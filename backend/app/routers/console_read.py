from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled

from app.auth import require_role
from app.db import get_db_connection
from app.logging_config import get_logger
from app.schemas import ErrorResponse, ValidationErrorResponse
from app.schemas.auth import AuthErrorResponse
from app.schemas.console import ConsoleBandListResponse, ConsoleSongListResponse, ConsoleVenueListResponse
from app.song_lookup import SONG_LOOKUP_SQL_FROM_CHARS, SONG_LOOKUP_SQL_TO_CHARS, normalize_song_lookup_text

router = APIRouter()
logger = get_logger(__name__)


def _normalize_lookup_query(value: str | None) -> str:
    """Trim optional console lookup text so blank queries become the default list query."""
    if value is None:
        return ""
    return value.strip()


def _build_lookup_pattern(value: str) -> str:
    """Build a safe ILIKE pattern for simple console lookup endpoints."""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _build_exact_lookup_pattern(value: str) -> str:
    """Build a safe exact ILIKE pattern for ordering exact lookup hits first."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


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
    q: str | None = Query(default=None, max_length=255, description="Song title keyword"),
    limit: int = Query(default=20, ge=1, le=100, description="Maximum number of songs to return"),
    _: Any = Depends(require_role("editor")),
):
    """Return song_list rows for the console song selector without mutating any data."""
    query_text = _normalize_lookup_query(q)
    normalized_query_text = normalize_song_lookup_text(query_text)

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                if query_text:
                    cur.execute(
                        """
                        WITH normalized_song_list AS (
                            SELECT
                                id,
                                song_name,
                                band_id,
                                is_cover,
                                translate(song_name, %s, %s) AS normalized_song_name
                            FROM song_list
                        )
                        SELECT id, song_name, band_id, is_cover
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
                        LIMIT %s
                        """,
                        (
                            SONG_LOOKUP_SQL_FROM_CHARS,
                            SONG_LOOKUP_SQL_TO_CHARS,
                            _build_lookup_pattern(query_text),
                            _build_lookup_pattern(normalized_query_text),
                            _build_exact_lookup_pattern(query_text),
                            _build_exact_lookup_pattern(normalized_query_text),
                            limit,
                        ),
                    )
                else:
                    cur.execute(
                        """
                        SELECT id, song_name, band_id, is_cover
                        FROM song_list
                        ORDER BY song_name, id
                        LIMIT %s
                        """,
                        (limit,),
                    )
                rows = cur.fetchall()
    except QueryCanceled as exc:
        logger.exception("list_songs timeout q=%s limit=%s", query_text, limit)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("list_songs operational error q=%s limit=%s", query_text, limit)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("list_songs failed q=%s limit=%s", query_text, limit)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "items": [
            {
                "song_id": int(row[0]),
                "song_name": row[1],
                "band_id": int(row[2]),
                "cover": bool(row[3]),
            }
            for row in rows
        ]
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
