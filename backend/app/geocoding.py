"""Google Places and Geocoding queries with a bounded local response cache."""

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
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

ATTRIBUTION = "Google Maps"
ATTRIBUTION_URL = "https://maps.google.com/"
MAX_BYTES = 262_144


def server_api_key() -> str:
    return os.getenv("GOOGLE_MAPS_SERVER_API_KEY", "").strip()


def _cache_path() -> Path:
    configured = os.getenv("GOOGLE_MAPS_CACHE_PATH")
    return Path(configured) if configured else Path(tempfile.gettempdir()) / "livesetlist-google-maps.sqlite3"


@contextmanager
def _database() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(_cache_path(), timeout=2)
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS requests (key TEXT PRIMARY KEY, expires REAL NOT NULL, body TEXT NOT NULL)")
        conn.commit()
        with conn:
            yield conn
    finally:
        conn.close()


def _request_json(url: str, *, method: str = "GET", body: dict[str, Any] | None = None,
                  field_mask: str | None = None) -> Any:
    api_key = server_api_key()
    if not api_key:
        raise ValueError("未配置 Google Maps 服务端 API Key")
    cache_key = hashlib.sha256(
        json.dumps({"url": url, "body": body, "field_mask": field_mask}, sort_keys=True).encode()
    ).hexdigest()
    now = time.time()
    with _database() as conn:
        cached = conn.execute("SELECT body FROM requests WHERE key=? AND expires>?", (cache_key, now)).fetchone()
        if cached:
            return json.loads(cached[0])
    headers = {"Accept": "application/json", "X-Goog-Api-Key": api_key}
    raw_body = None
    if field_mask:
        headers["X-Goog-FieldMask"] = field_mask
    if body is not None:
        headers["Content-Type"] = "application/json"
        raw_body = json.dumps(body).encode()
    request = Request(url, data=raw_body, method=method, headers=headers)
    try:
        with urlopen(request, timeout=8) as response:
            raw = response.read(MAX_BYTES + 1)
    except HTTPError as exc:
        if exc.code == 404:
            return {}
        raise ValueError("Google Maps 地址解析暂时不可用") from exc
    if len(raw) > MAX_BYTES:
        raise ValueError("Google Maps 地址解析响应过大")
    data = json.loads(raw)
    if not isinstance(data, (list, dict)):
        raise ValueError("无法识别 Google Maps 地址解析结果")
    with _database() as conn:
        conn.execute("DELETE FROM requests WHERE expires < ?", (now,))
        conn.execute("INSERT OR REPLACE INTO requests VALUES (?, ?, ?)", (cache_key, now + 86400, json.dumps(data)))
        conn.execute("DELETE FROM requests WHERE key NOT IN (SELECT key FROM requests ORDER BY expires DESC LIMIT 256)")
    return data


def _text(value: Any, limit: int = 500) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def _components(items: Any, *, new_api: bool) -> tuple[str | None, str | None, str | None]:
    country = admin = locality = None
    if not isinstance(items, list):
        return country, admin, locality
    for component in items:
        if not isinstance(component, dict):
            continue
        types = component.get("types")
        types = types if isinstance(types, list) else []
        long_name = _text(component.get("longText" if new_api else "long_name"), 120)
        short_name = _text(component.get("shortText" if new_api else "short_name"), 120)
        if "country" in types:
            code = short_name.upper()
            country = code if len(code) == 2 and code.isascii() and code.isalpha() else None
        elif "administrative_area_level_1" in types:
            admin = long_name or None
        elif not locality and any(kind in types for kind in ("locality", "postal_town", "administrative_area_level_2")):
            locality = long_name or None
    return country, admin, locality


def _place_candidate(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    location = item.get("location")
    location = location if isinstance(location, dict) else {}
    try:
        latitude, longitude = float(location["latitude"]), float(location["longitude"])
    except (KeyError, ValueError, TypeError):
        return None
    if not math.isfinite(latitude) or not math.isfinite(longitude) or abs(latitude) > 90 or abs(longitude) > 180:
        return None
    display = item.get("displayName")
    name = _text(display.get("text")) if isinstance(display, dict) else ""
    address = _text(item.get("formattedAddress"))
    place_id = _text(item.get("id"), 255)
    if not name or not address or not place_id:
        return None
    country, admin, locality = _components(item.get("addressComponents"), new_api=True)
    return {
        "name": name, "address": address, "latitude": round(latitude, 6), "longitude": round(longitude, 6),
        "country_code": country, "admin_area": admin, "locality_name": locality,
        "provider_place_id": place_id,
        "provider_url": _text(item.get("googleMapsUri"), 2048)
        or f"https://www.google.com/maps/search/?api=1&query_place_id={quote(place_id)}",
    }


def _geocode_candidate(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    geometry = item.get("geometry")
    geometry = geometry if isinstance(geometry, dict) else {}
    location = geometry.get("location")
    location = location if isinstance(location, dict) else {}
    try:
        latitude, longitude = float(location["lat"]), float(location["lng"])
    except (KeyError, ValueError, TypeError):
        return None
    address = _text(item.get("formatted_address"))
    if not address:
        return None
    country, admin, locality = _components(item.get("address_components"), new_api=False)
    return {
        "name": address, "address": address, "latitude": round(latitude, 6), "longitude": round(longitude, 6),
        "country_code": country, "admin_area": admin, "locality_name": locality,
        "provider_place_id": None, "provider_url": None,
    }


def _result(items: list[dict[str, Any]]) -> dict[str, Any]:
    return {"status": "ready" if items else "not_found", "items": items, "message": None,
            "attribution": ATTRIBUTION, "attribution_url": ATTRIBUTION_URL}


def geocode(*, query: str | None = None, country_code: str | None = None,
            latitude: float | None = None, longitude: float | None = None) -> dict[str, Any]:
    try:
        if query is not None:
            body: dict[str, Any] = {"textQuery": query, "maxResultCount": 5}
            if country_code:
                body["includedRegionCodes"] = [country_code.lower()]
            data = _request_json(
                "https://places.googleapis.com/v1/places:searchText", method="POST", body=body,
                field_mask="places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.addressComponents",
            )
            places = data.get("places", []) if isinstance(data, dict) else []
            return _result([candidate for item in places[:5] if (candidate := _place_candidate(item)) is not None])
        params = urlencode({"latlng": f"{latitude},{longitude}", "key": server_api_key()})
        data = _request_json(f"https://maps.googleapis.com/maps/api/geocode/json?{params}")
        results = data.get("results", []) if isinstance(data, dict) else []
        candidate = _geocode_candidate(results[0]) if results else None
        return _result([candidate] if candidate else [])
    except (ValueError, URLError, TimeoutError, OSError, sqlite3.Error, json.JSONDecodeError):
        return {"status": "unavailable", "items": [], "message": "Google Maps 地址解析暂时不可用，可继续手工填写",
                "attribution": ATTRIBUTION, "attribution_url": ATTRIBUTION_URL}


def place_details(place_id: str) -> dict[str, Any]:
    try:
        data = _request_json(
            f"https://places.googleapis.com/v1/places/{quote(place_id, safe='')}",
            field_mask="id,displayName,formattedAddress,location,googleMapsUri,addressComponents",
        )
        candidate = _place_candidate(data)
        return _result([candidate] if candidate else [])
    except (ValueError, URLError, TimeoutError, OSError, sqlite3.Error, json.JSONDecodeError):
        return {"status": "unavailable", "items": [], "message": "Google Maps 场馆详情暂时不可用，可继续手工填写",
                "attribution": ATTRIBUTION, "attribution_url": ATTRIBUTION_URL}
