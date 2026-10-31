import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from contextlib import contextmanager
from types import SimpleNamespace
from datetime import datetime, timezone, timedelta

import pytest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("bang_dream_monitor", ROOT / "scripts/bang_dream_monitor.py")
assert SPEC is not None and SPEC.loader is not None
monitor = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = monitor
SPEC.loader.exec_module(monitor)
NOW = datetime(2026, 10, 30, 2, tzinfo=timezone(timedelta(hours=8)))


def card(url="https://bang-dream.com/events/example/", date="2026年11月1日", title="公演"):
    return {"url": url, "date": date, "title": title, "text": f"{title} {date}", "images": [], "links": []}


def detail(date="2026年11月1日", body="料金：100円", kind="events", image=False):
    prefix = "p-live-event-detail" if kind == "events" else "p-discography-detail"
    label = "開催日" if kind == "events" else "発売日"
    img = '<img src="/cover.png" alt="封面">' if image else ""
    return f'''<article class="{prefix}"><h1 class="{prefix}__header-title">公演</h1>
    <div class="{prefix}__table"><table><tr><th>{label}</th><td>{date}</td></tr></table></div>
    <div class="{prefix}__content"><p>{body}</p>{img}</div>
    <div class="c-post-share">动态分享按钮</div></article>'''


def index(cards, kind="events", next_link=""):
    prefix = "p-live-event-list" if kind == "events" else "p-discography-list"
    entries = []
    for entry in cards:
        entries.append(f'''<article class="{prefix}__item"><a class="{prefix}__item-link" href="{entry['url']}">
        <div class="{prefix}__item-title">{entry['title']}</div><div class="{prefix}__item-description">
        <h2 class="{prefix}__item-date">開催日</h2><p>{entry['date']}</p></div></a></article>''')
    return f'<section class="{prefix}">' + "".join(entries) + "</section>" + next_link


class FakeClient:
    def __init__(self, pages):
        self.pages = pages
        self.requests = []

    def get(self, url, headers=None):
        self.requests.append(url)
        value = self.pages[url]
        if isinstance(value, Exception):
            raise value
        return monitor.Response(url, value.encode() if isinstance(value, str) else value)


def changes(m):
    return [json.loads(row[0]) for row in m.db.execute("SELECT payload FROM changes ORDER BY id")]


# 测试点：遍历所有分页，并保留指向同一专题页的不同场次，末页禁用链接不造成循环。
def test_full_pagination_shared_event_url_and_disabled_next(tmp_path):
    first = card(date="2026年11月1日", title="DAY1")
    second = card(date="2026年11月2日", title="DAY2")
    pages = {
        monitor.SITE + "events/": index([first], next_link='<a class="next" href="/events/page/2/">下一页</a>'),
        monitor.SITE + "events/page/2/": index([second], next_link='<a class="next disabled" href="/events/page/2/">下一页</a>'),
    }
    m = monitor.Monitor(tmp_path, FakeClient(pages), NOW)
    result = m.scan("events")
    assert len(result) == 1
    assert [entry["title"] for entry in result[0]["variants"]] == ["DAY1", "DAY2"]
    assert "2026年11月2日" in result[0]["date"]
    m.db.close()


# 测试点：初始化包含历史详情且不通知现有内容，后续概览变动重新检查已归档详情。
def test_initial_history_and_changed_overview_rechecks_archived_detail(tmp_path):
    old = card(date="2025年1月1日")
    client = FakeClient({old["url"]: detail(date=old["date"])})
    m = monitor.Monitor(tmp_path, client, NOW)
    m.discover("events", [old])
    m.check_details("events")
    assert changes(m) == []
    assert m.db.execute("SELECT closed FROM items").fetchone()[0] == 1
    client.requests.clear()
    m.check_details("events")
    assert client.requests == []
    new = {**old, "title": "名称修正"}
    m.discover("events", [new])
    client.pages[old["url"]] = detail(date=old["date"], body="费用更正：200円")
    m.check_details("events")
    assert [entry["type"] for entry in changes(m)] == ["概览变化", "详情变化"]
    assert "200円" in changes(m)[1]["diff"]
    m.db.close()


# 测试点：概览未变时仍比较待开始详情，日期到期后做一次收尾，然后停止常规详情请求。
def test_active_details_and_one_final_check(tmp_path):
    entry = card(date="2026年10月30日")
    client = FakeClient({entry["url"]: detail(date=entry["date"])})
    m = monitor.Monitor(tmp_path, client, NOW)
    m.discover("events", [entry])
    m.check_details("events")
    client.pages[entry["url"]] = detail(date=entry["date"], body="新票务")
    m.check_details("events")
    assert len(changes(m)) == 1
    m.now = NOW + timedelta(days=2)
    client.pages[entry["url"]] = detail(date=entry["date"], body="最后更新")
    m.check_details("events")
    assert changes(m)[-1]["closing"] is True
    client.requests.clear()
    m.check_details("events")
    assert not client.requests
    m.db.close()


# 测试点：新条目与概览移除分别通知；详情失败保留旧快照且概览不再变化时仍重试。
def test_new_removed_and_failed_detail_retry(tmp_path):
    entry = card()
    client = FakeClient({entry["url"]: detail()})
    m = monitor.Monitor(tmp_path, client, NOW)
    m.discover("events", [entry])
    m.check_details("events")
    previous = m.db.execute("SELECT detail FROM items").fetchone()[0]
    added = card(url="https://bang-dream.com/events/new/", title="新公演")
    client.pages[entry["url"]] = RuntimeError("暂时不可用")
    client.pages[added["url"]] = detail(body="新活动")
    m.discover("events", [added])
    m.check_details("events")
    assert [entry["type"] for entry in changes(m)] == ["新增", "概览移除"]
    assert m.db.execute("SELECT detail FROM items WHERE present=0").fetchone()[0] == previous
    client.pages[entry["url"]] = detail(body="恢复后的更改")
    m.check_details("events")
    assert "恢复后的更改" in changes(m)[-1]["diff"]
    m.db.close()


# 测试点：初始化中断后继续补齐，不将原有条目当新增，也不重复报告未变化的内容。
def test_resume_partial_initialization(tmp_path):
    entry = card()
    client = FakeClient({entry["url"]: RuntimeError("timeout")})
    first = monitor.Monitor(tmp_path, client, NOW)
    first.discover("events", [entry])
    first.check_details("events")
    first.db.close()
    client.pages[entry["url"]] = detail()
    second = monitor.Monitor(tmp_path, client, NOW)
    second.discover("events", [entry])
    second.check_details("events")
    second.check_details("events")
    assert changes(second) == []
    assert second.db.execute("SELECT initial,pending FROM items").fetchone()[:] == (0, 0)
    second.db.close()


# 测试点：详情基线尚未建立时，已存在的概览基线仍能独立发现字段变化。
def test_overview_change_during_partial_initialization(tmp_path):
    entry = card()
    m = monitor.Monitor(tmp_path, FakeClient({}), NOW)
    m.discover("events", [entry])
    m.discover("events", [{**entry, "title": "延期后的名称"}])
    assert changes(m)[0]["type"] == "概览变化"
    assert "延期后的名称" in changes(m)[0]["diff"]
    m.db.close()


# 测试点：专题页和新闻型活动详情也建立内容基线，并沿用概览的演出日期而非正文票务日期。
@pytest.mark.parametrize("prefix", ["p-page-detail", "p-news-detail"])
def test_special_event_templates(prefix):
    page = f'<article class="{prefix}"><h1 class="{prefix}__header-title">特别公演</h1><p>抽選受付：2025年1月1日</p></article>'
    snapshot = monitor.parse_detail(page, "https://bang-dream.com/special/", "events", card())
    assert snapshot["date"] == "2026年11月1日"
    assert "特别公演" in snapshot["text"]


# 测试点：历史活动页的空 main 不遮蔽实际正文，图片日文路径保持可追踪。
@pytest.mark.parametrize("url,selector", [("https://anime.bang-dream.com/filmlive/news/20190909/post-17", "news-Detail"), ("https://bushiroad.com/gbp_srl2019", "pageMainContents")])
def test_legacy_external_empty_main(url, selector):
    page = f'<title>舞台挨拶</title><main></main><div class="{selector}"><p>公演案内</p><img src="/メイン場面写1.jpg"></div>'
    snapshot = monitor.parse_detail(page, url, "events", card())
    assert "公演案内" in snapshot["text"]
    assert snapshot["images"][0]["url"].endswith("/メイン場面写1.jpg")


# 测试点：HTTP 请求编码日文及空格文件名，同时保留已有百分号编码，避免历史图片永久抓取失败。
def test_unicode_asset_request(monkeypatch):
    requests = []
    @contextmanager
    def opened(request, timeout):
        requests.append(request.full_url)
        yield SimpleNamespace(url=request.full_url, headers={}, read=lambda limit: b"pixels")
    monkeypatch.setattr(monitor, "urlopen", opened)
    assert monitor.Client(interval=0).get("https://example.org/画像 1%20a.jpg").body == b"pixels"
    assert requests == ["https://example.org/%E7%94%BB%E5%83%8F%201%20a.jpg"]


# 测试点：官网提供的可执行链接不能进入可点击报告，错误页不能冒充站外活动详情。
def test_unsafe_link_and_external_error_page_rejected():
    with pytest.raises(ValueError):
        monitor.parse_index(index([card(url="javascript:alert(1)")]), monitor.SITE, "events")
    with pytest.raises(ValueError):
        monitor.parse_detail('<title>Access Denied</title><main>Temporarily blocked</main>', 'https://partner.example/show/', 'events', card())


# 测试点：巡演末场、模糊发行日期和异常日期保守保留监控。
@pytest.mark.parametrize("text,expected", [
    ("2026年10月24日(土)・25日(日)", "2026-10-25"),
    ("2027年4月4日(日)・4月10日(土)・5月23日(日)", "2027-05-23"),
    ("2026年12月31日・2027年1月1日", "2027-01-01"),
    ("2027年春リリース", None), ("未定", None), ("2027年2月30日", None),
    ("2026年11月1日・12月予定", None), ("2026年12月31日・1月1日", None),
])
def test_schedule_dates(text, expected):
    actual = monitor.last_date(text)
    assert (actual.isoformat() if actual else None) == expected


# 测试点：主题脚本、分享区和排版空白不产生通知，正文链接及图片网址修改仍可见。
def test_semantic_noise_and_link_changes():
    html = detail(body='票务 <a href="/ticket-a">购票</a>', image=True)
    first = monitor.parse_detail(html, monitor.SITE, "events")
    noisy = html.replace("动态分享按钮", "新的动态内容").replace("<p>", "<p class='new-theme'>  ") + '<script src="app.js?ver=123"></script>'
    assert monitor.difference(first, monitor.parse_detail(noisy, monitor.SITE, "events")) == ""
    changed = monitor.parse_detail(html.replace("/ticket-a", "/ticket-b"), monitor.SITE, "events")
    assert "ticket-b" in monitor.difference(first, changed)
    new_cover = monitor.parse_detail(html.replace("/cover.png", "/new-cover.png"), monitor.SITE, "events")
    assert "new-cover.png" in monitor.difference(first, new_cover)


# 测试点：无正文的 HTTP 200 错误页不能替换成功详情，目录故障不会被解释为全部移除。
def test_structure_failures_leave_state_and_check_existing_details(tmp_path):
    entry = card()
    client = FakeClient({entry["url"]: detail()})
    m = monitor.Monitor(tmp_path, client, NOW)
    m.discover("events", [entry])
    m.check_details("events")
    before = m.db.execute("SELECT detail FROM items").fetchone()[0]
    client.pages[entry["url"]] = "<html>maintenance</html>"
    m.check_details("events")
    assert m.db.execute("SELECT detail FROM items").fetchone()[0] == before
    result = m.run()
    assert result["errors"] >= 2
    db = monitor.connect(tmp_path)
    assert db.execute("SELECT present FROM items").fetchone()[0] == 1
    db.close()


# 测试点：通知失败保留待发送记录，确认后不重复通知，七天轮转只删除报告且正确转义官网内容。
def test_outbox_report_rotation_and_html_escaping(tmp_path):
    m = monitor.Monitor(tmp_path, FakeClient({}), NOW)
    with m.db:
        m.change({"type": "新增", "title": "<script>alert(1)</script>", "url": monitor.SITE})
    first = m.report()
    second = m.report()
    assert first["changes"] == second["changes"] == 1
    assert "<script>alert" not in Path(first["report"]).read_text(encoding="utf-8")
    monitor.acknowledge(tmp_path, Path(first["ack_report"]))
    assert m.report()["changes"] == 0
    stale = tmp_path / "reports" / "20261001T020000-12345678.html"
    stale.write_text("old", encoding="utf-8")
    old_time = (NOW - timedelta(days=8)).timestamp()
    os.utime(stale, (old_time, old_time))
    unrelated = tmp_path / "reports" / "user-notes.txt"
    unrelated.write_text("keep", encoding="utf-8")
    os.utime(unrelated, (old_time, old_time))
    monitor.rotate_reports(tmp_path / "reports", NOW)
    assert not stale.exists()
    assert unrelated.exists() and (tmp_path / "state.sqlite3").exists()
    m.db.close()


# 测试点：损坏的状态库必须生成失败报告且保留原文件，不能静默重建并丢失比较基线。
def test_corrupt_state_reports_failure_without_reset(tmp_path, monkeypatch, capsys):
    state = tmp_path / "state.sqlite3"
    state.write_bytes(b"corrupt state")
    monkeypatch.setattr(sys, "argv", ["monitor", "--state-dir", str(tmp_path)])
    assert monitor.main() == 1
    result = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert result["notify"] and result["errors"] == 1
    assert Path(result["report"]).is_file()
    assert state.read_bytes() == b"corrupt state"


# 测试点：第二个并发进程不能取得监控锁，而释放后的锁可被后续运行重新取得。
def test_lock_exclusion_and_release(tmp_path):
    with monitor.exclusive(tmp_path):
        with pytest.raises(OSError):
            with monitor.exclusive(tmp_path):
                pytest.fail("concurrent acquisition")
    with monitor.exclusive(tmp_path):
        assert (tmp_path / "monitor.lock").exists()


# 测试点：多个 Python 候选时只启动优先解释器，真实子进程的参数、输出和退出状态保持正确。
@pytest.mark.parametrize("exit_code,stream", [(0, False), (7, True)])
def test_powershell_python_launch_with_multiple_candidates(tmp_path, exit_code, stream):
    shell = shutil.which("powershell.exe") or shutil.which("pwsh")
    if not shell:
        pytest.skip("PowerShell unavailable on this platform")
    child = tmp_path / "child.py"
    child.write_text("import json, sys\nprint(json.dumps(sys.argv[1:]))\nsys.exit(int(sys.argv[1]))\n", encoding="utf-8")
    script = tmp_path / "launch.ps1"
    entry = str(ROOT / "scripts/backup_app_auto.ps1").replace("'", "''")
    interpreter = sys.executable.replace("'", "''")
    child_path = str(child).replace("'", "''")
    script.write_text(f"""
    . '{entry}'
    function Get-Command {{
        param($Name, $CommandType, $ErrorAction)
        [pscustomobject]@{{Source='{interpreter}'}}
        [pscustomobject]@{{Source='C:\\unavailable-python\\python.exe'}}
    }}
    Invoke-PythonCommand -Arguments @('{child_path}', '{exit_code}', 'two words') -StreamProgress:${str(stream).lower()} | ConvertTo-Json -Depth 4 -Compress
    """, encoding="utf-8-sig")
    process = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script)], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
    assert process.returncode == 0, process.stderr
    actual = json.loads(process.stdout.strip().splitlines()[-1])
    assert actual["ExitCode"] == exit_code
    assert json.loads(actual["Output"][-1]) == [str(exit_code), "two words"]


# 测试点：Windows 编排在备份失败后仍按顺序查询，通知失败不确认变化，查询失败不能返回成功。
@pytest.mark.parametrize("backup_code,monitor_code,shown,expected,acknowledged", [
    (0, 0, True, 0, True), (1, 0, True, 1, True), (-1, 0, True, 1, True),
    (0, 1, True, 1, True), (0, 0, False, 1, False), (0, -1, True, 1, False),
])
def test_powershell_sequential_orchestration(tmp_path, backup_code, monitor_code, shown, expected, acknowledged):
    shell = shutil.which("powershell.exe") or shutil.which("pwsh")
    if not shell:
        pytest.skip("PowerShell unavailable on this platform")
    script = tmp_path / "orchestration.ps1"
    entry = str(ROOT / "scripts/backup_app_auto.ps1").replace("'", "''")
    script.write_text(f'''
    . '{entry}'
    $projectRoot = '{str(tmp_path).replace("'", "''")}'
    $steps = [System.Collections.Generic.List[string]]::new()
    $exitCode = Invoke-DailyMaintenance -BackupAction {{
        $steps.Add('backup')
        if ({backup_code} -eq -1) {{ throw 'backup process failed to launch' }}
        [pscustomobject]@{{ExitCode={backup_code};Output=@('backup result')}}
    }} -MonitorAction {{
        $steps.Add('monitor')
        if ({monitor_code} -eq -1) {{ throw 'monitor process failed to launch' }}
        [pscustomobject]@{{ExitCode={monitor_code};Output=@('{{"notify":true,"summary":"changed","errors":{monitor_code},"changes":1,"ack_report":"report.json","report":"report.html"}}')}}
    }} -NotifyAction {{
        param($title,$message,$level)
        return ${str(shown).lower()}
    }} -AckAction {{
        param($report)
        $steps.Add('ack')
        [pscustomobject]@{{ExitCode=0;Output=@()}}
    }}
    @{{code=$exitCode;steps=@($steps.ToArray())}} | ConvertTo-Json -Compress
    ''', encoding="utf-8-sig")
    process = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script)], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
    assert process.returncode == 0, process.stderr
    actual = json.loads(process.stdout.strip().splitlines()[-1])
    assert actual["code"] == expected
    assert actual["steps"] == ["backup", "monitor"] + (["ack"] if acknowledged else [])
    if monitor_code == -1:
        assert list((tmp_path / ".tmp/bang-dream-monitor/reports").glob("*.html"))


# 测试点：首轮完整扫描，后续在未变化页停止且保留后页条目，并继续检查其中的未开始详情。
@pytest.mark.parametrize("kind", ["events", "discographies"])
def test_stop_at_unchanged_page_preserves_later_details(tmp_path, kind):
    entries = [card(url=f"https://bang-dream.com/{kind}/{n}/", title=f"活动{n}") for n in range(1, 4)]
    urls = [monitor.SITE + kind + "/", monitor.SITE + kind + "/page/2/", monitor.SITE + kind + "/page/3/"]
    pages = {url: index([entry], kind, f'<a class="next" href="{urls[n+1]}">next</a>' if n < 2 else "") for n, (url, entry) in enumerate(zip(urls, entries))}
    pages.update({entry["url"]: detail(kind=kind) for entry in entries})
    client = FakeClient(pages)
    m = monitor.Monitor(tmp_path, client, NOW)
    m.discover(kind, m.scan(kind))
    m.check_details(kind)
    assert all(url in client.requests for url in urls)
    client.requests.clear()
    client.pages[urls[0]] = index([{**entries[0], "title": "更名"}], kind, f'<a class="next" href="{urls[1]}">next</a>')
    client.pages[entries[2]["url"]] = detail(kind=kind, body="后页的票务变更")
    m.discover(kind, m.scan(kind))
    m.check_details(kind)
    assert urls[0] in client.requests and urls[1] in client.requests and urls[2] not in client.requests
    assert m.db.execute("SELECT COUNT(*) FROM items WHERE present=1").fetchone()[0] == 3
    assert [entry["type"] for entry in changes(m)] == ["概览变化", "详情变化"]
    assert "后页的票务变更" in changes(m)[-1]["diff"]
    m.db.close()
