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
    ConsoleLiveMutationResponse,
    ConsoleLiveSetlistAppendRequest,
    ConsoleLiveSetlistAppendResponse,
    ConsoleLiveUpsertRequest,
    ConsoleSongBatchCreateRequest,
    ConsoleSongBatchCreateResponse,
    ConsoleSongCreateRequest,
    ConsoleSongMutationResponse,
    ConsoleSongUpdateRequest,
    ConsoleLiveSetlistReplaceResponse,
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
    hour, minute, *second_parts = (int(part) for part in value.split(":"))
    second = second_parts[0] if second_parts else 0
    if hour > 24 or minute > 59 or second > 59 or (hour == 24 and (minute != 0 or second != 0)):
        _raise_business_error(status.HTTP_400_BAD_REQUEST, f"Invalid time value: {value}")
    if not TIMEZONE_PATTERN.fullmatch(timezone):
        _raise_business_error(status.HTTP_400_BAD_REQUEST, f"Invalid timezone format: {timezone}")
    offset_sign = -1 if timezone.startswith("-") else 1
    offset_hour, offset_minute = (int(part) for part in timezone[1:].split(":"))
    offset_minutes = offset_sign * (offset_hour * 60 + offset_minute)
    if offset_minute % 15 != 0 or offset_minutes < -12 * 60 or offset_minutes > 14 * 60:
        _raise_business_error(status.HTTP_400_BAD_REQUEST, f"Invalid timezone value: {timezone}")
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


def _normalize_other_member_payload(raw: Mapping[str, Any] | None) -> dict[str, str | list[str] | None] | None:
    """Coerce optional other_member input into the compact JSON shape stored in the DB."""
    if raw is None:
        return None
    normalized: dict[str, str | list[str] | None] = {}
    for member_key, member_value_raw in raw.items():
        normalized_key = str(member_key).strip()
        values = _to_string_list(member_value_raw)
        if normalized_key == "":
            continue
        normalized[normalized_key] = None if len(values) == 0 else values[0] if len(values) == 1 else values
    return normalized or None


def _format_date(value: date) -> str:
    """Return an ISO date string for FastAPI response payloads."""
    return value.isoformat()


def _validate_and_normalize_live_relations(
    cur: Any,
    payload: ConsoleLiveUpsertRequest,
) -> tuple[list[dict[str, Any]], dict[str, list[str]]]:
    """Validate Live foreign keys and normalize event attendance for create and update."""
    cur.execute("SELECT 1 FROM venue_list WHERE id = %s", (payload.venue_id,))
    if cur.fetchone() is None:
        raise HTTPException(status_code=404, detail=f"Venue id {payload.venue_id} not found")

    band_members_by_id: dict[int, list[str]] = {}
    if payload.default_band_ids:
        cur.execute(
            "SELECT id, band_members FROM band_attrs WHERE id = ANY(%s) ORDER BY id",
            (payload.default_band_ids,),
        )
        band_rows = cur.fetchall()
        existing_band_ids = {int(row[0]) for row in band_rows}
        band_members_by_id = {
            int(row[0]): _to_string_list(row[1]) if len(row) > 1 else []
            for row in band_rows
        }
        missing_band_ids = [band_id for band_id in payload.default_band_ids if band_id not in existing_band_ids]
        if missing_band_ids:
            missing_text = ", ".join(str(band_id) for band_id in missing_band_ids)
            raise HTTPException(status_code=404, detail=f"Band ids not found: {missing_text}")

    normalized_event_attendees: list[dict[str, Any]] = []
    persisted_event_attendees: dict[str, list[str]] = {}
    for attendee in sorted(payload.event_attendees, key=lambda item: item.band_id):
        catalog_members = band_members_by_id.get(attendee.band_id, [])
        requested_members = set(attendee.members)
        unknown_members = [member for member in attendee.members if member not in catalog_members]
        if unknown_members:
            unknown_text = ", ".join(unknown_members)
            raise HTTPException(status_code=400, detail=f"Band {attendee.band_id} members not found: {unknown_text}")
        ordered_members = [member for member in catalog_members if member in requested_members]
        persisted_event_attendees[str(attendee.band_id)] = ordered_members
        normalized_event_attendees.append(
            {
                "band_id": attendee.band_id,
                "mode": "full" if len(ordered_members) == len(catalog_members) else "partial",
                "members": ordered_members,
            }
        )
    return normalized_event_attendees, persisted_event_attendees


def _build_live_mutation_item(
    *,
    live_id: int,
    payload: ConsoleLiveUpsertRequest,
    opening_time: str,
    start_time: str,
    normalized_event_attendees: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build the common normalized response item for Live create and update."""
    return {
        "live_id": live_id,
        "live_date": _format_date(payload.live_date),
        "live_title": payload.live_title,
        "live_type": payload.live_type,
        "url": payload.url,
        "opening_time": opening_time,
        "start_time": start_time,
        "venue_id": payload.venue_id,
        "default_band_ids": payload.default_band_ids,
        "event_attendees": normalized_event_attendees,
    }


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


@router.put(
    "/songs/{song_id}",
    response_model=ConsoleSongMutationResponse,
    summary="更新歌曲",
    description="`editor+` 用户更新歌曲名称、归属 Band 和翻唱属性。",
)
def update_song(
    payload: ConsoleSongUpdateRequest,
    request: Request,
    song_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM band_attrs WHERE id = %s", (payload.band_id,))
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail=f"Band id {payload.band_id} not found")
                cur.execute(
                    """
                    UPDATE song_list
                    SET song_name = %s, band_id = %s, is_cover = %s
                    WHERE id = %s
                    RETURNING id
                    """,
                    (payload.song_name, payload.band_id, payload.cover, song_id),
                )
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail=f"Song id {song_id} not found")
                _write_console_audit_log(
                    cur,
                    user_id=context.user.id,
                    action="song_update",
                    resource_type="song",
                    resource_id=str(song_id),
                    payload_json={"song_name": payload.song_name, "band_id": payload.band_id, "cover": payload.cover},
                )
    except HTTPException:
        raise
    except UniqueViolation as exc:
        raise HTTPException(status_code=409, detail=f"Song name already exists for band {payload.band_id}: {payload.song_name}") from exc
    except QueryCanceled as exc:
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
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
    description=(
        "`editor+` 用户新增 Live 基础信息。`live_type` 为必填字段，值为稳定 code"
        "（oneman/taiban/multi_act/festival/event/other）；`default_band_ids` 仅在 Live 尚无 setlist 时用于列表展示。"
    ),
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
    payload: ConsoleLiveUpsertRequest,
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
                normalized_event_attendees, persisted_event_attendees = _validate_and_normalize_live_relations(
                    cur,
                    payload,
                )

                cur.execute(
                    """
                    INSERT INTO live_attrs (
                        live_date,
                        live_title,
                        live_type,
                        is_internal,
                        url,
                        opening_time,
                        start_time,
                        venue_id,
                        default_band_ids,
                        event_attendees
                    )
                    VALUES (%s, %s, %s, false, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        payload.live_date,
                        payload.live_title,
                        payload.live_type,
                        payload.url,
                        opening_time,
                        start_time,
                        payload.venue_id,
                        payload.default_band_ids,
                        Json(persisted_event_attendees),
                    ),
                )
                created_row = cur.fetchone()
                assert created_row is not None
                live_id = int(created_row[0])

                audit_payload = {
                    "venue_id": payload.venue_id,
                    "opening_time": opening_time,
                    "start_time": start_time,
                    "live_type": payload.live_type,
                    "default_band_ids": payload.default_band_ids,
                    "event_attendees": normalized_event_attendees,
                }

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
        "item": _build_live_mutation_item(
            live_id=live_id,
            payload=payload,
            opening_time=opening_time,
            start_time=start_time,
            normalized_event_attendees=normalized_event_attendees,
        ),
    }


@router.put(
    "/lives/{live_id}",
    response_model=ConsoleLiveMutationResponse,
    summary="更新 Live",
    description="`editor+` 用户完整替换一个 Live 的可编辑基础资料，不修改 Setlist 或聚合关系。",
    responses={
        400: {"model": ErrorResponse, "description": "业务参数错误"},
        401: {"model": AuthErrorResponse, "description": "未登录或 session 已失效"},
        403: {"model": AuthErrorResponse, "description": "缺少权限或 CSRF 校验失败"},
        404: {"model": ErrorResponse, "description": "Live、Venue 或 Band 不存在"},
        422: {"model": ValidationErrorResponse, "description": "请求体验证失败"},
        500: {"model": ErrorResponse, "description": "数据库一般错误"},
        504: {"model": ErrorResponse, "description": "数据库连接或查询超时"},
    },
)
def update_live(
    payload: ConsoleLiveUpsertRequest,
    request: Request,
    live_id: int = Path(..., ge=1, description="Target live_id"),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    """Update one Live under a row lock and record only meaningful field changes."""
    assert_valid_csrf(request, context)
    opening_time = _normalize_time_with_timezone(payload.opening_time, payload.timezone)
    start_time = _normalize_time_with_timezone(payload.start_time, payload.timezone)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT to_jsonb(l) FROM live_attrs l WHERE l.id = %s FOR UPDATE", (live_id,))
                existing_row = cur.fetchone()
                if existing_row is None:
                    raise HTTPException(status_code=404, detail=f"Live id {live_id} not found")
                existing = dict(existing_row[0])
                normalized_event_attendees, persisted_event_attendees = _validate_and_normalize_live_relations(
                    cur,
                    payload,
                )
                target = {
                    "live_date": _format_date(payload.live_date),
                    "live_title": payload.live_title,
                    "live_type": payload.live_type,
                    "url": payload.url,
                    "opening_time": opening_time,
                    "start_time": start_time,
                    "venue_id": payload.venue_id,
                    "default_band_ids": payload.default_band_ids,
                    "event_attendees": persisted_event_attendees,
                }
                changes = {
                    field: {"before": existing.get(field), "after": value}
                    for field, value in target.items()
                    if existing.get(field) != value
                }
                if changes:
                    cur.execute(
                        """
                        UPDATE live_attrs
                        SET
                            live_date = %s,
                            live_title = %s,
                            live_type = %s,
                            url = %s,
                            opening_time = %s,
                            start_time = %s,
                            venue_id = %s,
                            default_band_ids = %s,
                            event_attendees = %s
                        WHERE id = %s
                        """,
                        (
                            payload.live_date,
                            payload.live_title,
                            payload.live_type,
                            payload.url,
                            opening_time,
                            start_time,
                            payload.venue_id,
                            payload.default_band_ids,
                            Json(persisted_event_attendees),
                            live_id,
                        ),
                    )
                    _write_console_audit_log(
                        cur,
                        user_id=context.user.id,
                        action="live_update",
                        resource_type="live",
                        resource_id=str(live_id),
                        payload_json={"changes": changes},
                    )
    except HTTPException:
        raise
    except QueryCanceled as exc:
        logger.exception("update_live timeout user_id=%s live_id=%s", context.user.id, live_id)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("update_live operational error user_id=%s live_id=%s", context.user.id, live_id)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("update_live failed user_id=%s live_id=%s", context.user.id, live_id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    return {
        "ok": True,
        "item": _build_live_mutation_item(
            live_id=live_id,
            payload=payload,
            opening_time=opening_time,
            start_time=start_time,
            normalized_event_attendees=normalized_event_attendees,
        ),
    }


@router.post(
    "/lives/{live_id}/setlist",
    status_code=201,
    response_model=ConsoleLiveSetlistAppendResponse,
    summary="向指定 Live 追加 setlist 行",
    description="`editor+` 用户向指定 Live 追加 setlist 行。如果目标 Live 已有 setlist 数据则禁止追加。",
    responses={
        400: {"model": ErrorResponse, "description": "业务参数错误"},
        401: {"model": AuthErrorResponse, "description": "未登录或 session 已失效"},
        403: {"model": AuthErrorResponse, "description": "缺少权限或 CSRF 校验失败"},
        404: {"model": ErrorResponse, "description": "目标 live 或 song 不存在"},
         409: {"model": ErrorResponse, "description": "Live 已有 setlist 数据或 absolute_order 冲突"},
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
                cur.execute("SELECT 1 FROM live_attrs WHERE id = %s FOR UPDATE", (live_id,))
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail=f"Live id {live_id} not found")

                cur.execute("SELECT 1 FROM live_setlist WHERE live_id = %s LIMIT 1", (live_id,))
                if cur.fetchone() is not None:
                    raise HTTPException(status_code=409, detail=f"Live id {live_id} already has setlist data")

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
                            Json(normalized_row["other_member"]) if normalized_row["other_member"] is not None else None,
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


@router.put(
    "/lives/{live_id}/setlist",
    response_model=ConsoleLiveSetlistReplaceResponse,
    summary="更新指定 Live 的 Setlist",
    description="`editor+` 用户用提交的完整行集合替换指定 Live 的 Setlist。",
)
def replace_live_setlist(
    payload: ConsoleLiveSetlistAppendRequest,
    request: Request,
    live_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    normalized_rows: list[dict[str, Any]] = []
    seen_absolute_orders: set[int] = set()
    for row in payload.setlist_rows:
        if row.absolute_order in seen_absolute_orders:
            _raise_business_error(status.HTTP_400_BAD_REQUEST, f"Duplicate absolute_order in setlist_rows: {row.absolute_order}")
        seen_absolute_orders.add(row.absolute_order)
        normalized_rows.append({
            "song_id": row.song_id,
            "absolute_order": row.absolute_order,
            "segment_type": _normalize_segment_type(row.segment_type),
            "sub_order": row.sub_order,
            "is_short": row.is_short,
            "band_member": _normalize_band_member_payload(row.band_member),
            "other_member": _normalize_other_member_payload(row.other_member),
            "comment": row.comment,
        })
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM live_attrs WHERE id = %s FOR UPDATE", (live_id,))
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail=f"Live id {live_id} not found")
                song_ids = list(dict.fromkeys(item["song_id"] for item in normalized_rows))
                cur.execute("SELECT id FROM song_list WHERE id = ANY(%s)", (song_ids,))
                existing_song_ids = {int(row[0]) for row in cur.fetchall()}
                missing_song_ids = [song_id for song_id in song_ids if song_id not in existing_song_ids]
                if missing_song_ids:
                    raise HTTPException(status_code=404, detail=f"Song ids not found: {', '.join(map(str, missing_song_ids))}")
                cur.execute("DELETE FROM live_setlist WHERE live_id = %s", (live_id,))
                for normalized_row in sorted(normalized_rows, key=lambda item: item["absolute_order"]):
                    cur.execute(
                        """
                        INSERT INTO live_setlist (
                            live_id, song_id, absolute_order, segment_type, sub_order,
                            is_short, band_member, other_member, comment
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
                            Json(normalized_row["other_member"]) if normalized_row["other_member"] is not None else None,
                            normalized_row["comment"],
                        ),
                    )
                _write_console_audit_log(
                    cur,
                    user_id=context.user.id,
                    action="live_setlist_update",
                    resource_type="live",
                    resource_id=str(live_id),
                    payload_json={"row_count": len(normalized_rows)},
                )
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
        "ok": True,
        "item": {
            "live_id": live_id,
            "inserted_row_count": len(normalized_rows),
            "total_setlist_row_count": len(normalized_rows),
        },
    }
