import re
from math import ceil
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled

from app.auth import require_role
from app.db import get_db_connection
from app.logging_config import get_logger
from app.live_status import build_public_live_status
from app.schemas import ErrorResponse, ValidationErrorResponse
from app.schemas.auth import AuthErrorResponse
from app.schemas.console import (
    ConsoleBandListResponse,
    ConsoleLiveCandidatesResponse,
    ConsoleLiveEditResponse,
    ConsoleSongListResponse,
    ConsoleLiveSetlistEditResponse,
    ConsoleVenueListResponse,
)
from app.song_lookup import (
    SONG_LOOKUP_SQL_FROM_CHARS,
    SONG_LOOKUP_SQL_PUNCTUATION_WHITESPACE_PATTERNS,
    SONG_LOOKUP_SQL_TO_CHARS,
    normalize_song_lookup_text,
)

router = APIRouter()
logger = get_logger(__name__)

TIMEZONE_SUFFIX_PATTERN = re.compile(r"([+-]\d{2})(?::?(\d{2}))?$")

CONSOLE_EVENT_ATTENDEES_SQL = """
CASE
    WHEN l.live_type = 'event' THEN COALESCE(
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'band_id', ba.band_id,
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
                ORDER BY ba.band_id
            )
            FROM jsonb_each(l.event_attendees) attendee(band_id_text, members)
            JOIN current_band_versions ba
                ON ba.band_id = CASE
                    WHEN attendee.band_id_text ~ '^[0-9]+$' THEN attendee.band_id_text::int
                    ELSE NULL
                END
            LEFT JOIN live_band_lineup_contexts context
                ON context.live_id = l.id
               AND context.band_id = ba.band_id
            WHERE jsonb_typeof(attendee.members) = 'array'
        ),
        '[]'::jsonb
    )
    ELSE '[]'::jsonb
END
"""


def _normalize_lookup_query(value: str | None) -> str:
    """Trim optional console lookup text so blank queries become the default list query."""
    if value is None:
        return ""
    return value.strip()


def _build_lookup_pattern(value: str) -> str:
    """Build a safe ILIKE pattern for simple console lookup endpoints."""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _build_prefix_lookup_pattern(value: str) -> str:
    """Build a safe ILIKE pattern that only completes text to the right."""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"{escaped}%"


def _build_exact_lookup_pattern(value: str) -> str:
    """Build a safe exact ILIKE pattern for ordering exact lookup hits first."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _normalize_timetz_text(value: Any) -> str | None:
    """Return a stable timetz string and its explicit UTC offset for the edit form."""
    if value is None:
        return None
    raw = str(value)
    match = TIMEZONE_SUFFIX_PATTERN.search(raw)
    if match is None:
        return raw
    timezone = f"{match.group(1)}:{match.group(2) or '00'}"
    local_time = raw[: match.start()]
    if len(local_time) == 5:
        local_time = f"{local_time}:00"
    return f"{local_time}{timezone}"


def _format_timezone_offset(offset_minutes: int) -> str:
    """Format a persisted fixed UTC offset for the console form."""
    sign = "+" if offset_minutes >= 0 else "-"
    absolute = abs(offset_minutes)
    return f"{sign}{absolute // 60:02d}:{absolute % 60:02d}"


def _missing_schedule_fields(venue_id: Any, opening_time: Any, start_time: Any) -> list[str]:
    """Return missing schedule field codes in stable presentation order."""
    return [
        field
        for field, value in (("venue", venue_id), ("opening_time", opening_time), ("start_time", start_time))
        if value is None
    ]


def _schedule_attention(event_status: str, date_phase: str, missing_fields: list[str]) -> str:
    """Derive the console-only urgency for incomplete schedule data."""
    if not missing_fields:
        return "none"
    if event_status != "scheduled":
        return "inactive"
    return "overdue" if date_phase == "past" else date_phase


def _normalize_console_event_attendees(raw: Any) -> list[dict[str, Any]]:
    """Normalize the JSON aggregate used by the console edit response."""
    if not isinstance(raw, list):
        return []
    result: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        band_id = item.get("band_id")
        members = item.get("members")
        mode = item.get("mode")
        if not isinstance(band_id, int) or not isinstance(members, list) or mode not in {"partial", "full"}:
            continue
        result.append({"band_id": band_id, "mode": mode, "members": [str(member) for member in members]})
    return result


@router.get(
    "/lives",
    response_model=ConsoleLiveCandidatesResponse,
    summary="查询可编辑 Live",
    description="`editor+` 用户按 Live 标题或 ID 分页查询全部可编辑 Live，并可按类型筛选。",
    responses={
        401: {"model": AuthErrorResponse, "description": "未登录或 session 已失效"},
        403: {"model": AuthErrorResponse, "description": "缺少权限"},
        422: {"model": ValidationErrorResponse, "description": "查询参数验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def list_editable_lives(
    q: str | None = Query(default=None, max_length=255, description="Live title keyword or exact ID"),
    live_type: Literal["oneman", "taiban", "multi_act", "festival", "event", "other"] | None = Query(
        default=None,
        description="Optional exact Live type filter",
    ),
    has_setlist: bool | None = Query(default=None, description="Optional Setlist existence filter"),
    event_status: Literal["scheduled", "postponed", "cancelled"] | None = Query(
        default=None,
        description="Optional exact event status filter",
    ),
    schedule_complete: bool | None = Query(default=None, description="Optional schedule completeness filter"),
    schedule_attention: Literal["upcoming", "today", "overdue", "inactive"] | None = Query(
        default=None,
        description="Optional derived schedule attention filter",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    _: Any = Depends(require_role("editor")),
):
    """Return every Live, including rows that already have Setlist data, for console editing."""
    query_text = _normalize_lookup_query(q)
    conditions: list[str] = []
    params: list[Any] = []
    if query_text:
        conditions.append("(l.live_title ILIKE %s ESCAPE '\\' OR CAST(l.id AS text) = %s)")
        params.extend((_build_lookup_pattern(query_text), query_text))
    if live_type is not None:
        conditions.append("l.live_type = %s")
        params.append(live_type)
    if has_setlist is True:
        conditions.append("EXISTS (SELECT 1 FROM live_setlist ls WHERE ls.live_id = l.id)")
    elif has_setlist is False:
        conditions.append("NOT EXISTS (SELECT 1 FROM live_setlist ls WHERE ls.live_id = l.id)")
    if event_status is not None:
        conditions.append("l.event_status = %s")
        params.append(event_status)
    complete_sql = "l.venue_id IS NOT NULL AND l.opening_time IS NOT NULL AND l.start_time IS NOT NULL"
    incomplete_sql = f"NOT ({complete_sql})"
    local_today_sql = "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + make_interval(mins => l.timezone_offset_minutes))::date"
    if schedule_complete is True:
        conditions.append(complete_sql)
    elif schedule_complete is False:
        conditions.append(incomplete_sql)
    if schedule_attention == "inactive":
        conditions.append(f"{incomplete_sql} AND l.event_status <> 'scheduled'")
    elif schedule_attention is not None:
        phase_operator = {"upcoming": ">", "today": "=", "overdue": "<"}[schedule_attention]
        conditions.append(
            f"{incomplete_sql} AND l.event_status = 'scheduled' AND l.live_date {phase_operator} {local_today_sql}"
        )
    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT COUNT(*) FROM live_attrs l {where_sql}", tuple(params))
                count_row = cur.fetchone()
                total = int(count_row[0]) if count_row is not None else 0
                total_pages = max(1, ceil(total / page_size))
                safe_page = min(page, total_pages)
                cur.execute(
                    f"""
                    SELECT
                        COUNT(*) FILTER (WHERE l.live_date > {local_today_sql}),
                        COUNT(*) FILTER (WHERE l.live_date = {local_today_sql}),
                        COUNT(*) FILTER (WHERE l.live_date < {local_today_sql})
                    FROM live_attrs l
                    WHERE l.event_status = 'scheduled' AND {incomplete_sql}
                    """
                )
                attention_row = cur.fetchone() or (0, 0, 0)
                attention_order_sql = (
                    f"CASE WHEN l.event_status = 'scheduled' AND {incomplete_sql} THEN "
                    f"CASE WHEN l.live_date = {local_today_sql} THEN 0 "
                    f"WHEN l.live_date < {local_today_sql} THEN 1 ELSE 2 END ELSE 3 END, "
                    f"CASE WHEN l.live_date < {local_today_sql} THEN l.live_date END DESC, "
                    f"CASE WHEN l.live_date > {local_today_sql} THEN l.live_date END ASC, "
                    "l.live_date ASC, l.id ASC"
                    if schedule_complete is False or schedule_attention is not None
                    else "l.live_date DESC, l.id DESC"
                )
                cur.execute(
                    f"""
                    SELECT l.id, l.live_date, l.live_title, l.live_type, v.venue,
                           l.start_time, l.event_status, l.opening_time, l.venue_id,
                           l.timezone_offset_minutes
                    FROM live_attrs l
                    LEFT JOIN venue_list v ON v.id = l.venue_id
                    {where_sql}
                    ORDER BY {attention_order_sql}
                    LIMIT %s OFFSET %s
                    """,
                    (*params, page_size, (safe_page - 1) * page_size),
                )
                rows = cur.fetchall()
    except QueryCanceled as exc:
        logger.exception("list_editable_lives timeout q=%s page=%s", query_text, page)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("list_editable_lives operational error q=%s page=%s", query_text, page)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("list_editable_lives failed q=%s page=%s", query_text, page)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    return {
        "items": [
            (lambda public_status, missing: {
                "live_id": int(row[0]),
                "live_date": row[1],
                "live_title": str(row[2]),
                "live_type": str(row[3]),
                "venue_name": str(row[4]) if row[4] is not None else None,
                **public_status,
                "missing_schedule_fields": missing,
                "schedule_attention": _schedule_attention(str(row[6]), str(public_status["date_phase"]), missing),
            })(
                build_public_live_status(
                    event_status=str(row[6]),
                    live_date=row[1],
                    start_time=row[5],
                    timezone_offset_minutes=int(row[9]),
                    was_rescheduled=False,
                ),
                _missing_schedule_fields(row[8], row[7], row[5]),
            )
            for row in rows
        ],
        "page": safe_page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "attention_counts": {
            "upcoming": int(attention_row[0]),
            "today": int(attention_row[1]),
            "overdue": int(attention_row[2]),
        },
    }


@router.get(
    "/lives/{live_id}",
    response_model=ConsoleLiveEditResponse,
    summary="获取 Live 编辑数据",
    description="返回一个 Live 的完整可编辑基础资料，不包含 Setlist 或聚合关系。",
    responses={
        401: {"model": AuthErrorResponse, "description": "未登录或 session 已失效"},
        403: {"model": AuthErrorResponse, "description": "缺少权限"},
        404: {"model": ErrorResponse, "description": "Live 不存在"},
        422: {"model": ValidationErrorResponse, "description": "路径参数验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def get_editable_live(
    live_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
):
    """Return the exact persisted values needed to populate the shared Live form."""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT
                        l.id,
                        l.live_date,
                        l.live_title,
                        l.live_type,
                        l.url,
                        l.opening_time::text,
                        l.start_time::text,
                        l.venue_id,
                        v.venue,
                        l.default_band_ids,
                        {CONSOLE_EVENT_ATTENDEES_SQL} AS event_attendees,
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
                        ) AS schedule_history,
                        EXISTS (
                            SELECT 1 FROM live_setlist existing_setlist
                            WHERE existing_setlist.live_id = l.id
                        ) AS has_setlist,
                        COALESCE(
                            (
                                SELECT jsonb_agg(
                                    jsonb_build_object(
                                        'band_id', context.band_id,
                                        'band_name_version_id', context.band_name_version_id,
                                        'base_lineup_version_id', context.base_lineup_version_id,
                                        'next_lineup_version_id', context.next_lineup_version_id
                                    )
                                    ORDER BY context.band_id
                                )
                                FROM live_band_lineup_contexts context
                                WHERE context.live_id = l.id
                            ),
                            '[]'::jsonb
                        ) AS band_lineup_contexts,
                        l.timezone_offset_minutes
                    FROM live_attrs l
                    LEFT JOIN venue_list v ON v.id = l.venue_id
                    WHERE l.id = %s
                    """,
                    (live_id,),
                )
                row = cur.fetchone()
    except QueryCanceled as exc:
        logger.exception("get_editable_live timeout live_id=%s", live_id)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("get_editable_live operational error live_id=%s", live_id)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("get_editable_live failed live_id=%s", live_id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    if row is None:
        raise HTTPException(status_code=404, detail=f"Live id {live_id} not found")
    opening_time = _normalize_timetz_text(row[5])
    start_time = _normalize_timetz_text(row[6])
    timezone = _format_timezone_offset(int(row[16]))
    return {
        "item": {
            "live_id": int(row[0]),
            "live_date": row[1],
            "live_title": str(row[2]),
            "live_type": str(row[3]),
            "url": str(row[4]),
            "opening_time": opening_time,
            "start_time": start_time,
            "timezone": timezone,
            "venue_id": int(row[7]) if row[7] is not None else None,
            "venue_name": str(row[8]) if row[8] is not None else None,
            "default_band_ids": list(row[9] or []),
            "event_attendees": _normalize_console_event_attendees(row[10]),
            "event_status": str(row[11]) if len(row) > 11 else "scheduled",
            "status_note": row[12] if len(row) > 12 else None,
            "date_phase": build_public_live_status(
                event_status=str(row[11]) if len(row) > 11 else "scheduled",
                live_date=row[1],
                start_time=row[6],
                timezone_offset_minutes=int(row[16]),
                was_rescheduled=bool(row[13]) if len(row) > 13 else False,
            )["date_phase"],
            "schedule_history": list(row[13] or []) if len(row) > 13 else [],
            "has_setlist": bool(row[14]) if len(row) > 14 else False,
            "band_lineup_contexts": list(row[15] or []) if len(row) > 15 else [],
        }
    }


@router.get(
    "/lives/{live_id}/setlist",
    response_model=ConsoleLiveSetlistEditResponse,
    summary="获取 Setlist 编辑数据",
    description="`editor+` 用户读取一个 Live 的完整原始 Setlist 数据。",
)
def get_editable_live_setlist(
    live_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM live_attrs WHERE id = %s", (live_id,))
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail=f"Live id {live_id} not found")
                cur.execute(
                    """
                    SELECT
                        ls.id::text,
                        ls.song_id,
                        s.song_name,
                        ls.absolute_order,
                        ls.segment_type,
                        ls.sub_order,
                        ls.is_short,
                        ls.other_member,
                        ls.comment
                    FROM live_setlist AS ls
                    JOIN song_list AS s ON s.id = ls.song_id
                    WHERE ls.live_id = %s
                    ORDER BY ls.absolute_order, ls.id
                    """,
                    (live_id,),
                )
                rows = cur.fetchall()
                cur.execute(
                    """
                    SELECT
                        context.band_id,
                        context.band_name_version_id,
                        context.base_lineup_version_id,
                        context.next_lineup_version_id,
                        name_version.band_name
                    FROM live_band_lineup_contexts context
                    JOIN band_name_versions name_version
                      ON name_version.id = context.band_name_version_id
                    WHERE context.live_id = %s
                    ORDER BY context.band_id
                    """,
                    (live_id,),
                )
                lineup_context_rows = cur.fetchall()
                cur.execute(
                    """
                    SELECT
                        performance.setlist_id::text,
                        performance.band_id,
                        performance.lineup_usage,
                        performance.handover_baseline,
                        ARRAY(
                            SELECT member.member_name
                            FROM live_setlist_band_performance_members member
                            WHERE member.setlist_id = performance.setlist_id
                              AND member.band_id = performance.band_id
                            ORDER BY member.display_order
                        )
                    FROM live_setlist_band_performances performance
                    WHERE performance.live_id = %s
                    ORDER BY performance.setlist_id, performance.band_id
                    """,
                    (live_id,),
                )
                performance_rows = cur.fetchall()
    except HTTPException:
        raise
    except QueryCanceled as exc:
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    performances_by_setlist_id: dict[str, list[dict[str, Any]]] = {}
    for setlist_id, band_id, lineup_usage, handover_baseline, members in performance_rows:
        performances_by_setlist_id.setdefault(str(setlist_id), []).append(
            {
                "band_id": int(band_id),
                "lineup_usage": str(lineup_usage),
                "handover_baseline": str(handover_baseline) if handover_baseline is not None else None,
                "members": [str(member) for member in members],
            }
        )
    band_names_by_id = {int(row[0]): str(row[4]) for row in lineup_context_rows}
    return {
        "live_id": live_id,
        "band_lineup_contexts": [
            {
                "band_id": int(row[0]),
                "band_name_version_id": int(row[1]),
                "base_lineup_version_id": int(row[2]),
                "next_lineup_version_id": int(row[3]) if row[3] is not None else None,
            }
            for row in lineup_context_rows
        ],
        "rows": [
            {
                "row_id": row[0],
                "song_id": int(row[1]),
                "song_name": str(row[2]),
                "absolute_order": int(row[3]),
                "segment_type": str(row[4]),
                "sub_order": int(row[5]),
                "is_short": bool(row[6]),
                "band_member": {
                    band_names_by_id[performance["band_id"]]: performance["members"]
                    for performance in performances_by_setlist_id.get(str(row[0]), [])
                    if performance["band_id"] in band_names_by_id
                },
                "band_performances": performances_by_setlist_id.get(str(row[0]), []),
                "other_member": row[7],
                "comment": row[8],
            }
            for row in rows
        ],
    }


@router.get(
    "/songs",
    response_model=ConsoleSongListResponse,
    summary="查询歌曲候选",
    description="`editor+` 用户查询控制台录入时可选择的歌曲。支持按歌名前缀和归属 Band 筛选。",
    responses={
        401: {"model": AuthErrorResponse, "description": "未登录或 session 已失效"},
        403: {"model": AuthErrorResponse, "description": "缺少权限"},
        422: {"model": ValidationErrorResponse, "description": "查询参数验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def list_songs(
    q: str | None = Query(default=None, max_length=255, description="Song title prefix"),
    limit: int = Query(default=20, ge=1, le=100, description="Maximum number of songs to return"),
    page: int = Query(default=1, ge=1, description="Result page"),
    band_id: int | None = Query(default=None, ge=0, description="Owning band_attrs.id"),
    _: Any = Depends(require_role("editor")),
):
    """Return song_list rows for the console song selector without mutating any data."""
    query_text = _normalize_lookup_query(q)
    normalized_query_text = normalize_song_lookup_text(query_text)
    band_filter_sql = " AND band_id = %s" if band_id is not None else ""
    band_filter_params = (band_id,) if band_id is not None else ()

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                if query_text:
                    normalized_song_list_sql = """
                        WITH normalized_song_list AS (
                            SELECT
                                s.id,
                                s.song_name,
                                s.band_id,
                                s.is_cover,
                                b.band_name,
                                regexp_replace(
                                    regexp_replace(
                                        regexp_replace(
                                            regexp_replace(
                                                translate(s.song_name, %s, %s),
                                                %s,
                                                '\\1',
                                                'g'
                                            ),
                                            %s,
                                            '\\1',
                                            'g'
                                        ),
                                        %s,
                                        '\\1\\2',
                                        'g'
                                    ),
                                    %s,
                                    '\\1\\2',
                                    'g'
                                ) AS normalized_song_name
                            FROM song_list AS s
                            JOIN band_attrs AS b ON b.id = s.band_id
                        )
                    """
                    normalization_params = (
                        SONG_LOOKUP_SQL_FROM_CHARS,
                        SONG_LOOKUP_SQL_TO_CHARS,
                        SONG_LOOKUP_SQL_PUNCTUATION_WHITESPACE_PATTERNS[0],
                        SONG_LOOKUP_SQL_PUNCTUATION_WHITESPACE_PATTERNS[1],
                        SONG_LOOKUP_SQL_PUNCTUATION_WHITESPACE_PATTERNS[2],
                        SONG_LOOKUP_SQL_PUNCTUATION_WHITESPACE_PATTERNS[3],
                    )
                    prefix_params = (
                        _build_prefix_lookup_pattern(query_text),
                        _build_prefix_lookup_pattern(normalized_query_text),
                    )
                    cur.execute(
                        f"""
                        {normalized_song_list_sql}
                        SELECT COUNT(*)
                        FROM normalized_song_list
                        WHERE (
                            song_name ILIKE %s ESCAPE '\\'
                            OR normalized_song_name ILIKE %s ESCAPE '\\'
                        )
                        {band_filter_sql}
                        """,
                        (*normalization_params, *prefix_params, *band_filter_params),
                    )
                elif band_id is not None:
                    cur.execute("SELECT COUNT(*) FROM song_list WHERE band_id = %s", (band_id,))
                else:
                    cur.execute("SELECT COUNT(*) FROM song_list")
                total_row = cur.fetchone()
                total = int(total_row[0]) if total_row is not None else 0
                total_pages = max(1, (total + limit - 1) // limit)
                safe_page = min(page, total_pages)
                offset = (safe_page - 1) * limit

                if query_text:
                    cur.execute(
                        f"""
                        {normalized_song_list_sql}
                        SELECT id, song_name, band_id, is_cover, band_name
                        FROM normalized_song_list
                        WHERE (
                            song_name ILIKE %s ESCAPE '\\'
                            OR normalized_song_name ILIKE %s ESCAPE '\\'
                        )
                        {band_filter_sql}
                        ORDER BY
                            CASE
                                WHEN song_name ILIKE %s ESCAPE '\\' THEN 0
                                WHEN normalized_song_name ILIKE %s ESCAPE '\\' THEN 1
                                ELSE 2
                            END,
                            song_name,
                            id
                        LIMIT %s OFFSET %s
                        """,
                        (
                            *normalization_params,
                            *prefix_params,
                            *band_filter_params,
                            _build_exact_lookup_pattern(query_text),
                            _build_exact_lookup_pattern(normalized_query_text),
                            limit,
                            offset,
                        ),
                    )
                elif band_id is not None:
                    cur.execute(
                        """
                        SELECT s.id, s.song_name, s.band_id, s.is_cover, b.band_name
                        FROM song_list AS s
                        JOIN band_attrs AS b ON b.id = s.band_id
                        WHERE s.band_id = %s
                        ORDER BY s.song_name, s.id
                        LIMIT %s OFFSET %s
                        """,
                        (band_id, limit, offset),
                    )
                else:
                    cur.execute(
                        """
                        SELECT s.id, s.song_name, s.band_id, s.is_cover, b.band_name
                        FROM song_list AS s
                        JOIN band_attrs AS b ON b.id = s.band_id
                        ORDER BY s.song_name, s.id
                        LIMIT %s OFFSET %s
                        """,
                        (limit, offset),
                    )
                rows = cur.fetchall()
    except QueryCanceled as exc:
        logger.exception(
            "list_songs timeout q=%s band_id=%s limit=%s page=%s",
            query_text,
            band_id,
            limit,
            page,
        )
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception(
            "list_songs operational error q=%s band_id=%s limit=%s page=%s",
            query_text,
            band_id,
            limit,
            page,
        )
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception(
            "list_songs failed q=%s band_id=%s limit=%s page=%s",
            query_text,
            band_id,
            limit,
            page,
        )
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "items": [
            {
                "song_id": int(row[0]),
                "song_name": row[1],
                "band_id": int(row[2]),
                "cover": bool(row[3]),
                "band_name": row[4],
            }
            for row in rows
        ],
        "page": safe_page,
        "page_size": limit,
        "total": total,
        "total_pages": total_pages,
    }


@router.get(
    "/bands",
    response_model=ConsoleBandListResponse,
    summary="查询乐队候选",
    description="`editor+` 用户查询控制台录入时可选择的乐队和成员列表。`q` 为空时返回默认候选列表。",
    responses={
        401: {"model": AuthErrorResponse, "description": "未登录或 session 已失效"},
        403: {"model": AuthErrorResponse, "description": "缺少权限"},
        422: {"model": ValidationErrorResponse, "description": "查询参数验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def list_bands(
    q: str | None = Query(default=None, max_length=255, description="Band name or abbreviation keyword"),
    limit: int = Query(default=20, ge=1, le=100, description="Maximum number of bands to return"),
    _: Any = Depends(require_role("editor")),
):
    """Return band_attrs rows for the console band/member selector without mutating any data."""
    query_text = _normalize_lookup_query(q)

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                if query_text:
                    pattern = _build_lookup_pattern(query_text)
                    cur.execute(
                        """
                        SELECT band_id, band_name, band_abbr, band_members
                        FROM current_band_versions
                        WHERE band_name ILIKE %s ESCAPE '\\'
                           OR band_abbr ILIKE %s ESCAPE '\\'
                        ORDER BY band_name, band_id
                        LIMIT %s
                        """,
                        (pattern, pattern, limit),
                    )
                else:
                    cur.execute(
                        """
                        SELECT band_id, band_name, band_abbr, band_members
                        FROM current_band_versions
                        ORDER BY band_name, band_id
                        LIMIT %s
                        """,
                        (limit,),
                    )
                rows = cur.fetchall()
    except QueryCanceled as exc:
        logger.exception("list_bands timeout q=%s limit=%s", query_text, limit)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("list_bands operational error q=%s limit=%s", query_text, limit)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("list_bands failed q=%s limit=%s", query_text, limit)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "items": [
            {
                "band_id": int(row[0]),
                "band_name": row[1],
                "band_abbr": row[2],
                "band_members": list(row[3] or []),
            }
            for row in rows
        ],
    }


@router.get(
    "/venues",
    response_model=ConsoleVenueListResponse,
    summary="查询场地候选",
    description="`editor+` 用户查询控制台录入时可选择的场地。`q` 为空时返回默认候选列表。",
    responses={
        401: {"model": AuthErrorResponse, "description": "未登录或 session 已失效"},
        403: {"model": AuthErrorResponse, "description": "缺少权限"},
        422: {"model": ValidationErrorResponse, "description": "查询参数验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def list_venues(
    q: str | None = Query(default=None, max_length=255, description="Venue keyword"),
    limit: int = Query(default=20, ge=1, le=100, description="Maximum number of venues to return"),
    _: Any = Depends(require_role("editor")),
):
    """Return venue_list rows for the console venue selector without mutating any data."""
    query_text = _normalize_lookup_query(q)

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                if query_text:
                    cur.execute(
                        """
                        SELECT id, venue
                        FROM venue_list
                        WHERE venue ILIKE %s ESCAPE '\\'
                        ORDER BY venue, id
                        LIMIT %s
                        """,
                        (_build_lookup_pattern(query_text), limit),
                    )
                else:
                    cur.execute(
                        """
                        SELECT id, venue
                        FROM venue_list
                        ORDER BY venue, id
                        LIMIT %s
                        """,
                        (limit,),
                    )
                rows = cur.fetchall()
    except QueryCanceled as exc:
        logger.exception("list_venues timeout q=%s limit=%s", query_text, limit)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("list_venues operational error q=%s limit=%s", query_text, limit)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("list_venues failed q=%s limit=%s", query_text, limit)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "items": [
            {
                "venue_id": int(row[0]),
                "venue_name": row[1],
            }
            for row in rows
        ]
    }
