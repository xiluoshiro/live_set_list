import re
from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled, UniqueViolation
from psycopg2.extras import Json

from app.auth import AuthSessionContext, assert_valid_csrf, get_current_auth_context, require_role
from app.band_history_write import (
    PersistedLineupContext,
    build_band_performances,
    load_lineup_contexts,
    persist_band_performances,
    replace_lineup_contexts,
    validate_lineup_contexts,
)
from app.db import get_write_db_connection
from app.logging_config import get_logger
from app.live_status import build_public_live_status
from app.schemas import ErrorResponse, ValidationErrorResponse
from app.schemas.auth import AuthErrorResponse
from app.schemas.console import (
    ConsoleLiveMutationResponse,
    ConsoleLiveBandLineupContextRequest,
    ConsoleLiveBaseRequest,
    ConsoleLiveCreateRequest,
    ConsoleLiveUpdateRequest,
    ConsoleLiveSetlistAppendRequest,
    ConsoleLiveSetlistAppendResponse,
    ConsoleSongBatchCreateRequest,
    ConsoleSongBatchCreateResponse,
    ConsoleSongCreateRequest,
    ConsoleSongMutationResponse,
    ConsoleSongUpdateRequest,
    ConsoleLiveSetlistReplaceResponse,
)

router = APIRouter()
logger = get_logger(__name__)

TIME_PATTERN = re.compile(r"^\d{2}:\d{2}(?::\d{2})?$")
TIMEZONE_PATTERN = re.compile(r"^[+-]\d{2}:\d{2}$")
SHORT_TIMEZONE_SUFFIX_PATTERN = re.compile(r"([+-]\d{2})$")


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


def _timezone_offset_minutes(timezone: str) -> int:
    """Validate an API UTC offset and return its signed minute value."""
    if not TIMEZONE_PATTERN.fullmatch(timezone):
        _raise_business_error(status.HTTP_400_BAD_REQUEST, f"Invalid timezone format: {timezone}")
    offset_sign = -1 if timezone.startswith("-") else 1
    offset_hour, offset_minute = (int(part) for part in timezone[1:].split(":"))
    offset_minutes = offset_sign * (offset_hour * 60 + offset_minute)
    if offset_minute % 15 != 0 or offset_minutes < -12 * 60 or offset_minutes > 14 * 60:
        _raise_business_error(status.HTTP_400_BAD_REQUEST, f"Invalid timezone value: {timezone}")
    return offset_minutes


def _normalize_optional_time_with_timezone(value: str | None, timezone: str) -> str | None:
    """Keep an unannounced time null while validating the shared UTC offset."""
    _timezone_offset_minutes(timezone)
    return None if value is None else _normalize_time_with_timezone(value, timezone)


def _normalize_persisted_time_with_timezone(value: Any) -> str:
    """Normalize PostgreSQL JSON's whole-hour offset before field comparison."""
    return SHORT_TIMEZONE_SUFFIX_PATTERN.sub(r"\1:00", str(value))


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
    payload: ConsoleLiveBaseRequest,
    *,
    existing_contexts: dict[int, PersistedLineupContext] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, list[str]], dict[int, PersistedLineupContext]]:
    """Validate Live foreign keys and normalize event attendance for create and update."""
    band_members_by_id: dict[int, list[str]] = {}
    band_rows: list[Any] = []
    if payload.default_band_ids:
        cur.execute(
            """
            SELECT band_id, band_members, band_name_version_id, lineup_version_id
            FROM current_band_versions
            WHERE band_id = ANY(%s)
            ORDER BY band_id
            """,
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

    current_context_ids = {
        int(row[0]): (int(row[2]), int(row[3]))
        for row in band_rows
        if len(row) > 3 and row[2] is not None and row[3] is not None
    }
    existing_contexts = existing_contexts or {}
    resolved_contexts = {
        band_id: context
        for band_id, context in existing_contexts.items()
        if band_id in set(payload.default_band_ids)
    }
    current_context_requests: list[ConsoleLiveBandLineupContextRequest] = []
    for band_id, version_ids in current_context_ids.items():
        if band_id not in resolved_contexts:
            current_context_requests.append(
                ConsoleLiveBandLineupContextRequest(
                    band_id=band_id,
                    band_name_version_id=version_ids[0],
                    base_lineup_version_id=version_ids[1],
                    next_lineup_version_id=None,
                )
            )
    resolved_contexts.update(validate_lineup_contexts(cur, current_context_requests))

    normalized_event_attendees: list[dict[str, Any]] = []
    persisted_event_attendees: dict[str, list[str]] = {}
    for attendee in sorted(payload.event_attendees, key=lambda item: item.band_id):
        lineup_context = resolved_contexts.get(attendee.band_id)
        catalog_members = (
            list(lineup_context.base_members)
            if lineup_context is not None
            else band_members_by_id.get(attendee.band_id, [])
        )
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
    return normalized_event_attendees, persisted_event_attendees, resolved_contexts


def _resolve_venue_name_version(cur: Any, payload: ConsoleLiveBaseRequest) -> int | None:
    """Validate an explicit Venue name version or resolve the current version for old clients."""
    if payload.venue_id is None:
        if payload.venue_name_version_id is not None:
            raise HTTPException(status_code=422, detail="venue_name_version_id requires venue_id")
        return None
    if payload.venue_name_version_id is None:
        cur.execute(
            """
            SELECT version.id
            FROM venue_list venue
            JOIN venue_name_versions version
              ON version.venue_id = venue.id
             AND version.valid_to IS NULL
            WHERE venue.id = %s
              AND venue.merged_into_venue_id IS NULL
            """,
            (payload.venue_id,),
        )
    else:
        cur.execute(
            """
            SELECT version.id
            FROM venue_list venue
            JOIN venue_name_versions version ON version.venue_id = venue.id
            WHERE venue.id = %s
              AND version.id = %s
              AND venue.merged_into_venue_id IS NULL
            """,
            (payload.venue_id, payload.venue_name_version_id),
        )
    row = cur.fetchone()
    if row is None:
        if payload.venue_name_version_id is None:
            raise HTTPException(status_code=404, detail=f"Venue id {payload.venue_id} not found")
        raise HTTPException(status_code=422, detail="Venue name version does not belong to venue_id")
    return int(row[0])


def _serialize_lineup_contexts(
    contexts: dict[int, PersistedLineupContext],
) -> list[dict[str, int | None]]:
    """Return stable API/audit payloads for persisted Live-level Band contexts."""
    return [
        {
            "band_id": context.band_id,
            "band_name_version_id": context.band_name_version_id,
            "base_lineup_version_id": context.base_lineup_version_id,
            "next_lineup_version_id": context.next_lineup_version_id,
        }
        for context in sorted(contexts.values(), key=lambda item: item.band_id)
    ]


def _ensure_current_performance_contexts(
    cur: Any,
    *,
    live_id: int,
    contexts: dict[int, PersistedLineupContext],
    band_ids: set[int],
) -> bool:
    missing_band_ids = sorted(band_ids - set(contexts))
    if not missing_band_ids:
        return False
    cur.execute(
        """
        SELECT band_id, band_name_version_id, lineup_version_id
        FROM current_band_versions
        WHERE band_id = ANY(%s)
        ORDER BY band_id
        """,
        (missing_band_ids,),
    )
    rows = cur.fetchall()
    found_ids = {int(row[0]) for row in rows}
    unavailable_ids = [band_id for band_id in missing_band_ids if band_id not in found_ids]
    if unavailable_ids:
        raise HTTPException(
            status_code=409,
            detail=f"Bands have no current lineup version: {', '.join(map(str, unavailable_ids))}",
        )
    requests = [
        ConsoleLiveBandLineupContextRequest(
            band_id=int(row[0]),
            band_name_version_id=int(row[1]),
            base_lineup_version_id=int(row[2]),
            next_lineup_version_id=None,
        )
        for row in rows
    ]
    contexts.update(validate_lineup_contexts(cur, requests, live_id=live_id))
    return True


def _validate_transition_performance_bindings(
    cur: Any,
    *,
    live_id: int,
    rows: list[dict[str, Any]],
    contexts: dict[int, PersistedLineupContext],
) -> None:
    transition_band_ids = {
        performance.band_id
        for row in rows
        for performance in row["band_performances"]
        if performance.lineup_usage in {"next", "handover"}
    }
    for band_id in sorted(transition_band_ids):
        context = contexts.get(band_id)
        if context is None or context.next_lineup_version_id is None:
            raise HTTPException(
                status_code=400,
                detail=f"Band {band_id} has no transition lineup context for Live {live_id}",
            )
        cur.execute(
            """
            SELECT 1
            FROM band_lineup_versions
            WHERE id = %s
              AND band_id = %s
              AND transition_live_id = %s
            """,
            (context.next_lineup_version_id, band_id, live_id),
        )
        if cur.fetchone() is None:
            raise HTTPException(
                status_code=400,
                detail=f"Band {band_id} can use next/handover only on its bound transition Live",
            )


def _build_live_mutation_item(
    *,
    live_id: int,
    payload: ConsoleLiveBaseRequest,
    opening_time: str | None,
    start_time: str | None,
    normalized_event_attendees: list[dict[str, Any]],
    lineup_contexts: dict[int, PersistedLineupContext],
    venue_name_version_id: int | None,
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
        "venue_name_version_id": venue_name_version_id,
        "default_band_ids": payload.default_band_ids,
        "event_attendees": normalized_event_attendees,
        "band_lineup_contexts": _serialize_lineup_contexts(lineup_contexts),
        "event_status": payload.event_status,
        "status_note": payload.status_note,
        "date_phase": build_public_live_status(
            event_status=payload.event_status,
            live_date=payload.live_date,
            start_time=start_time,
            timezone_offset_minutes=_timezone_offset_minutes(payload.timezone),
            was_rescheduled=False,
        )["date_phase"],
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
    payload: ConsoleLiveCreateRequest,
    request: Request,
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    """Insert one live_attrs row from the console live form and record the corresponding audit log."""
    assert_valid_csrf(request, context)

    opening_time = _normalize_optional_time_with_timezone(payload.opening_time, payload.timezone)
    start_time = _normalize_optional_time_with_timezone(payload.start_time, payload.timezone)
    timezone_offset_minutes = _timezone_offset_minutes(payload.timezone)

    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                normalized_event_attendees, persisted_event_attendees, lineup_contexts = _validate_and_normalize_live_relations(
                    cur,
                    payload,
                )
                venue_name_version_id = _resolve_venue_name_version(cur, payload)

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
                        venue_name_version_id,
                        default_band_ids,
                        event_attendees,
                        event_status,
                        status_note,
                        timezone_offset_minutes
                    )
                    VALUES (%s, %s, %s, false, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                        venue_name_version_id,
                        payload.default_band_ids,
                        Json(persisted_event_attendees),
                        payload.event_status,
                        payload.status_note,
                        timezone_offset_minutes,
                    ),
                )
                created_row = cur.fetchone()
                assert created_row is not None
                live_id = int(created_row[0])
                if lineup_contexts:
                    replace_lineup_contexts(cur, live_id, lineup_contexts)

                audit_payload = {
                    "venue_id": payload.venue_id,
                    "venue_name_version_id": venue_name_version_id,
                    "opening_time": opening_time,
                    "start_time": start_time,
                    "live_type": payload.live_type,
                    "default_band_ids": payload.default_band_ids,
                    "event_attendees": normalized_event_attendees,
                    "band_lineup_contexts": _serialize_lineup_contexts(lineup_contexts),
                    "event_status": payload.event_status,
                    "status_note": payload.status_note,
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
            lineup_contexts=lineup_contexts,
            venue_name_version_id=venue_name_version_id,
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
    payload: ConsoleLiveUpdateRequest,
    request: Request,
    live_id: int = Path(..., ge=1, description="Target live_id"),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    """Update one Live under a row lock and record only meaningful field changes."""
    assert_valid_csrf(request, context)
    opening_time = _normalize_optional_time_with_timezone(payload.opening_time, payload.timezone)
    start_time = _normalize_optional_time_with_timezone(payload.start_time, payload.timezone)
    timezone_offset_minutes = _timezone_offset_minutes(payload.timezone)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT to_jsonb(l) FROM live_attrs l WHERE l.id = %s FOR UPDATE", (live_id,))
                existing_row = cur.fetchone()
                if existing_row is None:
                    raise HTTPException(status_code=404, detail=f"Live id {live_id} not found")
                existing = dict(existing_row[0])
                existing.setdefault("event_status", "scheduled")
                existing.setdefault("status_note", None)
                existing["opening_time"] = (
                    _normalize_persisted_time_with_timezone(existing["opening_time"])
                    if existing.get("opening_time") is not None else None
                )
                existing["start_time"] = (
                    _normalize_persisted_time_with_timezone(existing["start_time"])
                    if existing.get("start_time") is not None else None
                )
                existing.setdefault("timezone_offset_minutes", timezone_offset_minutes)
                cur.execute("SELECT 1 FROM live_setlist WHERE live_id = %s LIMIT 1", (live_id,))
                has_setlist = cur.fetchone() is not None
                existing_lineup_contexts = load_lineup_contexts(cur, live_id)
                if has_setlist:
                    normalized_event_attendees, persisted_event_attendees, _ = _validate_and_normalize_live_relations(
                        cur,
                        payload,
                        existing_contexts=existing_lineup_contexts,
                    )
                    lineup_contexts = existing_lineup_contexts
                else:
                    normalized_event_attendees, persisted_event_attendees, lineup_contexts = (
                        _validate_and_normalize_live_relations(
                            cur,
                            payload,
                            existing_contexts=existing_lineup_contexts,
                        )
                    )
                venue_name_version_id = _resolve_venue_name_version(cur, payload)
                existing["band_lineup_contexts"] = _serialize_lineup_contexts(existing_lineup_contexts)
                target = {
                    "live_date": _format_date(payload.live_date),
                    "live_title": payload.live_title,
                    "live_type": payload.live_type,
                    "url": payload.url,
                    "opening_time": opening_time,
                    "start_time": start_time,
                    "venue_id": payload.venue_id,
                    "venue_name_version_id": venue_name_version_id,
                    "default_band_ids": payload.default_band_ids,
                    "event_attendees": persisted_event_attendees,
                    "band_lineup_contexts": _serialize_lineup_contexts(lineup_contexts),
                    "event_status": payload.event_status,
                    "status_note": payload.status_note,
                    "timezone_offset_minutes": timezone_offset_minutes,
                }
                changes = {
                    field: {"before": existing.get(field), "after": value}
                    for field, value in target.items()
                    if existing.get(field) != value
                }
                schedule_fields = {"live_date", "opening_time", "start_time", "venue_id", "venue_name_version_id", "timezone_offset_minutes"}
                changed_schedule_fields = schedule_fields.intersection(changes)
                announcement_only = bool(changed_schedule_fields) and all(
                    field in {"opening_time", "start_time", "venue_id", "venue_name_version_id"}
                    and existing.get(field) is None
                    and target[field] is not None
                    for field in changed_schedule_fields
                )
                if changed_schedule_fields and not announcement_only and payload.schedule_change_kind is None:
                    raise HTTPException(
                        status_code=422,
                        detail="schedule_change_kind is required when schedule fields change",
                    )
                if (not changed_schedule_fields or announcement_only) and payload.schedule_change_kind is not None:
                    raise HTTPException(
                        status_code=422,
                        detail="schedule_change_kind is only allowed when schedule fields change",
                    )
                if changes:
                    if payload.schedule_change_kind == "reschedule":
                        cur.execute(
                            """
                            INSERT INTO live_schedule_history (
                                live_id,
                                previous_live_title,
                                previous_live_date,
                                previous_opening_time,
                                previous_start_time,
                                previous_venue_id,
                                previous_venue_name_version_id,
                                changed_by,
                                note
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                live_id,
                                existing["live_title"],
                                existing["live_date"],
                                existing["opening_time"],
                                existing["start_time"],
                                existing["venue_id"],
                                existing.get("venue_name_version_id"),
                                context.user.id,
                                payload.schedule_change_note,
                            ),
                        )
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
                            venue_name_version_id = %s,
                            default_band_ids = %s,
                            event_attendees = %s,
                            event_status = %s,
                            status_note = %s,
                            timezone_offset_minutes = %s
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
                            venue_name_version_id,
                            payload.default_band_ids,
                            Json(persisted_event_attendees),
                            payload.event_status,
                            payload.status_note,
                            timezone_offset_minutes,
                            live_id,
                        ),
                    )
                    if not has_setlist:
                        replace_lineup_contexts(cur, live_id, lineup_contexts)
                    _write_console_audit_log(
                        cur,
                        user_id=context.user.id,
                        action="live_update",
                        resource_type="live",
                        resource_id=str(live_id),
                        payload_json={
                            "changes": changes,
                            "schedule_change_kind": payload.schedule_change_kind,
                            "schedule_change_note": payload.schedule_change_note,
                        },
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
            lineup_contexts=lineup_contexts,
            venue_name_version_id=venue_name_version_id,
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
        normalized_row: dict[str, Any] = {
            "song_id": row.song_id,
            "absolute_order": row.absolute_order,
            "segment_type": _normalize_segment_type(row.segment_type),
            "sub_order": row.sub_order,
            "is_short": row.is_short,
            "band_performances": row.band_performances,
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

                lineup_contexts = load_lineup_contexts(cur, live_id)
                requested_band_ids = {
                    performance.band_id
                    for row in normalized_rows
                    for performance in row["band_performances"]
                }
                added_current_contexts = _ensure_current_performance_contexts(
                    cur,
                    live_id=live_id,
                    contexts=lineup_contexts,
                    band_ids=requested_band_ids,
                )
                _validate_transition_performance_bindings(
                    cur,
                    live_id=live_id,
                    rows=normalized_rows,
                    contexts=lineup_contexts,
                )
                if added_current_contexts:
                    replace_lineup_contexts(cur, live_id, lineup_contexts)

                for normalized_row in sorted(normalized_rows, key=lambda item: item["absolute_order"]):
                    band_performances = normalized_row["band_performances"]
                    persisted_performances = build_band_performances(
                        band_performances,
                        lineup_contexts,
                    )
                    insert_values = (
                        live_id,
                        normalized_row["song_id"],
                        normalized_row["absolute_order"],
                        normalized_row["segment_type"],
                        normalized_row["sub_order"],
                        normalized_row["is_short"],
                        Json(normalized_row["other_member"]) if normalized_row["other_member"] is not None else None,
                        normalized_row["comment"],
                    )
                    if persisted_performances:
                        cur.execute(
                            """
                            INSERT INTO live_setlist (
                                live_id, song_id, absolute_order, segment_type, sub_order,
                                is_short, other_member, comment
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                            RETURNING id::text
                            """,
                            insert_values,
                        )
                        setlist_id = str(cur.fetchone()[0])
                        persist_band_performances(
                            cur,
                            setlist_id=setlist_id,
                            live_id=live_id,
                            performances=persisted_performances,
                        )
                    else:
                        cur.execute(
                            """
                            INSERT INTO live_setlist (
                                live_id, song_id, absolute_order, segment_type, sub_order,
                                is_short, other_member, comment
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            insert_values,
                        )

                cur.execute("SELECT COUNT(*) FROM live_setlist WHERE live_id = %s", (live_id,))
                count_row = cur.fetchone()
                assert count_row is not None
                total_setlist_row_count = int(count_row[0])

                audit_payload: dict[str, Any] = {
                    "inserted_row_count": len(normalized_rows),
                    "total_setlist_row_count": total_setlist_row_count,
                }
                versioned_performance_count = sum(
                    len(row["band_performances"]) for row in normalized_rows
                )
                if versioned_performance_count > 0:
                    audit_payload.update({
                        "lineup_context_count": len(lineup_contexts),
                        "versioned_performance_count": versioned_performance_count,
                    })
                _write_console_audit_log(
                    cur,
                    user_id=context.user.id,
                    action="live_setlist_append",
                    resource_type="live",
                    resource_id=str(live_id),
                    payload_json=audit_payload,
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
            "band_performances": row.band_performances,
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
                lineup_contexts = load_lineup_contexts(cur, live_id)
                requested_band_ids = {
                    performance.band_id
                    for row in normalized_rows
                    for performance in row["band_performances"]
                }
                added_current_contexts = _ensure_current_performance_contexts(
                    cur,
                    live_id=live_id,
                    contexts=lineup_contexts,
                    band_ids=requested_band_ids,
                )
                _validate_transition_performance_bindings(
                    cur,
                    live_id=live_id,
                    rows=normalized_rows,
                    contexts=lineup_contexts,
                )
                prepared_rows: list[tuple[dict[str, Any], list[Any]]] = []
                for normalized_row in normalized_rows:
                    band_performances = normalized_row["band_performances"]
                    persisted_performances = build_band_performances(
                        band_performances,
                        lineup_contexts,
                    )
                    prepared_rows.append((normalized_row, persisted_performances))
                cur.execute("DELETE FROM live_setlist WHERE live_id = %s", (live_id,))
                if added_current_contexts:
                    replace_lineup_contexts(cur, live_id, lineup_contexts)
                for normalized_row, persisted_performances in sorted(
                    prepared_rows,
                    key=lambda item: item[0]["absolute_order"],
                ):
                    insert_values = (
                        live_id,
                        normalized_row["song_id"],
                        normalized_row["absolute_order"],
                        normalized_row["segment_type"],
                        normalized_row["sub_order"],
                        normalized_row["is_short"],
                        Json(normalized_row["other_member"]) if normalized_row["other_member"] is not None else None,
                        normalized_row["comment"],
                    )
                    if persisted_performances:
                        cur.execute(
                            """
                            INSERT INTO live_setlist (
                                live_id, song_id, absolute_order, segment_type, sub_order,
                                is_short, other_member, comment
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                            RETURNING id::text
                            """,
                            insert_values,
                        )
                        setlist_id = str(cur.fetchone()[0])
                        persist_band_performances(
                            cur,
                            setlist_id=setlist_id,
                            live_id=live_id,
                            performances=persisted_performances,
                        )
                    else:
                        cur.execute(
                            """
                            INSERT INTO live_setlist (
                                live_id, song_id, absolute_order, segment_type, sub_order,
                                is_short, other_member, comment
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            insert_values,
                        )
                audit_payload = {"row_count": len(normalized_rows)}
                versioned_performance_count = sum(
                    len(row["band_performances"]) for row in normalized_rows
                )
                if versioned_performance_count > 0:
                    audit_payload.update({
                        "lineup_context_count": len(lineup_contexts),
                        "versioned_performance_count": versioned_performance_count,
                    })
                _write_console_audit_log(
                    cur,
                    user_id=context.user.id,
                    action="live_setlist_update",
                    resource_type="live",
                    resource_id=str(live_id),
                    payload_json=audit_payload,
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
