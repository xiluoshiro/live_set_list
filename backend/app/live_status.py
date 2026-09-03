import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal, cast

EventStatus = Literal["scheduled", "postponed", "cancelled"]
DatePhase = Literal["upcoming", "today", "past"]

EVENT_STATUS_VALUES = ("scheduled", "postponed", "cancelled")
_OFFSET_PATTERN = re.compile(r"([+-])(\d{2})(?::?(\d{2}))?$")


def _offset_from_start_time(start_time: str | time) -> timedelta:
    """Return the fixed UTC offset persisted in one time-with-time-zone value."""
    if isinstance(start_time, time) and start_time.tzinfo is not None:
        offset = start_time.utcoffset()
        if offset is not None:
            return offset

    match = _OFFSET_PATTERN.search(str(start_time))
    if match is None:
        raise ValueError(f"start_time has no UTC offset: {start_time}")
    direction = -1 if match.group(1) == "-" else 1
    hours = int(match.group(2))
    minutes = int(match.group(3) or "0")
    return timedelta(minutes=direction * (hours * 60 + minutes))


def derive_date_phase(
    live_date: date | str,
    start_time: str | time | None = None,
    now_utc: datetime | None = None,
    *,
    timezone_offset_minutes: int | None = None,
) -> DatePhase:
    """Compare a Live date with today in the fixed offset stored on that Live."""
    normalized_live_date = date.fromisoformat(live_date) if isinstance(live_date, str) else live_date
    current = now_utc or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    if timezone_offset_minutes is not None:
        offset = timedelta(minutes=timezone_offset_minutes)
    elif start_time is not None:
        offset = _offset_from_start_time(start_time)
    else:
        raise ValueError("timezone_offset_minutes is required when start_time is unannounced")
    local_today = (current.astimezone(timezone.utc) + offset).date()
    if normalized_live_date < local_today:
        return "past"
    if normalized_live_date > local_today:
        return "upcoming"
    return "today"


def build_public_live_status(
    *,
    event_status: str,
    live_date: date | str,
    start_time: str | time | None = None,
    timezone_offset_minutes: int | None = None,
    was_rescheduled: bool,
    now_utc: datetime | None = None,
) -> dict[str, EventStatus | DatePhase | bool]:
    """Build stable public status codes from persisted state and local date."""
    if event_status not in EVENT_STATUS_VALUES:
        raise ValueError(f"unknown event_status: {event_status}")
    return {
        "event_status": cast(EventStatus, event_status),
        "date_phase": derive_date_phase(
            live_date,
            start_time=start_time,
            timezone_offset_minutes=timezone_offset_minutes,
            now_utc=now_utc,
        ),
        "was_rescheduled": was_rescheduled,
    }
