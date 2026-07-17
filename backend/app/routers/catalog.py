from math import ceil
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled

from app.auth import AuthUser, get_current_user_optional
from app.db import get_db_connection
from app.favorites import get_favorite_live_id_set
from app.logging_config import get_logger
from app.schemas import (
    CatalogBandListResponse,
    CatalogBandLivesResponse,
    CatalogSearchResponse,
    CatalogStatsResponse,
    CatalogStatisticsResponse,
    ErrorResponse,
    ValidationErrorResponse,
)

router = APIRouter(prefix="/api/catalog", tags=["catalog"])
logger = get_logger(__name__)

ALLOWED_PAGE_SIZE = {15, 20}


def _normalize_query(value: str) -> str:
    normalized = value.strip()
    if normalized == "":
        raise HTTPException(status_code=400, detail="q must not be blank")
    return normalized


def _build_lookup_pattern(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _normalize_total_count(raw: Any) -> int:
    if raw is None:
        return 0
    return int(raw)


def _live_item_from_row(row: tuple[Any, ...], favorite_live_ids: set[int]) -> dict[str, Any]:
    live_id = int(row[0])
    return {
        "live_id": live_id,
        "live_date": row[1],
        "live_title": row[2],
        "bands": list(row[3] or []),
        "url": row[4],
        "live_type": row[5],
        "is_favorite": live_id in favorite_live_ids,
    }


SEARCH_LIVES_QUERY = """
WITH matched_live_ids AS (
    SELECT DISTINCT l.id
    FROM live_attrs l
    LEFT JOIN venue_list v
        ON v.id = l.venue_id
    LEFT JOIN live_setlist ls
        ON ls.live_id = l.id
    LEFT JOIN song_list s
        ON s.id = ls.song_id
    LEFT JOIN LATERAL (
        SELECT jsonb_object_keys(ls.band_member) AS band_name
        WHERE jsonb_typeof(ls.band_member) = 'object'
    ) bm ON true
    LEFT JOIN band_attrs b
        ON b.band_name = bm.band_name
    WHERE l.live_title ILIKE %s ESCAPE '\\'
       OR v.venue ILIKE %s ESCAPE '\\'
       OR s.song_name ILIKE %s ESCAPE '\\'
       OR b.band_name ILIKE %s ESCAPE '\\'
       OR b.band_abbr ILIKE %s ESCAPE '\\'
),
live_rows AS (
    SELECT
        l.id,
        l.live_date,
        l.live_title,
        COALESCE(
            array_agg(DISTINCT b.id ORDER BY b.id)
                FILTER (WHERE b.id IS NOT NULL),
            ARRAY[]::int[]
        ) AS band_ids,
        l.url,
        l.live_type
    FROM live_attrs l
    JOIN matched_live_ids m
        ON m.id = l.id
    LEFT JOIN live_setlist ls
        ON l.id = ls.live_id
    LEFT JOIN LATERAL (
        SELECT jsonb_object_keys(ls.band_member) AS band_name
        WHERE jsonb_typeof(ls.band_member) = 'object'
    ) bm ON true
    LEFT JOIN band_attrs b
        ON b.band_name = bm.band_name
    GROUP BY l.id, l.live_date, l.live_title, l.url, l.live_type
)
SELECT id, live_date, live_title, band_ids, url, live_type
FROM live_rows
ORDER BY live_date DESC, id DESC
LIMIT %s
"""

SEARCH_BANDS_QUERY = """
SELECT
    b.id,
    b.band_name,
    b.band_abbr,
    COUNT(DISTINCT ls.live_id) AS live_count
FROM band_attrs b
LEFT JOIN live_setlist ls
    ON jsonb_typeof(ls.band_member) = 'object'
   AND ls.band_member ? b.band_name
WHERE b.id > 0
  AND (
      b.band_name ILIKE %s ESCAPE '\\'
      OR b.band_abbr ILIKE %s ESCAPE '\\'
  )
GROUP BY b.id, b.band_name, b.band_abbr
ORDER BY live_count DESC, b.band_name, b.id
LIMIT %s
"""

SEARCH_SONGS_QUERY = """
SELECT
    s.id,
    s.song_name,
    s.band_id,
    b.band_name,
    COUNT(DISTINCT ls.live_id) AS live_count
FROM song_list s
LEFT JOIN band_attrs b
    ON b.id = s.band_id
LEFT JOIN live_setlist ls
    ON ls.song_id = s.id
WHERE s.song_name ILIKE %s ESCAPE '\\'
GROUP BY s.id, s.song_name, s.band_id, b.band_name
ORDER BY live_count DESC, s.song_name, s.id
LIMIT %s
"""

SEARCH_VENUES_QUERY = """
SELECT
    v.id,
    v.venue,
    COUNT(DISTINCT l.id) AS live_count
FROM venue_list v
LEFT JOIN live_attrs l
    ON l.venue_id = v.id
WHERE v.venue ILIKE %s ESCAPE '\\'
GROUP BY v.id, v.venue
ORDER BY live_count DESC, v.venue, v.id
LIMIT %s
"""

BAND_LIST_QUERY = """
SELECT
    b.id,
    b.band_name,
    b.band_abbr,
    COUNT(DISTINCT ls.live_id) AS live_count
FROM band_attrs b
LEFT JOIN live_setlist ls
    ON jsonb_typeof(ls.band_member) = 'object'
   AND ls.band_member ? b.band_name
WHERE b.id > 0
GROUP BY b.id, b.band_name, b.band_abbr
ORDER BY b.id
LIMIT %s
"""

BAND_META_QUERY = """
SELECT
    b.id,
    b.band_name,
    b.band_abbr,
    COUNT(DISTINCT ls.live_id) AS live_count
FROM band_attrs b
LEFT JOIN live_setlist ls
    ON jsonb_typeof(ls.band_member) = 'object'
   AND ls.band_member ? b.band_name
WHERE b.id = %s
GROUP BY b.id, b.band_name, b.band_abbr
"""

BAND_LIVES_COUNT_QUERY = """
SELECT COUNT(DISTINCT l.id)
FROM live_attrs l
JOIN live_setlist ls
    ON ls.live_id = l.id
JOIN band_attrs b
    ON b.id = %s
WHERE jsonb_typeof(ls.band_member) = 'object'
  AND ls.band_member ? b.band_name
"""

BAND_LIVES_PAGE_QUERY = """
WITH matched_live_ids AS (
    SELECT DISTINCT l.id
    FROM live_attrs l
    JOIN live_setlist ls
        ON ls.live_id = l.id
    JOIN band_attrs selected_band
        ON selected_band.id = %s
    WHERE jsonb_typeof(ls.band_member) = 'object'
      AND ls.band_member ? selected_band.band_name
),
live_rows AS (
    SELECT
        l.id,
        l.live_date,
        l.live_title,
        COALESCE(
            array_agg(DISTINCT b.id ORDER BY b.id)
                FILTER (WHERE b.id IS NOT NULL),
            ARRAY[]::int[]
        ) AS band_ids,
        l.url,
        l.live_type
    FROM live_attrs l
    JOIN matched_live_ids m
        ON m.id = l.id
    LEFT JOIN live_setlist ls
        ON l.id = ls.live_id
    LEFT JOIN LATERAL (
        SELECT jsonb_object_keys(ls.band_member) AS band_name
        WHERE jsonb_typeof(ls.band_member) = 'object'
    ) bm ON true
    LEFT JOIN band_attrs b
        ON b.band_name = bm.band_name
    GROUP BY l.id, l.live_date, l.live_title, l.url, l.live_type
)
SELECT id, live_date, live_title, band_ids, url, live_type
FROM live_rows
ORDER BY live_date DESC, id DESC
LIMIT %s OFFSET %s
"""


@router.get(
    "/search",
    response_model=CatalogSearchResponse,
    summary="公共资料库搜索",
    description="按 Live 标题、乐队、歌曲和场地搜索公开资料库。",
    responses={
        400: {"model": ErrorResponse, "description": "业务参数错误"},
        422: {"model": ValidationErrorResponse, "description": "查询参数验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def search_catalog(
    q: str = Query(..., max_length=255, description="Search keyword"),
    limit: int = Query(default=8, ge=1, le=20, description="Maximum rows per result group"),
    current_user: AuthUser | None = Depends(get_current_user_optional),
):
    """Search current public catalog without mutating data or requiring login."""
    query_text = _normalize_query(q)
    pattern = _build_lookup_pattern(query_text)

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(SEARCH_LIVES_QUERY, (pattern, pattern, pattern, pattern, pattern, limit))
                live_rows = cur.fetchall()
                favorite_live_ids = (
                    get_favorite_live_id_set(cur, current_user.id, [int(row[0]) for row in live_rows])
                    if current_user is not None
                    else set()
                )

                cur.execute(SEARCH_BANDS_QUERY, (pattern, pattern, limit))
                band_rows = cur.fetchall()
                cur.execute(SEARCH_SONGS_QUERY, (pattern, limit))
                song_rows = cur.fetchall()
                cur.execute(SEARCH_VENUES_QUERY, (pattern, limit))
                venue_rows = cur.fetchall()
    except QueryCanceled as exc:
        logger.exception("search_catalog timeout q=%s limit=%s", query_text, limit)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("search_catalog operational error q=%s limit=%s", query_text, limit)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("search_catalog failed q=%s limit=%s", query_text, limit)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "query": query_text,
        "lives": [_live_item_from_row(row, favorite_live_ids) for row in live_rows],
        "bands": [
            {
                "band_id": int(row[0]),
                "band_name": row[1],
                "band_abbr": row[2],
                "live_count": int(row[3]),
            }
            for row in band_rows
        ],
        "songs": [
            {
                "song_id": int(row[0]),
                "song_name": row[1],
                "band_id": int(row[2]),
                "band_name": row[3],
                "live_count": int(row[4]),
            }
            for row in song_rows
        ],
        "venues": [
            {
                "venue_id": int(row[0]),
                "venue_name": row[1],
                "live_count": int(row[2]),
            }
            for row in venue_rows
        ],
    }


@router.get(
    "/bands",
    response_model=CatalogBandListResponse,
    summary="公共乐队浏览列表",
    description="返回按收录 Live 数排序的乐队列表。",
)
def list_catalog_bands(
    limit: int = Query(default=20, ge=1, le=100, description="Maximum number of bands to return"),
):
    """Return public band browse candidates without requiring editor access."""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(BAND_LIST_QUERY, (limit,))
                rows = cur.fetchall()
    except QueryCanceled as exc:
        logger.exception("list_catalog_bands timeout limit=%s", limit)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("list_catalog_bands operational error limit=%s", limit)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("list_catalog_bands failed limit=%s", limit)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "items": [
            {
                "band_id": int(row[0]),
                "band_name": row[1],
                "band_abbr": row[2],
                "live_count": int(row[3]),
            }
            for row in rows
        ]
    }


@router.get(
    "/bands/{band_id}/lives",
    response_model=CatalogBandLivesResponse,
    summary="按乐队浏览 Live",
    description="返回指定乐队参与的 Live 列表。",
)
def get_catalog_band_lives(
    band_id: int,
    page: int = Query(default=1, ge=1, description="Page number, clamped to the last page"),
    page_size: int = Query(default=20, description="Page size, currently 15 or 20"),
    current_user: AuthUser | None = Depends(get_current_user_optional),
):
    """Return lives associated with one band using the current setlist member mapping."""
    if band_id < 1:
        raise HTTPException(status_code=400, detail="band_id must be >= 1")
    if page_size not in ALLOWED_PAGE_SIZE:
        raise HTTPException(status_code=400, detail="page_size must be 15 or 20")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(BAND_META_QUERY, (band_id,))
                band_row = cur.fetchone()
                if band_row is None:
                    raise HTTPException(status_code=404, detail=f"Band id {band_id} not found")

                cur.execute(BAND_LIVES_COUNT_QUERY, (band_id,))
                count_row = cur.fetchone()
                total = _normalize_total_count(count_row[0] if count_row else 0)
                total_pages = max(1, ceil(total / page_size)) if total else 1
                current_page = min(page, total_pages) if total else 1
                offset = (current_page - 1) * page_size

                cur.execute(BAND_LIVES_PAGE_QUERY, (band_id, page_size, offset))
                rows = cur.fetchall()
                favorite_live_ids = (
                    get_favorite_live_id_set(cur, current_user.id, [int(row[0]) for row in rows])
                    if current_user is not None
                    else set()
                )
    except HTTPException:
        raise
    except QueryCanceled as exc:
        logger.exception("get_catalog_band_lives timeout band_id=%s page=%s page_size=%s", band_id, page, page_size)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception(
            "get_catalog_band_lives operational error band_id=%s page=%s page_size=%s",
            band_id,
            page,
            page_size,
        )
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("get_catalog_band_lives failed band_id=%s page=%s page_size=%s", band_id, page, page_size)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "band": {
            "band_id": int(band_row[0]),
            "band_name": band_row[1],
            "band_abbr": band_row[2],
            "live_count": int(band_row[3]),
        },
        "items": [_live_item_from_row(row, favorite_live_ids) for row in rows],
        "pagination": {
            "page": current_page,
            "page_size": page_size,
            "total": total,
            "total_pages": total_pages,
        },
    }


@router.get(
    "/stats",
    response_model=CatalogStatsResponse,
    summary="Get catalog aggregate stats",
    description="Return catalog counts, the most recent live date, and available Live years.",
)
def get_catalog_stats():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    (SELECT COUNT(*) FROM band_attrs) AS band_count,
                    (SELECT COUNT(*) FROM song_list)   AS song_count,
                    (SELECT COUNT(*) FROM venue_list)  AS venue_count,
                    (SELECT MAX(live_date) FROM live_attrs) AS latest_live_date,
                    ARRAY(
                        SELECT DISTINCT EXTRACT(YEAR FROM live_date)::int AS live_year
                        FROM live_attrs
                        ORDER BY live_year DESC
                    ) AS years
            """)
            row = cur.fetchone()
            return CatalogStatsResponse(
                band_count=row[0],
                song_count=row[1],
                venue_count=row[2],
                latest_live_date=row[3].isoformat() if row[3] else None,
                years=list(row[4] or []),
            )
    except OperationalError as exc:
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("get_catalog_stats failed")
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    finally:
        conn.close()


def _statistics_candidate_sql(
    scope: str,
    year: int | None,
    live_type: str | None,
    band_id: int | None,
    user_id: int | None,
) -> tuple[str, list[Any]]:
    conditions: list[str] = []
    params: list[Any] = []
    if scope == "favorites":
        conditions.append("EXISTS (SELECT 1 FROM user_live_favorites f WHERE f.live_id = l.id AND f.user_id = %s)")
        params.append(user_id)
    if year is not None:
        conditions.append("EXTRACT(YEAR FROM l.live_date)::int = %s")
        params.append(year)
    if live_type is not None:
        conditions.append("l.live_type = %s")
        params.append(live_type)
    if band_id is not None:
        conditions.append(
            """EXISTS (
                SELECT 1 FROM band_attrs selected_band
                WHERE selected_band.id = %s
                  AND (
                    EXISTS (
                      SELECT 1 FROM live_setlist band_ls
                      WHERE band_ls.live_id = l.id
                        AND jsonb_typeof(band_ls.band_member) = 'object'
                        AND band_ls.band_member ? selected_band.band_name
                    )
                    OR (
                      NOT EXISTS (SELECT 1 FROM live_setlist any_ls WHERE any_ls.live_id = l.id)
                      AND selected_band.id = ANY(l.default_band_ids)
                    )
                  )
            )"""
        )
        params.append(band_id)
    where_sql = " AND ".join(conditions) if conditions else "TRUE"
    return f"SELECT l.* FROM live_attrs l WHERE {where_sql}", params


@router.get(
    "/statistics",
    response_model=CatalogStatisticsResponse,
    summary="公共资料库统计",
    description="按全部或当前用户收藏的 Live 范围，返回统一的资料库统计结果。",
)
def get_catalog_statistics(
    scope: Literal["all", "favorites"] = Query(default="all"),
    year: int | None = Query(default=None, ge=1900, le=2100),
    live_type: Literal["oneman", "taiban", "multi_act", "festival", "event", "other"] | None = Query(default=None),
    band_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=10, ge=5, le=50),
    current_user: AuthUser | None = Depends(get_current_user_optional),
):
    if scope == "favorites" and current_user is None:
        raise HTTPException(status_code=401, detail="Authentication required for favorite statistics")

    candidate_sql, candidate_params = _statistics_candidate_sql(
        scope, year, live_type, band_id, current_user.id if current_user else None
    )
    performer_band_condition = ""
    performer_band_params: list[Any] = []
    if band_id is not None:
        performer_band_condition = "AND performing_band.id = %s"
        performer_band_params.append(band_id)

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""WITH candidate_lives AS ({candidate_sql})
                    SELECT
                      COUNT(DISTINCT cl.id),
                      COUNT(DISTINCT cl.id) FILTER (WHERE ls.live_id IS NOT NULL),
                      COUNT(DISTINCT effective_band.band_id),
                      COUNT(DISTINCT (effective_band.band_id, ls.song_id))
                        FILTER (WHERE ls.song_id IS NOT NULL AND effective_band.band_id IS NOT NULL
                          {"AND effective_band.band_id = %s" if band_id is not None else ""}),
                      COUNT(DISTINCT cl.venue_id),
                      MIN(cl.live_date), MAX(cl.live_date)
                    FROM candidate_lives cl
                    LEFT JOIN live_setlist ls ON ls.live_id = cl.id
                    LEFT JOIN LATERAL (
                      SELECT DISTINCT b.id AS band_id
                      FROM band_attrs b
                      WHERE b.id > 0 AND (
                        (jsonb_typeof(ls.band_member) = 'object' AND ls.band_member ? b.band_name)
                        OR (ls.live_id IS NULL AND b.id = ANY(cl.default_band_ids))
                      )
                    ) effective_band ON true""",
                    candidate_params + ([band_id] if band_id is not None else []),
                )
                overview_row = cur.fetchone()

                cur.execute(
                    f"""WITH candidate_lives AS ({candidate_sql})
                    SELECT EXTRACT(YEAR FROM live_date)::int, COUNT(*)
                    FROM candidate_lives GROUP BY 1 ORDER BY 1 DESC""",
                    candidate_params,
                )
                year_rows = cur.fetchall()
                cur.execute(
                    f"""WITH candidate_lives AS ({candidate_sql})
                    SELECT live_type, COUNT(*) FROM candidate_lives
                    GROUP BY live_type ORDER BY COUNT(*) DESC, live_type""",
                    candidate_params,
                )
                type_rows = cur.fetchall()

                cur.execute(
                    f"""WITH candidate_lives AS ({candidate_sql}), performances AS (
                      SELECT s.id, s.song_name, performing_band.id AS band_id,
                             performing_band.band_name, s.is_cover,
                             cl.id AS live_id, cl.live_date, cl.live_title, ls.id AS setlist_id
                      FROM candidate_lives cl
                      JOIN live_setlist ls ON ls.live_id = cl.id
                      JOIN song_list s ON s.id = ls.song_id
                      JOIN LATERAL jsonb_object_keys(ls.band_member) performed_by(band_name)
                        ON jsonb_typeof(ls.band_member) = 'object'
                      JOIN band_attrs performing_band ON performing_band.band_name = performed_by.band_name
                      WHERE performing_band.id > 0 {performer_band_condition}
                    ), ranked AS (
                      SELECT *,
                        ROW_NUMBER() OVER (PARTITION BY band_id, id ORDER BY live_date, live_id) AS first_rank,
                        ROW_NUMBER() OVER (PARTITION BY band_id, id ORDER BY live_date DESC, live_id DESC) AS latest_rank
                      FROM performances
                    ), aggregated AS (
                      SELECT id, song_name, band_id, band_name, is_cover,
                             COUNT(DISTINCT live_id) AS live_count,
                             COUNT(DISTINCT setlist_id) AS performance_count,
                             MAX(live_id) FILTER (WHERE first_rank = 1) AS first_live_id,
                             MAX(live_date) FILTER (WHERE first_rank = 1) AS first_live_date,
                             MAX(live_title) FILTER (WHERE first_rank = 1) AS first_live_title,
                             MAX(live_id) FILTER (WHERE latest_rank = 1) AS latest_live_id,
                             MAX(live_date) FILTER (WHERE latest_rank = 1) AS latest_live_date,
                             MAX(live_title) FILTER (WHERE latest_rank = 1) AS latest_live_title
                      FROM ranked GROUP BY id, song_name, band_id, band_name, is_cover
                    ), band_ranked AS (
                      SELECT *, ROW_NUMBER() OVER (
                        PARTITION BY band_id
                        ORDER BY live_count DESC, performance_count DESC, song_name, id
                      ) AS band_rank
                      FROM aggregated
                    )
                    SELECT id, song_name, band_id, band_name, is_cover,
                           live_count, performance_count, first_live_id, first_live_date, first_live_title,
                           latest_live_id, latest_live_date, latest_live_title
                    FROM band_ranked
                    WHERE {"TRUE" if band_id is not None else "band_rank = 1"}
                    ORDER BY {"live_count DESC, performance_count DESC, song_name, id" if band_id is not None else "band_id"}
                    {"LIMIT %s" if band_id is not None else ""}""",
                    candidate_params + performer_band_params + ([limit] if band_id is not None else []),
                )
                song_rows = cur.fetchall()

                stale_rows: list[tuple[Any, ...]] = []
                if band_id is not None:
                    cur.execute(
                        f"""WITH candidate_lives AS ({candidate_sql}), band_lives AS (
                          SELECT cl.* FROM candidate_lives cl JOIN band_attrs b ON b.id = %s
                          WHERE EXISTS (SELECT 1 FROM live_setlist ls WHERE ls.live_id = cl.id
                            AND jsonb_typeof(ls.band_member) = 'object' AND ls.band_member ? b.band_name)
                             OR (NOT EXISTS (SELECT 1 FROM live_setlist ls WHERE ls.live_id = cl.id)
                                 AND b.id = ANY(cl.default_band_ids))
                        ), song_plays AS (
                          SELECT s.id, s.song_name, b.band_name, bl.id AS live_id,
                                 bl.live_date, bl.live_title
                          FROM band_lives bl
                          JOIN band_attrs b ON b.id = %s
                          JOIN live_setlist ls ON ls.live_id = bl.id
                            AND jsonb_typeof(ls.band_member) = 'object' AND ls.band_member ? b.band_name
                          JOIN song_list s ON s.id = ls.song_id
                        ), play_counts AS (
                          SELECT id, COUNT(DISTINCT live_id) AS live_count FROM song_plays GROUP BY id
                        ), latest AS (
                          SELECT sp.*, pc.live_count,
                                 ROW_NUMBER() OVER (PARTITION BY sp.id ORDER BY sp.live_date DESC, sp.live_id DESC) AS rn
                          FROM song_plays sp JOIN play_counts pc ON pc.id = sp.id
                        ), reference AS (SELECT MAX(live_date) AS live_date FROM band_lives)
                        SELECT l.id, l.song_name, l.band_name, l.live_count, l.live_id, l.live_date, l.live_title,
                               r.live_date, (r.live_date - l.live_date),
                               (SELECT COUNT(*) FROM band_lives later WHERE later.live_date > l.live_date)
                        FROM latest l CROSS JOIN reference r
                        WHERE l.rn = 1 AND l.live_count >= 2 AND r.live_date > l.live_date
                        ORDER BY r.live_date - l.live_date DESC, l.song_name, l.id LIMIT %s""",
                        candidate_params + [band_id, band_id, limit],
                    )
                    stale_rows = cur.fetchall()
    except QueryCanceled as exc:
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("get_catalog_statistics failed scope=%s", scope)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    overview = overview_row or (0, 0, 0, 0, 0, None, None)
    return {
        "scope": scope,
        "filters": {"year": year, "live_type": live_type, "band_id": band_id},
        "overview": {
            "live_count": int(overview[0]), "setlist_live_count": int(overview[1]),
            "band_count": int(overview[2]), "song_count": int(overview[3]),
            "venue_count": int(overview[4]), "earliest_live_date": overview[5], "latest_live_date": overview[6],
        },
        "years": [{"key": str(row[0]), "label": f"{row[0]} 年", "live_count": int(row[1])} for row in year_rows],
        "live_types": [{"key": row[0], "label": row[0], "live_count": int(row[1])} for row in type_rows],
        "top_songs": [{
            "song_id": int(r[0]), "song_name": r[1], "band_id": int(r[2]), "band_name": r[3], "is_cover": bool(r[4]),
            "live_count": int(r[5]), "performance_count": int(r[6]),
            "first_live_id": int(r[7]), "first_live_date": r[8], "first_live_title": r[9],
            "latest_live_id": int(r[10]), "latest_live_date": r[11], "latest_live_title": r[12],
        } for r in song_rows],
        "stale_songs": [{
            "song_id": int(r[0]), "song_name": r[1], "band_name": r[2], "live_count": int(r[3]),
            "latest_live_id": int(r[4]), "latest_live_date": r[5], "latest_live_title": r[6],
            "reference_live_date": r[7], "stale_days": int(r[8]), "missed_live_count": int(r[9]),
        } for r in stale_rows],
    }
