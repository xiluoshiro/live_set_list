from fastapi import APIRouter, HTTPException
from psycopg2 import Error

from app.db import get_db_connection

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("/db")
def db_healthcheck():
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("select 1;")
                row = cur.fetchone()
        return {"ok": True, "result": row[0] if row else None}
    except Error as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
