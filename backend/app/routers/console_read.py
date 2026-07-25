import re
from math import ceil
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled

from app.auth import require_role
from app.db import get_db_connection
from app.logging_config import get_logger
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
                    'band_id', ba.id,
                    'mode', CASE
                        WHEN jsonb_array_length(attendee.members) = cardinality(ba.band_members) THEN 'full'
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


def _normalize_timetz_text(value: Any) -> tuple[str, str]:
    """Return a stable timetz string and its explicit UTC offset for the edit form."""
    raw = str(value)
    match = TIMEZONE_SUFFIX_PATTERN.search(raw)
    if match is None:
        return raw, "+00:00"
    timezone = f"{match.group(1)}:{match.group(2) or '00'}"
    local_time = raw[: match.start()]
    if len(local_time) == 5:
        local_time = f"{local_time}:00"
    return f"{local_time}{timezone}", timezone


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
                    SELECT l.id, l.live_date, l.live_title, l.live_type, v.venue
                    FROM live_attrs l
                    JOIN venue_list v ON v.id = l.venue_id
                    {where_sql}
                    ORDER BY l.live_date DESC, l.id DESC
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
            {
                "live_id": int(row[0]),
                "live_date": row[1],
                "live_title": str(row[2]),
                "live_type": str(row[3]),
                "venue_name": str(row[4]),
            }
            for row in rows
        ],
        "page": safe_page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
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
                        {CONSOLE_EVENT_ATTENDEES_SQL} AS event_attendees
                    FROM live_attrs l
                    JOIN venue_list v ON v.id = l.venue_id
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
    opening_time, timezone = _normalize_timetz_text(row[5])
    start_time, _ = _normalize_timetz_text(row[6])
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
            "venue_id": int(row[7]),
            "venue_name": str(row[8]),
            "default_band_ids": list(row[9] or []),
            "event_attendees": _normalize_console_event_attendees(row[10]),
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
                        ls.band_member,
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
    return {
        "live_id": live_id,
        "rows": [
            {
                "row_id": row[0],
                "song_id": int(row[1]),
                "song_name": str(row[2]),
                "absolute_order": int(row[3]),
                "segment_type": str(row[4]),
                "sub_order": int(row[5]),
                "is_short": bool(row[6]),
                "band_member": row[7],
                "other_member": row[8],
                "comment": row[9],
            }
            for row in rows
        ],
    }


@router.get(
    "/songs",
    response_model=ConsoleSongListResponse,
    summary="查询歌曲候选",
    description="`editor+` 用户查询控制台录入时可选择的歌曲。`q` 为空时返回默认候选列表。",
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
    _: Any = Depends(require_role("editor")),
):
    """Return song_list rows for the console song selector without mutating any data."""
    query_text = _normalize_lookup_query(q)
    normalized_query_text = normalize_song_lookup_text(query_text)

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
                        WHERE song_name ILIKE %s ESCAPE '\\'
                           OR normalized_song_name ILIKE %s ESCAPE '\\'
                        """,
                        (*normalization_params, *prefix_params),
                    )
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
                        WHERE song_name ILIKE %s ESCAPE '\\'
                           OR normalized_song_name ILIKE %s ESCAPE '\\'
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
                            _build_exact_lookup_pattern(query_text),
                            _build_exact_lookup_pattern(normalized_query_text),
                            limit,
                            offset,
                        ),
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
        logger.exception("list_songs timeout q=%s limit=%s page=%s", query_text, limit, page)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("list_songs operational error q=%s limit=%s page=%s", query_text, limit, page)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("list_songs failed q=%s limit=%s page=%s", query_text, limit, page)
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
                        SELECT id, band_name, band_abbr, band_members
                        FROM band_attrs
                        WHERE band_name ILIKE %s ESCAPE '\\'
                           OR band_abbr ILIKE %s ESCAPE '\\'
                        ORDER BY band_name, id
                        LIMIT %s
                        """,
                        (pattern, pattern, limit),
                    )
                else:
                    cur.execute(
                        """
                        SELECT id, band_name, band_abbr, band_members
                        FROM band_attrs
                        ORDER BY band_name, id
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
        ]
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
