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
from app.live_timezone import normalize_live_times, time_offset, serialize_time
from app.logging_config import get_logger
from app.live_status import build_public_live_status
from app.schemas import ErrorResponse, ValidationErrorResponse
from app.schemas.auth import AuthErrorResponse
from app.song_catalog import require_setlist_date
from app.schemas.song_catalog import SongMutation, VersionCreate, VersionUpdate
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
    """Validate the explicit Venue/name-version pair required by the console contract."""
    if payload.venue_id is None:
        return None
    cur.execute(
        """
        SELECT version.id
        FROM venue_list venue
        JOIN venue_name_versions version ON version.venue_id = venue.id
        WHERE venue.id = %s
          AND version.id = %s
        """,
        (payload.venue_id, payload.venue_name_version_id),
    )
    row = cur.fetchone()
    if row is None:
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
    announced_locality_id: int | None,
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
        "announced_locality_id": announced_locality_id,
        "default_band_ids": payload.default_band_ids,
        "event_attendees": normalized_event_attendees,
        "band_lineup_contexts": _serialize_lineup_contexts(lineup_contexts),
        "event_status": payload.event_status,
        "status_note": payload.status_note,
        "date_phase": build_public_live_status(
            event_status=payload.event_status,
            live_date=payload.live_date,
            start_time=start_time,
            opening_time=opening_time,
            was_rescheduled=False,
        )["date_phase"],
    }


@router.post(
    "/songs",
    status_code=201,
    response_model=SongMutation | ConsoleSongMutationResponse,
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
    payload: VersionCreate | ConsoleSongCreateRequest,
    request: Request,
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    """Insert one new song from the console page after auth, CSRF, and band checks pass."""
    if isinstance(payload, VersionCreate):
        from app.routers.console_song_catalog import create_version
        return create_version(payload, request, context)
    assert_valid_csrf(request, context)

    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM band_attrs WHERE id = %s", (payload.band_id,))
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail=f"Band id {payload.band_id} not found")

                cur.execute(
                    """
                    WITH input(song_name, band_id, is_cover) AS (VALUES (%s, %s, %s)),
                    new_group AS (INSERT INTO song_groups(group_name) SELECT song_name FROM input
                        WHERE NOT EXISTS(SELECT 1 FROM song_list s WHERE s.song_name=input.song_name
                            AND s.band_id=input.band_id AND s.version_label='') RETURNING id)
                    INSERT INTO song_list (song_name, band_id, is_cover, group_id)
                    SELECT input.*, new_group.id FROM input CROSS JOIN new_group
                    RETURNING id
                    """,
                    (payload.song_name, payload.band_id, payload.cover),
                )
                created_row = cur.fetchone()
                if created_row is None:
                    raise HTTPException(status_code=409, detail=f"Song name already exists: {payload.song_name}")
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
    response_model=SongMutation | ConsoleSongMutationResponse,
    summary="更新歌曲",
    description="`editor+` 用户更新歌曲名称、归属 Band 和翻唱属性。",
)
def update_song(
    payload: VersionUpdate | ConsoleSongUpdateRequest,
    request: Request,
    song_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    if isinstance(payload, VersionUpdate):
        from app.routers.console_song_catalog import update_version
        return update_version(payload, song_id, request, context)
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
                    SET song_name = %s, band_id = %s, is_cover = %s, revision = revision + 1
                    WHERE id = %s AND owner_mode IS NULL
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
                            WITH input(song_name, band_id, is_cover) AS (VALUES (%s, %s, %s)),
                            new_group AS (INSERT INTO song_groups(group_name) SELECT song_name FROM input
                                WHERE NOT EXISTS(SELECT 1 FROM song_list s WHERE s.song_name=input.song_name
                                    AND s.band_id=input.band_id AND s.version_label='') RETURNING id)
                            INSERT INTO song_list (song_name, band_id, is_cover, group_id)
                            SELECT input.*, new_group.id FROM input CROSS JOIN new_group
                            RETURNING id
                            """,
                            (song.song_name, song.band_id, song.cover),
                        )
                        created_row = cur.fetchone()
                        if created_row is None:
                            cur.execute("RELEASE SAVEPOINT batch_song_sp")
                            continue
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

    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                normalized_event_attendees, persisted_event_attendees, lineup_contexts = _validate_and_normalize_live_relations(
                    cur,
                    payload,
                )
                venue_name_version_id = _resolve_venue_name_version(cur, payload)
                opening_time, start_time = normalize_live_times(
                    cur, live_date=payload.live_date, venue_id=payload.venue_id,
                    announced_locality_id=payload.announced_locality_id, offset=payload.timezone,
                    opening_time=payload.opening_time, start_time=payload.start_time,
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
                        venue_name_version_id,
                        announced_locality_id,
                        default_band_ids,
                        event_attendees,
                        event_status,
                        status_note
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
                        payload.announced_locality_id,
                        payload.default_band_ids,
                        Json(persisted_event_attendees),
                        payload.event_status,
                        payload.status_note,
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
                    "announced_locality_id": payload.announced_locality_id,
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
            announced_locality_id=payload.announced_locality_id,
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
                existing.setdefault("announced_locality_id", None)
                existing["opening_time"] = (
                    serialize_time(existing["opening_time"])
                    if existing.get("opening_time") is not None else None
                )
                existing["start_time"] = (
                    serialize_time(existing["start_time"])
                    if existing.get("start_time") is not None else None
                )
                cur.execute("SELECT 1 FROM live_setlist WHERE live_id = %s LIMIT 1", (live_id,))
                has_setlist = cur.fetchone() is not None
                if has_setlist and (str(existing["live_date"]) != str(payload.live_date) or payload.event_status == "cancelled"):
                    raise HTTPException(409, "已有歌单的演出不允许修改日期或取消")
                if (payload.schedule_change_kind == "reschedule" or (payload.event_status == "postponed" and existing["event_status"] != "postponed")) and str(existing["live_date"]) == str(payload.live_date):
                    raise HTTPException(422, "延期必须指定新的演出日期")
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
                opening_time, start_time = normalize_live_times(
                    cur, live_date=payload.live_date, venue_id=payload.venue_id,
                    announced_locality_id=payload.announced_locality_id, offset=payload.timezone,
                    opening_time=payload.opening_time, start_time=payload.start_time,
                )
                same_schedule = (
                    str(existing["live_date"]) == str(payload.live_date)
                    and existing.get("venue_id") == payload.venue_id
                    and all((str(existing[key])[:len(value)] if existing.get(key) and value else None) == (value if value else None)
                            for key, value in (("opening_time", payload.opening_time), ("start_time", payload.start_time)))
                    and (payload.timezone is None or payload.timezone == time_offset(existing.get("start_time") or existing.get("opening_time")))
                )
                if same_schedule:
                    opening_time, start_time = existing.get("opening_time"), existing.get("start_time")
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
                    "announced_locality_id": payload.announced_locality_id,
                    "default_band_ids": payload.default_band_ids,
                    "event_attendees": persisted_event_attendees,
                    "band_lineup_contexts": _serialize_lineup_contexts(lineup_contexts),
                    "event_status": payload.event_status,
                    "status_note": payload.status_note,
                }
                changes = {
                    field: {"before": existing.get(field), "after": value}
                    for field, value in target.items()
                    if existing.get(field) != value
                }
                schedule_fields = {
                    "live_date", "opening_time", "start_time", "venue_id", "venue_name_version_id", "announced_locality_id",
                }
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
                                previous_announced_locality_id,
                                changed_by,
                                note
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                live_id,
                                existing["live_title"],
                                existing["live_date"],
                                existing["opening_time"],
                                existing["start_time"],
                                existing["venue_id"],
                                existing.get("venue_name_version_id"),
                                existing.get("announced_locality_id"),
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
                            announced_locality_id = %s,
                            default_band_ids = %s,
                            event_attendees = %s,
                            event_status = %s,
                            status_note = %s
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
                            payload.announced_locality_id,
                            payload.default_band_ids,
                            Json(persisted_event_attendees),
                            payload.event_status,
                            payload.status_note,
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
            announced_locality_id=payload.announced_locality_id,
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
    song_group_ids_in_request: list[int] = []

    for row in payload.setlist_rows:
        if row.absolute_order in seen_absolute_orders:
            _raise_business_error(
                status.HTTP_400_BAD_REQUEST,
                f"Duplicate absolute_order in setlist_rows: {row.absolute_order}",
            )
        seen_absolute_orders.add(row.absolute_order)
        normalized_row: dict[str, Any] = {
            "song_group_id": row.song_group_id,
            "absolute_order": row.absolute_order,
            "segment_type": _normalize_segment_type(row.segment_type),
            "sub_order": row.sub_order,
            "is_short": row.is_short,
            "band_performances": row.band_performances,
            "other_member": _normalize_other_member_payload(row.other_member),
            "comment": row.comment,
        }
        normalized_rows.append(normalized_row)
        song_group_ids_in_request.append(row.song_group_id)

    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM live_attrs WHERE id = %s FOR UPDATE", (live_id,))
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail=f"Live id {live_id} not found")
                require_setlist_date(cur, live_id)

                cur.execute("SELECT 1 FROM live_setlist WHERE live_id = %s LIMIT 1", (live_id,))
                if cur.fetchone() is not None:
                    raise HTTPException(status_code=409, detail=f"Live id {live_id} already has setlist data")

                deduped_song_group_ids = list(dict.fromkeys(song_group_ids_in_request))
                cur.execute("SELECT id FROM song_groups WHERE id = ANY(%s)", (deduped_song_group_ids,))
                existing_song_group_ids = {int(row[0]) for row in cur.fetchall()}
                missing_song_group_ids = [song_group_id for song_group_id in deduped_song_group_ids if song_group_id not in existing_song_group_ids]
                if len(missing_song_group_ids) > 0:
                    missing_text = ", ".join(str(song_group_id) for song_group_id in missing_song_group_ids)
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
                        normalized_row["song_group_id"],
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
                                live_id, song_group_id, absolute_order, segment_type, sub_order,
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
                                live_id, song_group_id, absolute_order, segment_type, sub_order,
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
            "song_group_id": row.song_group_id,
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
                require_setlist_date(cur, live_id)
                song_group_ids = list(dict.fromkeys(item["song_group_id"] for item in normalized_rows))
                cur.execute("SELECT id FROM song_groups WHERE id = ANY(%s)", (song_group_ids,))
                existing_song_group_ids = {int(row[0]) for row in cur.fetchall()}
                missing_song_group_ids = [song_group_id for song_group_id in song_group_ids if song_group_id not in existing_song_group_ids]
                if missing_song_group_ids:
                    raise HTTPException(status_code=404, detail=f"Song ids not found: {', '.join(map(str, missing_song_group_ids))}")
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
                        normalized_row["song_group_id"],
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
                                live_id, song_group_id, absolute_order, segment_type, sub_order,
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
                                live_id, song_group_id, absolute_order, segment_type, sub_order,
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
