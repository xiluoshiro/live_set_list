from math import ceil

from fastapi import APIRouter, HTTPException, Query
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled

from app.db import get_db_connection

router = APIRouter(prefix="/api/lives", tags=["lives"])

ALLOWED_PAGE_SIZE = {15, 20}

LIVES_BASE_QUERY = """
SELECT
    l.id,
    l.live_date,
    l.live_title,
    COALESCE(
        array_agg(DISTINCT b.id ORDER BY b.id)
            FILTER (WHERE b.id IS NOT NULL),
        ARRAY[]::int[]
    ) AS band_ids,
    NULL AS url
FROM live_attrs l
JOIN live_setlist ls
    ON l.id = ls.live_id
LEFT JOIN LATERAL (
    SELECT jsonb_object_keys(ls.band_member) AS key
    WHERE jsonb_typeof(ls.band_member) = 'object'
) t ON true
LEFT JOIN band_attrs b
    ON b.band_name = t.key
GROUP BY l.id, l.live_date, l.live_title
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


@router.get("")
def get_lives(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20),
):
    if page_size not in ALLOWED_PAGE_SIZE:
        raise HTTPException(status_code=400, detail="page_size must be 15 or 20")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(LIVES_COUNT_QUERY)
                count_row = cur.fetchone()
                total = int(count_row[0]) if count_row else 0

                total_pages = ceil(total / page_size) if total > 0 else 1
                safe_page = min(page, total_pages)
                offset = (safe_page - 1) * page_size

                cur.execute(LIVES_PAGE_QUERY, (page_size, offset))
                rows = cur.fetchall()
    except QueryCanceled as exc:
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    items = [
        {
            "live_id": row[0],
            "live_date": row[1],
            "live_title": row[2],
            "bands": row[3] or [],
            "url": row[4],
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
