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
    ConsoleTourEditResponse,
    ConsoleTourLiveCandidatesResponse,
    ConsoleTourMutationResponse,
    ConsoleTourUpsertRequest,
)

router = APIRouter()
logger = get_logger(__name__)


def _not_found_ids(cur: Any, *, table: str, ids: list[int]) -> list[int]:
    """Return missing IDs for one allow-listed lookup table."""
    if table not in {"band_attrs", "live_attrs"}:
        raise ValueError(f"Unsupported lookup table: {table}")
    cur.execute(f"SELECT id FROM {table} WHERE id = ANY(%s) ORDER BY id", (ids,))
    existing = {int(row[0]) for row in cur.fetchall()}
    return [item_id for item_id in ids if item_id not in existing]


def _raise_missing(resource: str, missing_ids: list[int]) -> None:
    """Raise one stable 404 message for missing relation targets."""
    if missing_ids:
        missing_text = ", ".join(str(item_id) for item_id in missing_ids)
        raise HTTPException(status_code=404, detail=f"{resource} ids not found: {missing_text}")


def _validate_tour_relations(
    cur: Any,
    payload: ConsoleTourUpsertRequest,
    current_tour_id: int | None,
) -> list[int]:
    """Validate relations and return Live IDs in canonical date/ID order."""
    live_ids = [stop.live_id for stop in payload.stops]
    _raise_missing("Band", _not_found_ids(cur, table="band_attrs", ids=payload.band_ids))
    _raise_missing("Live", _not_found_ids(cur, table="live_attrs", ids=live_ids))

    cur.execute(
        """
        SELECT tl.live_id, tl.tour_id, ta.tour_title
        FROM tour_lives tl
        JOIN tour_attrs ta ON ta.id = tl.tour_id
        WHERE tl.live_id = ANY(%s)
          AND (%s IS NULL OR tl.tour_id <> %s)
        ORDER BY tl.live_id
        """,
        (live_ids, current_tour_id, current_tour_id),
    )
    conflict_rows = cur.fetchall()
    if conflict_rows:
        conflicts = [
            {"live_id": int(row[0]), "tour_id": int(row[1]), "tour_title": str(row[2])}
            for row in conflict_rows
        ]
        conflict_ids = ", ".join(str(item["live_id"]) for item in conflicts)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "TOUR_LIVE_CONFLICT",
                "message": f"Live already belongs to another tour: {conflict_ids}",
                "conflicts": conflicts,
            },
        )

    cur.execute(
        """
        SELECT
            l.id,
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
            END AS band_ids
        FROM live_attrs l
        WHERE l.id = ANY(%s)
        ORDER BY l.live_date, l.id
        """,
        (live_ids,),
    )
    ordered_rows = cur.fetchall()
    if payload.band_ids:
        effective_band_ids = {
            int(band_id)
            for row in ordered_rows
            for band_id in list(row[1] or [])
        }
        missing_performer_ids = [band_id for band_id in payload.band_ids if band_id not in effective_band_ids]
        if missing_performer_ids:
            missing_text = ", ".join(str(band_id) for band_id in missing_performer_ids)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Tour band ids are not present in any selected Live: {missing_text}",
            )
    return [int(row[0]) for row in ordered_rows]


def _insert_tour_relations(
    cur: Any,
    tour_id: int,
    payload: ConsoleTourUpsertRequest,
    ordered_live_ids: list[int],
) -> None:
    """Insert bands by ID and stops by canonical Live date/ID order."""
    for display_order, band_id in enumerate(payload.band_ids, start=1):
        cur.execute(
            "INSERT INTO tour_bands (tour_id, band_id, display_order) VALUES (%s, %s, %s)",
            (tour_id, band_id, display_order),
        )
    labels_by_live_id = {stop.live_id: stop.stop_label for stop in payload.stops}
    for stop_order, live_id in enumerate(ordered_live_ids, start=1):
        cur.execute(
            "INSERT INTO tour_lives (tour_id, live_id, stop_order, stop_label) VALUES (%s, %s, %s, %s)",
            (tour_id, live_id, stop_order, labels_by_live_id[live_id]),
        )


def _mutation_response(tour_id: int, payload: ConsoleTourUpsertRequest) -> dict[str, Any]:
    return {
        "ok": True,
        "item": {
            "tour_id": tour_id,
            "tour_title": payload.tour_title,
            "band_count": len(payload.band_ids),
            "stop_count": len(payload.stops),
        },
    }


def _handle_tour_db_error(exc: Exception, *, action: str, user_id: int) -> None:
    """Translate database failures while keeping credentials and request tokens out of logs."""
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
        raise HTTPException(status_code=409, detail="Tour relation conflict; reload and retry") from exc
    logger.exception("%s failed user_id=%s", action, user_id)
    raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


TOUR_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": AuthErrorResponse, "description": "未登录或 session 已失效"},
    403: {"model": AuthErrorResponse, "description": "缺少权限或 CSRF 校验失败"},
    404: {"model": ErrorResponse, "description": "Tour、Band 或 Live 不存在"},
    409: {"model": ErrorResponse, "description": "Live 已属于其他 Tour"},
    422: {"model": ValidationErrorResponse, "description": "请求体验证失败"},
    500: {"model": ErrorResponse, "description": "数据库一般错误"},
    504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
}


@router.get(
    "/tours/live-candidates",
    response_model=ConsoleTourLiveCandidatesResponse,
    summary="查询巡演场次候选",
    description="`editor+` 用户按标题或 ID 搜索尚未关联任何巡演的 Live。",
)
def get_tour_live_candidates(
    q: str | None = Query(default=None, max_length=255),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=500),
    _: Any = Depends(require_role("editor")),
):
    normalized_query = q.strip() if q is not None else ""
    conditions = ["NOT EXISTS (SELECT 1 FROM tour_lives occupied WHERE occupied.live_id = l.id)"]
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
                        v.venue,
                        NULL::integer AS tour_id,
                        NULL::text AS tour_title,
                        CASE
                            WHEN EXISTS (SELECT 1 FROM live_setlist any_setlist WHERE any_setlist.live_id = l.id)
                            THEN COALESCE(
                                (
                                    SELECT array_agg(DISTINCT ba.id ORDER BY ba.id)
                                    FROM live_setlist candidate_setlist
                                    JOIN LATERAL jsonb_object_keys(candidate_setlist.band_member) k(band_name)
                                        ON jsonb_typeof(candidate_setlist.band_member) = 'object'
                                    JOIN band_attrs ba ON ba.band_name = k.band_name
                                    WHERE candidate_setlist.live_id = l.id
                                ),
                                ARRAY[]::int[]
                            )
                            ELSE l.default_band_ids
                        END AS band_ids
                    FROM live_attrs l
                    LEFT JOIN venue_list v ON v.id = l.venue_id
                    {where_sql}
                    ORDER BY l.live_date DESC, l.id DESC
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
                "venue": row[3],
                "tour_id": int(row[4]) if row[4] is not None else None,
                "tour_title": str(row[5]) if row[5] is not None else None,
                "band_ids": list(row[6] or []),
            }
            for row in rows
        ],
        "page": safe_page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }


@router.get(
    "/tours/{tour_id}",
    response_model=ConsoleTourEditResponse,
    summary="获取巡演编辑数据",
    description="返回显式乐队选择和按日期排序的完整场次，供 `editor+` 控制台编辑。",
)
def get_console_tour(
    tour_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT tour_title FROM tour_attrs WHERE id = %s", (tour_id,))
                header = cur.fetchone()
                if header is None:
                    raise HTTPException(status_code=404, detail=f"Tour id {tour_id} not found")
                cur.execute("SELECT band_id FROM tour_bands WHERE tour_id = %s ORDER BY band_id", (tour_id,))
                explicit_band_ids = [int(row[0]) for row in cur.fetchall()]
                cur.execute(
                    """
                    SELECT
                        l.id,
                        l.live_date,
                        l.live_title,
                        v.venue,
                        tl.stop_label,
                        CASE
                            WHEN EXISTS (SELECT 1 FROM live_setlist any_setlist WHERE any_setlist.live_id = l.id)
                            THEN COALESCE(
                                (
                                    SELECT array_agg(DISTINCT ba.id ORDER BY ba.id)
                                    FROM live_setlist edit_setlist
                                    JOIN LATERAL jsonb_object_keys(edit_setlist.band_member) k(band_name)
                                        ON jsonb_typeof(edit_setlist.band_member) = 'object'
                                    JOIN band_attrs ba ON ba.band_name = k.band_name
                                    WHERE edit_setlist.live_id = l.id
                                ),
                                ARRAY[]::int[]
                            )
                            ELSE l.default_band_ids
                        END AS band_ids
                    FROM tour_lives tl
                    JOIN live_attrs l ON l.id = tl.live_id
                    LEFT JOIN venue_list v ON v.id = l.venue_id
                    WHERE tl.tour_id = %s
                    ORDER BY l.live_date, l.id
                    """,
                    (tour_id,),
                )
                stop_rows = cur.fetchall()
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
        "tour_id": tour_id,
        "tour_title": str(header[0]),
        "band_ids": explicit_band_ids,
        "stops": [
            {
                "live_id": int(row[0]),
                "live_date": row[1],
                "live_title": str(row[2]),
                "venue": row[3],
                "stop_label": row[4],
                "band_ids": list(row[5] or []),
            }
            for row in stop_rows
        ],
    }


@router.post(
    "/tours",
    status_code=201,
    response_model=ConsoleTourMutationResponse,
    summary="新增巡演",
    description="`editor+` 用户在一个事务中新增巡演及其完整乐队、场次关系。",
    responses=TOUR_RESPONSES,
)
def create_tour(
    payload: ConsoleTourUpsertRequest,
    request: Request,
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                ordered_live_ids = _validate_tour_relations(cur, payload, None)
                cur.execute(
                    """
                    INSERT INTO tour_attrs (tour_title)
                    VALUES (%s)
                    RETURNING id
                    """,
                    (payload.tour_title,),
                )
                created_row = cur.fetchone()
                assert created_row is not None
                tour_id = int(created_row[0])
                _insert_tour_relations(cur, tour_id, payload, ordered_live_ids)
                _write_console_audit_log(
                    cur,
                    user_id=context.user.id,
                    action="tour_create",
                    resource_type="tour",
                    resource_id=str(tour_id),
                    payload_json={
                        "tour_title": payload.tour_title,
                        "band_count": len(payload.band_ids),
                        "stop_count": len(payload.stops),
                        "live_ids": [stop.live_id for stop in payload.stops],
                    },
                )
    except HTTPException:
        raise
    except Error as exc:
        _handle_tour_db_error(exc, action="create_tour", user_id=context.user.id)
    return _mutation_response(tour_id, payload)


@router.put(
    "/tours/{tour_id}",
    response_model=ConsoleTourMutationResponse,
    summary="更新巡演",
    description="`editor+` 用户以完整目标集合替换巡演的乐队和场次关系。",
    responses=TOUR_RESPONSES,
)
def update_tour(
    payload: ConsoleTourUpsertRequest,
    request: Request,
    tour_id: int = Path(..., ge=1, description="Target tour ID"),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT tour_title FROM tour_attrs WHERE id = %s FOR UPDATE", (tour_id,))
                existing = cur.fetchone()
                if existing is None:
                    raise HTTPException(status_code=404, detail=f"Tour id {tour_id} not found")
                cur.execute(
                    """
                    SELECT
                        (SELECT COUNT(*) FROM tour_bands WHERE tour_id = %s),
                        (SELECT COUNT(*) FROM tour_lives WHERE tour_id = %s)
                    """,
                    (tour_id, tour_id),
                )
                count_row = cur.fetchone()
                assert count_row is not None
                previous_band_count, previous_stop_count = int(count_row[0]), int(count_row[1])
                ordered_live_ids = _validate_tour_relations(cur, payload, tour_id)
                cur.execute(
                    "UPDATE tour_attrs SET tour_title = %s, url = NULL, description = NULL WHERE id = %s",
                    (payload.tour_title, tour_id),
                )
                cur.execute("DELETE FROM tour_bands WHERE tour_id = %s", (tour_id,))
                cur.execute("DELETE FROM tour_lives WHERE tour_id = %s", (tour_id,))
                _insert_tour_relations(cur, tour_id, payload, ordered_live_ids)
                _write_console_audit_log(
                    cur,
                    user_id=context.user.id,
                    action="tour_update",
                    resource_type="tour",
                    resource_id=str(tour_id),
                    payload_json={
                        "tour_title": payload.tour_title,
                        "previous_band_count": previous_band_count,
                        "band_count": len(payload.band_ids),
                        "previous_stop_count": previous_stop_count,
                        "stop_count": len(payload.stops),
                        "live_ids": [stop.live_id for stop in payload.stops],
                    },
                )
    except HTTPException:
        raise
    except Error as exc:
        _handle_tour_db_error(exc, action="update_tour", user_id=context.user.id)
    return _mutation_response(tour_id, payload)
