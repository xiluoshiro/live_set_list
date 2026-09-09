"""Resolve the persisted Live timezone source inside the write transaction."""

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


def _preserve_existing(existing: dict[str, Any] | None, venue_id: int | None, locality_id: int | None) -> ResolvedLiveTimezone | None:
    if existing is None:
        return None
    if existing.get("venue_id") != venue_id or existing.get("announced_locality_id") != locality_id:
        return None
    source = existing.get("timezone_source", "legacy_offset")
    if source not in {"venue", "locality", "explicit", "legacy_offset"}:
        return None
    timezone_id = existing.get("timezone_id")
    if source != "legacy_offset" and not timezone_id:
        return None
    return ResolvedLiveTimezone(timezone_id, source, existing.get("timezone_source_revision"))


def resolve_live_timezone(
    cur: Any,
    *,
    venue_id: int | None,
    announced_locality_id: int | None,
    explicit_timezone_id: str | None,
    existing: dict[str, Any] | None = None,
    allow_legacy: bool = False,
) -> ResolvedLiveTimezone:
    """Resolve only trusted DB geography; never accept a client-derived offset."""
    if venue_id is not None and announced_locality_id is not None:
        raise HTTPException(422, "已选择场馆时不能另外指定活动城市")

    try:
        explicit = validate_timezone(explicit_timezone_id) if explicit_timezone_id else None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if allow_legacy and explicit is None and (existing is None or existing.get("timezone_source", "legacy_offset") == "legacy_offset"):
        return ResolvedLiveTimezone(None, "legacy_offset", None)
    if venue_id is not None:
        cur.execute(
            """
            SELECT venue.venue_kind, venue.timezone_id, venue.location_revision,
                   locality.timezone_id AS locality_timezone_id
            FROM venue_list venue
            LEFT JOIN geo_localities locality ON locality.id = venue.locality_id
            WHERE venue.id = %s AND venue.merged_into_venue_id IS NULL
            """,
            (venue_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(422, "场馆不存在或已合并，请重新选择")
        venue_kind, venue_timezone, location_revision, locality_timezone = row
        effective = venue_timezone or locality_timezone
        if effective:
            if explicit is not None:
                raise HTTPException(422, "实体场馆的时区由已核验所在地决定，不能手工覆盖")
            return ResolvedLiveTimezone(str(effective), "venue", int(location_revision))
        if venue_kind == "online":
            if explicit is None:
                preserved = _preserve_existing(existing, venue_id, None)
                if preserved is not None:
                    return preserved
                raise HTTPException(422, "线上 Live 请指定主办方公布的活动时区")
            return ResolvedLiveTimezone(explicit, "explicit", None)
        preserved = _preserve_existing(existing, venue_id, None)
        if preserved is not None:
            return preserved
        if allow_legacy:
            return ResolvedLiveTimezone(None, "legacy_offset", None)
        raise HTTPException(422, "请先在场馆资料中核验城市或精确时区")

    if announced_locality_id is not None:
        if explicit is not None:
            raise HTTPException(422, "已公布城市的时区由城市资料决定，不能手工覆盖")
        cur.execute("SELECT timezone_id, revision FROM geo_localities WHERE id = %s", (announced_locality_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(422, "城市不存在，请重新选择")
        if row[0] is None:
            raise HTTPException(422, "该城市尚未核验单一时区")
        return ResolvedLiveTimezone(str(row[0]), "locality", int(row[1]))

    if explicit is not None:
        return ResolvedLiveTimezone(explicit, "explicit", None)
    preserved = _preserve_existing(existing, None, None)
    if preserved is not None:
        return preserved
    if allow_legacy:
        return ResolvedLiveTimezone(None, "legacy_offset", None)
    raise HTTPException(422, "请选择已核验场馆／城市，或指定活动公布的时区")
