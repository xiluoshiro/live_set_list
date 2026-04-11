from fastapi import APIRouter, HTTPException
from psycopg2 import Error

from app.db import get_db_connection
from app.logging_config import get_logger
from app.schemas import ErrorResponse, HealthResponse

router = APIRouter(prefix="/api/health", tags=["health"])
logger = get_logger(__name__)


@router.get(
    "/db",
    response_model=HealthResponse,
    summary="数据库健康检查",
    description="建立数据库连接并执行 select 1;，用于确认数据库可连接。",
    responses={
        500: {
            "model": ErrorResponse,
            "description": "数据库异常",
        }
    },
)
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


