"""Resolve venue wall times and online fixed offsets at the write boundary."""
import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any

from fastapi import HTTPException
from app.geography import resolve_local_time


def parse_offset(value: str) -> timezone:
    match = re.fullmatch(r"([+-])(\d{2}):(\d{2})", value)
    if not match:
        raise ValueError("请选择有效的 UTC 偏移")
    hours, minutes = int(match[2]), int(match[3])
    total = (hours * 60 + minutes) * (-1 if match[1] == "-" else 1)
    if minutes > 59 or minutes % 15 or not -720 <= total <= 840:
        raise ValueError("请选择有效的 UTC 偏移")
    return timezone(timedelta(minutes=total))


def serialize_time(value: str | time | None) -> str | None:
    """Normalize PostgreSQL time objects and JSON timetz strings identically."""
    return time.fromisoformat(str(value)).isoformat() if value is not None else None


def time_offset(value: str | time | None) -> str | None:
    if value is None:
        return None
    clock = time.fromisoformat(str(value))
    if clock.utcoffset() is None:
        return None
    return clock.isoformat()[-6:]


def timezone_abbreviation(day: date | str, value: str | time | None, timezone_id: str | None) -> str | None:
    """Use the venue zone at the persisted instant; absent zones leave display mapping to the frontend."""
    if value is None or timezone_id is None:
        return None
    live_day = date.fromisoformat(day) if isinstance(day, str) else day
    clock = time.fromisoformat(value) if isinstance(value, str) else value
    if clock.utcoffset() is None:
        raise ValueError("Announced Live times must include a UTC offset")
    return datetime.combine(live_day, clock).astimezone(ZoneInfo(timezone_id)).tzname()


def normalize_live_times(cur: Any, *, live_date: date, venue_id: int | None,
                         announced_locality_id: int | None, offset: str | None,
                         opening_time: str | None, start_time: str | None) -> tuple[str | None, str | None]:
    if venue_id is not None and announced_locality_id is not None:
        raise HTTPException(422, "已选择场地时不能另外指定地区")
    if venue_id is None:
        if opening_time is not None or start_time is not None:
            raise HTTPException(422, "未选择场地时不能填写开场或开演时间")
        if offset is not None:
            raise HTTPException(422, "仅 ONLINE 演出可以填写固定偏移")
        if announced_locality_id is not None:
            cur.execute("SELECT 1 FROM geo_localities WHERE id=%s", (announced_locality_id,))
            if cur.fetchone() is None:
                raise HTTPException(422, "地区不存在")
        return None, None
    cur.execute("SELECT venue_kind, timezone_id FROM venue_list WHERE id=%s AND merged_into_venue_id IS NULL", (venue_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(422, "场地不存在或已合并")
    kind, zone = row
    if kind != "online" and not zone:
        raise HTTPException(422, "请先填写场地自身时区")
    if kind != "online" and offset is not None:
        raise HTTPException(422, "非 ONLINE 演出使用场地自身时区")
    try:
        fixed = parse_offset(offset) if offset is not None else None
        if kind == "online" and (opening_time is not None or start_time is not None) and fixed is None:
            raise ValueError("ONLINE 演出已公布时间时必须填写 UTC 偏移")
        def persisted(value: str | None) -> str | None:
            if value is None:
                return None
            clock = time.fromisoformat(value)
            if clock.tzinfo is not None:
                raise ValueError("请填写不含偏移的当地钟点")
            if kind == "online":
                return clock.replace(tzinfo=fixed).isoformat(timespec="seconds")
            resolved = resolve_local_time(live_date, clock, str(zone))
            return resolved.isoformat(timespec="seconds").split("T", 1)[1]
        return persisted(opening_time), persisted(start_time)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
