"""Optional map search adapters. Provider coordinates are normalized to WGS84 here."""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.geography import place_url

MapProviderName = Literal["apple", "amap"]
ProviderStatus = Literal["ready", "not_configured", "unavailable"]


@dataclass(frozen=True)
class MapCandidate:
    provider_place_id: str
    provider_url: str
    name: str
    address: str
    latitude: float
    longitude: float
    source_coordinate_system: Literal["WGS84", "GCJ02"]


@dataclass(frozen=True)
class MapSearchResult:
    status: ProviderStatus
    message: str | None
    candidates: list[MapCandidate]


class MapProviderRequestError(RuntimeError):
    pass


def haversine_distance_m(latitude_a: float, longitude_a: float,
                         latitude_b: float, longitude_b: float) -> int:
    radius = 6_371_008.8
    phi_a, phi_b = math.radians(latitude_a), math.radians(latitude_b)
    delta_phi = math.radians(latitude_b - latitude_a)
    delta_lambda = math.radians(longitude_b - longitude_a)
    value = math.sin(delta_phi / 2) ** 2 + math.cos(phi_a) * math.cos(phi_b) * math.sin(delta_lambda / 2) ** 2
    return round(radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value)))


def _outside_china(latitude: float, longitude: float) -> bool:
    return not (0.8293 <= latitude <= 55.8271 and 72.004 <= longitude <= 137.8347)


def _gcj_delta(latitude: float, longitude: float) -> tuple[float, float]:
    x = longitude - 105.0
    y = latitude - 35.0
    latitude_shift = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    latitude_shift += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    latitude_shift += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
    latitude_shift += (160.0 * math.sin(y / 12.0 * math.pi) + 320 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
    longitude_shift = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    longitude_shift += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    longitude_shift += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
    longitude_shift += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0
    eccentricity = 0.006693421622965943
    semi_major_axis = 6_378_245.0
    radians = latitude / 180.0 * math.pi
    magic = 1 - eccentricity * math.sin(radians) ** 2
    sqrt_magic = math.sqrt(magic)
    latitude_delta = latitude_shift * 180.0 / ((semi_major_axis * (1 - eccentricity)) / (magic * sqrt_magic) * math.pi)
    longitude_delta = longitude_shift * 180.0 / (semi_major_axis / sqrt_magic * math.cos(radians) * math.pi)
    return latitude_delta, longitude_delta


def wgs84_to_gcj02(latitude: float, longitude: float) -> tuple[float, float]:
    if _outside_china(latitude, longitude):
        return latitude, longitude
    latitude_delta, longitude_delta = _gcj_delta(latitude, longitude)
    return latitude + latitude_delta, longitude + longitude_delta


def gcj02_to_wgs84(latitude: float, longitude: float) -> tuple[float, float]:
    """Iteratively invert GCJ-02 without ever persisting the provider coordinate."""
    if _outside_china(latitude, longitude):
        return latitude, longitude
    estimate_latitude, estimate_longitude = latitude, longitude
    for _ in range(8):
        converted_latitude, converted_longitude = wgs84_to_gcj02(estimate_latitude, estimate_longitude)
        estimate_latitude -= converted_latitude - latitude
        estimate_longitude -= converted_longitude - longitude
    return round(estimate_latitude, 6), round(estimate_longitude, 6)


def _request_json(url: str, *, headers: dict[str, str], payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(url, data=body, headers=headers, method="POST" if body is not None else "GET")
    try:
        with urlopen(request, timeout=8) as response:  # noqa: S310 - URLs are fixed provider endpoints.
            value = json.load(response)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        raise MapProviderRequestError("地图服务暂时不可用，请稍后重试或继续手工关联") from exc
    if not isinstance(value, dict):
        raise MapProviderRequestError("地图服务返回了无法识别的数据")
    return value


def _apple_search(query: str, latitude: float, longitude: float, country_code: str | None) -> MapSearchResult:
    token = os.getenv("APPLE_MAPS_SERVER_API_TOKEN", "").strip()
    if not token:
        return MapSearchResult("not_configured", "未配置 Apple Maps Server API Token，可继续手工关联", [])
    language = "ja-JP" if country_code == "JP" else "zh-Hans" if country_code == "CN" else "en-US"
    params = {"q": query, "lang": language, "searchLocation": f"{latitude:.6f},{longitude:.6f}", "resultTypeFilter": "Poi"}
    if country_code:
        params["limitToCountries"] = country_code
    data = _request_json(
        "https://maps-api.apple.com/v1/search?" + urlencode(params),
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    candidates = []
    for item in data.get("results", [])[:8]:
        coordinate = item.get("coordinate") or {}
        place_id = str(item.get("id") or "").strip()
        name = str(item.get("name") or "").strip()
        try:
            item_latitude = float(coordinate["latitude"])
            item_longitude = float(coordinate["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if not place_id or not name:
            continue
        provider_url = "https://maps.apple.com/place?" + urlencode({"place-id": place_id})
        address_lines = item.get("formattedAddressLines") or []
        candidates.append(MapCandidate(
            provider_place_id=place_id, provider_url=provider_url, name=name,
            address=" ".join(str(line) for line in address_lines if line),
            latitude=round(item_latitude, 6), longitude=round(item_longitude, 6),
            source_coordinate_system="WGS84",
        ))
    return MapSearchResult("ready", None, candidates)


def _amap_search(query: str, country_code: str | None) -> MapSearchResult:
    key = os.getenv("AMAP_WEB_SERVICE_API_KEY", "").strip()
    if not key:
        return MapSearchResult("not_configured", "未配置高德 Web 服务 API Key，可继续手工关联", [])
    data = _request_json(
        "https://restapi.amap.com/v3/place/text?" + urlencode({
            "key": key, "keywords": query, "offset": 8, "page": 1, "extensions": "base", "output": "JSON",
        }),
        headers={"Accept": "application/json"},
    )
    if str(data.get("status")) != "1":
        raise MapProviderRequestError("高德地图搜索失败，请稍后重试或继续手工关联")
    candidates = []
    for item in data.get("pois", [])[:8]:
        location = str(item.get("location") or "")
        place_id = str(item.get("id") or "").strip()
        name = str(item.get("name") or "").strip()
        try:
            raw_longitude, raw_latitude = (float(part) for part in location.split(",", 1))
        except (TypeError, ValueError):
            continue
        if not place_id or not name:
            continue
        if country_code == "CN":
            item_latitude, item_longitude = gcj02_to_wgs84(raw_latitude, raw_longitude)
            source_system: Literal["WGS84", "GCJ02"] = "GCJ02"
        else:
            item_latitude, item_longitude = round(raw_latitude, 6), round(raw_longitude, 6)
            source_system = "WGS84"
        address = item.get("address")
        candidates.append(MapCandidate(
            provider_place_id=place_id, provider_url=place_url("amap", place_id, name), name=name,
            address=address if isinstance(address, str) else "",
            latitude=item_latitude, longitude=item_longitude,
            source_coordinate_system=source_system,
        ))
    return MapSearchResult("ready", None, candidates)


def search_map_candidates(provider: MapProviderName, query: str, latitude: float, longitude: float,
                          country_code: str | None) -> MapSearchResult:
    try:
        if provider == "apple":
            return _apple_search(query, latitude, longitude, country_code)
        return _amap_search(query, country_code)
    except MapProviderRequestError as exc:
        return MapSearchResult("unavailable", str(exc), [])
