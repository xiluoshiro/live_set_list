"""Offline suggestions only: never write Venue or Live data."""
from functools import lru_cache
from threading import Lock
from typing import Any

from app.geography import validate_timezone

_lookup_lock = Lock()


@lru_cache(maxsize=1)
def _finder() -> Any:
    from timezonefinder import TimezoneFinder
    return TimezoneFinder(in_memory=False)


def lookup_timezone(latitude: float, longitude: float) -> dict[str, Any]:
    try:
        # Reuse one reader; serialize access to its memory-mapped data handles.
        with _lookup_lock:
            zone = _finder().timezone_at_land(lat=latitude, lng=longitude)
        if zone is None:
            return {"status": "not_found", "timezone_id": None, "message": "未找到陆地时区，请手工核对"}
        return {"status": "ready", "timezone_id": validate_timezone(zone), "message": None}
    except (ImportError, OSError, ValueError, RuntimeError):
        return {"status": "unavailable", "timezone_id": None, "message": "本地时区数据不可用，请手工核对"}
