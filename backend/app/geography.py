"""Provider-independent location and clock helpers; no network access."""

from datetime import date, datetime, time, timezone
from functools import lru_cache
from urllib.parse import urlencode, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones


@lru_cache(maxsize=1)
def timezone_names() -> frozenset[str]:
    return frozenset(available_timezones())


def validate_timezone(value: str) -> str:
    value = value.strip()
    if value not in timezone_names():
        raise ValueError("请选择有效的 IANA 时区")
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("请选择有效的 IANA 时区") from exc
    return value


def resolve_local_time(day: date, clock: time, timezone_id: str) -> datetime:
    """Reject nonexistent and ambiguous wall times."""
    zone = ZoneInfo(validate_timezone(timezone_id))
    if clock.tzinfo is not None:
        raise ValueError("需要不含偏移的当地时间")
    wall = datetime.combine(day, clock)
    candidates = []
    for occurrence in (0, 1):
        candidate = wall.replace(tzinfo=zone, fold=occurrence)
        restored = candidate.astimezone(timezone.utc).astimezone(zone)
        if restored.replace(tzinfo=None) == wall and restored.fold == occurrence:
            candidates.append(candidate)
    if not candidates:
        raise ValueError("当地时间因夏令时跳时而不存在")
    if len(candidates) > 1:
        raise ValueError("当地时间因夏令时重复，不能录入该钟点")
    return candidates[0]


def validate_map_url(provider: str, value: str) -> str:
    url = urlsplit(value)
    hosts = {
        "google": {"www.google.com", "maps.google.com", "maps.app.goo.gl"},
        "apple": {"maps.apple.com"},
        "amap": {"uri.amap.com", "www.amap.com", "amap.com", "surl.amap.com"},
    }
    if (url.scheme != "https" or url.hostname not in hosts.get(provider, set())
            or url.username or url.password or url.port not in (None, 443)
            or any(ord(char) < 32 for char in value) or "\\" in value):
        raise ValueError("请填写对应地图平台的 HTTPS 场馆链接")
    if provider == "google" and url.hostname == "www.google.com" and not url.path.startswith("/maps"):
        raise ValueError("请填写 Google Maps 场馆链接")
    return value


def coordinate_url(provider: str, latitude: float, longitude: float, name: str) -> str:
    point = f"{latitude:.6f},{longitude:.6f}"
    if provider == "google":
        return "https://www.google.com/maps/search/?" + urlencode({"api": 1, "query": point})
    if provider == "apple":
        return "https://maps.apple.com/?" + urlencode({"ll": point, "q": name})
    if provider == "amap":
        return "https://uri.amap.com/marker?" + urlencode({
            "position": f"{longitude:.6f},{latitude:.6f}", "name": name,
            "coordinate": "wgs84", "src": "LiveSetList",
        })
    raise ValueError("Unsupported map provider")


def place_url(provider: str, place_id: str, name: str) -> str:
    if provider == "google":
        return "https://www.google.com/maps/search/?" + urlencode({
            "api": 1, "query": name, "query_place_id": place_id,
        })
    if provider == "amap":
        return "https://uri.amap.com/poidetail?" + urlencode({"poiid": place_id, "src": "LiveSetList"})
    raise ValueError("该平台请提供已核对的场馆详情链接")
