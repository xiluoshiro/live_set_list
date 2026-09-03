from math import ceil
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled

from app.auth import AuthUser, get_current_user_optional
from app.db import get_db_connection
from app.favorites import get_favorite_live_id_set
from app.logging_config import get_logger
from app.live_status import build_public_live_status
from app.live_list_filters import LiveListFilters, LiveType, build_live_where, build_lookup_pattern
from app.schemas import (
    CatalogPerformancesResponse,
    ErrorResponse,
    PerformanceGroupDetailResponse,
    ValidationErrorResponse,
)
from app.tour_refs import build_tour_ref_from_row
from app.performance_group_refs import build_performance_group_ref_from_row

router = APIRouter(prefix="/api/catalog/performance-groups", tags=["catalog"])
logger = get_logger(__name__)

PERFORMANCE_GROUP_HEADER_QUERY = """
SELECT
    pg.id,
    pg.group_title,
    MIN(l.live_date) AS start_date,
    MAX(l.live_date) AS end_date,
    COUNT(DISTINCT l.live_date)::int AS day_count,
    COUNT(DISTINCT l.id)::int AS live_count,
    COUNT(DISTINCT l.id) FILTER (WHERE l.event_status = 'cancelled')::int AS cancelled_live_count
FROM performance_group_attrs pg
JOIN performance_group_lives pgl ON pgl.group_id = pg.id
JOIN live_attrs l ON l.id = pgl.live_id
WHERE pg.id = %s
GROUP BY pg.id, pg.group_title
HAVING COUNT(DISTINCT l.id) >= 2
"""

PERFORMANCE_GROUP_BANDS_QUERY = """
SELECT ba.band_id, ba.band_name, ba.band_abbr
FROM (
    SELECT DISTINCT effective.band_id
    FROM performance_group_lives pgl
    JOIN effective_live_bands effective ON effective.live_id = pgl.live_id
    WHERE pgl.group_id = %s
) aggregated_band_ids
JOIN current_band_versions ba ON ba.band_id = aggregated_band_ids.band_id
ORDER BY ba.band_id
"""

PERFORMANCE_GROUP_VENUES_QUERY = """
SELECT DISTINCT COALESCE(to_jsonb(v) ->> 'venue', to_jsonb(v) ->> 'venue_name') AS venue_name
FROM performance_group_lives pgl
JOIN live_attrs l ON l.id = pgl.live_id
LEFT JOIN venue_list v ON v.id = l.venue_id
WHERE pgl.group_id = %s
  AND COALESCE(to_jsonb(v) ->> 'venue', to_jsonb(v) ->> 'venue_name') IS NOT NULL
ORDER BY venue_name
"""

PERFORMANCE_GROUP_LIVES_QUERY = """
SELECT
    l.id,
    l.live_date,
    l.live_title,
    l.live_type,
    to_jsonb(l) ->> 'start_time' AS start_time,
    COALESCE(to_jsonb(v) ->> 'venue', to_jsonb(v) ->> 'venue_name') AS venue,
    COALESCE((
        SELECT array_agg(effective.band_id ORDER BY effective.band_id)
        FROM effective_live_bands effective
        WHERE effective.live_id = l.id
    ), ARRAY[]::int[]) AS bands,
    l.url,
    EXISTS (SELECT 1 FROM live_setlist any_setlist WHERE any_setlist.live_id = l.id) AS has_setlist,
    l.event_status,
    EXISTS (
        SELECT 1 FROM live_schedule_history history
        WHERE history.live_id = l.id
    ) AS was_rescheduled,
    l.timezone_offset_minutes
FROM performance_group_lives pgl
JOIN live_attrs l ON l.id = pgl.live_id
LEFT JOIN venue_list v ON v.id = l.venue_id
WHERE pgl.group_id = %s
ORDER BY
    l.live_date ASC,
    (l.event_status = 'cancelled') DESC,
    l.start_time ASC NULLS LAST,
    l.id ASC
"""


def _compute_display_type(day_count: int, live_count: int) -> str:
    if day_count == 1:
        return "single_day_multi_show"
    return "multi_day"


@router.get(
    "/{group_id}",
    response_model=PerformanceGroupDetailResponse,
    summary="获取演出活动组详情",
    description="返回活动组摘要及按日期、开演时间排序的完整场次列表。",
    responses={
        400: {"model": ErrorResponse, "description": "参数错误"},
        404: {"model": ErrorResponse, "description": "指定活动组不存在"},
        422: {"model": ValidationErrorResponse, "description": "查询参数验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def get_performance_group_detail(
    group_id: int,
    current_user: AuthUser | None = Depends(get_current_user_optional),
):
    if group_id < 1:
        raise HTTPException(status_code=400, detail="group_id must be >= 1")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(PERFORMANCE_GROUP_HEADER_QUERY, (group_id,))
                header_row = cur.fetchone()
                if header_row is None:
                    raise HTTPException(status_code=404, detail=f"Performance group id {group_id} not found")

                cur.execute(PERFORMANCE_GROUP_BANDS_QUERY, (group_id,))
                band_rows = cur.fetchall()

                cur.execute(PERFORMANCE_GROUP_VENUES_QUERY, (group_id,))
                venue_rows = cur.fetchall()

                cur.execute(PERFORMANCE_GROUP_LIVES_QUERY, (group_id,))
                live_rows = cur.fetchall()
                if not live_rows:
                    logger.error("performance group has no lives group_id=%s", group_id)
                    raise HTTPException(status_code=500, detail="Performance group has no collected lives")

                live_ids = [int(row[0]) for row in live_rows]
                favorite_live_ids = (
                    get_favorite_live_id_set(cur, current_user.id, live_ids)
                    if current_user is not None
                    else set()
                )
    except HTTPException:
        raise
    except QueryCanceled as exc:
        logger.exception("get_performance_group_detail timeout group_id=%s", group_id)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("get_performance_group_detail operational error group_id=%s", group_id)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("get_performance_group_detail failed group_id=%s", group_id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    day_count = int(header_row[4])
    live_count = int(header_row[5])
    cancelled_live_count = int(header_row[6]) if len(header_row) > 6 else 0

    return {
        "group_id": int(header_row[0]),
        "group_title": str(header_row[1]),
        "start_date": header_row[2],
        "end_date": header_row[3],
        "day_count": day_count,
        "live_count": live_count,
        "cancelled_live_count": cancelled_live_count,
        "display_type": _compute_display_type(day_count, live_count),
        "bands": [
            {"band_id": int(row[0]), "band_name": str(row[1]), "band_abbr": str(row[2])}
            for row in band_rows
        ],
        "venues": [str(row[0]) for row in venue_rows],
        "lives": [
            {
                "live_id": int(row[0]),
                "live_date": row[1],
                "live_title": str(row[2]),
                "live_type": str(row[3]),
                "start_time": row[4],
                "venue": row[5],
                "bands": list(row[6] or []),
                "url": row[7],
                "is_favorite": int(row[0]) in favorite_live_ids,
                "has_setlist": bool(row[8]),
                **build_public_live_status(
                    event_status=str(row[9]) if len(row) > 9 else "scheduled",
                    live_date=row[1],
                    start_time=row[4],
                    timezone_offset_minutes=int(row[11]) if len(row) > 11 and row[11] is not None else None,
                    was_rescheduled=bool(row[10]) if len(row) > 10 else False,
                ),
            }
            for row in live_rows
        ],
    }


catalog_router = APIRouter(prefix="/api/catalog", tags=["catalog"])

ALLOWED_PAGE_SIZE = {15, 20}


def _build_live_filter_conditions(
    *,
    q: str | None,
    year: int | None,
    live_type: LiveType | None,
    band_id: int | None,
) -> tuple[str, tuple[object, ...]]:
    where_sql, params = build_live_where(
        LiveListFilters(q=q, year=year, live_type=live_type, band_id=band_id)
    )
    return where_sql, tuple(params)


def _build_catalog_performances_queries(
    *,
    q: str | None,
    year: int | None,
    live_type: LiveType | None,
    band_id: int | None,
    sort: Literal["date_desc", "date_asc"],
    scope: Literal["all", "favorites"],
    user_id: int | None,
) -> tuple[str, tuple[object, ...], str, tuple[object, ...]]:
    live_where, live_params = _build_live_filter_conditions(
        q=q, year=year, live_type=live_type, band_id=band_id,
    )
    secondary_where, secondary_params = _build_live_filter_conditions(
        q=None, year=year, live_type=live_type, band_id=band_id,
    )

    sort_group_date = "end_date" if sort == "date_desc" else "start_date"
    sort_group_time = "end_time" if sort == "date_desc" else "start_time"
    sort_dir = "DESC" if sort == "date_desc" else "ASC"

    return _build_scope_queries(
        live_where=live_where,
        live_params=live_params,
        secondary_where=secondary_where,
        secondary_params=secondary_params,
        group_query_pattern=build_lookup_pattern(q) if q is not None else None,
        sort_group_date=sort_group_date,
        sort_group_time=sort_group_time,
        sort_dir=sort_dir,
        favorite_user_id=user_id if scope == "favorites" else None,
        favorites_scope=scope == "favorites",
    )


LIVE_BAND_AGG_SQL = """
COALESCE(
    (
        SELECT array_agg(effective.band_id ORDER BY effective.band_id)
        FROM effective_live_bands effective
        WHERE effective.live_id = sl.id
    ),
    ARRAY[]::int[]
)
"""


def _build_scope_queries(
    *,
    live_where: str,
    live_params: tuple[object, ...],
    secondary_where: str,
    secondary_params: tuple[object, ...],
    group_query_pattern: str | None,
    sort_group_date: str,
    sort_group_time: str,
    sort_dir: str,
    favorite_user_id: int | None,
    favorites_scope: bool,
) -> tuple[str, tuple[object, ...], str, tuple[object, ...]]:
    if favorites_scope and favorite_user_id is None:
        raise ValueError("favorites scope requires a user id")

    if favorites_scope:
        eligible_lives_sql = """
            SELECT l.id
            FROM live_attrs l
            WHERE EXISTS (
                SELECT 1
                FROM user_live_favorites favorite
                WHERE favorite.live_id = l.id AND favorite.user_id = %s
            )
        """
        scope_params: tuple[object, ...] = (favorite_user_id,)
    else:
        eligible_lives_sql = "SELECT l.id FROM live_attrs l"
        scope_params = ()

    if group_query_pattern is None:
        group_title_matches_sql = "SELECT NULL::int AS group_id WHERE FALSE"
        group_title_candidate_condition = ""
        group_title_params: tuple[object, ...] = ()
    else:
        group_title_matches_sql = """
            SELECT vg.group_id
            FROM valid_groups vg
            WHERE vg.group_title ILIKE %s ESCAPE '\\'
        """
        group_title_candidate_condition = (
            f"OR (gtm.group_id IS NOT NULL AND ({secondary_where}))"
        )
        group_title_params = (group_query_pattern,)

    common_ctes = f"""
        eligible_lives AS (
            {eligible_lives_sql}
        ),
        valid_groups AS (
            SELECT
                pg.id AS group_id,
                pg.group_title,
                MIN(l.live_date) AS start_date,
                MAX(l.live_date) AS end_date,
                (array_agg(l.start_time ORDER BY l.live_date ASC, l.start_time ASC NULLS LAST, l.id ASC))[1] AS start_time,
                (array_agg(l.start_time ORDER BY l.live_date DESC, l.start_time DESC NULLS LAST, l.id DESC))[1] AS end_time,
                COUNT(DISTINCT l.live_date)::int AS day_count,
                COUNT(DISTINCT l.id)::int AS live_count,
                COUNT(DISTINCT l.id) FILTER (WHERE l.event_status = 'cancelled')::int AS cancelled_live_count
            FROM performance_group_attrs pg
            JOIN performance_group_lives pgl ON pgl.group_id = pg.id
            JOIN live_attrs l ON l.id = pgl.live_id
            GROUP BY pg.id, pg.group_title
            HAVING COUNT(DISTINCT l.id) >= 2
        ),
        group_title_matches AS (
            {group_title_matches_sql}
        ),
        valid_group_lives AS (
            SELECT pgl.group_id, pgl.live_id
            FROM valid_groups vg
            JOIN performance_group_lives pgl ON pgl.group_id = vg.group_id
        ),
        standalone_matched_lives AS (
            SELECT l.id AS live_id
            FROM live_attrs l
            JOIN eligible_lives eligible ON eligible.id = l.id
            WHERE ({live_where})
              AND NOT EXISTS (
                  SELECT 1
                  FROM valid_group_lives grouped
                  WHERE grouped.live_id = l.id
              )
        ),
        group_candidates AS (
            SELECT vg.group_id, vg.group_title, l.id AS live_id
            FROM valid_groups vg
            JOIN performance_group_lives pgl ON pgl.group_id = vg.group_id
            JOIN live_attrs l ON l.id = pgl.live_id
            JOIN eligible_lives eligible ON eligible.id = l.id
            LEFT JOIN group_title_matches gtm ON gtm.group_id = vg.group_id
            WHERE (({live_where}) {group_title_candidate_condition})
        ),
        group_scope_stats AS (
            SELECT
                vg.group_id,
                vg.group_title,
                vg.start_date,
                vg.end_date,
                vg.start_time,
                vg.end_time,
                vg.day_count,
                vg.live_count,
                vg.cancelled_live_count,
                COUNT(DISTINCT eligible.id)::int AS eligible_live_count,
                COUNT(DISTINCT candidate.live_id)::int AS matched_live_count,
                (gtm.group_id IS NOT NULL) AS group_title_matches
            FROM valid_groups vg
            JOIN performance_group_lives pgl ON pgl.group_id = vg.group_id
            LEFT JOIN eligible_lives eligible ON eligible.id = pgl.live_id
            LEFT JOIN group_candidates candidate
                ON candidate.group_id = vg.group_id AND candidate.live_id = pgl.live_id
            LEFT JOIN group_title_matches gtm ON gtm.group_id = vg.group_id
            GROUP BY vg.group_id, vg.group_title, vg.start_date, vg.end_date,
                     vg.start_time, vg.end_time, vg.day_count, vg.live_count,
                     vg.cancelled_live_count, gtm.group_id
        ),
        full_group_matches AS (
            SELECT stats.*
            FROM group_scope_stats stats
            WHERE stats.eligible_live_count = stats.live_count
              AND stats.matched_live_count > 0
              AND (
                  stats.matched_live_count = stats.live_count
                  OR stats.group_title_matches
              )
        ),
        partial_group_lives AS (
            SELECT candidate.live_id, candidate.group_id, candidate.group_title
            FROM group_candidates candidate
            LEFT JOIN full_group_matches full_group
                ON full_group.group_id = candidate.group_id
            WHERE full_group.group_id IS NULL
        )
    """

    common_params = (
        scope_params
        + group_title_params
        + live_params
        + live_params
        + (secondary_params if group_query_pattern is not None else ())
    )

    count_sql = f"""
        WITH {common_ctes}
        SELECT COUNT(*) FROM (
            SELECT live_id FROM standalone_matched_lives
            UNION ALL
            SELECT group_id FROM full_group_matches
            UNION ALL
            SELECT live_id FROM partial_group_lives
        ) combined
    """

    page_sql = f"""
        WITH {common_ctes},
        matched_live_refs AS (
            SELECT
                standalone.live_id,
                NULL::int AS performance_group_id,
                NULL::text AS group_title
            FROM standalone_matched_lives standalone
            UNION ALL
            SELECT
                partial.live_id,
                partial.group_id AS performance_group_id,
                partial.group_title
            FROM partial_group_lives partial
        ),
        selected_lives AS (
            SELECT
                l.id,
                l.live_date,
                l.start_time,
                l.live_title,
                l.url,
                l.live_type,
                l.default_band_ids,
                tour.id AS tour_id,
                tour.tour_title,
                matched.performance_group_id,
                matched.group_title,
                l.event_status,
                l.timezone_offset_minutes,
                EXISTS (
                    SELECT 1 FROM live_schedule_history history
                    WHERE history.live_id = l.id
                ) AS was_rescheduled
            FROM matched_live_refs matched
            JOIN live_attrs l ON l.id = matched.live_id
            LEFT JOIN tour_lives tour_live ON tour_live.live_id = l.id
            LEFT JOIN tour_attrs tour ON tour.id = tour_live.tour_id
        ),
        selected_lives_with_bands AS (
            SELECT
                sl.id,
                sl.live_date,
                sl.start_time,
                sl.live_title,
                sl.url,
                sl.live_type,
                {LIVE_BAND_AGG_SQL} AS band_ids,
                sl.tour_id,
                sl.tour_title,
                sl.performance_group_id,
                sl.group_title,
                sl.event_status,
                sl.was_rescheduled,
                sl.timezone_offset_minutes
            FROM selected_lives sl
            GROUP BY sl.id, sl.live_date, sl.start_time, sl.live_title, sl.url, sl.live_type,
                     sl.default_band_ids, sl.tour_id, sl.tour_title,
                     sl.performance_group_id, sl.group_title, sl.event_status,
                     sl.was_rescheduled, sl.timezone_offset_minutes
        ),
        group_bands AS (
            SELECT grouped_band.group_id, ba.band_id, ba.band_name, ba.band_abbr
            FROM (
                SELECT DISTINCT full_group.group_id, effective.band_id
                FROM full_group_matches full_group
                JOIN performance_group_lives pgl ON pgl.group_id = full_group.group_id
                JOIN effective_live_bands effective ON effective.live_id = pgl.live_id
            ) grouped_band
            JOIN current_band_versions ba ON ba.band_id = grouped_band.band_id
        ),
        group_venues AS (
            SELECT DISTINCT full_group.group_id,
                   COALESCE(to_jsonb(venue) ->> 'venue', to_jsonb(venue) ->> 'venue_name') AS venue_name
            FROM full_group_matches full_group
            JOIN performance_group_lives pgl ON pgl.group_id = full_group.group_id
            JOIN live_attrs l ON l.id = pgl.live_id
            LEFT JOIN venue_list venue ON venue.id = l.venue_id
            WHERE COALESCE(to_jsonb(venue) ->> 'venue', to_jsonb(venue) ->> 'venue_name') IS NOT NULL
        ),
        group_summary AS (
            SELECT
                full_group.group_id,
                full_group.group_title,
                full_group.start_date,
                full_group.end_date,
                full_group.start_time,
                full_group.end_time,
                full_group.day_count,
                full_group.live_count,
                full_group.cancelled_live_count,
                CASE
                    WHEN full_group.day_count = 1 THEN 'single_day_multi_show'
                    ELSE 'multi_day'
                END AS display_type,
                COALESCE(
                    (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'band_id', grouped_band.band_id,
                                'band_name', grouped_band.band_name,
                                'band_abbr', grouped_band.band_abbr
                            )
                            ORDER BY grouped_band.band_id
                        )
                        FROM group_bands grouped_band
                        WHERE grouped_band.group_id = full_group.group_id
                    ),
                    '[]'::jsonb
                ) AS bands,
                COALESCE(
                    (
                        SELECT jsonb_agg(grouped_venue.venue_name ORDER BY grouped_venue.venue_name)
                        FROM group_venues grouped_venue
                        WHERE grouped_venue.group_id = full_group.group_id
                    ),
                    '[]'::jsonb
                ) AS venues
            FROM full_group_matches full_group
        ),
        merged AS (
            SELECT
                'live'::text AS kind,
                slw.id,
                slw.live_date,
                slw.live_title,
                slw.url,
                slw.live_type,
                slw.band_ids,
                slw.tour_id,
                slw.tour_title,
                slw.performance_group_id,
                slw.group_title AS live_group_title,
                NULL::int AS group_result_id,
                NULL::text AS group_result_title,
                NULL::date AS group_start_date,
                NULL::date AS group_end_date,
                NULL::int AS group_day_count,
                NULL::int AS group_live_count,
                NULL::int AS group_cancelled_live_count,
                NULL::text AS group_display_type,
                NULL::jsonb AS group_bands,
                NULL::jsonb AS group_venues,
                slw.event_status AS live_event_status,
                slw.start_time AS live_start_time,
                slw.was_rescheduled AS live_was_rescheduled,
                slw.timezone_offset_minutes AS live_timezone_offset_minutes,
                CASE
                    WHEN slw.event_status = 'cancelled' THEN 2
                    WHEN slw.live_date > (
                        CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                        + make_interval(mins => slw.timezone_offset_minutes)
                    )::date THEN 0
                    WHEN slw.live_date < (
                        CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                        + make_interval(mins => slw.timezone_offset_minutes)
                    )::date THEN 2
                    ELSE 1
                END AS sort_rank,
                slw.live_date AS sort_date,
                slw.start_time AS sort_time,
                slw.id AS sort_id
            FROM selected_lives_with_bands slw
            UNION ALL
            SELECT
                'performance_group'::text AS kind,
                NULL::int AS id,
                NULL::date AS live_date,
                NULL::text AS live_title,
                NULL::text AS url,
                NULL::text AS live_type,
                NULL::int[] AS band_ids,
                NULL::int AS tour_id,
                NULL::text AS tour_title,
                NULL::int AS performance_group_id,
                NULL::text AS live_group_title,
                gs.group_id AS group_result_id,
                gs.group_title AS group_result_title,
                gs.start_date AS group_start_date,
                gs.end_date AS group_end_date,
                gs.day_count AS group_day_count,
                gs.live_count AS group_live_count,
                gs.cancelled_live_count AS group_cancelled_live_count,
                gs.display_type AS group_display_type,
                gs.bands AS group_bands,
                gs.venues AS group_venues,
                NULL::text AS live_event_status,
                NULL::timetz AS live_start_time,
                NULL::boolean AS live_was_rescheduled,
                NULL::smallint AS live_timezone_offset_minutes,
                CASE
                    WHEN gs.live_count > 0 AND gs.cancelled_live_count >= gs.live_count THEN 2
                    WHEN CURRENT_DATE < gs.start_date THEN 0
                    WHEN CURRENT_DATE > gs.end_date THEN 2
                    ELSE 1
                END AS sort_rank,
                gs.{sort_group_date} AS sort_date,
                gs.{sort_group_time} AS sort_time,
                gs.group_id AS sort_id
            FROM group_summary gs
        )
        SELECT
            kind, id, live_date, live_title, url, live_type, band_ids,
            tour_id, tour_title, performance_group_id, live_group_title,
            group_result_id, group_result_title, group_start_date, group_end_date,
            group_day_count, group_live_count, group_cancelled_live_count,
            group_display_type, group_bands, group_venues,
            live_event_status, live_start_time, live_was_rescheduled, live_timezone_offset_minutes
        FROM merged
        ORDER BY sort_rank ASC, sort_date {sort_dir}, sort_time {sort_dir} NULLS LAST, sort_id {sort_dir}
        LIMIT %s OFFSET %s
    """

    return count_sql, common_params, page_sql, common_params


def _parse_performances_row(
    row: tuple[Any, ...],
    favorite_live_ids: set[int],
) -> dict[str, Any]:
    kind = str(row[0])
    if kind == "live":
        live_id = int(row[1])
        has_status_columns = len(row) > 24
        return {
            "kind": "live",
            "live": {
                "live_id": live_id,
                "live_date": row[2],
                "live_title": str(row[3]),
                "live_type": str(row[5]),
                "bands": list(row[6] or []),
                "url": row[4],
                "is_favorite": live_id in favorite_live_ids,
                "tour": build_tour_ref_from_row(row, tour_id_index=7, tour_title_index=8),
                "performance_group": build_performance_group_ref_from_row(
                    row, group_id_index=9, group_title_index=10
                ),
                **build_public_live_status(
                    event_status=str(row[21]) if has_status_columns else "scheduled",
                    live_date=row[2],
                    start_time=row[22] if has_status_columns else "00:00:00+00:00",
                    timezone_offset_minutes=int(row[24]) if has_status_columns else None,
                    was_rescheduled=bool(row[23]) if has_status_columns else False,
                ),
            },
        }
    else:
        has_cancelled_count = len(row) > 20
        band_rows_raw = (row[19] if has_cancelled_count else row[18]) or []
        bands = [
            {"band_id": int(b["band_id"]), "band_name": str(b["band_name"]), "band_abbr": str(b["band_abbr"])}
            for b in band_rows_raw
        ]
        venue_rows_raw = (row[20] if has_cancelled_count else row[19]) or []
        venues = [str(v) for v in venue_rows_raw]
        return {
            "kind": "performance_group",
            "performance_group": {
                "group_id": int(row[11]),
                "group_title": str(row[12]),
                "start_date": row[13],
                "end_date": row[14],
                "day_count": int(row[15]),
                "live_count": int(row[16]),
                "cancelled_live_count": int(row[17]) if has_cancelled_count else 0,
                "display_type": str(row[18] if has_cancelled_count else row[17]),
                "bands": bands,
                "venues": venues,
            },
        }


@catalog_router.get(
    "/performances",
    response_model=CatalogPerformancesResponse,
    summary="获取演出活动组聚合列表",
    description="返回独立 Live 与有效演出活动组（≥2 场）的混合分页列表；部分筛选命中的活动组按场次展开。",
    responses={
        400: {"model": ErrorResponse, "description": "参数错误"},
        401: {"model": ErrorResponse, "description": "favorites 范围需要登录"},
        422: {"model": ValidationErrorResponse, "description": "查询参数验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def get_catalog_performances(
    scope: Literal["all", "favorites"] = Query(default="all"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20),
    q: str | None = Query(default=None, max_length=255),
    year: int | None = Query(default=None, ge=1900, le=2100),
    live_type: Literal["oneman", "taiban", "multi_act", "festival", "event", "other"] | None = Query(default=None),
    band_id: int | None = Query(default=None, ge=1),
    sort: Literal["date_desc", "date_asc"] = Query(default="date_desc"),
    current_user: AuthUser | None = Depends(get_current_user_optional),
):
    if page_size not in ALLOWED_PAGE_SIZE:
        raise HTTPException(status_code=400, detail="page_size must be 15 or 20")

    if scope == "favorites" and current_user is None:
        raise HTTPException(status_code=401, detail="Authentication required for favorites scope")

    query = q.strip() if q is not None else None
    query = query or None

    user_id = current_user.id if current_user else None
    count_query, count_params, page_query, page_params = _build_catalog_performances_queries(
        q=query,
        year=year,
        live_type=live_type,
        band_id=band_id,
        sort=sort,
        scope=scope,
        user_id=user_id,
    )

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
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

                favorite_live_ids: set[int] = set()
                if current_user is not None:
                    live_ids_in_page = [int(row[1]) for row in rows if str(row[0]) == "live"]
                    if live_ids_in_page:
                        favorite_live_ids = get_favorite_live_id_set(cur, current_user.id, live_ids_in_page)
    except QueryCanceled as exc:
        logger.exception(
            "get_catalog_performances timeout page=%s page_size=%s scope=%s", page, page_size, scope
        )
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception(
            "get_catalog_performances operational error page=%s page_size=%s scope=%s", page, page_size, scope
        )
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception(
            "get_catalog_performances failed page=%s page_size=%s scope=%s", page, page_size, scope
        )
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "items": [_parse_performances_row(row, favorite_live_ids) for row in rows],
        "pagination": {
            "page": safe_page,
            "page_size": page_size,
            "total": total,
            "total_pages": total_pages,
        },
    }
