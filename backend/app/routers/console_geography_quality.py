from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from psycopg2 import Error
from psycopg2.extras import RealDictCursor

from app.auth import require_role
from app.db import get_db_connection
from app.routers.console_venues import _raise_database_error
from app.schemas.geography_quality import GeographyQualityPage


router = APIRouter(dependencies=[Depends(require_role("editor"))])

QUALITY_CATEGORIES = (
    "missing_locality",
    "missing_address",
    "missing_coordinates",
    "missing_timezone",
    "zero_coordinates",
)

QUALITY_CTE = f"""
    WITH venue_base AS (
        SELECT venue.id AS venue_id,
               version.venue_name,
               venue.venue_kind,
               venue.locality_id,
               venue.address,
               venue.latitude,
               venue.longitude,
               venue.timezone_id,
               NULLIF(concat_ws(' / ', locality.country_code, locality.admin_area, locality.locality_name), '')
                   AS locality_label
        FROM venue_list venue
        JOIN venue_name_versions version ON version.venue_id = venue.id AND version.valid_to IS NULL
        LEFT JOIN geo_localities locality ON locality.id = venue.locality_id
        WHERE venue.merged_into_venue_id IS NULL
          AND venue.venue_kind = 'physical'
    ), venue_quality AS (
        SELECT issue.category, 'venue'::text AS subject_type, base.venue_id AS subject_id,
               base.venue_id, base.venue_name, base.venue_kind, base.locality_label,
               NULL::date AS live_date, NULL::text AS live_title, issue.detail
        FROM venue_base base
        CROSS JOIN LATERAL (
            VALUES
                ('missing_locality', base.locality_id IS NULL, '实体 Venue 尚未登记所在地'),
                ('missing_address', base.address IS NULL OR btrim(base.address) = '', '实体 Venue 尚未登记公开门牌地址'),
                ('missing_coordinates', base.latitude IS NULL, '实体 Venue 尚未登记 WGS84 坐标'),
                ('missing_timezone', base.timezone_id IS NULL, '场馆未登记 IANA 时区；请补全后录入演出'),
                ('zero_coordinates', base.latitude = 0 AND base.longitude = 0, '坐标为 (0, 0)，需要人工核对')
        ) AS issue(category, matches, detail)
        WHERE issue.matches
    ), quality AS (
        SELECT * FROM venue_quality
    )
"""


@router.get("/geography-quality", response_model=GeographyQualityPage, summary="Venue 地理资料质量中心")
def list_geography_quality(
    category: Literal[
        "all", "missing_locality", "missing_address", "missing_coordinates", "missing_timezone",
        "zero_coordinates",
    ] = Query(default="all"),
    q: str = Query(default="", max_length=255),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    normalized = q.strip()
    filters = "WHERE (%(q)s = '' OR COALESCE(quality.venue_name, '') ILIKE %(pattern)s OR COALESCE(quality.live_title, '') ILIKE %(pattern)s)"
    if category != "all":
        filters += " AND quality.category = %(category)s"
    params: dict[str, Any] = {
        "q": normalized,
        "pattern": f"%{normalized}%",
        "category": category,
    }
    try:
        with get_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(QUALITY_CTE + " SELECT category, COUNT(*) AS count FROM quality GROUP BY category")
            counts = {item: 0 for item in QUALITY_CATEGORIES}
            counts.update({str(row["category"]): int(row["count"]) for row in cur.fetchall()})
            cur.execute(QUALITY_CTE + f" SELECT COUNT(*) AS total FROM quality {filters}", params)
            total = int(cur.fetchone()["total"])
            params.update({"limit": limit, "offset": (page - 1) * limit})
            cur.execute(
                QUALITY_CTE + f" SELECT * FROM quality {filters} "
                "ORDER BY category, live_date DESC NULLS LAST, venue_name, subject_id "
                "LIMIT %(limit)s OFFSET %(offset)s",
                params,
            )
            return {
                "items": cur.fetchall(), "counts": counts, "total": total, "page": page,
                "page_size": limit, "total_pages": max(1, (total + limit - 1) // limit),
            }
    except Error as exc:
        _raise_database_error("list_geography_quality", exc)
