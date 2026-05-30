import re
from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled, UniqueViolation
from psycopg2.extras import Json

from app.auth import AuthSessionContext, assert_valid_csrf, get_current_auth_context, require_role
from app.db import get_write_db_connection
from app.logging_config import get_logger
from app.schemas import ErrorResponse, ValidationErrorResponse
from app.schemas.auth import AuthErrorResponse
from app.schemas.console import (
    ConsoleLiveCreateRequest,
    ConsoleLiveMutationResponse,
    ConsoleLiveSetlistAppendRequest,
    ConsoleLiveSetlistAppendResponse,
    ConsoleSongBatchCreateRequest,
    ConsoleSongBatchCreateResponse,
    ConsoleSongCreateRequest,
    ConsoleSongMutationResponse,
    ConsoleVenueCreateRequest,
    ConsoleVenueMutationResponse,
)

router = APIRouter()
logger = get_logger(__name__)

TIME_PATTERN = re.compile(r"^\d{2}:\d{2}(?::\d{2})?$")
TIMEZONE_PATTERN = re.compile(r"^[+-]\d{2}:\d{2}$")


def _write_console_audit_log(
    cur: Any,
    *,
    user_id: int,
    action: str,
    resource_type: str,
    resource_id: str,
    payload_json: dict[str, Any] | None = None,
) -> None:
    """Write one audit_logs row for a console mutation inside the current transaction."""
    cur.execute(
        """
        INSERT INTO audit_logs (user_id, action, resource_type, resource_id, payload_json)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (user_id, action, resource_type, resource_id, Json(payload_json) if payload_json is not None else None),
    )


def _raise_business_error(status_code: int, message: str) -> None:
    """Raise a consistent HTTPException for console-side business validation failures."""
    raise HTTPException(status_code=status_code, detail=message)


def _normalize_time_with_timezone(value: str, timezone: str) -> str:
    """Combine a local clock time and UTC offset into the DB-ready time-with-timezone format."""
    if not TIME_PATTERN.fullmatch(value):
        _raise_business_error(status.HTTP_400_BAD_REQUEST, f"Invalid time format: {value}")
    if not TIMEZONE_PATTERN.fullmatch(timezone):
        _raise_business_error(status.HTTP_400_BAD_REQUEST, f"Invalid timezone format: {timezone}")
    normalized_time = value if len(value) == 8 else f"{value}:00"
    return f"{normalized_time}{timezone}"


def _normalize_segment_type(value: str) -> str:
    """Reject blank segment_type; pass through valid values directly."""
    raw = value.strip()
    if raw == "":
        _raise_business_error(status.HTTP_400_BAD_REQUEST, "segment_type must not be blank")
    return raw


def _to_string_list(raw: Any) -> list[str]:
    """Normalize one scalar or sequence into a de-duplicated string list for JSON fields."""
    if isinstance(raw, str):
        normalized = raw.strip()
        return [normalized] if normalized != "" else []
    if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes, bytearray)):
        result: list[str] = []
        seen: set[str] = set()
        for item in raw:
            normalized = str(item).strip()
            if normalized == "" or normalized in seen:
                continue
            result.append(normalized)
            seen.add(normalized)
        return result
    return []


def _normalize_band_member_payload(raw: Mapping[str, Any]) -> dict[str, list[str]]:
    """Coerce band_member into the JSON shape expected by live_setlist.band_member."""
    normalized: dict[str, list[str]] = {}
    for band_name, members_raw in raw.items():
        normalized_band_name = str(band_name).strip()
        members = _to_string_list(members_raw)
        if normalized_band_name == "" or len(members) == 0:
            continue
        normalized[normalized_band_name] = members
    if len(normalized) == 0:
        _raise_business_error(status.HTTP_400_BAD_REQUEST, "band_member must contain at least one band with members")
    return normalized


def _normalize_other_member_payload(raw: Mapping[str, Any] | None) -> dict[str, str | list[str]]:
    """Coerce optional other_member input into the compact JSON shape stored in the DB."""
    if raw is None:
        return {}
    normalized: dict[str, str | list[str]] = {}
    for member_key, member_value_raw in raw.items():
        normalized_key = str(member_key).strip()
        values = _to_string_list(member_value_raw)
        if normalized_key == "" or len(values) == 0:
            continue
        normalized[normalized_key] = values[0] if len(values) == 1 else values
    return normalized


def _format_date(value: date) -> str:
    """Return an ISO date string for FastAPI response payloads."""
    return value.isoformat()


@router.post(
    "/songs",
    status_code=201,
    response_model=ConsoleSongMutationResponse,
    summary="新增歌曲",
    description="`editor+` 用户新增歌曲基础信息。",
    responses={
        400: {"model": ErrorResponse, "description": "业务参数错误"},
        401: {"model": AuthErrorResponse, "description": "未登录或 session 已失效"},
        403: {"model": AuthErrorResponse, "description": "缺少权限或 CSRF 校验失败"},
        404: {"model": ErrorResponse, "description": "关联 band 不存在"},
        409: {"model": ErrorResponse, "description": "歌曲唯一键冲突"},
        422: {"model": ValidationErrorResponse, "description": "请求体验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def create_song(
    payload: ConsoleSongCreateRequest,
    request: Request,
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    """Insert one new song from the console page after auth, CSRF, and band checks pass."""
    assert_valid_csrf(request, context)

    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM band_attrs WHERE id = %s", (payload.band_id,))
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail=f"Band id {payload.band_id} not found")

                cur.execute(
                    """
                    INSERT INTO song_list (song_name, band_id, is_cover)
                    VALUES (%s, %s, %s)
                    RETURNING id
                    """,
                    (payload.song_name, payload.band_id, payload.cover),
                )
                created_row = cur.fetchone()
                assert created_row is not None
                song_id = int(created_row[0])

                _write_console_audit_log(
                    cur,
                    user_id=context.user.id,
                    action="song_create",
                    resource_type="song",
                    resource_id=str(song_id),
                    payload_json={"band_id": payload.band_id, "cover": payload.cover},
                )
    except HTTPException:
        raise
    except UniqueViolation as exc:
        logger.exception("create_song conflict user_id=%s song_name=%s", context.user.id, payload.song_name)
        raise HTTPException(status_code=409, detail=f"Song name already exists: {payload.song_name}") from exc
    except QueryCanceled as exc:
        logger.exception("create_song timeout user_id=%s song_name=%s", context.user.id, payload.song_name)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("create_song operational error user_id=%s song_name=%s", context.user.id, payload.song_name)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("create_song failed user_id=%s song_name=%s", context.user.id, payload.song_name)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "ok": True,
        "item": {
            "song_id": song_id,
            "song_name": payload.song_name,
            "band_id": payload.band_id,
            "cover": payload.cover,
        },
    }


@router.post(
    "/songs:batch",
    status_code=201,
    response_model=ConsoleSongBatchCreateResponse,
    summary="批量新增歌曲",
    description="`editor+` 用户批量新增歌曲。每个请求项独立处理，一项失败不影响其他项。",
    responses={
        401: {"model": AuthErrorResponse, "description": "未登录或 session 已失效"},
        403: {"model": AuthErrorResponse, "description": "缺少权限或 CSRF 校验失败"},
        422: {"model": ValidationErrorResponse, "description": "请求体验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def create_songs_batch(
    payload: ConsoleSongBatchCreateRequest,
    request: Request,
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    """Insert multiple songs from the console page in one request."""
    assert_valid_csrf(request, context)

    created: list[dict[str, Any]] = []

    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                for song in payload.songs:
                    cur.execute("SAVEPOINT batch_song_sp")
                    try:
                        cur.execute("SELECT 1 FROM band_attrs WHERE id = %s", (song.band_id,))
                        if cur.fetchone() is None:
                            logger.warning(
                                "batch song skip band_not_found user_id=%s song_name=%s band_id=%s",
                                context.user.id,
                                song.song_name,
                                song.band_id,
                            )
                            cur.execute("RELEASE SAVEPOINT batch_song_sp")
                            continue

                        cur.execute(
                            """
                            INSERT INTO song_list (song_name, band_id, is_cover)
                            VALUES (%s, %s, %s)
                            RETURNING id
                            """,
                            (song.song_name, song.band_id, song.cover),
                        )
                        created_row = cur.fetchone()
                        assert created_row is not None
                        song_id = int(created_row[0])

                        _write_console_audit_log(
                            cur,
                            user_id=context.user.id,
                            action="song_create",
                            resource_type="song",
                            resource_id=str(song_id),
                            payload_json={"band_id": song.band_id, "cover": song.cover},
                        )

                        created.append({
                            "song_id": song_id,
                            "song_name": song.song_name,
                            "band_id": song.band_id,
                            "cover": song.cover,
                        })
                        cur.execute("RELEASE SAVEPOINT batch_song_sp")
                    except UniqueViolation:
                        cur.execute("ROLLBACK TO SAVEPOINT batch_song_sp")
                        logger.warning(
                            "batch song skip duplicate user_id=%s song_name=%s",
                            context.user.id,
                            song.song_name,
                        )
    except HTTPException:
        raise
    except QueryCanceled as exc:
        logger.exception("batch create_songs timeout user_id=%s count=%s", context.user.id, len(payload.songs))
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("batch create_songs operational error user_id=%s", context.user.id)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("batch create_songs failed user_id=%s", context.user.id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {"ok": len(created) == len(payload.songs), "created": created}


@router.post(
    "/venues",
    status_code=201,
    response_model=ConsoleVenueMutationResponse,
    summary="新增场地",
    description="`editor+` 用户新增 venue_list 场地。当前表结构的 NOT NULL 列为 `venue`，`id` 由 sequence 自动生成。",
    responses={
        401: {"model": AuthErrorResponse, "description": "未登录或 session 已失效"},
        403: {"model": AuthErrorResponse, "description": "缺少权限或 CSRF 校验失败"},
        422: {"model": ValidationErrorResponse, "description": "请求体验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def create_venue(
    payload: ConsoleVenueCreateRequest,
    request: Request,
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    """Insert one venue_list row from the console venue quick-insert control and audit it."""
    assert_valid_csrf(request, context)

    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO venue_list (venue)
                    VALUES (%s)
                    RETURNING id
                    """,
                    (payload.venue_name,),
                )
                created_row = cur.fetchone()
                assert created_row is not None
                venue_id = int(created_row[0])

                _write_console_audit_log(
                    cur,
                    user_id=context.user.id,
                    action="venue_create",
                    resource_type="venue",
                    resource_id=str(venue_id),
                    payload_json={"venue_name": payload.venue_name},
                )
    except QueryCanceled as exc:
        logger.exception("create_venue timeout user_id=%s venue_name=%s", context.user.id, payload.venue_name)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("create_venue operational error user_id=%s venue_name=%s", context.user.id, payload.venue_name)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("create_venue failed user_id=%s venue_name=%s", context.user.id, payload.venue_name)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "ok": True,
        "item": {
            "venue_id": venue_id,
            "venue_name": payload.venue_name,
        },
    }


@router.post(
    "/lives",
    status_code=201,
    response_model=ConsoleLiveMutationResponse,
    summary="新增 Live",
    description="`editor+` 用户新增 Live 基础信息。当前请求体中的 `type` 仅作兼容字段，不会持久化。",
    responses={
        400: {"model": ErrorResponse, "description": "业务参数错误"},
        401: {"model": AuthErrorResponse, "description": "未登录或 session 已失效"},
        403: {"model": AuthErrorResponse, "description": "缺少权限或 CSRF 校验失败"},
        404: {"model": ErrorResponse, "description": "关联 venue 不存在"},
        422: {"model": ValidationErrorResponse, "description": "请求体验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def create_live(
    payload: ConsoleLiveCreateRequest,
    request: Request,
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    """Insert one live_attrs row from the console live form and record the corresponding audit log."""
    assert_valid_csrf(request, context)

    opening_time = _normalize_time_with_timezone(payload.opening_time, payload.timezone)
    start_time = _normalize_time_with_timezone(payload.start_time, payload.timezone)

    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM venue_list WHERE id = %s", (payload.venue_id,))
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail=f"Venue id {payload.venue_id} not found")

                cur.execute(
                    """
                    INSERT INTO live_attrs (
                        live_date,
                        live_title,
                        is_internal,
                        url,
                        opening_time,
                        start_time,
                        venue_id
                    )
                    VALUES (%s, %s, false, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        payload.live_date,
                        payload.live_title,
                        payload.url,
                        opening_time,
                        start_time,
                        payload.venue_id,
                    ),
                )
                created_row = cur.fetchone()
                assert created_row is not None
                live_id = int(created_row[0])

                audit_payload = {
                    "venue_id": payload.venue_id,
                    "opening_time": opening_time,
                    "start_time": start_time,
                }
                if payload.type is not None:
                    audit_payload["ui_type"] = payload.type

                _write_console_audit_log(
                    cur,
                    user_id=context.user.id,
                    action="live_create",
                    resource_type="live",
                    resource_id=str(live_id),
                    payload_json=audit_payload,
                )
    except HTTPException:
        raise
    except QueryCanceled as exc:
        logger.exception("create_live timeout user_id=%s live_title=%s", context.user.id, payload.live_title)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("create_live operational error user_id=%s live_title=%s", context.user.id, payload.live_title)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("create_live failed user_id=%s live_title=%s", context.user.id, payload.live_title)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "ok": True,
        "item": {
            "live_id": live_id,
            "live_date": _format_date(payload.live_date),
            "live_title": payload.live_title,
            "url": payload.url,
            "opening_time": opening_time,
            "start_time": start_time,
            "venue_id": payload.venue_id,
        },
    }


@router.post(
    "/lives/{live_id}/setlist",
    status_code=201,
    response_model=ConsoleLiveSetlistAppendResponse,
    summary="向指定 Live 追加 setlist 行",
    description="`editor+` 用户向指定 Live 追加 setlist 行。该接口只插入，不会删除或覆盖已有行。",
    responses={
        400: {"model": ErrorResponse, "description": "业务参数错误"},
        401: {"model": AuthErrorResponse, "description": "未登录或 session 已失效"},
        403: {"model": AuthErrorResponse, "description": "缺少权限或 CSRF 校验失败"},
        404: {"model": ErrorResponse, "description": "目标 live 或 song 不存在"},
        409: {"model": ErrorResponse, "description": "absolute_order 与已有 setlist 行冲突"},
        422: {"model": ValidationErrorResponse, "description": "请求体验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def append_live_setlist(
    payload: ConsoleLiveSetlistAppendRequest,
    request: Request,
    live_id: int = Path(..., ge=1, description="Target live_id"),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    """Append new rows for one live without modifying any existing live_setlist data."""
    assert_valid_csrf(request, context)

    normalized_rows: list[dict[str, Any]] = []
    seen_absolute_orders: set[int] = set()
    song_ids_in_request: list[int] = []

    for row in payload.setlist_rows:
        if row.absolute_order in seen_absolute_orders:
            _raise_business_error(
                status.HTTP_400_BAD_REQUEST,
                f"Duplicate absolute_order in setlist_rows: {row.absolute_order}",
            )
        seen_absolute_orders.add(row.absolute_order)
        normalized_row = {
            "song_id": row.song_id,
            "absolute_order": row.absolute_order,
            "segment_type": _normalize_segment_type(row.segment_type),
            "sub_order": row.sub_order,
            "is_short": row.is_short,
            "band_member": _normalize_band_member_payload(row.band_member),
            "other_member": _normalize_other_member_payload(row.other_member),
            "comment": row.comment,
        }
        normalized_rows.append(normalized_row)
        song_ids_in_request.append(row.song_id)

    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM live_attrs WHERE id = %s", (live_id,))
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail=f"Live id {live_id} not found")

                deduped_song_ids = list(dict.fromkeys(song_ids_in_request))
                cur.execute("SELECT id FROM song_list WHERE id = ANY(%s)", (deduped_song_ids,))
                existing_song_ids = {int(row[0]) for row in cur.fetchall()}
                missing_song_ids = [song_id for song_id in deduped_song_ids if song_id not in existing_song_ids]
                if len(missing_song_ids) > 0:
                    missing_text = ", ".join(str(song_id) for song_id in missing_song_ids)
                    raise HTTPException(status_code=404, detail=f"Song ids not found: {missing_text}")

                cur.execute("SELECT absolute_order FROM live_setlist WHERE live_id = %s", (live_id,))
                existing_absolute_orders = {int(row[0]) for row in cur.fetchall()}
                conflicting_orders = sorted(
                    normalized_row["absolute_order"]
                    for normalized_row in normalized_rows
                    if normalized_row["absolute_order"] in existing_absolute_orders
                )
                if len(conflicting_orders) > 0:
                    conflict_text = ", ".join(str(order) for order in conflicting_orders)
                    raise HTTPException(
                        status_code=409,
                        detail=f"absolute_order already exists for live {live_id}: {conflict_text}",
                    )

                for normalized_row in sorted(normalized_rows, key=lambda item: item["absolute_order"]):
                    cur.execute(
                        """
                        INSERT INTO live_setlist (
                            live_id,
                            song_id,
                            absolute_order,
                            segment_type,
                            sub_order,
                            is_short,
                            band_member,
                            other_member,
                            comment
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            live_id,
                            normalized_row["song_id"],
                            normalized_row["absolute_order"],
                            normalized_row["segment_type"],
                            normalized_row["sub_order"],
                            normalized_row["is_short"],
                            Json(normalized_row["band_member"]),
                            Json(normalized_row["other_member"]),
                            normalized_row["comment"],
                        ),
                    )

                cur.execute("SELECT COUNT(*) FROM live_setlist WHERE live_id = %s", (live_id,))
                count_row = cur.fetchone()
                assert count_row is not None
                total_setlist_row_count = int(count_row[0])

                _write_console_audit_log(
                    cur,
                    user_id=context.user.id,
                    action="live_setlist_append",
                    resource_type="live",
                    resource_id=str(live_id),
                    payload_json={
                        "inserted_row_count": len(normalized_rows),
                        "total_setlist_row_count": total_setlist_row_count,
                    },
                )
    except HTTPException:
        raise
    except UniqueViolation as exc:
        logger.exception("append_live_setlist conflict user_id=%s live_id=%s", context.user.id, live_id)
        raise HTTPException(status_code=409, detail=f"absolute_order already exists for live {live_id}") from exc
    except QueryCanceled as exc:
        logger.exception("append_live_setlist timeout user_id=%s live_id=%s", context.user.id, live_id)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("append_live_setlist operational error user_id=%s live_id=%s", context.user.id, live_id)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("append_live_setlist failed user_id=%s live_id=%s", context.user.id, live_id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "ok": True,
        "item": {
            "live_id": live_id,
            "inserted_row_count": len(normalized_rows),
            "total_setlist_row_count": total_setlist_row_count,
        },
    }
