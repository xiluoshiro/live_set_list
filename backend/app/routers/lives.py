import json
from collections.abc import Mapping
from math import ceil
from typing import Any, Literal, cast

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled

from app.auth import AuthUser, get_current_user_optional
from app.band_history import AppearanceCategory, calculate_attendance
from app.db import get_db_connection
from app.favorites import get_favorite_live_id_set, is_live_favorite
from app.live_list_filters import (
    LiveListFilters,
    build_filtered_live_queries,
    effective_band_ids_sql,
    normalize_list_query,
)
from app.logging_config import get_logger
from app.live_status import build_public_live_status
from app.schemas import (
    ErrorResponse,
    LiveDetailBatchRequest,
    LiveDetailResponse,
    LiveDetailsBatchResponse,
    LivesResponse,
    ValidationErrorResponse,
)
from app.tour_refs import build_tour_ref_from_row
from app.performance_group_refs import build_performance_group_ref_from_row

router = APIRouter(prefix="/api/lives", tags=["lives"])
logger = get_logger(__name__)

ALLOWED_PAGE_SIZE = {15, 20}

BAND_TOTAL_COUNT_SQL = """
CASE
    WHEN ba.band_members IS NULL THEN NULL
    WHEN jsonb_typeof(to_jsonb(ba.band_members)) = 'array' THEN jsonb_array_length(to_jsonb(ba.band_members))
    ELSE length(ba.band_members::text)
END
"""

EVENT_ATTENDEES_SQL = """
CASE
    WHEN l.live_type = 'event' THEN COALESCE(
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'band_id', ba.id,
                    'band_name', COALESCE(name_version.band_name, ba.band_name),
                    'mode', CASE
                        WHEN context.base_lineup_version_id IS NOT NULL
                             AND jsonb_array_length(attendee.members) = (
                                 SELECT COUNT(*)
                                 FROM band_lineup_version_members expected
                                 WHERE expected.lineup_version_id = context.base_lineup_version_id
                             )
                             AND NOT EXISTS (
                                 SELECT 1
                                 FROM band_lineup_version_members expected
                                 WHERE expected.lineup_version_id = context.base_lineup_version_id
                                   AND NOT attendee.members ? expected.member_name
                             )
                            THEN 'full'
                        WHEN context.base_lineup_version_id IS NULL
                             AND jsonb_array_length(attendee.members) = cardinality(ba.band_members)
                            THEN 'full'
                        ELSE 'partial'
                    END,
                    'members', attendee.members
                )
                ORDER BY ba.id
            )
            FROM jsonb_each(l.event_attendees) attendee(band_id_text, members)
            JOIN band_attrs ba
                ON ba.id = CASE
                    WHEN attendee.band_id_text ~ '^[0-9]+$' THEN attendee.band_id_text::int
                    ELSE NULL
                END
            LEFT JOIN live_band_lineup_contexts context
                ON context.live_id = l.id
               AND context.band_id = ba.id
            LEFT JOIN band_name_versions name_version
                ON name_version.id = context.band_name_version_id
            WHERE jsonb_typeof(attendee.members) = 'array'
        ),
        '[]'::jsonb
    )
    ELSE '[]'::jsonb
END
"""

LIVES_BAND_IDS_SQL = effective_band_ids_sql(live_alias="l", setlist_alias="ls", band_alias="b")

LIVES_BASE_QUERY = f"""
SELECT
    l.id,
    l.live_date,
    l.live_title,
    {LIVES_BAND_IDS_SQL} AS band_ids,
    l.url AS url,
    l.live_type,
    tour.id AS tour_id,
    tour.tour_title,
    pg.id AS performance_group_id,
    pg.group_title,
    l.start_time,
    l.event_status,
    EXISTS (
        SELECT 1 FROM live_schedule_history history
        WHERE history.live_id = l.id
    ) AS was_rescheduled
FROM live_attrs l
LEFT JOIN tour_lives tour_live
    ON tour_live.live_id = l.id
LEFT JOIN tour_attrs tour
    ON tour.id = tour_live.tour_id
LEFT JOIN performance_group_lives pgl
    ON pgl.live_id = l.id
LEFT JOIN performance_group_attrs pg
    ON pg.id = pgl.group_id
LEFT JOIN live_setlist ls
    ON l.id = ls.live_id
LEFT JOIN LATERAL (
    SELECT jsonb_object_keys(ls.band_member) AS key
    WHERE jsonb_typeof(ls.band_member) = 'object'
) t ON true
LEFT JOIN band_attrs b
    ON b.band_name = t.key
GROUP BY l.id, l.live_date, l.live_title, l.live_type, l.url, l.default_band_ids,
         l.start_time, l.event_status, tour.id, tour.tour_title, pg.id, pg.group_title
"""

LIVES_COUNT_QUERY = f"""
SELECT COUNT(*) FROM (
    {LIVES_BASE_QUERY}
) q
"""

LIVES_PAGE_QUERY = f"""
{LIVES_BASE_QUERY}
ORDER BY l.live_date DESC, l.id DESC
LIMIT %s OFFSET %s
"""

LIVES_WITHOUT_SETLIST_BASE_QUERY = """
SELECT
    l.id,
    l.live_date,
    l.live_title,
    l.default_band_ids AS band_ids,
    l.url AS url,
    l.live_type,
    tour.id AS tour_id,
    tour.tour_title,
    pg.id AS performance_group_id,
    pg.group_title,
    l.start_time,
    l.event_status,
    EXISTS (
        SELECT 1 FROM live_schedule_history history
        WHERE history.live_id = l.id
    ) AS was_rescheduled
FROM live_attrs l
LEFT JOIN tour_lives tour_live
    ON tour_live.live_id = l.id
LEFT JOIN tour_attrs tour
    ON tour.id = tour_live.tour_id
LEFT JOIN performance_group_lives pgl
    ON pgl.live_id = l.id
LEFT JOIN performance_group_attrs pg
    ON pg.id = pgl.group_id
WHERE NOT EXISTS (
    SELECT 1
    FROM live_setlist ls
    WHERE ls.live_id = l.id
)
"""

LIVES_WITHOUT_SETLIST_COUNT_QUERY = f"""
SELECT COUNT(*) FROM (
    {LIVES_WITHOUT_SETLIST_BASE_QUERY}
) q
"""

LIVES_WITHOUT_SETLIST_PAGE_QUERY = f"""
{LIVES_WITHOUT_SETLIST_BASE_QUERY}
ORDER BY (l.live_type = 'event') ASC, l.live_date DESC, l.id DESC
LIMIT %s OFFSET %s
"""

LIVE_DETAIL_HEADER_QUERY = f"""
SELECT
    l.id AS live_id,
    l.live_date,
    l.live_title,
    COALESCE(to_jsonb(v) ->> 'venue', to_jsonb(v) ->> 'venue_name') AS venue,
    to_jsonb(l) ->> 'opening_time' AS opening_time,
    to_jsonb(l) ->> 'start_time' AS start_time,
    CASE
        WHEN EXISTS (SELECT 1 FROM live_setlist stl WHERE stl.live_id = l.id) THEN COALESCE(
            (
                SELECT array_agg(DISTINCT ba.id ORDER BY ba.id)
                FROM live_setlist stl
                JOIN LATERAL jsonb_object_keys(stl.band_member) k(band_name)
                    ON jsonb_typeof(stl.band_member) = 'object'
                JOIN band_attrs ba
                    ON ba.band_name = k.band_name
                WHERE stl.live_id = l.id
            ),
            ARRAY[]::int[]
        )
        ELSE l.default_band_ids
    END AS bands,
    CASE
        WHEN EXISTS (SELECT 1 FROM live_setlist stl WHERE stl.live_id = l.id) THEN COALESCE(
            (
                SELECT array_agg(
                    x.band_name
                    ORDER BY (x.band_id IS NULL), x.band_id, x.band_name
                )
                FROM (
                    SELECT DISTINCT
                        k.band_name AS band_name,
                        ba.id AS band_id
                    FROM live_setlist stl
                    JOIN LATERAL jsonb_object_keys(stl.band_member) k(band_name)
                        ON jsonb_typeof(stl.band_member) = 'object'
                    LEFT JOIN band_attrs ba
                        ON ba.band_name = k.band_name
                    WHERE stl.live_id = l.id
                ) x
            ),
            ARRAY[]::text[]
        )
        ELSE COALESCE(
            (
                SELECT array_agg(COALESCE(name_version.band_name, ba.band_name) ORDER BY ba.id)
                FROM band_attrs ba
                LEFT JOIN live_band_lineup_contexts context
                    ON context.live_id = l.id
                   AND context.band_id = ba.id
                LEFT JOIN band_name_versions name_version
                    ON name_version.id = context.band_name_version_id
                WHERE ba.id = ANY(l.default_band_ids)
            ),
            ARRAY[]::text[]
        )
    END AS band_names,
    to_jsonb(l) ->> 'url' AS url,
    l.live_type,
    tour.id AS tour_id,
    tour.tour_title,
    pg.id AS performance_group_id,
    pg.group_title,
    {EVENT_ATTENDEES_SQL} AS event_attendees,
    l.event_status,
    l.status_note,
    COALESCE(
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'previous_live_title', history.previous_live_title,
                    'previous_live_date', history.previous_live_date,
                    'previous_opening_time', history.previous_opening_time::text,
                    'previous_start_time', history.previous_start_time::text,
                    'previous_venue_id', history.previous_venue_id,
                    'previous_venue', history_venue.venue,
                    'changed_at', history.changed_at,
                    'note', history.note
                )
                ORDER BY history.changed_at, history.id
            )
            FROM live_schedule_history history
            LEFT JOIN venue_list history_venue ON history_venue.id = history.previous_venue_id
            WHERE history.live_id = l.id
        ),
        '[]'::jsonb
    ) AS schedule_history
FROM live_attrs l
LEFT JOIN venue_list v
    ON v.id = NULLIF(to_jsonb(l) ->> 'venue_id', '')::int
LEFT JOIN tour_lives tour_live
    ON tour_live.live_id = l.id
LEFT JOIN tour_attrs tour
    ON tour.id = tour_live.tour_id
LEFT JOIN performance_group_lives pgl
    ON pgl.live_id = l.id
LEFT JOIN performance_group_attrs pg
    ON pg.id = pgl.group_id
WHERE l.id = %s
"""

LIVE_DETAIL_ROWS_QUERY = """
SELECT
    concat(stl.segment_type, stl.sub_order)::text AS row_id,
    s.song_name,
    stl.band_member,
    stl.other_member,
    stl.is_short,
    s.is_cover,
    s.band_id,
    owner_band.band_name
FROM live_setlist stl
JOIN song_list s
    ON s.id = stl.song_id
LEFT JOIN band_attrs owner_band
    ON owner_band.id = s.band_id
WHERE stl.live_id = %s
ORDER BY stl.absolute_order
"""

BATCH_LIVE_DETAIL_HEADERS_QUERY = f"""
SELECT
    l.id AS live_id,
    l.live_date,
    l.live_title,
    COALESCE(to_jsonb(v) ->> 'venue', to_jsonb(v) ->> 'venue_name') AS venue,
    to_jsonb(l) ->> 'opening_time' AS opening_time,
    to_jsonb(l) ->> 'start_time' AS start_time,
    CASE
        WHEN EXISTS (SELECT 1 FROM live_setlist stl WHERE stl.live_id = l.id) THEN COALESCE(
            (
                SELECT array_agg(DISTINCT ba.id ORDER BY ba.id)
                FROM live_setlist stl
                JOIN LATERAL jsonb_object_keys(stl.band_member) k(band_name)
                    ON jsonb_typeof(stl.band_member) = 'object'
                JOIN band_attrs ba
                    ON ba.band_name = k.band_name
                WHERE stl.live_id = l.id
            ),
            ARRAY[]::int[]
        )
        ELSE l.default_band_ids
    END AS bands,
    CASE
        WHEN EXISTS (SELECT 1 FROM live_setlist stl WHERE stl.live_id = l.id) THEN COALESCE(
            (
                SELECT array_agg(
                    x.band_name
                    ORDER BY (x.band_id IS NULL), x.band_id, x.band_name
                )
                FROM (
                    SELECT DISTINCT
                        k.band_name AS band_name,
                        ba.id AS band_id
                    FROM live_setlist stl
                    JOIN LATERAL jsonb_object_keys(stl.band_member) k(band_name)
                        ON jsonb_typeof(stl.band_member) = 'object'
                    LEFT JOIN band_attrs ba
                        ON ba.band_name = k.band_name
                    WHERE stl.live_id = l.id
                ) x
            ),
            ARRAY[]::text[]
        )
        ELSE COALESCE(
            (
                SELECT array_agg(COALESCE(name_version.band_name, ba.band_name) ORDER BY ba.id)
                FROM band_attrs ba
                LEFT JOIN live_band_lineup_contexts context
                    ON context.live_id = l.id
                   AND context.band_id = ba.id
                LEFT JOIN band_name_versions name_version
                    ON name_version.id = context.band_name_version_id
                WHERE ba.id = ANY(l.default_band_ids)
            ),
            ARRAY[]::text[]
        )
    END AS band_names,
    to_jsonb(l) ->> 'url' AS url,
    l.live_type,
    tour.id AS tour_id,
    tour.tour_title,
    pg.id AS performance_group_id,
    pg.group_title,
    {EVENT_ATTENDEES_SQL} AS event_attendees,
    l.event_status,
    l.status_note,
    COALESCE(
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'previous_live_title', history.previous_live_title,
                    'previous_live_date', history.previous_live_date,
                    'previous_opening_time', history.previous_opening_time::text,
                    'previous_start_time', history.previous_start_time::text,
                    'previous_venue_id', history.previous_venue_id,
                    'previous_venue', history_venue.venue,
                    'changed_at', history.changed_at,
                    'note', history.note
                )
                ORDER BY history.changed_at, history.id
            )
            FROM live_schedule_history history
            LEFT JOIN venue_list history_venue ON history_venue.id = history.previous_venue_id
            WHERE history.live_id = l.id
        ),
        '[]'::jsonb
    ) AS schedule_history
FROM live_attrs l
LEFT JOIN venue_list v
    ON v.id = NULLIF(to_jsonb(l) ->> 'venue_id', '')::int
LEFT JOIN tour_lives tour_live
    ON tour_live.live_id = l.id
LEFT JOIN tour_attrs tour
    ON tour.id = tour_live.tour_id
LEFT JOIN performance_group_lives pgl
    ON pgl.live_id = l.id
LEFT JOIN performance_group_attrs pg
    ON pg.id = pgl.group_id
WHERE l.id = ANY(%s)
"""

BATCH_LIVE_DETAIL_ROWS_QUERY = f"""
WITH row_base AS (
    SELECT
        stl.live_id,
        concat(stl.segment_type, stl.sub_order)::text AS row_id,
        s.song_name,
        stl.band_member,
        stl.other_member,
        stl.is_short,
        s.is_cover,
        s.band_id,
        stl.absolute_order
    FROM live_setlist stl
    JOIN song_list s
        ON s.id = stl.song_id
    WHERE stl.live_id = ANY(%s)
)
SELECT
    rb.live_id,
    rb.row_id,
    rb.song_name,
    COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'band_id', ba.id,
                'band_name', kv.key,
                'total_count', {BAND_TOTAL_COUNT_SQL},
                'present_members',
                CASE
                    WHEN jsonb_typeof(kv.value) = 'array' THEN kv.value
                    WHEN kv.value IS NULL THEN '[]'::jsonb
                    ELSE jsonb_build_array(kv.value)
                END
            )
            ORDER BY (ba.id IS NULL), ba.id, kv.key
        ) FILTER (WHERE kv.key IS NOT NULL),
        '[]'::jsonb
    ) AS band_members,
    rb.other_member,
    rb.is_short,
    rb.is_cover,
    rb.band_id,
    owner_band.band_name
FROM row_base rb
LEFT JOIN LATERAL jsonb_each(
    CASE
        WHEN jsonb_typeof(rb.band_member) = 'object' THEN rb.band_member
        ELSE '{{}}'::jsonb
    END
) kv(key, value) ON true
LEFT JOIN band_attrs ba
    ON ba.band_name = kv.key
LEFT JOIN band_attrs owner_band
    ON owner_band.id = rb.band_id
GROUP BY
    rb.live_id,
    rb.row_id,
    rb.song_name,
    rb.other_member,
    rb.is_short,
    rb.is_cover,
    rb.band_id,
    owner_band.band_name,
    rb.absolute_order
ORDER BY rb.live_id, rb.absolute_order
"""

LIVE_DETAIL_PERFORMANCES_QUERY = """
SELECT
    performance.live_id,
    concat(setlist.segment_type, setlist.sub_order)::text AS row_id,
    performance.band_id,
    name_version.band_name,
    performance.lineup_usage,
    performance.handover_baseline,
    base_version.id,
    base_version.version_label,
    ARRAY(
        SELECT member.member_name
        FROM band_lineup_version_members member
        WHERE member.lineup_version_id = base_version.id
        ORDER BY member.display_order
    ) AS base_members,
    next_version.id,
    next_version.version_label,
    ARRAY(
        SELECT member.member_name
        FROM band_lineup_version_members member
        WHERE member.lineup_version_id = next_version.id
        ORDER BY member.display_order
    ) AS next_members,
    ARRAY(
        SELECT member.member_name
        FROM live_setlist_band_performance_members member
        WHERE member.setlist_id = performance.setlist_id
          AND member.band_id = performance.band_id
        ORDER BY member.display_order
    ) AS present_members,
    COALESCE(
        (
            SELECT jsonb_object_agg(member.member_name, member.appearance_role)
            FROM live_setlist_band_performance_members member
            WHERE member.setlist_id = performance.setlist_id
              AND member.band_id = performance.band_id
              AND member.appearance_role IS NOT NULL
        ),
        '{}'::jsonb
    ) AS appearance_roles
FROM live_setlist_band_performances performance
JOIN live_setlist setlist
    ON setlist.id = performance.setlist_id
JOIN live_band_lineup_contexts context
    ON context.live_id = performance.live_id
   AND context.band_id = performance.band_id
JOIN band_name_versions name_version
    ON name_version.id = context.band_name_version_id
JOIN band_lineup_versions base_version
    ON base_version.id = context.base_lineup_version_id
LEFT JOIN band_lineup_versions next_version
    ON next_version.id = context.next_lineup_version_id
WHERE performance.live_id = ANY(%s)
ORDER BY performance.live_id, setlist.absolute_order, performance.band_id
"""

BAND_ID_LOOKUP_QUERY = f"""
SELECT
    ba.id,
    ba.band_name,
    {BAND_TOTAL_COUNT_SQL} AS total_count
FROM band_attrs ba
WHERE ba.band_name = ANY(%s)
"""

DEFAULT_BAND_TOTAL_COUNT = 5


ParsedDetailRow = tuple[str, str, Any, dict[str, Any], bool, bool, int, str | None]
PerformanceRowsByDetail = dict[tuple[int, str], list[dict[str, Any]]]


def _ensure_json_object(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {}
    return {}


def _ensure_json_array(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            return []
    return []


def _to_string_list(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(item) for item in raw]
    if isinstance(raw, tuple):
        return [str(item) for item in raw]
    return [str(raw)]


def _normalize_event_attendees(raw: Any, live_type: str) -> list[dict[str, Any]]:
    """Normalize query-computed event attendance and suppress it for every other Live type."""
    if live_type != "event":
        return []
    normalized: list[dict[str, Any]] = []
    for item in _ensure_json_array(raw):
        if not isinstance(item, dict):
            continue
        band_id = item.get("band_id")
        band_name = item.get("band_name")
        mode = item.get("mode")
        members = _to_string_list(item.get("members"))
        if not isinstance(band_id, int) or band_name is None or mode not in {"partial", "full"} or not members:
            continue
        normalized.append(
            {
                "band_id": band_id,
                "band_name": str(band_name),
                "mode": mode,
                "members": members,
            }
        )
    normalized.sort(key=lambda item: int(item["band_id"]))
    return normalized


def _to_string_array(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(item) for item in raw]
    if isinstance(raw, tuple):
        return [str(item) for item in raw]
    if isinstance(raw, str):
        stripped = raw.strip()
        # 兼容 value 存成 JSON 字符串数组的情况，例如 "[\"a\", \"b\"]"
        if stripped.startswith("[") and stripped.endswith("]"):
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, list):
                    return [str(item) for item in parsed]
            except json.JSONDecodeError:
                pass
        # 兼容双引号包裹的字符串字面量，例如 "\"xxx\""
        if len(stripped) >= 2 and stripped[0] == '"' and stripped[-1] == '"':
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, str):
                    return [parsed]
            except json.JSONDecodeError:
                pass
        return [raw]
    if isinstance(raw, (int, float, bool)):
        return [str(raw)]
    return [json.dumps(raw, ensure_ascii=False)]


def _normalize_band_ids(raw: Any) -> list[int]:
    if not isinstance(raw, (list, tuple)):
        return []
    return sorted({int(v) for v in raw if isinstance(v, int)})


def _normalize_total_count(raw: Any) -> int:
    if isinstance(raw, int) and raw > 0:
        return raw
    return DEFAULT_BAND_TOTAL_COUNT


def _load_detail_performances(cur: Any, live_ids: list[int]) -> PerformanceRowsByDetail:
    if not live_ids:
        return {}
    cur.execute(LIVE_DETAIL_PERFORMANCES_QUERY, (live_ids,))
    rows_by_detail: PerformanceRowsByDetail = {}
    allowed_roles: set[str] = {"former", "incoming", "guest", "support"}
    for row in cur.fetchall():
        (
            live_id,
            row_id,
            band_id,
            band_name,
            lineup_usage,
            handover_baseline,
            base_version_id,
            base_version_label,
            base_members,
            next_version_id,
            next_version_label,
            next_members,
            present_members,
            appearance_roles_raw,
        ) = row
        appearance_roles: dict[str, AppearanceCategory] = {
            str(member): cast(AppearanceCategory, str(raw_role))
            for member, raw_role in dict(appearance_roles_raw or {}).items()
            if str(raw_role) in allowed_roles
        }
        rows_by_detail.setdefault((int(live_id), str(row_id)), []).append(
            {
                "band_id": int(band_id),
                "band_name": str(band_name),
                "lineup_usage": str(lineup_usage),
                "handover_baseline": str(handover_baseline) if handover_baseline is not None else None,
                "base_version_id": int(base_version_id),
                "base_version_label": str(base_version_label),
                "base_members": _to_string_list(base_members),
                "next_version_id": int(next_version_id) if next_version_id is not None else None,
                "next_version_label": str(next_version_label) if next_version_label is not None else None,
                "next_members": _to_string_list(next_members),
                "present_members": _to_string_list(present_members),
                "appearance_roles": appearance_roles,
            }
        )
    return rows_by_detail


def _build_version_ref(version_id: int | None, version_label: str | None) -> dict[str, Any] | None:
    if version_id is None or version_label is None:
        return None
    return {
        "lineup_version_id": version_id,
        "version_label": version_label,
    }


def _build_versioned_band_member(item: dict[str, Any]) -> dict[str, Any]:
    usage = str(item["lineup_usage"])
    handover_baseline = str(item["handover_baseline"]) if item["handover_baseline"] is not None else None
    base_members = _to_string_list(item["base_members"])
    next_members = _to_string_list(item["next_members"])
    use_next_baseline = usage == "next" or (usage == "handover" and handover_baseline == "next")
    expected_members = next_members if use_next_baseline and item["next_version_id"] is not None else base_members
    base_member_set = set(base_members)
    next_member_set = set(next_members)
    incoming_members = [member for member in next_members if member not in base_member_set]
    outgoing_members = [member for member in base_members if member not in next_member_set]
    attendance = calculate_attendance(
        expected_members=expected_members,
        present_members=_to_string_list(item["present_members"]),
        incoming_members=incoming_members,
        outgoing_members=outgoing_members,
        appearance_roles=item["appearance_roles"],
    )
    return {
        "band_id": int(item["band_id"]),
        "band_name": str(item["band_name"]),
        "lineup_usage": usage,
        "handover_baseline": handover_baseline,
        "lineup_version": _build_version_ref(
            int(item["base_version_id"]),
            str(item["base_version_label"]),
        ),
        "next_lineup_version": _build_version_ref(
            int(item["next_version_id"]) if item["next_version_id"] is not None else None,
            str(item["next_version_label"]) if item["next_version_label"] is not None else None,
        ),
        "attendance_status": attendance.attendance_status,
        "expected_count": attendance.expected_count,
        "present_members": list(attendance.present_members),
        "present_count": attendance.present_count,
        "missing_members": list(attendance.missing_members),
        "extra_members": [
            {
                "member_name": extra.member_name,
                "category": extra.category,
            }
            for extra in attendance.extra_members
        ],
        "total_count": attendance.expected_count,
        "is_full": attendance.attendance_status in {"full", "full_plus"},
    }


def _build_unknown_band_member(
    *,
    band_id: int | None,
    band_name: str,
    present_members_raw: Any,
) -> dict[str, Any]:
    attendance = calculate_attendance(
        expected_members=None,
        present_members=_to_string_list(present_members_raw),
    )
    return {
        "band_id": band_id,
        "band_name": band_name,
        "lineup_usage": None,
        "handover_baseline": None,
        "lineup_version": None,
        "next_lineup_version": None,
        "attendance_status": attendance.attendance_status,
        "expected_count": attendance.expected_count,
        "present_members": list(attendance.present_members),
        "present_count": attendance.present_count,
        "missing_members": [],
        "extra_members": [],
        "total_count": attendance.expected_count,
        "is_full": False,
    }


def _build_detail_band_members(
    *,
    live_id: int,
    row_id: str,
    band_member_raw: Any,
    band_meta_by_name: dict[str, dict[str, int | None]],
    performance_rows_by_detail: PerformanceRowsByDetail,
) -> list[dict[str, Any]]:
    versioned_items = performance_rows_by_detail.get((live_id, row_id), [])
    band_members = [_build_versioned_band_member(item) for item in versioned_items]
    versioned_band_names = {str(item["band_name"]) for item in versioned_items}
    if isinstance(band_member_raw, dict):
        for band_name, present_members in band_member_raw.items():
            if str(band_name) in versioned_band_names:
                continue
            band_meta = band_meta_by_name.get(str(band_name), {})
            raw_band_id = band_meta.get("band_id")
            band_members.append(
                _build_unknown_band_member(
                    band_id=int(raw_band_id) if isinstance(raw_band_id, int) else None,
                    band_name=str(band_name),
                    present_members_raw=present_members,
                )
            )
    else:
        for raw_item in _ensure_json_array(band_member_raw):
            if not isinstance(raw_item, dict) or raw_item.get("band_name") is None:
                continue
            if str(raw_item["band_name"]) in versioned_band_names:
                continue
            raw_band_id = raw_item.get("band_id")
            band_members.append(
                _build_unknown_band_member(
                    band_id=int(raw_band_id) if isinstance(raw_band_id, int) else None,
                    band_name=str(raw_item["band_name"]),
                    present_members_raw=raw_item.get("present_members"),
                )
            )
    band_members.sort(
        key=lambda item: (
            item["band_id"] is None,
            item["band_id"] if item["band_id"] is not None else 10**9,
            item["band_name"],
        )
    )
    return band_members


def _other_member_sort_key(item: dict[str, Any]) -> str:
    key = item.get("key")
    return str(key) if key is not None else ""


def _build_detail_tags(
    is_short: bool,
    is_cover: bool,
    song_band_id: int,
    song_band_name: str | None,
    performer_band_ids: set[int],
) -> tuple[list[str], dict[str, Any] | None]:
    comments: list[str] = []
    if is_short:
        comments.append("短版")
    if is_cover:
        comments.append("翻唱")
        return comments, None
    if song_band_id > 0 and song_band_id not in performer_band_ids:
        comments.append("翻唱")
        return comments, {
            "band_id": song_band_id,
            "band_name": song_band_name or f"Band {song_band_id}",
        }
    return comments, None


def _order_band_names_by_bands(
    bands: list[int],
    raw_band_names: Any,
    band_name_to_id: Mapping[str, int | None] | None = None,
) -> list[str]:
    if not isinstance(raw_band_names, (list, tuple)):
        return []

    # 去重并保持原始出现顺序，避免重复 band_name 污染展示。
    deduped_names: list[str] = []
    seen_names: set[str] = set()
    for raw_name in raw_band_names:
        name = str(raw_name)
        if name in seen_names:
            continue
        seen_names.add(name)
        deduped_names.append(name)

    if not deduped_names or not band_name_to_id:
        return deduped_names

    mapped_groups: dict[int, list[str]] = {}
    unmapped_names: list[str] = []
    for name in deduped_names:
        band_id = band_name_to_id.get(name)
        if isinstance(band_id, int):
            mapped_groups.setdefault(band_id, []).append(name)
        else:
            unmapped_names.append(name)

    ordered_names: list[str] = []
    for band_id in bands:
        ordered_names.extend(sorted(mapped_groups.pop(band_id, [])))

    # 容错：若存在可映射但不在 bands 中的 id，仍按 band_id 升序拼接到已映射尾部。
    for band_id in sorted(mapped_groups):
        ordered_names.extend(sorted(mapped_groups[band_id]))

    # 规则：未映射到 band_id 的名称放在末尾。
    ordered_names.extend(unmapped_names)
    return ordered_names


def _build_live_detail_payload(
    header_row: tuple[Any, ...],
    parsed_rows: list[ParsedDetailRow],
    band_meta_by_name: dict[str, dict[str, int | None]],
    performance_rows_by_detail: PerformanceRowsByDetail,
) -> dict[str, Any]:
    live_id = int(header_row[0])
    bands = _normalize_band_ids(header_row[6])
    band_name_to_id = {
        band_name: band_meta["band_id"]
        for band_name, band_meta in band_meta_by_name.items()
        if isinstance(band_meta.get("band_id"), int)
    }
    detail_rows = []
    for row_id, song_name, band_member_raw, other_member_obj, is_short, is_cover, song_band_id, song_band_name in parsed_rows:
        band_members = _build_detail_band_members(
            live_id=live_id,
            row_id=row_id,
            band_member_raw=band_member_raw,
            band_meta_by_name=band_meta_by_name,
            performance_rows_by_detail=performance_rows_by_detail,
        )

        other_members = [{"key": str(key), "value": _to_string_array(value)} for key, value in other_member_obj.items()]
        other_members.sort(key=_other_member_sort_key)

        performer_band_ids = {int(member["band_id"]) for member in band_members if isinstance(member["band_id"], int)}
        comments, cover_band = _build_detail_tags(
            is_short,
            is_cover,
            song_band_id,
            song_band_name,
            performer_band_ids,
        )

        detail_rows.append(
            {
                "row_id": row_id,
                "song_name": song_name,
                "band_members": band_members,
                "other_members": other_members,
                "comments": comments,
                "cover_band": cover_band,
            }
        )

    live_type = str(header_row[9])
    event_attendees_raw = header_row[14] if len(header_row) > 14 else []
    event_status = str(header_row[15]) if len(header_row) > 15 else "scheduled"
    schedule_history = list(header_row[17] or []) if len(header_row) > 17 else []
    public_status = build_public_live_status(
        event_status=event_status,
        live_date=header_row[1],
        start_time=header_row[5] if len(header_row) > 15 else "00:00:00+00:00",
        was_rescheduled=bool(schedule_history),
    )
    return {
        "live_id": live_id,
        "live_date": header_row[1],
        "live_title": str(header_row[2]),
        "live_type": live_type,
        "venue": header_row[3],
        "opening_time": header_row[4],
        "start_time": header_row[5],
        "bands": bands,
        "band_names": _order_band_names_by_bands(bands, header_row[7], band_name_to_id),
        "url": header_row[8],
        "tour": build_tour_ref_from_row(header_row, tour_id_index=10, tour_title_index=11),
        "performance_group": build_performance_group_ref_from_row(header_row, group_id_index=12, group_title_index=13),
        "event_attendees": _normalize_event_attendees(event_attendees_raw, live_type),
        **public_status,
        "status_note": (
            header_row[16]
            if len(header_row) > 16 and event_status in {"postponed", "cancelled"}
            else None
        ),
        "schedule_history": schedule_history,
        "detail_rows": detail_rows,
    }


def _build_live_detail_with_cursor(cur: Any, live_id: int) -> dict[str, Any] | None:
    cur.execute(LIVE_DETAIL_HEADER_QUERY, (live_id,))
    header_row = cur.fetchone()
    if not header_row:
        return None

    cur.execute(LIVE_DETAIL_ROWS_QUERY, (live_id,))
    raw_rows = cur.fetchall()
    performance_rows_by_detail = _load_detail_performances(cur, [live_id])

    parsed_rows: list[ParsedDetailRow] = []
    all_band_names: set[str] = set()
    for row in raw_rows:
        row_id, song_name, band_member_raw, other_member_raw, is_short, is_cover, *song_band_values = row
        song_band_id = int(song_band_values[0]) if song_band_values else 0
        song_band_name = str(song_band_values[1]) if len(song_band_values) > 1 and song_band_values[1] is not None else None
        band_member_obj = _ensure_json_object(band_member_raw)
        other_member_obj = _ensure_json_object(other_member_raw)
        all_band_names.update(str(k) for k in band_member_obj.keys())
        parsed_rows.append(
            (
                str(row_id),
                str(song_name),
                band_member_obj,
                other_member_obj,
                bool(is_short),
                bool(is_cover),
                int(song_band_id),
                song_band_name,
            )
        )

    band_meta_by_name: dict[str, dict[str, int | None]] = {}
    if all_band_names:
        ordered_band_names = sorted(all_band_names)
        cur.execute(BAND_ID_LOOKUP_QUERY, (ordered_band_names,))
        band_lookup_rows = cur.fetchall()
        band_meta_by_name = {
            str(band_name): {
                "band_id": int(band_id) if isinstance(band_id, int) else None,
                "total_count": int(total_count) if isinstance(total_count, int) else None,
            }
            for band_id, band_name, total_count in band_lookup_rows
            if band_name is not None
        }
    for performance_items in performance_rows_by_detail.values():
        for performance_item in performance_items:
            band_meta_by_name[str(performance_item["band_name"])] = {
                "band_id": int(performance_item["band_id"]),
                "total_count": None,
            }

    return _build_live_detail_payload(
        header_row,
        parsed_rows,
        band_meta_by_name,
        performance_rows_by_detail,
    )


@router.get(
    "",
    response_model=LivesResponse,
    summary="获取 Live 列表",
    description=(
        "返回分页后的 Live 列表。page_size 当前只允许 15 或 20；"
        "当请求页码超过最后一页时，后端会自动钳制到最后一页。"
    ),
    responses={
        400: {
            "model": ErrorResponse,
            "description": "参数错误，例如非法 page_size",
        },
        500: {
            "model": ErrorResponse,
            "description": "数据库一般错误",
        },
        504: {
            "model": ErrorResponse,
            "description": "数据库连接超时或查询超时",
        },
    },
)
def get_lives(
    page: int = Query(default=1, ge=1, description="页码，从 1 开始。"),
    page_size: int = Query(default=20, description="每页条数，当前仅允许 15 或 20。"),
    without_setlist: bool = Query(default=False, description="是否仅返回尚无 setlist 数据的 Live。"),
    q: str | None = Query(default=None, max_length=255, description="匹配 Live、乐队、歌曲或场地的关键词。"),
    year: int | None = Query(default=None, ge=1900, le=2100, description="Live 年份。"),
    live_type: Literal["oneman", "taiban", "multi_act", "festival", "event", "other"] | None = Query(
        default=None,
        description="Live 类型。",
    ),
    band_id: int | None = Query(default=None, ge=1, description="包含指定乐队的 Live。"),
    sort: Literal["date_desc", "date_asc"] = Query(default="date_desc", description="按 Live 日期排序。"),
    current_user: AuthUser | None = Depends(get_current_user_optional),
):
    if page_size not in ALLOWED_PAGE_SIZE:
        raise HTTPException(status_code=400, detail="page_size must be 15 or 20")

    filters = LiveListFilters(
        q=normalize_list_query(q),
        year=year,
        live_type=live_type,
        band_id=band_id,
        sort=sort,
        without_setlist=without_setlist,
    )

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                if filters.is_default:
                    count_query = LIVES_COUNT_QUERY
                    count_params: tuple[object, ...] = ()
                    page_query = LIVES_PAGE_QUERY
                    page_params: tuple[object, ...] = ()
                elif (
                    without_setlist
                    and filters.q is None
                    and year is None
                    and live_type is None
                    and band_id is None
                    and sort == "date_desc"
                ):
                    count_query = LIVES_WITHOUT_SETLIST_COUNT_QUERY
                    count_params = ()
                    page_query = LIVES_WITHOUT_SETLIST_PAGE_QUERY
                    page_params = ()
                else:
                    count_query, count_params, page_query, page_params = build_filtered_live_queries(filters)

                if count_params:
                    cur.execute(count_query, count_params)
                else:
                    cur.execute(count_query)
                count_row = cur.fetchone()
                total = int(count_row[0]) if count_row else 0

                total_pages = ceil(total / page_size) if total > 0 else 1
                safe_page = min(page, total_pages)
                offset = (safe_page - 1) * page_size

                cur.execute(page_query, (*page_params, page_size, offset))
                rows = cur.fetchall()
                favorite_live_ids = set()
                if current_user is not None:
                    requested_live_ids = [int(row[0]) for row in rows]
                    favorite_live_ids = get_favorite_live_id_set(cur, current_user.id, requested_live_ids)
    except QueryCanceled as exc:
        logger.exception(
            "get_lives failed page=%s page_size=%s error_type=%s",
            page,
            page_size,
            type(exc).__name__,
        )
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception(
            "get_lives failed page=%s page_size=%s error_type=%s",
            page,
            page_size,
            type(exc).__name__,
        )
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception(
            "get_lives failed page=%s page_size=%s error_type=%s",
            page,
            page_size,
            type(exc).__name__,
        )
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    items = [
        {
            "live_id": row[0],
            "live_date": row[1],
            "live_title": row[2],
            "live_type": row[5],
            "bands": row[3] or [],
            "url": row[4],
            "is_favorite": int(row[0]) in favorite_live_ids if current_user is not None else False,
            "tour": build_tour_ref_from_row(row, tour_id_index=6, tour_title_index=7),
            "performance_group": build_performance_group_ref_from_row(row, group_id_index=8, group_title_index=9),
            **build_public_live_status(
                event_status=str(row[11]) if len(row) > 11 else "scheduled",
                live_date=row[1],
                start_time=row[10] if len(row) > 10 else "00:00:00+00:00",
                was_rescheduled=bool(row[12]) if len(row) > 12 else False,
            ),
        }
        for row in rows
    ]

    return {
        "items": items,
        "pagination": {
            "page": safe_page,
            "page_size": page_size,
            "total": total,
            "total_pages": total_pages,
        },
    }


@router.post(
    "/details:batch",
    response_model=LiveDetailsBatchResponse,
    summary="批量获取 Live 详情",
    description=(
        "用于批量预读详情。live_ids 会先去重并保序；"
        "允许部分成功，未命中的 ID 会进入 missing_live_ids。"
    ),
    responses={
        400: {
            "model": ErrorResponse,
            "description": "请求体中的某个 live_id 非法",
        },
        422: {
            "model": ValidationErrorResponse,
            "description": "请求体验证失败，例如缺失、空数组或超过最大长度",
        },
        500: {
            "model": ErrorResponse,
            "description": "数据库一般错误",
        },
        504: {
            "model": ErrorResponse,
            "description": "数据库连接超时或查询超时",
        },
    },
)
def get_live_details_batch(
    payload: LiveDetailBatchRequest = Body(..., description="待批量查询的 live_id 列表。"),
    current_user: AuthUser | None = Depends(get_current_user_optional),
):
    deduped_live_ids: list[int] = []
    seen: set[int] = set()
    for live_id in payload.live_ids:
        if live_id < 1:
            raise HTTPException(status_code=400, detail="all live_ids must be >= 1")
        if live_id in seen:
            continue
        seen.add(live_id)
        deduped_live_ids.append(live_id)

    items: list[dict[str, Any]] = []
    missing_live_ids: list[int] = []
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(BATCH_LIVE_DETAIL_HEADERS_QUERY, (deduped_live_ids,))
                header_rows = cur.fetchall()
                header_by_live_id = {int(row[0]): row for row in header_rows}
                favorite_live_ids = set()
                if current_user is not None:
                    favorite_live_ids = get_favorite_live_id_set(cur, current_user.id, deduped_live_ids)

                cur.execute(BATCH_LIVE_DETAIL_ROWS_QUERY, (deduped_live_ids,))
                raw_rows = cur.fetchall()
                performance_rows_by_detail = _load_detail_performances(cur, deduped_live_ids)

                parsed_rows_by_live_id: dict[int, list[ParsedDetailRow]] = {}
                band_meta_by_name_by_live_id: dict[int, dict[str, dict[str, int | None]]] = {}
                for row in raw_rows:
                    live_id, row_id, song_name, band_members_raw, other_member_raw, is_short, is_cover, *song_band_values = row
                    song_band_id = int(song_band_values[0]) if song_band_values else 0
                    song_band_name = str(song_band_values[1]) if len(song_band_values) > 1 and song_band_values[1] is not None else None
                    live_id_int = int(live_id)
                    for band_item in _ensure_json_array(band_members_raw):
                        if not isinstance(band_item, dict):
                            continue
                        band_name_raw = band_item.get("band_name")
                        if band_name_raw is None:
                            continue
                        band_name = str(band_name_raw)
                        band_id_raw = band_item.get("band_id")
                        band_meta_by_name_by_live_id.setdefault(live_id_int, {})[band_name] = {
                            "band_id": int(band_id_raw) if isinstance(band_id_raw, int) else None,
                            "total_count": None,
                        }
                    parsed_rows_by_live_id.setdefault(live_id_int, []).append(
                        (
                            str(row_id),
                            str(song_name),
                            band_members_raw,
                            _ensure_json_object(other_member_raw),
                            bool(is_short),
                            bool(is_cover),
                            int(song_band_id),
                            song_band_name,
                        )
                    )

                for (live_id, _row_id), performance_items in performance_rows_by_detail.items():
                    for performance_item in performance_items:
                        band_meta_by_name_by_live_id.setdefault(live_id, {})[
                            str(performance_item["band_name"])
                        ] = {
                            "band_id": int(performance_item["band_id"]),
                            "total_count": None,
                        }

                for live_id in deduped_live_ids:
                    header_row = header_by_live_id.get(live_id)
                    if header_row is None:
                        missing_live_ids.append(live_id)
                        continue
                    detail = _build_live_detail_payload(
                        header_row,
                        parsed_rows_by_live_id.get(live_id, []),
                        band_meta_by_name_by_live_id.get(live_id, {}),
                        performance_rows_by_detail,
                    )
                    detail["is_favorite"] = (
                        live_id in favorite_live_ids if current_user is not None else False
                    )
                    items.append(detail)
    except QueryCanceled as exc:
        logger.exception(
            "get_live_details_batch failed live_ids_count=%s error_type=%s",
            len(deduped_live_ids),
            type(exc).__name__,
        )
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception(
            "get_live_details_batch failed live_ids_count=%s error_type=%s",
            len(deduped_live_ids),
            type(exc).__name__,
        )
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception(
            "get_live_details_batch failed live_ids_count=%s error_type=%s",
            len(deduped_live_ids),
            type(exc).__name__,
        )
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "items": items,
        "missing_live_ids": missing_live_ids,
    }


@router.get(
    "/{live_id}",
    response_model=LiveDetailResponse,
    summary="获取单条 Live 详情",
    description=(
        "返回指定 live_id 的完整详情。detail_rows 按 absolute_order 返回；"
        "band_names 会先去重，再按 bands 中的 band_id 顺序排列。"
    ),
    responses={
        400: {
            "model": ErrorResponse,
            "description": "参数错误",
        },
        404: {
            "model": ErrorResponse,
            "description": "指定 live_id 不存在",
        },
        500: {
            "model": ErrorResponse,
            "description": "数据库一般错误",
        },
        504: {
            "model": ErrorResponse,
            "description": "数据库连接超时或查询超时",
        },
    },
)
def get_live_detail(
    live_id: int,
    current_user: AuthUser | None = Depends(get_current_user_optional),
):
    if live_id < 1:
        raise HTTPException(status_code=400, detail="live_id must be >= 1")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                detail = _build_live_detail_with_cursor(cur, live_id)
                if detail is None:
                    raise HTTPException(status_code=404, detail=f"Live id {live_id} not found")
                detail["is_favorite"] = is_live_favorite(cur, current_user.id, live_id) if current_user is not None else False
    except QueryCanceled as exc:
        logger.exception("get_live_detail failed live_id=%s error_type=%s", live_id, type(exc).__name__)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("get_live_detail failed live_id=%s error_type=%s", live_id, type(exc).__name__)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("get_live_detail failed live_id=%s error_type=%s", live_id, type(exc).__name__)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return detail



