from fastapi import APIRouter, HTTPException
from psycopg2 import Error

from app.db import get_db_connection
from app.logging_config import get_logger

router = APIRouter(prefix="/api/health", tags=["health"])
logger = get_logger(__name__)


@router.get("/db")
def db_healthcheck():
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("select 1;")
                row = cur.fetchone()
        return {"ok": True, "result": row[0] if row else None}
    except Error as exc:
        logger.exception("db healthcheck failed path=/api/health/db error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
