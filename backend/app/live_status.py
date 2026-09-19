"""Visitor-local calendar dates shared by API responses and SQL filters."""
from contextvars import ContextVar
from datetime import date, datetime, time, timezone
from typing import Literal, cast
from zoneinfo import ZoneInfo

EventStatus = Literal["scheduled", "postponed", "cancelled"]
DatePhase = Literal["upcoming", "today", "past"]
EVENT_STATUS_VALUES = ("scheduled", "postponed", "cancelled")
visitor_timezone: ContextVar[str] = ContextVar("visitor_timezone", default="UTC")
VISITOR_ZONE_SQL = "COALESCE(NULLIF(current_setting('app.visitor_timezone', true), ''), 'UTC')"
VISITOR_TODAY_SQL = f"(CURRENT_TIMESTAMP AT TIME ZONE {VISITOR_ZONE_SQL})::date"


def visitor_date_sql(alias: str) -> str:
    return (f"COALESCE((({alias}.live_date + COALESCE({alias}.start_time, {alias}.opening_time)) "
            f"AT TIME ZONE {VISITOR_ZONE_SQL})::date, {alias}.live_date)")


def visitor_live_date(live_date: date | str, start_time: str | time | None = None,
                      opening_time: str | time | None = None) -> date:
    day = date.fromisoformat(live_date) if isinstance(live_date, str) else live_date
    clock = start_time or opening_time
    if clock is None:
        return day
    parsed = time.fromisoformat(clock) if isinstance(clock, str) else clock
    if parsed.utcoffset() is None:
        raise ValueError("Announced Live times must include a UTC offset")
    return datetime.combine(day, parsed).astimezone(ZoneInfo(visitor_timezone.get())).date()


def derive_date_phase(live_date: date | str, start_time: str | time | None = None,
                      now_utc: datetime | None = None, *, opening_time: str | time | None = None) -> DatePhase:
    day = visitor_live_date(live_date, start_time, opening_time)
    now = now_utc or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    today = now.astimezone(ZoneInfo(visitor_timezone.get())).date()
    return "past" if day < today else "upcoming" if day > today else "today"


def build_public_live_status(*, event_status: str, live_date: date | str,
                             start_time: str | time | None = None, opening_time: str | time | None = None,
                             was_rescheduled: bool, now_utc: datetime | None = None
                             ) -> dict[str, EventStatus | DatePhase | bool]:
    if event_status not in EVENT_STATUS_VALUES:
        raise ValueError(f"unknown event_status: {event_status}")
    return {"event_status": cast(EventStatus, event_status),
            "date_phase": derive_date_phase(live_date, start_time, now_utc, opening_time=opening_time),
            "was_rescheduled": was_rescheduled}
