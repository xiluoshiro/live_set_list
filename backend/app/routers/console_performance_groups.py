from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled, UniqueViolation

from app.auth import AuthSessionContext, assert_valid_csrf, get_current_auth_context, require_role
from app.db import get_db_connection, get_write_db_connection
from app.logging_config import get_logger
from app.routers.console_write import _write_console_audit_log
from app.schemas import ErrorResponse, ValidationErrorResponse
from app.schemas.auth import AuthErrorResponse
from app.schemas.console import (
    ConsolePerformanceGroupEditResponse,
    ConsolePerformanceGroupListResponse,
    ConsolePerformanceGroupLiveCandidatesResponse,
    ConsolePerformanceGroupMutationResponse,
    ConsolePerformanceGroupUpsertRequest,
)

router = APIRouter()
logger = get_logger(__name__)


def _not_found_ids(cur: Any, table: str, ids: list[int]) -> list[int]:
    """Return missing IDs for one allow-listed lookup table."""
    if table not in {"live_attrs"}:
        raise ValueError(f"Unsupported lookup table: {table}")
    cur.execute(f"SELECT id FROM {table} WHERE id = ANY(%s) ORDER BY id", (ids,))
    existing = {int(row[0]) for row in cur.fetchall()}
    return [item_id for item_id in ids if item_id not in existing]


def _raise_missing(resource: str, missing_ids: list[int]) -> None:
    """Raise one stable 404 message for missing relation targets."""
    if missing_ids:
        missing_text = ", ".join(str(item_id) for item_id in missing_ids)
        raise HTTPException(status_code=404, detail=f"{resource} ids not found: {missing_text}")


def _validate_performance_group_relations(
    cur: Any,
    payload: ConsolePerformanceGroupUpsertRequest,
    current_group_id: int | None,
) -> list[int]:
    """Validate relations and return Live IDs in canonical date/start_time/ID order."""
    _raise_missing("Live", _not_found_ids(cur, table="live_attrs", ids=payload.live_ids))

    cur.execute(
        """
        SELECT pgl.live_id, pgl.group_id, pga.group_title
        FROM performance_group_lives pgl
        JOIN performance_group_attrs pga ON pga.id = pgl.group_id
        WHERE pgl.live_id = ANY(%s)
          AND (%s IS NULL OR pgl.group_id <> %s)
        ORDER BY pgl.live_id
        """,
        (payload.live_ids, current_group_id, current_group_id),
    )
    conflict_rows = cur.fetchall()
    if conflict_rows:
        conflicts = [
            {"live_id": int(row[0]), "group_id": int(row[1]), "group_title": str(row[2])}
            for row in conflict_rows
        ]
        conflict_ids = ", ".join(str(item["live_id"]) for item in conflicts)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "PERFORMANCE_GROUP_LIVE_CONFLICT",
                "message": f"Live already belongs to another performance group: {conflict_ids}",
                "conflicts": conflicts,
            },
        )

    cur.execute(
        """
        SELECT l.id
        FROM live_attrs l
        WHERE l.id = ANY(%s)
        ORDER BY l.live_date ASC, l.start_time ASC, l.id ASC
        """,
        (payload.live_ids,),
    )
    return [int(row[0]) for row in cur.fetchall()]


def _insert_performance_group_relations(
    cur: Any,
    group_id: int,
    ordered_live_ids: list[int],
) -> None:
    """Insert group-live relations; sort order comes from the canonical query."""
    for live_id in ordered_live_ids:
        cur.execute(
            "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, %s)",
            (group_id, live_id),
        )


def _mutation_response(group_id: int, payload: ConsolePerformanceGroupUpsertRequest) -> dict[str, Any]:
    return {
        "ok": True,
        "item": {
            "group_id": group_id,
            "group_title": payload.group_title,
            "live_count": len(payload.live_ids),
        },
    }


def _handle_performance_group_db_error(exc: Exception, *, action: str, user_id: int) -> None:
    if isinstance(exc, QueryCanceled):
        logger.exception("%s timeout user_id=%s", action, user_id)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    if isinstance(exc, OperationalError):
        logger.exception("%s operational error user_id=%s", action, user_id)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    if isinstance(exc, UniqueViolation):
        logger.exception("%s unique conflict user_id=%s", action, user_id)
        raise HTTPException(status_code=409, detail="Performance group relation conflict; reload and retry") from exc
    logger.exception("%s failed user_id=%s", action, user_id)
    raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


PERFORMANCE_GROUP_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": AuthErrorResponse, "description": "未登录或 session 已失效"},
    403: {"model": AuthErrorResponse, "description": "缺少权限或 CSRF 校验失败"},
    404: {"model": ErrorResponse, "description": "Group 或 Live 不存在"},
    409: {"model": ErrorResponse, "description": "Live 已属于其他 Performance Group"},
    422: {"model": ValidationErrorResponse, "description": "请求体验证失败"},
    500: {"model": ErrorResponse, "description": "数据库一般错误"},
    504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
}


@router.get(
    "/performance-groups",
    response_model=ConsolePerformanceGroupListResponse,
    summary="查询可编辑活动组",
    description="返回全部活动组，供 `editor+` 控制台选择现有活动组。",
)
def get_console_performance_groups(
    _: Any = Depends(require_role("editor")),
):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, group_title
                    FROM performance_group_attrs
                    ORDER BY group_title ASC, id ASC
                    """
                )
                rows = cur.fetchall()
    except QueryCanceled as exc:
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    return {
        "items": [
            {"group_id": int(row[0]), "group_title": str(row[1])}
            for row in rows
        ]
    }


@router.get(
    "/performance-groups/live-candidates",
    response_model=ConsolePerformanceGroupLiveCandidatesResponse,
    summary="查询活动组场次候选",
    description="`editor+` 用户按标题或 ID 搜索尚未关联任何活动组的 Live。",
)
def get_performance_group_live_candidates(
    q: str | None = Query(default=None, max_length=255),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=500),
    _: Any = Depends(require_role("editor")),
):
    normalized_query = q.strip() if q is not None else ""
    conditions = ["NOT EXISTS (SELECT 1 FROM performance_group_lives occupied WHERE occupied.live_id = l.id)"]
    params: list[Any] = []
    if normalized_query:
        conditions.append("(l.live_title ILIKE %s OR CAST(l.id AS text) = %s)")
        params.extend((f"%{normalized_query}%", normalized_query))
    where_sql = f"WHERE {' AND '.join(conditions)}"
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT COUNT(*) FROM live_attrs l {where_sql}", tuple(params))
                total_row = cur.fetchone()
                total = int(total_row[0]) if total_row is not None else 0
                total_pages = max(1, (total + page_size - 1) // page_size)
                safe_page = min(page, total_pages)
                cur.execute(
                    f"""
                    SELECT
                        l.id,
                        l.live_date,
                        l.live_title,
                        l.start_time::text,
                        v.venue,
                        COALESCE((
                            SELECT array_agg(effective.band_id ORDER BY effective.band_id)
                            FROM effective_live_bands effective
                            WHERE effective.live_id = l.id
                        ), ARRAY[]::int[]) AS band_ids
                    FROM live_attrs l
                    LEFT JOIN venue_list v ON v.id = l.venue_id
                    {where_sql}
                    ORDER BY l.live_date DESC, l.start_time DESC, l.id DESC
                    LIMIT %s OFFSET %s
                    """,
                    (*params, page_size, (safe_page - 1) * page_size),
                )
                rows = cur.fetchall()
    except QueryCanceled as exc:
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    return {
        "items": [
            {
                "live_id": int(row[0]),
                "live_date": row[1],
                "live_title": str(row[2]),
                "start_time": str(row[3]),
                "venue": row[4],
                "band_ids": list(row[5] or []),
            }
            for row in rows
        ],
        "page": safe_page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }


@router.get(
    "/performance-groups/{group_id}",
    response_model=ConsolePerformanceGroupEditResponse,
    summary="获取活动组编辑数据",
    description="返回活动组标题和按日期、开演时间、ID 排序的完整场次，供 `editor+` 控制台编辑。",
)
def get_console_performance_group(
    group_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT group_title FROM performance_group_attrs WHERE id = %s", (group_id,))
                header = cur.fetchone()
                if header is None:
                    raise HTTPException(status_code=404, detail=f"Performance group id {group_id} not found")
                cur.execute(
                    """
                    SELECT
                        l.id,
                        l.live_date,
                        l.live_title,
                        to_jsonb(l) ->> 'start_time' AS start_time,
                        v.venue,
                        COALESCE((
                            SELECT array_agg(effective.band_id ORDER BY effective.band_id)
                            FROM effective_live_bands effective
                            WHERE effective.live_id = l.id
                        ), ARRAY[]::int[]) AS band_ids
                    FROM performance_group_lives pgl
                    JOIN live_attrs l ON l.id = pgl.live_id
                    LEFT JOIN venue_list v ON v.id = l.venue_id
                    WHERE pgl.group_id = %s
                    ORDER BY l.live_date ASC, l.start_time ASC, l.id ASC
                    """,
                    (group_id,),
                )
                live_rows = cur.fetchall()
    except HTTPException:
        raise
    except QueryCanceled as exc:
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    return {
        "group_id": group_id,
        "group_title": str(header[0]),
        "lives": [
            {
                "live_id": int(row[0]),
                "live_date": row[1],
                "live_title": str(row[2]),
                "start_time": row[3],
                "venue": row[4],
                "band_ids": list(row[5] or []),
            }
            for row in live_rows
        ],
    }


@router.post(
    "/performance-groups",
    status_code=201,
    response_model=ConsolePerformanceGroupMutationResponse,
    summary="新增活动组",
    description="`editor+` 用户在一个事务中新增活动组及其完整场次关系。",
    responses=PERFORMANCE_GROUP_RESPONSES,
)
def create_performance_group(
    payload: ConsolePerformanceGroupUpsertRequest,
    request: Request,
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                ordered_live_ids = _validate_performance_group_relations(cur, payload, None)
                cur.execute(
                    """
                    INSERT INTO performance_group_attrs (group_title)
                    VALUES (%s)
                    RETURNING id
                    """,
                    (payload.group_title,),
                )
                created_row = cur.fetchone()
                assert created_row is not None
                group_id = int(created_row[0])
                _insert_performance_group_relations(cur, group_id, ordered_live_ids)
                _write_console_audit_log(
                    cur,
                    user_id=context.user.id,
                    action="performance_group_create",
                    resource_type="performance_group",
                    resource_id=str(group_id),
                    payload_json={
                        "group_title": payload.group_title,
                        "live_count": len(payload.live_ids),
                        "live_ids": ordered_live_ids,
                    },
                )
    except HTTPException:
        raise
    except Error as exc:
        _handle_performance_group_db_error(exc, action="create_performance_group", user_id=context.user.id)
    return _mutation_response(group_id, payload)


@router.put(
    "/performance-groups/{group_id}",
    response_model=ConsolePerformanceGroupMutationResponse,
    summary="更新活动组",
    description="`editor+` 用户以完整目标集合替换活动组的场次关系。",
    responses=PERFORMANCE_GROUP_RESPONSES,
)
def update_performance_group(
    payload: ConsolePerformanceGroupUpsertRequest,
    request: Request,
    group_id: int = Path(..., ge=1, description="Target group ID"),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT group_title FROM performance_group_attrs WHERE id = %s FOR UPDATE", (group_id,))
                existing = cur.fetchone()
                if existing is None:
                    raise HTTPException(status_code=404, detail=f"Performance group id {group_id} not found")
                cur.execute(
                    "SELECT COUNT(*) FROM performance_group_lives WHERE group_id = %s",
                    (group_id,),
                )
                count_row = cur.fetchone()
                assert count_row is not None
                previous_live_count = int(count_row[0])
                ordered_live_ids = _validate_performance_group_relations(cur, payload, group_id)
                cur.execute(
                    "UPDATE performance_group_attrs SET group_title = %s WHERE id = %s",
                    (payload.group_title, group_id),
                )
                cur.execute("DELETE FROM performance_group_lives WHERE group_id = %s", (group_id,))
                _insert_performance_group_relations(cur, group_id, ordered_live_ids)
                _write_console_audit_log(
                    cur,
                    user_id=context.user.id,
                    action="performance_group_update",
                    resource_type="performance_group",
                    resource_id=str(group_id),
                    payload_json={
                        "group_title": payload.group_title,
                        "previous_live_count": previous_live_count,
                        "live_count": len(payload.live_ids),
                        "live_ids": ordered_live_ids,
                    },
                )
    except HTTPException:
        raise
    except Error as exc:
        _handle_performance_group_db_error(exc, action="update_performance_group", user_id=context.user.id)
    return _mutation_response(group_id, payload)
