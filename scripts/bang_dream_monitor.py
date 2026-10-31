"""Daily, resumable BanG Dream catalog monitoring (Python standard library only)."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
import difflib
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sqlite3
import sys
import time
from threading import Lock
from typing import Any, Iterator
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STATE = ROOT / ".tmp" / "bang-dream-monitor"
SITE = "https://bang-dream.com/"
KINDS = {"events": "live-event", "discographies": "discography"}
JST = timezone(timedelta(hours=9))
CST = timezone(timedelta(hours=8))
# Explicit user exclusions: keep overview monitoring, skip these historical details.
DETAIL_EXCLUSIONS = {
    "https://www.galaxymobile.jp/explore/event/galaxy-bangdream-note10/?cid=jp_links_bd-official_bangdream_20191101",
    "https://www.animax.co.jp/animaxmusix",
    "https://www.bang-dream-museum.com",
}


def detail_excluded(overview: dict[str, Any]) -> bool:
    return url_key(overview["url"]).rstrip("/") in DETAIL_EXCLUSIONS


def packed(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def url_key(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, parts.query, ""))


@dataclass
class Node:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list[Node | str] = field(default_factory=list)

    def walk(self) -> Iterator[Node]:
        yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.walk()

    def has(self, name: str) -> bool:
        return name in self.attrs.get("class", "").split()

    def find(self, name: str) -> Node | None:
        return next((node for node in self.walk() if node.has(name)), None)

    def text(self) -> str:
        return clean(" ".join(child.text() if isinstance(child, Node) else child for child in self.children))


class Tree(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self, html: str):
        super().__init__(convert_charrefs=True)
        self.root = Node("document")
        self.stack = [self.root]
        self.feed(html)
        self.close()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = Node(tag, {key: value or "" for key, value in attrs})
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        self.stack[-1].children.append(data)


def semantic(node: Node, base: str) -> dict[str, Any]:
    """Retain content/links/media, not theme classes or request-time script versions."""
    lines: list[str] = []
    links: list[dict[str, str]] = []
    images: list[dict[str, str]] = []
    excluded = {"c-post-share", "c-post-pager", "c-post-header", "p-live-event-detail__goods"}
    blocks = {"p", "div", "li", "ul", "ol", "table", "tr", "td", "th", "section", "br", "h1", "h2", "h3", "h4", "h5", "h6"}

    def visit(part: Node | str) -> None:
        if isinstance(part, str):
            lines.append(part)
            return
        if part.tag in {"script", "style", "noscript"} or any(part.has(x) for x in excluded):
            return
        if part.tag in blocks:
            lines.append("\n")
        if part.tag == "a" and part.attrs.get("href"):
            href = urljoin(base, part.attrs["href"])
            if urlsplit(href).scheme in {"https", "http", "mailto", "tel"}:
                links.append({"text": part.text(), "url": href})
        if part.tag == "img":
            src = part.attrs.get("data-src") or part.attrs.get("src", "")
            if src and urlsplit(urljoin(base, src)).scheme in {"https", "http"}:
                images.append({"url": urljoin(base, src), "alt": part.attrs.get("alt", "")})
        if part.tag in {"iframe", "video", "audio", "source", "object"}:
            src = part.attrs.get("src") or part.attrs.get("data", "")
            if src:
                links.append({"text": part.tag, "url": urljoin(base, src)})
        if part.tag in {"del", "s"}:
            lines.append("[删除线]")
        for child in part.children:
            visit(child)
        if part.tag in blocks:
            lines.append("\n")

    visit(node)
    return {"text": "\n".join(line for line in (clean(x) for x in "".join(lines).splitlines()) if line), "links": links, "images": images}


def parse_index(html: str, base: str, kind: str) -> tuple[list[dict[str, Any]], str | None]:
    root = Tree(html).root
    prefix = "p-" + KINDS[kind] + "-list"
    container = root.find(prefix)
    if container is None:
        raise ValueError(f"概览结构缺失: {base}")
    result = []
    for card in container.walk():
        if not card.has(prefix + "__item"):
            continue
        link = card.find(prefix + "__item-link")
        title = card.find(prefix + "__item-title")
        if link is None or title is None or not link.attrs.get("href") or not title.text():
            raise ValueError(f"概览条目不完整: {base}")
        url = url_key(urljoin(base, link.attrs["href"]))
        if urlsplit(url).scheme not in {"https", "http"}:
            raise ValueError(f"不支持的详情链接: {url}")
        snapshot = semantic(card, base)
        date_label = card.find(prefix + "__item-date")
        date_text = ""
        if date_label:
            description = card.find(prefix + "__item-description")
            if description:
                nodes = list(description.walk())
                position = nodes.index(date_label)
                date_text = next((n.text() for n in nodes[position + 1:] if n.tag == "p"), "")
        snapshot.update(title=title.text(), date=date_text, url=url)
        result.append(snapshot)
    if not result:
        raise ValueError(f"概览为空，保留原基线: {base}")
    next_node = next((n for n in root.walk() if n.tag == "a" and n.has("next") and not n.has("disabled") and n.attrs.get("href")), None)
    return result, urljoin(base, next_node.attrs["href"]) if next_node else None


def parse_detail(html: str, base: str, kind: str, overview: dict[str, Any] | None = None) -> dict[str, Any]:
    root = Tree(html).root
    prefix = "p-" + KINDS[kind] + "-detail"
    content = root.find(prefix)
    title = root.find(prefix + "__header-title")
    table = root.find(prefix + "__table")
    if content is None and kind == "events":
        for alternative in ("p-page-detail", "p-news-detail"):
            content = root.find(alternative)
            if content:
                title = content.find(alternative + "__header-title")
                break
        if content is None and urlsplit(base).netloc != "bang-dream.com":
            # Some directory entries link straight to a partner's event microsite.
            content = next((n for n in root.walk() if n.tag == "main"), None)
            title = next((n for n in root.walk() if n.tag == "title"), None)
            if content is None or not (content.text() or any(n.tag == "img" for n in content.walk())):
                legacy = {"anime.bang-dream.com": "news-Detail", "bang-dream.bushimo.jp": "idx-Wrapper", "www.choujigen-ongakusai.jp": "all", "bushiroad.com": "pageMainContents"}
                selector = legacy.get(urlsplit(base).netloc)
                content = root.find(selector) if selector else None
        if content and title and (content.text() or any(n.tag == "img" for n in content.walk())):
            if re.search(r"access denied|just a moment|captcha|ページが見つかりません|404 not found", title.text(), re.I):
                raise ValueError(f"详情返回拦截/错误页面: {base}")
            snapshot = semantic(content, base)
            snapshot.update(title=title.text(), date=(overview or {}).get("date", ""), fields={}, resolved_url=base)
            return snapshot
    if content is None or title is None or table is None or not title.text():
        raise ValueError(f"详情结构缺失，保留原基线: {base}")
    snapshot = semantic(content, base)
    fields = {}
    for row in table.walk():
        if row.tag == "tr":
            cells = [n for n in row.walk() if n.tag in {"th", "td"}]
            if len(cells) >= 2:
                fields[cells[0].text()] = " ".join(n.text() for n in cells[1:])
    snapshot.update(title=title.text(), date=fields.get("開催日", fields.get("発売日", (overview or {}).get("date", ""))), fields=fields, resolved_url=base)
    return snapshot


def last_date(text: str) -> date | None:
    """Japanese repeated dates inherit year/month; imprecise dates stay monitored."""
    if not text or re.search(r"未定|延期|調整|春|夏|秋|冬|上旬|中旬|下旬|予定.*未", text):
        return None
    text = re.sub(r"(\d{4})[./-](\d{1,2})[./-](\d{1,2})", r"\1年\2月\3日", text)
    matches = list(re.finditer(r"(?:(\d{4})年)?\s*(?:(\d{1,2})月)?\s*(\d{1,2})日", text))
    dates = []
    year = month = None
    try:
        for match in matches:
            new_year, new_month, day = match.groups()
            if new_year:
                year = int(new_year)
            if new_month:
                # Never silently roll a missing year across December/January.
                if month and int(new_month) < month and not new_year:
                    return None
                month = int(new_month)
            if year is None or month is None:
                return None
            dates.append(date(year, month, int(day)))
    except ValueError:
        return None
    # A mixture of precise and month-only dates is not a known final date.
    residue = text
    for match in reversed(matches):
        residue = residue[:match.start()] + residue[match.end():]
    if re.search(r"\d\s*[年月日]", residue):
        return None
    return max(dates) if dates else None


def active(overview: dict[str, Any], detail: dict[str, Any] | None, kind: str, now: datetime) -> bool:
    # Both sources must prove expiry. A changed/unknown date never prematurely archives an item.
    sources = [overview] + ([detail] if detail else [])
    for source in sources:
        final = last_date(source.get("date", ""))
        if final is None:
            return True
        offset = 9
        if kind == "events":
            location = source.get("fields", {}).get("場所", "") or overview.get("text", "")
            if re.search(r"香港|台北|台湾|臺灣|上海|北京|深圳|广州|廣州|新加坡|シンガポール|Singapore|Hong Kong|Taipei", location, re.I):
                offset = 8
            elif re.search(r"バンコク|Bangkok|タイ王国|ジャカルタ|Jakarta", location, re.I):
                offset = 7
            elif re.search(r"海外|アメリカ|米国|ロサンゼルス|Los Angeles|ヨーロッパ|ロンドン|London", location, re.I):
                # Unknown/DST zones: latest possible civil date, conservatively retaining the day.
                offset = -12
        if final >= now.astimezone(timezone(timedelta(hours=offset))).date():
            return True
    return False


@dataclass
class Response:
    url: str
    body: bytes
    headers: dict[str, str] = field(default_factory=dict)
    status: int = 200


class Client:
    def __init__(self, interval: float = 0.1):
        self.interval = interval
        self.previous = 0.0
        self.rate_lock = Lock()

    def get(self, url: str, headers: dict[str, str] | None = None) -> Response:
        if urlsplit(url).scheme not in {"http", "https"}:
            raise ValueError(f"不支持的 URL: {url}")
        for attempt in range(3):
            with self.rate_lock:
                time.sleep(max(0.0, self.previous + self.interval - time.monotonic()))
                self.previous = time.monotonic()
            # Legacy uploads contain literal Japanese filenames and spaces.
            encoded_url = quote(url, safe=":/?&=;%+@!$'()*,-._~#[]")
            request = Request(encoded_url, headers={"User-Agent": "LiveSetList-CatalogMonitor/1.0", **(headers or {})})
            try:
                with urlopen(request, timeout=25) as response:
                    body = response.read(25 * 1024 * 1024 + 1)
                    if len(body) > 25 * 1024 * 1024:
                        raise ValueError(f"资源超过 25 MiB: {url}")
                    return Response(response.url, body, {k.lower(): v for k, v in response.headers.items()})
            except HTTPError as error:
                if error.code == 304:
                    return Response(url, b"", status=304)
                if error.code not in {408, 429, 500, 502, 503, 504} or attempt == 2:
                    raise
                retry = error.headers.get("Retry-After", "")
                time.sleep(min(30, int(retry)) if retry.isdigit() else 2 ** attempt)
            except (URLError, TimeoutError, OSError):
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
        raise RuntimeError("请求重试已耗尽")


def connect(directory: Path) -> sqlite3.Connection:
    directory.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(directory / "state.sqlite3")
    db.row_factory = sqlite3.Row
    db.executescript("""
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS items (
            key TEXT PRIMARY KEY, kind TEXT NOT NULL, overview TEXT NOT NULL,
            detail TEXT, initial INTEGER NOT NULL, pending INTEGER NOT NULL DEFAULT 1,
            closed INTEGER NOT NULL DEFAULT 0, present INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS pages (
            kind TEXT NOT NULL, url TEXT NOT NULL, cards TEXT NOT NULL, PRIMARY KEY(kind,url));
        CREATE TABLE IF NOT EXISTS changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, run TEXT NOT NULL,
            payload TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0);
    """)
    return db


@contextmanager
def exclusive(directory: Path) -> Iterator[None]:
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "monitor.lock").open("a+b") as handle:
        handle.seek(0)
        if not handle.read(1):
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        if sys.platform == "win32":
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            handle.seek(0)
            if sys.platform == "win32":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def difference(old: dict[str, Any], new: dict[str, Any]) -> str:
    # Ignore the retired byte hashes when comparing an existing baseline.
    before, after = dict(old), dict(new)
    before.pop("image_hashes", None)
    after.pop("image_hashes", None)
    return "\n".join(difflib.unified_diff(
        json.dumps(before, ensure_ascii=False, indent=2, sort_keys=True).splitlines(),
        json.dumps(after, ensure_ascii=False, indent=2, sort_keys=True).splitlines(),
        fromfile="上次成功快照", tofile="本次快照", lineterm=""))


class Monitor:
    def __init__(self, directory: Path, client: Client, now: datetime | None = None):
        self.directory = directory
        self.client = client
        self.now = now or datetime.now(timezone.utc)
        self.run_id = self.now.astimezone(CST).strftime("%Y%m%dT%H%M%S") + "-" + uuid4().hex[:8]
        self.db = connect(directory)
        self.errors: list[str] = []
        self.scanned_pages: dict[str, dict[str, list[dict[str, Any]]]] = {}
        self.checks: list[dict[str, Any]] = []
        self.checked = 0

    def progress(self, message: str) -> None:
        print(message, flush=True)

    def scan(self, kind: str) -> list[dict[str, Any]]:
        url: str | None = SITE + kind + "/"
        visited: set[str] = set()
        saved = {row["url"]: json.loads(row["cards"]) for row in self.db.execute("SELECT * FROM pages WHERE kind=?", (kind,))}
        pages: dict[str, list[dict[str, Any]]] = {}
        while url:
            if url in visited or len(visited) >= 500:
                raise ValueError(f"分页循环或超出限制: {url}")
            if urlsplit(url).netloc != "bang-dream.com" or not urlsplit(url).path.startswith("/" + kind + "/"):
                raise ValueError(f"异常分页地址: {url}")
            visited.add(url)
            response = self.client.get(url)
            page_url = url
            cards, url = parse_index(response.body.decode("utf-8-sig"), response.url, kind)
            pages[page_url] = cards
            self.progress(f"{kind}: 已读取 {len(visited)} 页")
            if saved.get(page_url) == cards:
                # Unvisited pages remain baseline data, never inferred removals.
                pages = {**saved, **pages}
                self.progress(f"{kind}: 当前页无变化，停止翻页")
                break
        self.scanned_pages[kind] = pages
        items: dict[str, list[dict[str, Any]]] = {}
        for cards in pages.values():
            for card in cards:
                key = card["url"].rstrip("/")
                variants = items.setdefault(key, [])
                if card not in variants:
                    variants.append(card)
        result = []
        for variants in items.values():
            if len(variants) == 1:
                result.append(variants[0])
            else:
                variants.sort(key=packed)
                result.append({"url": variants[0]["url"], "title": " / ".join(dict.fromkeys(v["title"] for v in variants)),
                               "date": "・".join(v["date"] for v in variants), "text": "\n".join(v["text"] for v in variants), "variants": variants})
        return result

    def change(self, payload: dict[str, Any]) -> None:
        self.db.execute("INSERT INTO changes(run,payload) VALUES (?,?)", (self.run_id, packed(payload)))

    def discover(self, kind: str, cards: list[dict[str, Any]]) -> None:
        initial = self.db.execute("SELECT 1 FROM meta WHERE key=?", (kind,)).fetchone() is None
        seen = set()
        with self.db:
            if kind in self.scanned_pages:
                self.db.execute("DELETE FROM pages WHERE kind=?", (kind,))
                self.db.executemany("INSERT INTO pages VALUES (?,?,?)", [(kind, url, packed(entries)) for url, entries in self.scanned_pages.pop(kind).items()])
            for card in cards:
                # Discography IDs survive a canonical path's trailing-slash changes.
                identifier = re.search(r"/discographies/(\d+)/?$", urlsplit(card["url"]).path) if kind == "discographies" else None
                key = kind + ":" + (identifier.group(1) if identifier else card["url"].rstrip("/"))
                seen.add(key)
                previous = self.db.execute("SELECT * FROM items WHERE key=?", (key,)).fetchone()
                if previous is None:
                    self.db.execute("INSERT INTO items(key,kind,overview,initial) VALUES (?,?,?,?)", (key, kind, packed(card), int(initial)))
                    if not initial:
                        self.change({"type": "新增", "title": card["title"], "url": card["url"], "overview": card})
                elif previous["overview"] != packed(card) or not previous["present"]:
                    diff = difference(json.loads(previous["overview"]), card)
                    self.change({"type": "概览变化" if previous["present"] else "概览重新出现", "title": card["title"], "url": card["url"], "diff": diff})
                    self.db.execute("UPDATE items SET overview=?,pending=1,present=1 WHERE key=?", (packed(card), key))
            for row in self.db.execute("SELECT * FROM items WHERE kind=? AND present=1", (kind,)).fetchall():
                if row["key"] not in seen:
                    card = json.loads(row["overview"])
                    self.change({"type": "概览移除", "title": card["title"], "url": card["url"]})
                    self.db.execute("UPDATE items SET present=0,pending=1 WHERE key=?", (row["key"],))
            self.db.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (kind, self.now.isoformat()))

    def check_details(self, kind: str) -> None:
        rows = self.db.execute("SELECT * FROM items WHERE kind=? ORDER BY key", (kind,)).fetchall()
        selected = []
        for row in rows:
            overview = json.loads(row["overview"])
            if detail_excluded(overview):
                self.checks.append({"kind": kind, "title": overview["title"], "url": overview["url"],
                                    "initial": False, "status": "已排除（用户指定不检查详情）"})
                continue
            old = json.loads(row["detail"]) if row["detail"] else None
            watching = active(overview, old, kind, self.now)
            if row["pending"] or old is None or watching or not row["closed"]:
                selected.append((row, overview, old))
        # Fetch concurrently, while keeping SQLite commits on the owning thread.
        with ThreadPoolExecutor(max_workers=12) as pool:
            jobs = {pool.submit(self.client.get, entry[1]["url"]): entry for entry in selected}
            for future in as_completed(jobs):
                row, overview, old = jobs[future]
                self.save_detail(kind, row, overview, old, future, len(selected))

    def save_detail(self, kind: str, row: sqlite3.Row, overview: dict[str, Any], old: dict[str, Any] | None, future: Any, total: int) -> None:
        record = {"kind": kind, "title": overview["title"], "url": overview["url"], "initial": bool(row["initial"])}
        try:
            response = future.result()
            snapshot = parse_detail(response.body.decode("utf-8-sig"), response.url, kind, overview)
            closing = not active(overview, snapshot, kind, self.now)
            diff = difference(old, snapshot) if old else ""
            with self.db:
                if diff and not row["initial"]:
                    self.change({"type": "详情变化", "title": overview["title"], "url": overview["url"], "closing": closing, "diff": diff})
                self.db.execute("UPDATE items SET detail=?,initial=0,pending=?,closed=? WHERE key=?", (packed(snapshot), 0, int(closing), row["key"]))
            self.checked += 1
            record.update(status="成功", closing=closing)
            self.progress(f"{kind}: 已保存详情（本组目标 {total} 项）: {overview['title']}")
        except Exception as error:
            with self.db:
                self.db.execute("UPDATE items SET pending=1 WHERE key=?", (row["key"],))
            self.errors.append(f"详情检查失败: {overview['url']}: {error}")
            record.update(status="失败", error=str(error))
            self.progress(self.errors[-1])
        self.checks.append(record)

    def run(self) -> dict[str, Any]:
        try:
            for kind in KINDS:
                try:
                    self.discover(kind, self.scan(kind))
                except Exception as error:
                    self.errors.append(f"{kind} 概览扫描失败（不推断移除）: {error}")
                # Even an index outage must not disable already-known active detail checks.
                self.check_details(kind)
            return self.report()
        finally:
            self.db.close()

    def report(self) -> dict[str, Any]:
        notifications = [{"id": row["id"], **json.loads(row["payload"])} for row in self.db.execute("SELECT * FROM changes WHERE notified=0 ORDER BY id")]
        pending = sum(not detail_excluded(json.loads(row["overview"])) for row in self.db.execute("SELECT overview FROM items WHERE detail IS NULL OR initial=1"))
        excluded = sum(detail_excluded(json.loads(row["overview"])) for row in self.db.execute("SELECT overview FROM items"))
        closed = self.db.execute("SELECT COUNT(*) FROM items WHERE closed=1").fetchone()[0]
        total = self.db.execute("SELECT COUNT(*) FROM items").fetchone()[0]
        result = {"run": self.run_id, "time": self.now.astimezone(CST).isoformat(), "checked": self.checked,
                  "total": total, "baseline_pending": pending, "closed": closed, "excluded": excluded,
                  "notifications": notifications, "errors": self.errors, "checks": self.checks}
        reports = self.directory / "reports"
        reports.mkdir(parents=True, exist_ok=True)
        json_path = reports / (self.run_id + ".json")
        html_path = reports / (self.run_id + ".html")
        summary = f"新增/变化 {len(notifications)} 项；本次检查详情 {self.checked} 项；待初始化 {pending} 项；已排除详情 {excluded} 项；异常 {len(self.errors)} 项。"
        sections = ["<!doctype html><meta charset='utf-8'><title>BanG Dream 官网监控报告</title>",
                    "<style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:0 20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:16px}a{overflow-wrap:anywhere}</style>",
                    f"<h1>BanG Dream 官网监控报告</h1><p>{escape(result['time'])}</p><p>{escape(summary)}</p>",
                    "<p>记录的是检查时发现的变化，不推断官网实际修改时间。首次建立的快照不作为新增通知。</p>"]
        for change in notifications:
            sections.append(f"<h2>{escape(change['type'])}{'（收尾）' if change.get('closing') else ''}：{escape(change['title'])}</h2>")
            sections.append(f"<p><a href='{escape(change['url'], quote=True)}'>{escape(change['url'])}</a></p>")
        if not notifications:
            sections.append("<p>本次没有待通知的新增或变化。</p>")
        for error in self.errors:
            sections.append(f"<pre>{escape(error)}</pre>")
        sections.append("<details><summary>本次详情检查明细</summary><ul>")
        for record in self.checks:
            phase = "初始化" if record["initial"] else ("收尾" if record.get("closing") else "监控")
            sections.append(f"<li>{phase} · {escape(record['status'])} · <a href='{escape(record['url'], quote=True)}'>{escape(record['title'])}</a></li>")
        sections.append("</ul></details>")
        for path, content in [(json_path, json.dumps(result, ensure_ascii=False, indent=2)), (html_path, "\n".join(sections))]:
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_text(content, encoding="utf-8")
            temporary.replace(path)
        rotate_reports(reports, self.now)
        return {"summary": summary, "report": str(html_path.resolve()), "ack_report": str(json_path.resolve()),
                "notify": bool(notifications or self.errors), "errors": len(self.errors), "changes": len(notifications), "baseline_pending": pending}


def rotate_reports(reports: Path, now: datetime) -> None:
    cutoff = now.timestamp() - timedelta(days=7).total_seconds()
    for path in reports.iterdir():
        if re.fullmatch(r"\d{8}T\d{6}-[0-9a-f]{8}\.(html|json)", path.name) and path.is_file() and not path.is_symlink() and path.stat().st_mtime < cutoff:
            path.unlink()


def acknowledge(directory: Path, report: Path) -> None:
    if report.resolve().parent != (directory / "reports").resolve() or report.suffix != ".json":
        raise ValueError("只能确认本监控目录下的 JSON 报告")
    data = json.loads(report.read_text(encoding="utf-8"))
    db = connect(directory)
    try:
        with db:
            for entry in data["notifications"]:
                db.execute("UPDATE changes SET notified=1 WHERE id=?", (entry["id"],))
    finally:
        db.close()


def failure_report(directory: Path, error: Exception) -> dict[str, Any]:
    """A corrupt state DB or other startup failure must still produce a report."""
    now = datetime.now(timezone.utc)
    run_id = now.astimezone(CST).strftime("%Y%m%dT%H%M%S") + "-" + uuid4().hex[:8]
    result: dict[str, Any] = {"summary": f"监控运行失败: {error}", "notify": True, "errors": 1, "changes": 0, "report": "", "ack_report": ""}
    try:
        reports = directory / "reports"
        reports.mkdir(parents=True, exist_ok=True)
        html_path = reports / (run_id + ".html")
        (reports / (run_id + ".json")).write_text(json.dumps({"run": run_id, "time": now.astimezone(CST).isoformat(), "errors": [str(error)], "notifications": []}, ensure_ascii=False, indent=2), encoding="utf-8")
        html_path.write_text("<!doctype html><meta charset='utf-8'><title>官网监控失败</title><h1>官网监控失败</h1><pre>" + escape(str(error)) + "</pre>", encoding="utf-8")
        result["report"] = str(html_path.resolve())
        rotate_reports(reports, now)
    except OSError as report_error:
        result["summary"] += f"；报告写入失败: {report_error}"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--ack-report", type=Path, help="仅在 Windows 通知接口成功调用后确认已提交的变更")
    args = parser.parse_args()
    try:
        with exclusive(args.state_dir):
            if args.ack_report:
                acknowledge(args.state_dir, args.ack_report)
                return 0
            result = Monitor(args.state_dir, Client()).run()
            print(json.dumps(result, ensure_ascii=False), flush=True)
            return 1 if result["errors"] else 0
    except Exception as error:
        print(json.dumps(failure_report(args.state_dir, error), ensure_ascii=False), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
