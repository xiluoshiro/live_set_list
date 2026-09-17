"""Derive a Live's offset from its Venue IANA timezone or the +09:00 default."""

from dataclasses import dataclass
from typing import Any, Literal

from fastapi import HTTPException

from app.geography import validate_timezone

TimezoneSource = Literal["venue", "locality", "explicit", "legacy_offset"]


@dataclass(frozen=True)
class ResolvedLiveTimezone:
    timezone_id: str | None
    timezone_source: TimezoneSource
    timezone_source_revision: int | None


def resolve_live_timezone(
    cur: Any,
    *,
    venue_id: int | None,
    announced_locality_id: int | None,
    explicit_timezone_id: str | None,
    existing: dict[str, Any] | None = None,
) -> ResolvedLiveTimezone:
    """Only online Venues may provide an explicit IANA zone; other Lives use Venue or +09:00."""
    if venue_id is not None and announced_locality_id is not None:
        raise HTTPException(422, "已选择场馆时不能另外指定活动城市")

    try:
        explicit = validate_timezone(explicit_timezone_id) if explicit_timezone_id else None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if venue_id is not None:
        cur.execute(
            """
            SELECT venue.venue_kind, venue.timezone_id, venue.location_revision
            FROM venue_list venue
            WHERE venue.id = %s AND venue.merged_into_venue_id IS NULL
            """,
            (venue_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(422, "场馆不存在或已合并，请重新选择")
        venue_kind, venue_timezone, location_revision = row
        if venue_kind == "online":
            if explicit is None:
                if existing is not None and existing.get("venue_id") == venue_id and existing.get("timezone_source") == "explicit" and existing.get("timezone_id"):
                    return ResolvedLiveTimezone(str(existing["timezone_id"]), "explicit", None)
                raise HTTPException(422, "线上 Live 请指定主办方公布的活动时区")
            return ResolvedLiveTimezone(explicit, "explicit", None)
        if explicit is not None:
            raise HTTPException(422, "只有线上 Live 可以手工指定时区")
        if venue_timezone:
            return ResolvedLiveTimezone(str(venue_timezone), "venue", int(location_revision))
        return ResolvedLiveTimezone(None, "legacy_offset", None)

    if announced_locality_id is not None:
        cur.execute("SELECT 1 FROM geo_localities WHERE id = %s", (announced_locality_id,))
        if cur.fetchone() is None:
            raise HTTPException(422, "城市不存在，请重新选择")
    if explicit is not None:
        raise HTTPException(422, "只有线上 Live 可以手工指定时区")
    return ResolvedLiveTimezone(None, "legacy_offset", None)
