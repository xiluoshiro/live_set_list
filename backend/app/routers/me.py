from math import ceil
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response, status
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled
from psycopg2.extras import Json

from app.auth import AuthSessionContext, AuthUser, assert_valid_csrf, get_current_auth_context, get_current_user
from app.db import get_db_connection, get_user_write_db_connection
from app.favorites import apply_favorites_batch, get_live_event_status, live_exists
from app.live_list_filters import (
    LiveListFilters,
    build_filtered_live_queries,
    effective_band_ids_sql,
    normalize_list_query,
)
from app.live_status import build_public_live_status
from app.logging_config import get_logger
from app.routers.lives import ALLOWED_PAGE_SIZE
from app.schemas import ErrorResponse, LivesResponse
from app.schemas.auth import AuthErrorResponse
from app.schemas.favorites import FavoriteBatchRequest, FavoriteBatchResponse
from app.tour_refs import build_tour_ref_from_row
from app.performance_group_refs import build_performance_group_ref_from_row


router = APIRouter(prefix="/api/me", tags=["me"])
logger = get_logger(__name__)

FAVORITE_BAND_IDS_SQL = effective_band_ids_sql(live_alias="l", setlist_alias="ls", band_alias="b")

FAVORITE_LIVES_BASE_QUERY = f"""
SELECT
    l.id,
    l.live_date,
    l.live_title,
    {FAVORITE_BAND_IDS_SQL} AS band_ids,
    l.url AS url,
    l.live_type,
    tour.id AS tour_id,
    tour.tour_title,
    pg.id AS performance_group_id,
    pg.group_title,
    l.start_time,
    l.event_status,
    EXISTS (
        SELECT 1 FROM live_schedule_history history
        WHERE history.live_id = l.id
    ) AS was_rescheduled,
    l.timezone_offset_minutes
FROM user_live_favorites f
JOIN live_attrs l
    ON l.id = f.live_id
   AND l.event_status <> 'cancelled'
LEFT JOIN tour_lives tour_live
    ON tour_live.live_id = l.id
LEFT JOIN tour_attrs tour
    ON tour.id = tour_live.tour_id
LEFT JOIN performance_group_lives pgl
    ON pgl.live_id = l.id
LEFT JOIN performance_group_attrs pg
    ON pg.id = pgl.group_id
WHERE f.user_id = %s
GROUP BY l.id, l.live_date, l.live_title, l.live_type, l.url, l.default_band_ids,
         l.start_time, l.event_status, l.timezone_offset_minutes, tour.id, tour.tour_title, pg.id, pg.group_title
"""

FAVORITE_LIVES_COUNT_QUERY = f"""
SELECT COUNT(*) FROM (
    {FAVORITE_LIVES_BASE_QUERY}
) q
"""

FAVORITE_LIVES_PAGE_QUERY = f"""
{FAVORITE_LIVES_BASE_QUERY}
ORDER BY l.live_date DESC, l.id DESC
LIMIT %s OFFSET %s
"""


def _write_favorite_audit_log(cur: Any, *, user_id: int, action: str, live_id: int) -> None:
    cur.execute(
        """
        INSERT INTO audit_logs (user_id, action, resource_type, resource_id)
        VALUES (%s, %s, 'favorite', %s)
        """,
        (user_id, action, str(live_id)),
    )


def _write_favorite_batch_audit_log(
    cur: Any,
    *,
    user_id: int,
    action: str,
    requested_count: int,
    applied_count: int,
    noop_count: int,
    not_found_count: int,
) -> None:
    cur.execute(
        """
        INSERT INTO audit_logs (user_id, action, resource_type, resource_id, payload_json)
        VALUES (%s, %s, 'favorite', %s, %s)
        """,
        (
            user_id,
            action,
            str(requested_count),
            Json(
                {
                    "requested_count": requested_count,
                    "applied_count": applied_count,
                    "noop_count": noop_count,
                    "not_found_count": not_found_count,
                },
            ),
        ),
    )


@router.get(
    "/favorites/lives",
    response_model=LivesResponse,
    summary="获取当前用户收藏的 Live 列表",
    description="分页返回当前登录用户的收藏列表；返回结构与 GET /api/lives 保持一致。",
    responses={
        400: {
            "model": ErrorResponse,
            "description": "参数错误，例如非法 page_size",
        },
        401: {
            "model": AuthErrorResponse,
            "description": "未登录或 session 已失效",
        },
        500: {
            "model": ErrorResponse,
            "description": "数据库一般错误",
        },
        504: {
            "model": ErrorResponse,
            "description": "数据库连接超时或查询超时",
        },
    },
)
def get_my_favorite_lives(
    page: int = Query(default=1, ge=1, description="页码，从 1 开始。"),
    page_size: int = Query(default=20, description="每页条数，当前仅允许 15 或 20。"),
    q: str | None = Query(default=None, max_length=255, description="匹配 Live、乐队、歌曲或场地的关键词。"),
    year: int | None = Query(default=None, ge=1900, le=2100, description="Live 年份。"),
    live_type: Literal["oneman", "taiban", "multi_act", "festival", "event", "other"] | None = Query(
        default=None,
        description="Live 类型。",
    ),
    band_id: int | None = Query(default=None, ge=1, description="包含指定乐队的 Live。"),
    sort: Literal["date_desc", "date_asc"] = Query(default="date_desc", description="按 Live 日期排序。"),
    current_user: AuthUser = Depends(get_current_user),
):
    if page_size not in ALLOWED_PAGE_SIZE:
        raise HTTPException(status_code=400, detail="page_size must be 15 or 20")

    filters = LiveListFilters(
        q=normalize_list_query(q),
        year=year,
        live_type=live_type,
        band_id=band_id,
        sort=sort,
    )

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                if filters.is_default:
                    count_query = FAVORITE_LIVES_COUNT_QUERY
                    count_params: tuple[object, ...] = (current_user.id,)
                    page_query = FAVORITE_LIVES_PAGE_QUERY
                    page_params: tuple[object, ...] = (current_user.id,)
                else:
                    count_query, count_params, page_query, page_params = build_filtered_live_queries(
                        filters,
                        favorite_user_id=current_user.id,
                    )

                cur.execute(count_query, count_params)
                count_row = cur.fetchone()
                total = int(count_row[0]) if count_row else 0

                total_pages = ceil(total / page_size) if total > 0 else 1
                safe_page = min(page, total_pages)
                offset = (safe_page - 1) * page_size

                cur.execute(page_query, (*page_params, page_size, offset))
                rows = cur.fetchall()
    except QueryCanceled as exc:
        logger.exception(
            "get_my_favorite_lives failed user_id=%s page=%s page_size=%s error_type=%s",
            current_user.id,
            page,
            page_size,
            type(exc).__name__,
        )
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception(
            "get_my_favorite_lives failed user_id=%s page=%s page_size=%s error_type=%s",
            current_user.id,
            page,
            page_size,
            type(exc).__name__,
        )
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception(
            "get_my_favorite_lives failed user_id=%s page=%s page_size=%s error_type=%s",
            current_user.id,
            page,
            page_size,
            type(exc).__name__,
        )
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    items = [
        {
            "live_id": row[0],
            "live_date": row[1],
            "live_title": row[2],
            "live_type": row[5],
            "bands": row[3] or [],
            "url": row[4],
            "is_favorite": True,
            "tour": build_tour_ref_from_row(row, tour_id_index=6, tour_title_index=7),
            "performance_group": build_performance_group_ref_from_row(row, group_id_index=8, group_title_index=9),
            **build_public_live_status(
                event_status=str(row[11]) if len(row) > 11 else "scheduled",
                live_date=row[1],
                start_time=row[10] if len(row) > 10 else "00:00:00+00:00",
                timezone_offset_minutes=int(row[13]) if len(row) > 13 and row[13] is not None else None,
                was_rescheduled=bool(row[12]) if len(row) > 12 else False,
            ),
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


@router.post(
    "/favorites/lives:batch",
    response_model=FavoriteBatchResponse,
    summary="批量收藏/取消收藏 Live",
    description="登录用户批量收藏或取消收藏；接口幂等并返回 applied/noop/not_found 分类结果。",
    responses={
        400: {
            "model": ErrorResponse,
            "description": "业务参数错误，例如去重后无有效 live_ids",
        },
        401: {
            "model": AuthErrorResponse,
            "description": "未登录或 session 已失效",
        },
        403: {
            "model": AuthErrorResponse,
            "description": "CSRF Token 缺失或校验失败",
        },
        422: {
            "description": "请求体验证失败，例如 live_ids 超过 100",
        },
        500: {
            "model": ErrorResponse,
            "description": "数据库一般错误",
        },
        504: {
            "model": ErrorResponse,
            "description": "数据库连接超时或查询超时",
        },
    },
)
def favorite_lives_batch(
    payload: FavoriteBatchRequest,
    request: Request,
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    deduped_live_ids = list(dict.fromkeys(payload.live_ids))
    if len(deduped_live_ids) == 0:
        raise HTTPException(status_code=400, detail="live_ids must not be empty")

    try:
        with get_user_write_db_connection() as conn:
            with conn.cursor() as cur:
                result = apply_favorites_batch(
                    cur,
                    user_id=context.user.id,
                    action=payload.action,
                    live_ids=deduped_live_ids,
                )
                _write_favorite_batch_audit_log(
                    cur,
                    user_id=context.user.id,
                    action="favorite_batch_add" if payload.action == "favorite" else "favorite_batch_remove",
                    requested_count=result.requested_count,
                    applied_count=len(result.applied_live_ids),
                    noop_count=len(result.noop_live_ids),
                    not_found_count=len(result.not_found_live_ids),
                )
    except QueryCanceled as exc:
        logger.exception(
            "favorite_lives_batch failed user_id=%s action=%s count=%s error_type=%s",
            context.user.id,
            payload.action,
            len(deduped_live_ids),
            type(exc).__name__,
        )
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception(
            "favorite_lives_batch failed user_id=%s action=%s count=%s error_type=%s",
            context.user.id,
            payload.action,
            len(deduped_live_ids),
            type(exc).__name__,
        )
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception(
            "favorite_lives_batch failed user_id=%s action=%s count=%s error_type=%s",
            context.user.id,
            payload.action,
            len(deduped_live_ids),
            type(exc).__name__,
        )
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "action": result.action,
        "requested_count": result.requested_count,
        "applied_live_ids": result.applied_live_ids,
        "noop_live_ids": result.noop_live_ids,
        "not_found_live_ids": result.not_found_live_ids,
    }


@router.put(
    "/favorites/lives/{live_id}",
    status_code=204,
    summary="收藏指定 Live",
    description="幂等收藏操作；若当前用户已收藏该 Live，再次调用仍返回 204。",
    responses={
        204: {
            "description": "收藏成功或目标已在收藏中",
        },
        401: {
            "model": AuthErrorResponse,
            "description": "未登录或 session 已失效",
        },
        403: {
            "model": AuthErrorResponse,
            "description": "CSRF Token 缺失或校验失败",
        },
        404: {
            "model": ErrorResponse,
            "description": "目标 live 不存在",
        },
    },
)
def favorite_live(
    request: Request,
    response: Response,
    live_id: int = Path(..., ge=1, description="待收藏的 live_id。"),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)

    try:
        with get_user_write_db_connection() as conn:
            with conn.cursor() as cur:
                event_status = get_live_event_status(cur, live_id)
                if event_status is None:
                    raise HTTPException(status_code=404, detail=f"Live id {live_id} not found")
                if event_status == "cancelled":
                    raise HTTPException(status_code=409, detail="Cancelled Live cannot be favorited")

                cur.execute(
                    """
                    INSERT INTO user_live_favorites (user_id, live_id, source)
                    VALUES (%s, %s, 'manual')
                    ON CONFLICT (user_id, live_id) DO NOTHING
                    """,
                    (context.user.id, live_id),
                )
                if cur.rowcount > 0:
                    _write_favorite_audit_log(cur, user_id=context.user.id, action="favorite_add", live_id=live_id)
    except QueryCanceled as exc:
        logger.exception("favorite_live failed user_id=%s live_id=%s error_type=%s", context.user.id, live_id, type(exc).__name__)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("favorite_live failed user_id=%s live_id=%s error_type=%s", context.user.id, live_id, type(exc).__name__)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("favorite_live failed user_id=%s live_id=%s error_type=%s", context.user.id, live_id, type(exc).__name__)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    response.status_code = status.HTTP_204_NO_CONTENT
    return None


@router.delete(
    "/favorites/lives/{live_id}",
    status_code=204,
    summary="取消收藏指定 Live",
    description="幂等取消收藏操作；若目标本就未收藏，再次调用仍返回 204。",
    responses={
        204: {
            "description": "取消收藏成功或目标本就未收藏",
        },
        401: {
            "model": AuthErrorResponse,
            "description": "未登录或 session 已失效",
        },
        403: {
            "model": AuthErrorResponse,
            "description": "CSRF Token 缺失或校验失败",
        },
        404: {
            "model": ErrorResponse,
            "description": "目标 live 不存在",
        },
    },
)
def unfavorite_live(
    request: Request,
    response: Response,
    live_id: int = Path(..., ge=1, description="待取消收藏的 live_id。"),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)

    try:
        with get_user_write_db_connection() as conn:
            with conn.cursor() as cur:
                if not live_exists(cur, live_id):
                    raise HTTPException(status_code=404, detail=f"Live id {live_id} not found")

                cur.execute(
                    """
                    DELETE FROM user_live_favorites
                    WHERE user_id = %s
                        AND live_id = %s
                    """,
                    (context.user.id, live_id),
                )
                if cur.rowcount > 0:
                    _write_favorite_audit_log(cur, user_id=context.user.id, action="favorite_remove", live_id=live_id)
    except QueryCanceled as exc:
        logger.exception("unfavorite_live failed user_id=%s live_id=%s error_type=%s", context.user.id, live_id, type(exc).__name__)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("unfavorite_live failed user_id=%s live_id=%s error_type=%s", context.user.id, live_id, type(exc).__name__)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("unfavorite_live failed user_id=%s live_id=%s error_type=%s", context.user.id, live_id, type(exc).__name__)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    response.status_code = status.HTTP_204_NO_CONTENT
    return None
