from math import ceil
from typing import Any, NoReturn

from fastapi import APIRouter, HTTPException, Query
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled

from app.db import get_db_connection
from app.geography import coordinate_url, place_url
from app.live_status import build_public_live_status
from app.logging_config import get_logger
from app.schemas import ErrorResponse, ValidationErrorResponse
from app.schemas.venues import PublicVenueDetailResponse, PublicVenueMapsResponse

router = APIRouter(prefix="/api/venues", tags=["venues"])
logger = get_logger(__name__)
ALLOWED_PAGE_SIZE = {15, 20}
MAP_PROVIDERS = ("google", "apple", "amap")

VENUE_HEADER_QUERY = """
SELECT
    requested.id,
    requested.merged_into_venue_id,
    venue.id,
    current_name.venue_name,
    venue.venue_kind,
    locality.country_code,
    locality.admin_area,
    locality.locality_name,
    venue.address,
    venue.latitude,
    venue.longitude,
    venue.timezone_id
FROM venue_list requested
JOIN venue_list venue
  ON venue.id = COALESCE(requested.merged_into_venue_id, requested.id)
JOIN current_venue_versions current_name ON current_name.venue_id = venue.id
LEFT JOIN geo_localities locality ON locality.id = venue.locality_id
WHERE requested.id = %s
"""

VENUE_NAME_VERSIONS_QUERY = """
SELECT venue_name, valid_from, valid_to, valid_to IS NULL
FROM venue_name_versions
WHERE venue_id = %s
ORDER BY valid_from ASC NULLS FIRST, id ASC
"""

VENUE_MAP_LINKS_QUERY = """
SELECT provider, provider_place_id, provider_url
FROM venue_map_links
WHERE venue_id = %s
ORDER BY provider
"""

VENUE_LIVE_COUNT_QUERY = "SELECT COUNT(*) FROM live_attrs WHERE venue_id = %s"

VENUE_LIVES_QUERY = """
SELECT
    live.id,
    live.live_date,
    live.live_title,
    live.live_type,
    COALESCE((
        SELECT array_agg(effective.band_id ORDER BY effective.band_id)
        FROM effective_live_bands effective
        WHERE effective.live_id = live.id
    ), ARRAY[]::int[]),
    live.url,
    live.event_status,
    EXISTS (SELECT 1 FROM live_schedule_history history WHERE history.live_id = live.id),
    live.start_time,
    live.opening_time
FROM live_attrs live
WHERE live.venue_id = %s
ORDER BY live.live_date DESC, live.start_time DESC NULLS LAST, live.id DESC
LIMIT %s OFFSET %s
"""


def _load_header(cur: Any, venue_id: int) -> tuple[Any, ...]:
    cur.execute(VENUE_HEADER_QUERY, (venue_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Venue id {venue_id} not found")
    return row


def _public_map_links(cur: Any, header: tuple[Any, ...]) -> list[dict[str, str]]:
    venue_id = int(header[2])
    venue_name = str(header[3])
    venue_kind = str(header[4])
    latitude = header[9]
    longitude = header[10]
    if venue_kind != "physical" or latitude is None or longitude is None:
        return []

    cur.execute(VENUE_MAP_LINKS_QUERY, (venue_id,))
    stored = {str(row[0]): row for row in cur.fetchall()}
    links: list[dict[str, str]] = []
    for provider in MAP_PROVIDERS:
        item = stored.get(provider)
        if item is not None:
            target = item[2] or place_url(provider, str(item[1]), venue_name)
            source = "place"
        else:
            target = coordinate_url(provider, float(latitude), float(longitude), venue_name)
            source = "coordinates"
        links.append({"provider": provider, "url": target, "source": source})
    return links


def _raise_read_error(operation: str, venue_id: int, exc: Error) -> NoReturn:
    if isinstance(exc, QueryCanceled):
        logger.exception("%s timeout venue_id=%s", operation, venue_id)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    if isinstance(exc, OperationalError) and "timeout expired" in str(exc).lower():
        logger.exception("%s connection timeout venue_id=%s", operation, venue_id)
        raise HTTPException(status_code=504, detail="Database connection timeout") from exc
    logger.exception("%s failed venue_id=%s", operation, venue_id)
    raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


@router.get(
    "/{venue_id}/maps",
    response_model=PublicVenueMapsResponse,
    summary="获取场馆地图入口",
    description="返回当前有效的平台详情链接；没有详情关联时使用 Venue 的 WGS84 坐标生成链接。",
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}, 504: {"model": ErrorResponse}},
)
def get_venue_maps(venue_id: int):
    if venue_id < 1:
        raise HTTPException(status_code=400, detail="venue_id must be >= 1")
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            header = _load_header(cur, venue_id)
            return {
                "venue_id": int(header[2]),
                "venue_name": str(header[3]),
                "map_links": _public_map_links(cur, header),
            }
    except HTTPException:
        raise
    except Error as exc:
        _raise_read_error("get_venue_maps", venue_id, exc)


@router.get(
    "/{venue_id}",
    response_model=PublicVenueDetailResponse,
    summary="获取场馆详情",
    description="返回场馆公开资料、名称历史、地图入口和分页 Live；合并来源 ID 返回目标 Venue。",
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        422: {"model": ValidationErrorResponse},
        500: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
)
def get_venue_detail(
    venue_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20),
):
    if venue_id < 1:
        raise HTTPException(status_code=400, detail="venue_id must be >= 1")
    if page_size not in ALLOWED_PAGE_SIZE:
        raise HTTPException(status_code=400, detail="page_size must be 15 or 20")

    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            header = _load_header(cur, venue_id)
            canonical_id = int(header[2])
            cur.execute(VENUE_NAME_VERSIONS_QUERY, (canonical_id,))
            name_rows = cur.fetchall()
            map_links = _public_map_links(cur, header)
            cur.execute(VENUE_LIVE_COUNT_QUERY, (canonical_id,))
            count_row = cur.fetchone()
            total = int(count_row[0]) if count_row else 0
            total_pages = ceil(total / page_size) if total > 0 else 1
            safe_page = min(page, total_pages)
            cur.execute(VENUE_LIVES_QUERY, (canonical_id, page_size, (safe_page - 1) * page_size))
            live_rows = cur.fetchall()
    except HTTPException:
        raise
    except Error as exc:
        _raise_read_error("get_venue_detail", venue_id, exc)

    locality = None
    if header[5] is not None:
        locality = {"country_code": header[5], "admin_area": header[6], "locality_name": header[7]}
    return {
        "venue_id": int(header[2]),
        "venue_name": str(header[3]),
        "venue_kind": str(header[4]),
        "locality": locality,
        "address": header[8],
        "latitude": header[9],
        "longitude": header[10],
        "timezone_id": header[11],
        "name_versions": [
            {"venue_name": row[0], "valid_from": row[1], "valid_to": row[2], "is_current": bool(row[3])}
            for row in name_rows
        ],
        "map_links": map_links,
        "lives": [
            {
                "live_id": int(row[0]),
                "live_date": row[1],
                "live_title": str(row[2]),
                "live_type": str(row[3]),
                "bands": list(row[4] or []),
                "url": row[5],
                **build_public_live_status(
                    event_status=str(row[6]),
                    live_date=row[1],
                    start_time=row[8],
                    opening_time=row[9],
                    was_rescheduled=bool(row[7]),
                ),
            }
            for row in live_rows
        ],
        "pagination": {"page": safe_page, "page_size": page_size, "total": total, "total_pages": total_pages},
    }
