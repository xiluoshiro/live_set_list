import math
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled, UniqueViolation
from psycopg2.extras import Json

from app.auth import AuthSessionContext, assert_valid_csrf, get_current_auth_context, require_role
from app.db import get_db_connection, get_write_db_connection
from app.logging_config import get_logger
from app.schemas.console import (
    ConsoleVenueCreateRequest,
    ConsoleVenueDetailResponse,
    ConsoleVenueListResponse,
    ConsoleVenueLivesResponse,
    ConsoleVenueMergePreviewResponse,
    ConsoleVenueMergeRequest,
    ConsoleVenueMutationResponse,
    ConsoleVenueNameVersionCreateRequest,
    ConsoleVenueNameVersionUpdateRequest,
    ConsoleVenueUpdateRequest,
    VenueKind,
)


router = APIRouter()
logger = get_logger(__name__)
VENUE_NAME_LOCK_SQL = (
    "SELECT pg_advisory_xact_lock("
    "hashtext('live-set-list'), hashtext('venue-name-registry'))"
)


def _lookup_pattern(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _write_audit(
    cur: Any,
    *,
    user_id: int,
    action: str,
    venue_id: int,
    payload: dict[str, Any],
) -> None:
    cur.execute(
        """
        INSERT INTO audit_logs (user_id, action, resource_type, resource_id, payload_json)
        VALUES (%s, %s, 'venue', %s, %s)
        """,
        (user_id, action, str(venue_id), Json(payload)),
    )


def _ensure_name_available(
    cur: Any,
    venue_name: str,
    *,
    exclude_version_id: int | None = None,
) -> None:
    params: list[Any] = [venue_name]
    exclude_sql = ""
    if exclude_version_id is not None:
        exclude_sql = " AND version.id <> %s"
        params.append(exclude_version_id)
    cur.execute(
        f"""
        SELECT 1
        FROM venue_name_versions version
        JOIN venue_list venue ON venue.id = version.venue_id
        WHERE lower(btrim(version.venue_name)) = lower(btrim(%s))
          AND venue.merged_into_venue_id IS NULL
          {exclude_sql}
        LIMIT 1
        """,
        tuple(params),
    )
    if cur.fetchone() is not None:
        raise HTTPException(
            status_code=409,
            detail="Venue name already exists in current or historical names",
        )


def _lock_name_registry(cur: Any) -> None:
    cur.execute(VENUE_NAME_LOCK_SQL)


def _lock_active_venue(cur: Any, venue_id: int) -> None:
    cur.execute(
        """
        SELECT merged_into_venue_id
        FROM venue_list
        WHERE id = %s
        FOR UPDATE
        """,
        (venue_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Venue id {venue_id} not found")
    if row[0] is not None:
        raise HTTPException(status_code=409, detail=f"Venue id {venue_id} has already been merged")


def _load_detail(cur: Any, venue_id: int) -> dict[str, Any]:
    cur.execute(
        """
        SELECT
            venue.id,
            current_version.venue_name,
            current_version.id,
            venue.venue_kind,
            venue.merged_into_venue_id,
            COUNT(live.id),
            MIN(live.live_date),
            MAX(live.live_date)
        FROM venue_list venue
        LEFT JOIN venue_name_versions current_version
          ON current_version.venue_id = venue.id
         AND current_version.valid_to IS NULL
        LEFT JOIN live_attrs live ON live.venue_id = venue.id
        WHERE venue.id = %s
        GROUP BY venue.id, current_version.venue_name, current_version.id
        """,
        (venue_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Venue id {venue_id} not found")
    if row[2] is None:
        raise HTTPException(status_code=409, detail=f"Venue id {venue_id} has no current name version")
    cur.execute(
        """
        SELECT
            version.id,
            version.venue_name,
            version.valid_from,
            version.valid_to,
            COUNT(DISTINCT live.id),
            COUNT(DISTINCT history.id)
        FROM venue_name_versions version
        LEFT JOIN live_attrs live ON live.venue_name_version_id = version.id
        LEFT JOIN live_schedule_history history
          ON history.previous_venue_name_version_id = version.id
        WHERE version.venue_id = %s
        GROUP BY version.id
        ORDER BY version.valid_from NULLS FIRST, version.id
        """,
        (venue_id,),
    )
    versions = cur.fetchall()
    return {
        "venue_id": int(row[0]),
        "venue_name": str(row[1]),
        "venue_name_version_id": int(row[2]),
        "venue_kind": str(row[3]),
        "merged_into_venue_id": int(row[4]) if row[4] is not None else None,
        "live_count": int(row[5]),
        "first_live_date": row[6],
        "last_live_date": row[7],
        "name_versions": [
            {
                "venue_name_version_id": int(version[0]),
                "venue_name": str(version[1]),
                "valid_from": version[2],
                "valid_to": version[3],
                "live_count": int(version[4]),
                "schedule_history_count": int(version[5]),
                "is_current": version[3] is None,
            }
            for version in versions
        ],
    }


def _raise_database_error(operation: str, exc: Exception) -> None:
    logger.exception("%s failed", operation)
    if isinstance(exc, QueryCanceled):
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    if isinstance(exc, OperationalError) and "timeout expired" in str(exc).lower():
        raise HTTPException(status_code=504, detail="Database connection timeout") from exc
    raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


@router.get("/venues", response_model=ConsoleVenueListResponse, summary="分页查询 Venue")
def list_venues(
    q: str | None = Query(default=None, max_length=255),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    kind: VenueKind | None = Query(default=None),
    include_merged: bool = Query(default=False),
    _: Any = Depends(require_role("editor")),
):
    query_text = q.strip() if q else ""
    filters = ["(%s OR venue.merged_into_venue_id IS NULL)"]
    params: list[Any] = [include_merged]
    if kind is not None:
        filters.append("venue.venue_kind = %s")
        params.append(kind)
    if query_text:
        filters.append("matched_version.venue_name ILIKE %s ESCAPE '\\'")
        params.append(_lookup_pattern(query_text))
    where_sql = " AND ".join(filters)
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    WITH matched AS (
                        SELECT DISTINCT ON (venue.id)
                            venue.id,
                            current_version.venue_name,
                            current_version.id AS current_version_id,
                            venue.venue_kind,
                            venue.merged_into_venue_id,
                            matched_version.venue_name AS matched_name,
                            matched_version.id AS matched_version_id,
                            matched_version.valid_to IS NULL AS is_current_match
                        FROM venue_list venue
                        JOIN venue_name_versions current_version
                          ON current_version.venue_id = venue.id
                         AND current_version.valid_to IS NULL
                        JOIN venue_name_versions matched_version
                          ON matched_version.venue_id = venue.id
                        WHERE {where_sql}
                        ORDER BY venue.id, is_current_match DESC, matched_version.id DESC
                    ), usage AS (
                        SELECT venue_id, COUNT(*) AS live_count,
                               MIN(live_date) AS first_live_date,
                               MAX(live_date) AS last_live_date
                        FROM live_attrs
                        WHERE venue_id IS NOT NULL
                        GROUP BY venue_id
                    )
                    SELECT matched.*, COALESCE(usage.live_count, 0),
                           usage.first_live_date, usage.last_live_date,
                           COUNT(*) OVER()
                    FROM matched
                    LEFT JOIN usage ON usage.venue_id = matched.id
                    ORDER BY matched.venue_name, matched.id
                    LIMIT %s OFFSET %s
                    """,
                    (*params, limit, (page - 1) * limit),
                )
                rows = cur.fetchall()
    except (QueryCanceled, OperationalError, Error) as exc:
        _raise_database_error("list_venues", exc)
    total = int(rows[0][11]) if rows else 0
    total_pages = max(1, math.ceil(total / limit))
    return {
        "items": [
            {
                "venue_id": int(row[0]),
                "venue_name": str(row[1]),
                "venue_name_version_id": int(row[2]),
                "venue_kind": str(row[3]),
                "merged_into_venue_id": int(row[4]) if row[4] is not None else None,
                "matched_name": str(row[5]),
                "matched_name_version_id": int(row[6]),
                "match_kind": "current" if row[7] else "historical",
                "live_count": int(row[8]),
                "first_live_date": row[9],
                "last_live_date": row[10],
            }
            for row in rows
        ],
        "page": page,
        "page_size": limit,
        "total": total,
        "total_pages": total_pages,
    }


@router.get("/venues/{venue_id}", response_model=ConsoleVenueDetailResponse, summary="查询 Venue 详情")
def get_venue(venue_id: int = Path(..., ge=1), _: Any = Depends(require_role("editor"))):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                return _load_detail(cur, venue_id)
    except HTTPException:
        raise
    except (QueryCanceled, OperationalError, Error) as exc:
        _raise_database_error("get_venue", exc)


@router.get("/venues/{venue_id}/lives", response_model=ConsoleVenueLivesResponse, summary="查询 Venue 关联 Live")
def list_venue_lives(
    venue_id: int = Path(..., ge=1),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    _: Any = Depends(require_role("editor")),
):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM venue_list WHERE id = %s", (venue_id,))
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail=f"Venue id {venue_id} not found")
                cur.execute("SELECT COUNT(*) FROM live_attrs WHERE venue_id = %s", (venue_id,))
                total = int(cur.fetchone()[0])
                cur.execute(
                    """
                    SELECT live.id, live.live_date, live.live_title,
                           COALESCE(version.venue_name, venue.venue)
                    FROM live_attrs live
                    JOIN venue_list venue ON venue.id = live.venue_id
                    LEFT JOIN venue_name_versions version ON version.id = live.venue_name_version_id
                    WHERE live.venue_id = %s
                    ORDER BY live.live_date DESC, live.id DESC
                    LIMIT %s OFFSET %s
                    """,
                    (venue_id, limit, (page - 1) * limit),
                )
                rows = cur.fetchall()
    except HTTPException:
        raise
    except (QueryCanceled, OperationalError, Error) as exc:
        _raise_database_error("list_venue_lives", exc)
    return {
        "items": [
            {"live_id": int(row[0]), "live_date": row[1], "live_title": str(row[2]), "venue_name": str(row[3])}
            for row in rows
        ],
        "page": page,
        "page_size": limit,
        "total": total,
        "total_pages": max(1, math.ceil(total / limit)),
    }


@router.post("/venues", response_model=ConsoleVenueMutationResponse, status_code=201, summary="新增 Venue")
def create_venue(
    payload: ConsoleVenueCreateRequest,
    request: Request,
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                _lock_name_registry(cur)
                _ensure_name_available(cur, payload.venue_name)
                cur.execute(
                    "INSERT INTO venue_list (venue, venue_kind) VALUES (%s, %s) RETURNING id",
                    (payload.venue_name, payload.venue_kind),
                )
                venue_id = int(cur.fetchone()[0])
                cur.execute(
                    """
                    INSERT INTO venue_name_versions (venue_id, venue_name)
                    VALUES (%s, %s)
                    RETURNING id
                    """,
                    (venue_id, payload.venue_name),
                )
                version_id = int(cur.fetchone()[0])
                _write_audit(
                    cur,
                    user_id=context.user.id,
                    action="venue_create",
                    venue_id=venue_id,
                    payload={"venue_name": payload.venue_name, "venue_kind": payload.venue_kind, "venue_name_version_id": version_id},
                )
    except HTTPException:
        raise
    except UniqueViolation as exc:
        raise HTTPException(status_code=409, detail="Venue name or version conflict") from exc
    except (QueryCanceled, OperationalError, Error) as exc:
        _raise_database_error("create_venue", exc)
    return {
        "ok": True,
        "item": {
            "venue_id": venue_id,
            "venue_name": payload.venue_name,
            "venue_name_version_id": version_id,
            "venue_kind": payload.venue_kind,
        },
    }


@router.patch("/venues/{venue_id}", response_model=ConsoleVenueDetailResponse, summary="修改 Venue 类型")
def update_venue(
    payload: ConsoleVenueUpdateRequest,
    request: Request,
    venue_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                _lock_active_venue(cur, venue_id)
                cur.execute("UPDATE venue_list SET venue_kind = %s WHERE id = %s", (payload.venue_kind, venue_id))
                _write_audit(cur, user_id=context.user.id, action="venue_update", venue_id=venue_id, payload={"venue_kind": payload.venue_kind})
                return _load_detail(cur, venue_id)
    except HTTPException:
        raise
    except (QueryCanceled, OperationalError, Error) as exc:
        _raise_database_error("update_venue", exc)


@router.post("/venues/{venue_id}/name-versions", response_model=ConsoleVenueDetailResponse, status_code=201, summary="记录 Venue 正式更名")
def create_venue_name_version(
    payload: ConsoleVenueNameVersionCreateRequest,
    request: Request,
    venue_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                _lock_active_venue(cur, venue_id)
                _lock_name_registry(cur)
                _ensure_name_available(cur, payload.venue_name)
                cur.execute(
                    "SELECT id, valid_from FROM venue_name_versions WHERE venue_id = %s AND valid_to IS NULL FOR UPDATE",
                    (venue_id,),
                )
                rows = cur.fetchall()
                if len(rows) != 1:
                    raise HTTPException(status_code=409, detail="Venue must have exactly one current name version")
                if rows[0][1] is not None and payload.valid_from <= rows[0][1]:
                    raise HTTPException(status_code=409, detail="New name valid_from must be later than the current version")
                old_version_id = int(rows[0][0])
                cur.execute("UPDATE venue_name_versions SET valid_to = %s WHERE id = %s", (payload.valid_from, old_version_id))
                cur.execute(
                    "INSERT INTO venue_name_versions (venue_id, venue_name, valid_from) VALUES (%s, %s, %s) RETURNING id",
                    (venue_id, payload.venue_name, payload.valid_from),
                )
                new_version_id = int(cur.fetchone()[0])
                cur.execute("UPDATE venue_list SET venue = %s WHERE id = %s", (payload.venue_name, venue_id))
                _write_audit(
                    cur,
                    user_id=context.user.id,
                    action="venue_name_version_create",
                    venue_id=venue_id,
                    payload={"closed_version_id": old_version_id, "new_version_id": new_version_id, "venue_name": payload.venue_name, "valid_from": payload.valid_from.isoformat()},
                )
                return _load_detail(cur, venue_id)
    except HTTPException:
        raise
    except (QueryCanceled, OperationalError, Error) as exc:
        _raise_database_error("create_venue_name_version", exc)


@router.patch("/venues/{venue_id}/name-versions/{version_id}", response_model=ConsoleVenueDetailResponse, summary="修正 Venue 名称版本文本")
def update_venue_name_version(
    payload: ConsoleVenueNameVersionUpdateRequest,
    request: Request,
    venue_id: int = Path(..., ge=1),
    version_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                _lock_active_venue(cur, venue_id)
                _lock_name_registry(cur)
                _ensure_name_available(cur, payload.venue_name, exclude_version_id=version_id)
                cur.execute(
                    "SELECT venue_name, valid_to FROM venue_name_versions WHERE id = %s AND venue_id = %s FOR UPDATE",
                    (version_id, venue_id),
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(status_code=404, detail=f"Venue name version id {version_id} not found")
                cur.execute("UPDATE venue_name_versions SET venue_name = %s WHERE id = %s", (payload.venue_name, version_id))
                if row[1] is None:
                    cur.execute("UPDATE venue_list SET venue = %s WHERE id = %s", (payload.venue_name, venue_id))
                _write_audit(
                    cur,
                    user_id=context.user.id,
                    action="venue_name_version_update",
                    venue_id=venue_id,
                    payload={"venue_name_version_id": version_id, "before": str(row[0]), "after": payload.venue_name},
                )
                return _load_detail(cur, venue_id)
    except HTTPException:
        raise
    except (QueryCanceled, OperationalError, Error) as exc:
        _raise_database_error("update_venue_name_version", exc)


@router.get("/venues/{source_venue_id}/merge-preview", response_model=ConsoleVenueMergePreviewResponse, summary="预览 Venue 合并")
def preview_venue_merge(
    source_venue_id: int = Path(..., ge=1),
    target_venue_id: int = Query(..., ge=1),
    _: Any = Depends(require_role("admin")),
):
    if source_venue_id == target_venue_id:
        raise HTTPException(status_code=409, detail="Source and target Venue must differ")
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                source = _load_detail(cur, source_venue_id)
                target = _load_detail(cur, target_venue_id)
    except HTTPException:
        raise
    except (QueryCanceled, OperationalError, Error) as exc:
        _raise_database_error("preview_venue_merge", exc)
    if source["merged_into_venue_id"] is not None or target["merged_into_venue_id"] is not None:
        raise HTTPException(status_code=409, detail="Merged Venue cannot be used as merge source or target")
    return {
        "source": source,
        "target": target,
        "required_source_version_ids": [int(version["venue_name_version_id"]) for version in source["name_versions"]],
    }


@router.post("/venues/{source_venue_id}/merge", response_model=ConsoleVenueDetailResponse, summary="执行 Venue 合并")
def merge_venue(
    payload: ConsoleVenueMergeRequest,
    request: Request,
    source_venue_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("admin")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    if source_venue_id == payload.target_venue_id:
        raise HTTPException(status_code=409, detail="Source and target Venue must differ")
    mapping = {item.source_version_id: item.target_version_id for item in payload.version_mappings}
    if len(mapping) != len(payload.version_mappings):
        raise HTTPException(status_code=409, detail="Duplicate source version mapping")
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                for venue_id in sorted((source_venue_id, payload.target_venue_id)):
                    _lock_active_venue(cur, venue_id)
                cur.execute("SELECT id FROM venue_name_versions WHERE venue_id = %s ORDER BY id", (source_venue_id,))
                source_version_ids = [int(row[0]) for row in cur.fetchall()]
                if set(mapping) != set(source_version_ids):
                    raise HTTPException(status_code=409, detail="Every source name version must have exactly one mapping")
                cur.execute("SELECT id FROM venue_name_versions WHERE venue_id = %s", (payload.target_venue_id,))
                target_version_ids = {int(row[0]) for row in cur.fetchall()}
                if not set(mapping.values()).issubset(target_version_ids):
                    raise HTTPException(status_code=409, detail="Every mapped target version must belong to the target Venue")
                live_count = 0
                history_count = 0
                for source_version_id, target_version_id in mapping.items():
                    cur.execute(
                        "UPDATE live_attrs SET venue_id = %s, venue_name_version_id = %s WHERE venue_id = %s AND venue_name_version_id = %s",
                        (payload.target_venue_id, target_version_id, source_venue_id, source_version_id),
                    )
                    live_count += cur.rowcount
                    cur.execute(
                        "UPDATE live_schedule_history SET previous_venue_id = %s, previous_venue_name_version_id = %s WHERE previous_venue_id = %s AND previous_venue_name_version_id = %s",
                        (payload.target_venue_id, target_version_id, source_venue_id, source_version_id),
                    )
                    history_count += cur.rowcount
                cur.execute("SELECT COUNT(*) FROM live_attrs WHERE venue_id = %s", (source_venue_id,))
                if int(cur.fetchone()[0]) != 0:
                    raise HTTPException(status_code=409, detail="Source Venue contains Live rows without a mapped name version")
                cur.execute("SELECT COUNT(*) FROM live_schedule_history WHERE previous_venue_id = %s", (source_venue_id,))
                if int(cur.fetchone()[0]) != 0:
                    raise HTTPException(status_code=409, detail="Source Venue contains schedule history rows without a mapped name version")
                cur.execute("UPDATE venue_list SET merged_into_venue_id = %s WHERE id = %s", (payload.target_venue_id, source_venue_id))
                _write_audit(
                    cur,
                    user_id=context.user.id,
                    action="venue_merge",
                    venue_id=source_venue_id,
                    payload={"target_venue_id": payload.target_venue_id, "version_mappings": mapping, "live_count": live_count, "schedule_history_count": history_count},
                )
                return _load_detail(cur, payload.target_venue_id)
    except HTTPException:
        raise
    except (QueryCanceled, OperationalError, Error) as exc:
        _raise_database_error("merge_venue", exc)
