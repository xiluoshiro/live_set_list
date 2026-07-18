from datetime import date
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
    ErrorResponse,
    TourDetailResponse,
    ToursResponse,
    TourStatisticsResponse,
    ValidationErrorResponse,
)

router = APIRouter(prefix="/api/catalog/tours", tags=["catalog"])
logger = get_logger(__name__)

ALLOWED_PAGE_SIZE = {15, 20}


def _lookup_pattern(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _build_tour_filters(
    *,
    query: str | None,
    year: int | None,
    band_id: int | None,
) -> tuple[str, tuple[object, ...]]:
    conditions = ["EXISTS (SELECT 1 FROM tour_lives required_stop WHERE required_stop.tour_id = t.id)"]
    params: list[object] = []

    if query is not None:
        pattern = _lookup_pattern(query)
        conditions.append(
            """
            (
                t.tour_title ILIKE %s ESCAPE '\\'
                OR EXISTS (
                    SELECT 1
                    FROM tour_lives query_stop
                    JOIN live_attrs query_live ON query_live.id = query_stop.live_id
                    WHERE query_stop.tour_id = t.id
                      AND (
                          query_stop.stop_label ILIKE %s ESCAPE '\\'
                          OR query_live.live_title ILIKE %s ESCAPE '\\'
                      )
                )
            )
            """
        )
        params.extend([pattern, pattern, pattern])

    if year is not None:
        conditions.append(
            """
            EXISTS (
                SELECT 1
                FROM tour_lives year_stop
                JOIN live_attrs year_live ON year_live.id = year_stop.live_id
                WHERE year_stop.tour_id = t.id
                  AND year_live.live_date >= %s
                  AND year_live.live_date < %s
            )
            """
        )
        params.extend([date(year, 1, 1), date(year + 1, 1, 1)])

    if band_id is not None:
        conditions.append(
            """
            (
                EXISTS (
                    SELECT 1
                    FROM tour_bands selected_band
                    WHERE selected_band.tour_id = t.id
                      AND selected_band.band_id = %s
                )
                OR (
                    NOT EXISTS (SELECT 1 FROM tour_bands explicit_band WHERE explicit_band.tour_id = t.id)
                    AND EXISTS (
                        SELECT 1
                        FROM tour_lives fallback_stop
                        JOIN live_attrs fallback_live ON fallback_live.id = fallback_stop.live_id
                        WHERE fallback_stop.tour_id = t.id
                          AND (
                              (
                                  NOT EXISTS (
                                      SELECT 1 FROM live_setlist any_setlist
                                      WHERE any_setlist.live_id = fallback_live.id
                                  )
                                  AND %s = ANY(fallback_live.default_band_ids)
                              )
                              OR EXISTS (
                                  SELECT 1
                                  FROM live_setlist fallback_setlist
                                  JOIN LATERAL jsonb_object_keys(fallback_setlist.band_member) k(band_name)
                                      ON jsonb_typeof(fallback_setlist.band_member) = 'object'
                                  JOIN band_attrs fallback_band ON fallback_band.band_name = k.band_name
                                  WHERE fallback_setlist.live_id = fallback_live.id
                                    AND fallback_band.id = %s
                              )
                          )
                    )
                )
            )
            """
        )
        params.extend([band_id, band_id, band_id])

    where_sql = " AND ".join(f"({condition.strip()})" for condition in conditions)
    return where_sql, tuple(params)


def _build_tour_list_queries(
    *,
    query: str | None,
    year: int | None,
    band_id: int | None,
    sort: Literal["date_desc", "date_asc"],
) -> tuple[str, tuple[object, ...], str, tuple[object, ...]]:
    where_sql, params = _build_tour_filters(query=query, year=year, band_id=band_id)
    matched_order = (
        "(SELECT MIN(order_live.live_date) FROM tour_lives order_stop "
        "JOIN live_attrs order_live ON order_live.id = order_stop.live_id "
        "WHERE order_stop.tour_id = t.id) ASC, t.id ASC"
        if sort == "date_asc"
        else "(SELECT MAX(order_live.live_date) FROM tour_lives order_stop "
        "JOIN live_attrs order_live ON order_live.id = order_stop.live_id "
        "WHERE order_stop.tour_id = t.id) DESC, t.id DESC"
    )
    result_order = "summary.start_date ASC, summary.tour_id ASC" if sort == "date_asc" else "summary.end_date DESC, summary.tour_id DESC"

    count_query = f"SELECT COUNT(*) FROM tour_attrs t WHERE {where_sql}"
    page_query = f"""
        WITH matched_tours AS (
            SELECT t.id
            FROM tour_attrs t
            WHERE {where_sql}
            ORDER BY {matched_order}
            LIMIT %s OFFSET %s
        ),
        summary AS (
            SELECT
                t.id AS tour_id,
                t.tour_title,
                (
                    SELECT first_live.url
                    FROM tour_lives first_stop
                    JOIN live_attrs first_live ON first_live.id = first_stop.live_id
                    WHERE first_stop.tour_id = t.id
                    ORDER BY first_live.live_date, first_live.id
                    LIMIT 1
                ) AS url,
                NULL::text AS description,
                MIN(l.live_date) AS start_date,
                MAX(l.live_date) AS end_date,
                COUNT(*)::int AS collected_live_count,
                COALESCE(
                    (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'band_id', b.id,
                                'band_name', b.band_name,
                                'band_abbr', b.band_abbr
                            )
                            ORDER BY b.id
                        )
                        FROM tour_bands tb
                        JOIN band_attrs b ON b.id = tb.band_id
                        WHERE tb.tour_id = t.id
                    ),
                    (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'band_id', fallback_band.id,
                                'band_name', fallback_band.band_name,
                                'band_abbr', fallback_band.band_abbr
                            )
                            ORDER BY fallback_band.id
                        )
                        FROM (
                            SELECT DISTINCT setlist_band.id
                            FROM tour_lives fallback_stop
                            JOIN live_setlist fallback_setlist ON fallback_setlist.live_id = fallback_stop.live_id
                            JOIN LATERAL jsonb_object_keys(fallback_setlist.band_member) k(band_name)
                                ON jsonb_typeof(fallback_setlist.band_member) = 'object'
                            JOIN band_attrs setlist_band ON setlist_band.band_name = k.band_name
                            WHERE fallback_stop.tour_id = t.id
                            UNION
                            SELECT DISTINCT unnest(fallback_live.default_band_ids) AS id
                            FROM tour_lives fallback_stop
                            JOIN live_attrs fallback_live ON fallback_live.id = fallback_stop.live_id
                            WHERE fallback_stop.tour_id = t.id
                              AND NOT EXISTS (
                                  SELECT 1 FROM live_setlist any_setlist
                                  WHERE any_setlist.live_id = fallback_live.id
                              )
                        ) fallback_ids
                        JOIN band_attrs fallback_band ON fallback_band.id = fallback_ids.id
                    ),
                    '[]'::jsonb
                ) AS bands,
                COALESCE(
                    array_agg(tl.stop_label ORDER BY l.live_date, l.id)
                        FILTER (WHERE tl.stop_label IS NOT NULL),
                    ARRAY[]::text[]
                ) AS stop_labels
            FROM matched_tours matched
            JOIN tour_attrs t ON t.id = matched.id
            JOIN tour_lives tl ON tl.tour_id = t.id
            JOIN live_attrs l ON l.id = tl.live_id
            GROUP BY t.id, t.tour_title
        )
        SELECT
            summary.tour_id,
            summary.tour_title,
            summary.url,
            summary.description,
            summary.bands,
            summary.start_date,
            summary.end_date,
            summary.collected_live_count,
            summary.stop_labels
        FROM summary
        ORDER BY {result_order}
    """
    return count_query, params, page_query, params


TOUR_DETAIL_HEADER_QUERY = """
SELECT
    t.id,
    t.tour_title,
    (
        SELECT first_live.url
        FROM tour_lives first_stop
        JOIN live_attrs first_live ON first_live.id = first_stop.live_id
        WHERE first_stop.tour_id = t.id
        ORDER BY first_live.live_date, first_live.id
        LIMIT 1
    ) AS url,
    NULL::text AS description,
    MIN(l.live_date) AS start_date,
    MAX(l.live_date) AS end_date,
    COUNT(*)::int AS collected_live_count,
    COALESCE(
        array_agg(tl.stop_label ORDER BY l.live_date, l.id)
            FILTER (WHERE tl.stop_label IS NOT NULL),
        ARRAY[]::text[]
    ) AS stop_labels
FROM tour_attrs t
JOIN tour_lives tl ON tl.tour_id = t.id
JOIN live_attrs l ON l.id = tl.live_id
WHERE t.id = %s
GROUP BY t.id, t.tour_title
"""

TOUR_DETAIL_BANDS_QUERY = """
SELECT selected.id, selected.band_name, selected.band_abbr
FROM (
    SELECT b.id, b.band_name, b.band_abbr
    FROM tour_bands tb
    JOIN band_attrs b ON b.id = tb.band_id
    WHERE tb.tour_id = %s
    UNION ALL
    SELECT fallback_band.id, fallback_band.band_name, fallback_band.band_abbr
    FROM (
        SELECT DISTINCT setlist_band.id
        FROM tour_lives fallback_stop
        JOIN live_setlist fallback_setlist ON fallback_setlist.live_id = fallback_stop.live_id
        JOIN LATERAL jsonb_object_keys(fallback_setlist.band_member) k(band_name)
            ON jsonb_typeof(fallback_setlist.band_member) = 'object'
        JOIN band_attrs setlist_band ON setlist_band.band_name = k.band_name
        WHERE fallback_stop.tour_id = %s
        UNION
        SELECT DISTINCT unnest(fallback_live.default_band_ids) AS id
        FROM tour_lives fallback_stop
        JOIN live_attrs fallback_live ON fallback_live.id = fallback_stop.live_id
        WHERE fallback_stop.tour_id = %s
          AND NOT EXISTS (
              SELECT 1 FROM live_setlist any_setlist
              WHERE any_setlist.live_id = fallback_live.id
          )
    ) fallback_ids
    JOIN band_attrs fallback_band ON fallback_band.id = fallback_ids.id
    WHERE NOT EXISTS (SELECT 1 FROM tour_bands explicit_band WHERE explicit_band.tour_id = %s)
) selected
ORDER BY selected.id
"""

TOUR_DETAIL_STOPS_QUERY = """
SELECT
    ROW_NUMBER() OVER (ORDER BY l.live_date, l.id)::int AS stop_order,
    tl.stop_label,
    l.id,
    l.live_date,
    l.live_title,
    l.live_type,
    COALESCE(to_jsonb(v) ->> 'venue', to_jsonb(v) ->> 'venue_name') AS venue,
    CASE
        WHEN EXISTS (SELECT 1 FROM live_setlist any_setlist WHERE any_setlist.live_id = l.id)
        THEN COALESCE(
            (
                SELECT array_agg(DISTINCT ba.id ORDER BY ba.id)
                FROM live_setlist stop_setlist
                JOIN LATERAL jsonb_object_keys(stop_setlist.band_member) k(band_name)
                    ON jsonb_typeof(stop_setlist.band_member) = 'object'
                JOIN band_attrs ba ON ba.band_name = k.band_name
                WHERE stop_setlist.live_id = l.id
            ),
            ARRAY[]::int[]
        )
        ELSE l.default_band_ids
    END AS bands,
    l.url,
    EXISTS (SELECT 1 FROM live_setlist any_setlist WHERE any_setlist.live_id = l.id) AS has_setlist
FROM tour_lives tl
JOIN live_attrs l ON l.id = tl.live_id
LEFT JOIN venue_list v ON v.id = l.venue_id
WHERE tl.tour_id = %s
ORDER BY l.live_date, l.id
"""

TOUR_STATISTICS_QUERY = """
SELECT
    l.id,
    l.live_date,
    l.live_title,
    stl.song_id,
    s.song_name,
    stl.segment_type,
    stl.sub_order,
    stl.absolute_order
FROM tour_lives tl
JOIN live_attrs l ON l.id = tl.live_id
LEFT JOIN live_setlist stl ON stl.live_id = l.id
LEFT JOIN song_list s ON s.id = stl.song_id
WHERE tl.tour_id = %s
ORDER BY l.live_date, l.id, stl.absolute_order
"""


def _song_ref(song: dict[str, Any]) -> dict[str, Any]:
    return {"song_id": song["song_id"], "song_name": song["song_name"]}


def _build_tour_statistics(tour_id: int, rows: list[tuple[Any, ...]]) -> dict[str, Any]:
    stops: list[dict[str, Any]] = []
    stop_by_id: dict[int, dict[str, Any]] = {}
    for row in rows:
        live_id = int(row[0])
        stop = stop_by_id.get(live_id)
        if stop is None:
            stop = {
                "live_id": live_id,
                "live_date": row[1],
                "live_title": str(row[2]),
                "songs": [],
            }
            stop_by_id[live_id] = stop
            stops.append(stop)
        if row[3] is not None:
            stop["songs"].append(
                {
                    "song_id": int(row[3]),
                    "song_name": str(row[4]),
                    "segment_type": str(row[5]),
                    "sub_order": int(row[6]),
                    "absolute_order": int(row[7]),
                }
            )

    setlist_stops = [stop for stop in stops if stop["songs"]]
    song_names: dict[int, str] = {}
    song_live_ids: dict[int, list[int]] = {}
    for stop in setlist_stops:
        seen_in_stop: set[int] = set()
        for song in stop["songs"]:
            song_id = song["song_id"]
            song_names[song_id] = song["song_name"]
            if song_id not in seen_in_stop:
                song_live_ids.setdefault(song_id, []).append(stop["live_id"])
                seen_in_stop.add(song_id)

    setlist_live_ids = [stop["live_id"] for stop in setlist_stops]
    song_items: list[dict[str, Any]] = []
    for song_id, live_ids in song_live_ids.items():
        positions = [setlist_live_ids.index(live_id) for live_id in live_ids]
        if len(live_ids) == len(setlist_stops):
            status = "common"
        elif len(live_ids) == 1:
            status = "single"
        elif positions == list(range(positions[0], len(setlist_stops))):
            status = "added"
        elif positions == list(range(0, positions[-1] + 1)):
            status = "removed"
        else:
            status = "intermittent"
        song_items.append(
            {
                "song_id": song_id,
                "song_name": song_names[song_id],
                "appearance_count": len(live_ids),
                "first_live_id": live_ids[0],
                "last_live_id": live_ids[-1],
                "status": status,
            }
        )
    song_items.sort(key=lambda item: (-item["appearance_count"], item["song_id"]))

    transitions: list[dict[str, Any]] = []
    for from_stop, to_stop in zip(stops, stops[1:]):
        if not from_stop["songs"] or not to_stop["songs"]:
            continue
        from_slots = {
            (song["segment_type"], song["sub_order"]): song
            for song in from_stop["songs"]
        }
        to_slots = {
            (song["segment_type"], song["sub_order"]): song
            for song in to_stop["songs"]
        }
        from_by_song = {song["song_id"]: song for song in from_stop["songs"]}
        to_by_song = {song["song_id"]: song for song in to_stop["songs"]}
        moved_song_ids = {
            song_id
            for song_id in from_by_song.keys() & to_by_song.keys()
            if from_by_song[song_id]["absolute_order"] != to_by_song[song_id]["absolute_order"]
        }
        moved_songs = [
            {
                **_song_ref(from_by_song[song_id]),
                "from_order": from_by_song[song_id]["absolute_order"],
                "to_order": to_by_song[song_id]["absolute_order"],
            }
            for song_id in sorted(moved_song_ids)
        ]
        replacements: list[dict[str, Any]] = []
        replaced_from_ids: set[int] = set()
        replaced_to_ids: set[int] = set()
        for slot in sorted(from_slots.keys() & to_slots.keys()):
            from_song = from_slots[slot]
            to_song = to_slots[slot]
            if from_song["song_id"] == to_song["song_id"]:
                continue
            if from_song["song_id"] in moved_song_ids or to_song["song_id"] in moved_song_ids:
                continue
            replacements.append(
                {
                    "segment_type": slot[0],
                    "sub_order": slot[1],
                    "from_song": _song_ref(from_song),
                    "to_song": _song_ref(to_song),
                }
            )
            replaced_from_ids.add(from_song["song_id"])
            replaced_to_ids.add(to_song["song_id"])

        added_songs = [
            _song_ref(song)
            for song in to_stop["songs"]
            if song["song_id"] not in from_by_song and song["song_id"] not in replaced_to_ids
        ]
        removed_songs = [
            _song_ref(song)
            for song in from_stop["songs"]
            if song["song_id"] not in to_by_song and song["song_id"] not in replaced_from_ids
        ]
        transitions.append(
            {
                "from_live_id": from_stop["live_id"],
                "from_live_date": from_stop["live_date"],
                "from_live_title": from_stop["live_title"],
                "to_live_id": to_stop["live_id"],
                "to_live_date": to_stop["live_date"],
                "to_live_title": to_stop["live_title"],
                "replacements": replacements,
                "added_songs": added_songs,
                "removed_songs": removed_songs,
                "moved_songs": moved_songs,
            }
        )

    common_song_count = sum(1 for item in song_items if item["status"] == "common")
    return {
        "tour_id": tour_id,
        "coverage": {
            "stop_count": len(stops),
            "setlist_stop_count": len(setlist_stops),
            "comparable_transition_count": len(transitions),
        },
        "overview": {
            "distinct_song_count": len(song_items),
            "common_song_count": common_song_count,
        },
        "songs": song_items,
        "transitions": transitions,
    }


def _tour_summary_from_row(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "tour_id": int(row[0]),
        "tour_title": str(row[1]),
        "url": row[2],
        "description": row[3],
        "bands": list(row[4] or []),
        "start_date": row[5],
        "end_date": row[6],
        "collected_live_count": int(row[7]),
        "stop_labels": list(row[8] or []),
    }


@router.get(
    "",
    response_model=ToursResponse,
    summary="获取巡演列表",
    description="返回本站已整理且至少关联一场 Live 的巡演聚合列表。",
    responses={
        400: {"model": ErrorResponse, "description": "参数错误"},
        422: {"model": ValidationErrorResponse, "description": "查询参数验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def get_tours(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20),
    q: str | None = Query(default=None, max_length=255),
    year: int | None = Query(default=None, ge=1900, le=2100),
    band_id: int | None = Query(default=None, ge=1),
    sort: Literal["date_desc", "date_asc"] = Query(default="date_desc"),
):
    if page_size not in ALLOWED_PAGE_SIZE:
        raise HTTPException(status_code=400, detail="page_size must be 15 or 20")
    query = q.strip() if q is not None else None
    query = query or None
    count_query, count_params, page_query, page_params = _build_tour_list_queries(
        query=query,
        year=year,
        band_id=band_id,
        sort=sort,
    )

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(count_query, count_params)
                count_row = cur.fetchone()
                total = int(count_row[0]) if count_row else 0
                total_pages = ceil(total / page_size) if total > 0 else 1
                safe_page = min(page, total_pages)
                offset = (safe_page - 1) * page_size
                cur.execute(page_query, (*page_params, page_size, offset))
                rows = cur.fetchall()
    except QueryCanceled as exc:
        logger.exception("get_tours timeout page=%s page_size=%s", page, page_size)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("get_tours operational error page=%s page_size=%s", page, page_size)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("get_tours failed page=%s page_size=%s", page, page_size)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "items": [_tour_summary_from_row(row) for row in rows],
        "pagination": {
            "page": safe_page,
            "page_size": page_size,
            "total": total,
            "total_pages": total_pages,
        },
    }


@router.get(
    "/{tour_id}/statistics",
    response_model=TourStatisticsResponse,
    summary="获取巡演统计",
    description="按相邻且均已收录 setlist 的场次比较歌曲替换、新增、移除和顺序变化。",
    responses={
        400: {"model": ErrorResponse, "description": "参数错误"},
        404: {"model": ErrorResponse, "description": "指定巡演不存在"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def get_tour_statistics(tour_id: int):
    if tour_id < 1:
        raise HTTPException(status_code=400, detail="tour_id must be >= 1")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(TOUR_STATISTICS_QUERY, (tour_id,))
                rows = cur.fetchall()
    except QueryCanceled as exc:
        logger.exception("get_tour_statistics timeout tour_id=%s", tour_id)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("get_tour_statistics operational error tour_id=%s", tour_id)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("get_tour_statistics failed tour_id=%s", tour_id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    if not rows:
        raise HTTPException(status_code=404, detail=f"Tour id {tour_id} not found")
    return _build_tour_statistics(tour_id, rows)


@router.get(
    "/{tour_id}",
    response_model=TourDetailResponse,
    summary="获取巡演详情",
    description="返回巡演摘要及按人工维护顺序排列的已收录 Live。",
    responses={
        400: {"model": ErrorResponse, "description": "参数错误"},
        404: {"model": ErrorResponse, "description": "指定巡演不存在"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def get_tour_detail(
    tour_id: int,
    current_user: AuthUser | None = Depends(get_current_user_optional),
):
    if tour_id < 1:
        raise HTTPException(status_code=400, detail="tour_id must be >= 1")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(TOUR_DETAIL_HEADER_QUERY, (tour_id,))
                header_row = cur.fetchone()
                if header_row is None:
                    raise HTTPException(status_code=404, detail=f"Tour id {tour_id} not found")

                cur.execute(TOUR_DETAIL_BANDS_QUERY, (tour_id, tour_id, tour_id, tour_id))
                band_rows = cur.fetchall()
                cur.execute(TOUR_DETAIL_STOPS_QUERY, (tour_id,))
                stop_rows = cur.fetchall()
                if not stop_rows:
                    logger.error("tour has no stops tour_id=%s", tour_id)
                    raise HTTPException(status_code=500, detail="Tour data has no collected lives")

                live_ids = [int(row[2]) for row in stop_rows]
                favorite_live_ids = (
                    get_favorite_live_id_set(cur, current_user.id, live_ids)
                    if current_user is not None
                    else set()
                )
    except HTTPException:
        raise
    except QueryCanceled as exc:
        logger.exception("get_tour_detail timeout tour_id=%s", tour_id)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("get_tour_detail operational error tour_id=%s", tour_id)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("get_tour_detail failed tour_id=%s", tour_id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "tour_id": int(header_row[0]),
        "tour_title": str(header_row[1]),
        "url": header_row[2],
        "description": header_row[3],
        "bands": [
            {"band_id": int(row[0]), "band_name": str(row[1]), "band_abbr": str(row[2])}
            for row in band_rows
        ],
        "start_date": header_row[4],
        "end_date": header_row[5],
        "collected_live_count": int(header_row[6]),
        "stop_labels": list(header_row[7] or []),
        "stops": [
            {
                "stop_order": int(row[0]),
                "stop_label": row[1],
                "live_id": int(row[2]),
                "live_date": row[3],
                "live_title": str(row[4]),
                "live_type": str(row[5]),
                "venue": row[6],
                "bands": list(row[7] or []),
                "url": row[8],
                "is_favorite": int(row[2]) in favorite_live_ids,
                "has_setlist": bool(row[9]),
            }
            for row in stop_rows
        ],
    }
