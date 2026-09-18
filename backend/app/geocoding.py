"""Bounded Nominatim queries with a cross-process local cache/rate gate."""
import hashlib
from contextlib import contextmanager
from collections.abc import Iterator
import json
import math
import os
from pathlib import Path
import sqlite3
import tempfile
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from fastapi import HTTPException

ATTRIBUTION = "© OpenStreetMap contributors"
ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright"
MAX_BYTES = 262_144


def service_url() -> str:
    value = os.getenv("VENUE_GEOCODING_URL", "https://nominatim.openstreetmap.org").strip().rstrip("/")
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        return ""
    return value


def _cache_path() -> Path:
    # Shared by workers and local dev reloads; no business database or migration.
    configured = os.getenv("VENUE_GEOCODING_CACHE_PATH")
    return Path(configured) if configured else Path(tempfile.gettempdir()) / "livesetlist-geocoding.sqlite3"


@contextmanager
def _database() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(_cache_path(), timeout=2)
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS requests (key TEXT PRIMARY KEY, expires REAL NOT NULL, body TEXT NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS gate (service TEXT PRIMARY KEY, next_at REAL NOT NULL)")
        conn.commit()
        with conn:
            yield conn
    finally:
        conn.close()


def _reserve(service: str, key: str) -> Any:
    now = time.time()
    with _database() as conn:
        conn.execute("BEGIN IMMEDIATE")
        cached = conn.execute("SELECT body FROM requests WHERE key=? AND expires>?", (key, now)).fetchone()
        if cached:
            return json.loads(cached[0])
        gate = conn.execute("SELECT next_at FROM gate WHERE service=?", (service,)).fetchone()
        if gate and gate[0] > now:
            raise HTTPException(429, "地图查询较频繁，请稍后重试", headers={"Retry-After": str(math.ceil(gate[0] - now))})
        conn.execute("INSERT OR REPLACE INTO gate VALUES (?, ?)", (service, now + 1.1))
    return None


def _cooldown(service: str, seconds: int) -> None:
    with _database() as conn:
        conn.execute("INSERT INTO gate VALUES (?, ?) ON CONFLICT(service) DO UPDATE SET next_at=MAX(next_at, excluded.next_at)",
                     (service, time.time() + seconds))


def _query(path: str, params: dict[str, str]) -> Any:
    base = service_url()
    if not base:
        raise ValueError("未配置可用的地址解析服务")
    url = base + "/" + path + "?" + urlencode({"format": "jsonv2", "addressdetails": "1", **params})
    key = hashlib.sha256(url.encode()).hexdigest()
    cached = _reserve(base, key)
    if cached is not None:
        return cached
    request = Request(url, headers={"User-Agent": "LiveSetList-VenueEditor/1.0", "Accept": "application/json"})
    try:
        with urlopen(request, timeout=8) as response:
            raw = response.read(MAX_BYTES + 1)
    except HTTPError as exc:
        if exc.code == 429:
            retry = exc.headers.get("Retry-After", "60")
            seconds = max(1, min(int(retry), 3600)) if retry.isdigit() else 60
            _cooldown(base, seconds)
            raise HTTPException(429, "地址解析服务限流，请稍后重试", headers={"Retry-After": str(seconds)}) from exc
        if exc.code == 404 and path == "reverse":
            return {}
        raise ValueError("地址解析服务暂时不可用") from exc
    if len(raw) > MAX_BYTES:
        raise ValueError("地址解析响应过大")
    data = json.loads(raw)
    if not isinstance(data, (list, dict)):
        raise ValueError("无法识别地址解析结果")
    with _database() as conn:
        conn.execute("DELETE FROM requests WHERE expires < ?", (time.time(),))
        conn.execute("INSERT OR REPLACE INTO requests VALUES (?, ?, ?)", (key, time.time() + 86400, json.dumps(data)))
        conn.execute("DELETE FROM requests WHERE key NOT IN (SELECT key FROM requests ORDER BY expires DESC LIMIT 256)")
    return data


def _text(value: Any, limit: int = 500) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def _candidate(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    try:
        latitude, longitude = float(item["lat"]), float(item["lon"])
    except (KeyError, ValueError, TypeError):
        return None
    if not math.isfinite(latitude) or not math.isfinite(longitude) or abs(latitude) > 90 or abs(longitude) > 180:
        return None
    address = item.get("address")
    address = address if isinstance(address, dict) else {}
    country = _text(address.get("country_code")).upper()
    label = _text(item.get("display_name"))
    if not label:
        return None
    return {"name": _text(item.get("name")) or label, "address": label,
            "latitude": round(latitude, 6), "longitude": round(longitude, 6),
            "country_code": country if len(country) == 2 and country.isascii() and country.isalpha() else None,
            "admin_area": _text(address.get("state"), 120) or None,
            "locality_name": _text(address.get("city") or address.get("town") or address.get("village"), 120) or None}


def geocode(*, query: str | None = None, country_code: str | None = None,
            latitude: float | None = None, longitude: float | None = None) -> dict[str, Any]:
    try:
        if query is not None:
            params = {"q": query, "limit": "5"}
            if country_code:
                params["countrycodes"] = country_code.lower()
            data = _query("search", params)
            if not isinstance(data, list):
                raise ValueError("无法识别名称搜索结果")
            items = [candidate for item in data[:5] if (candidate := _candidate(item)) is not None]
        else:
            data = _query("reverse", {"lat": str(latitude), "lon": str(longitude), "zoom": "18"})
            if not isinstance(data, dict):
                raise ValueError("无法识别位置解析结果")
            candidate = _candidate(data)
            items = [candidate] if candidate else []
        return {"status": "ready" if items else "not_found", "items": items, "message": None,
                "attribution": ATTRIBUTION, "attribution_url": ATTRIBUTION_URL}
    except (ValueError, URLError, TimeoutError, OSError, sqlite3.Error):
        return {"status": "unavailable", "items": [], "message": "地址解析暂时不可用，可继续手工填写",
                "attribution": ATTRIBUTION, "attribution_url": ATTRIBUTION_URL}
