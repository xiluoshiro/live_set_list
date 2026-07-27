from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled, UniqueViolation
from psycopg2.extras import Json

from app.auth import AuthSessionContext, assert_valid_csrf, get_current_auth_context, require_role
from app.band_history_backfill import inspect_legacy_band_history_backfill
from app.db import get_db_connection, get_write_db_connection
from app.logging_config import get_logger
from app.schemas.band_history import (
    BandHistoryBackfillPreflightResponse,
    ConsoleBandCreateRequest,
    ConsoleBandCreateResponse,
    ConsoleBandHistoryMutationResponse,
    ConsoleBandHistoryResponse,
    ConsoleBandInitializeRequest,
    ConsoleBandLineupCorrectionRequest,
    ConsoleBandLineupImpactResponse,
    ConsoleBandLineupVersionCreateRequest,
    ConsoleBandNameVersionCreateRequest,
)


router = APIRouter()
logger = get_logger(__name__)
REGULAR_BAND_ID_MAX = 99
BAND_ID_ALLOCATION_LOCK_SQL = (
    "SELECT pg_advisory_xact_lock("
    "hashtext('live-set-list'), hashtext('band-id-allocation'))"
)


def _write_audit(
    cur: Any,
    *,
    user_id: int,
    action: str,
    band_id: int,
    payload: dict[str, Any],
) -> None:
    cur.execute(
        """
        INSERT INTO audit_logs (user_id, action, resource_type, resource_id, payload_json)
        VALUES (%s, %s, 'band', %s, %s)
        """,
        (user_id, action, str(band_id), Json(payload)),
    )


def _insert_initial_band_history(
    cur: Any,
    *,
    band_id: int,
    band_name: str,
    band_abbr: str,
    members: list[str],
    version_no: int,
    version_label: str,
    valid_from: date | None,
    valid_to: date | None,
    note: str | None,
) -> tuple[int, int]:
    cur.execute(
        """
        INSERT INTO band_name_versions (
            band_id, band_name, band_abbr, valid_from, valid_to, note
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (band_id, band_name, band_abbr or None, valid_from, valid_to, note),
    )
    name_version_id = int(cur.fetchone()[0])
    cur.execute(
        """
        INSERT INTO band_lineup_versions (
            band_id, version_no, version_label, valid_from, valid_to,
            predecessor_id, change_type, note
        )
        VALUES (%s, %s, %s, %s, %s, NULL, 'initial', %s)
        RETURNING id
        """,
        (band_id, version_no, version_label, valid_from, valid_to, note),
    )
    lineup_version_id = int(cur.fetchone()[0])
    cur.executemany(
        """
        INSERT INTO band_lineup_version_members (
            lineup_version_id, member_name, display_order
        )
        VALUES (%s, %s, %s)
        """,
        [
            (lineup_version_id, member, index)
            for index, member in enumerate(members, start=1)
        ],
    )
    return name_version_id, lineup_version_id


def _allocate_band_id(cur: Any, id_range: str) -> int:
    cur.execute(BAND_ID_ALLOCATION_LOCK_SQL)
    if id_range == "regular":
        cur.execute(
            """
            SELECT COALESCE(MAX(id), 0) + 1
            FROM band_attrs
            WHERE id BETWEEN 1 AND %s
            """,
            (REGULAR_BAND_ID_MAX,),
        )
        band_id = int(cur.fetchone()[0])
        if band_id > REGULAR_BAND_ID_MAX:
            raise HTTPException(status_code=409, detail="Regular Band ID range 1-99 is exhausted")
        return band_id

    cur.execute(
        """
        SELECT COALESCE(MAX(id), 100) + 1
        FROM band_attrs
        WHERE id > 100
        """
    )
    return int(cur.fetchone()[0])


def _ensure_band_name_available(cur: Any, band_name: str) -> None:
    cur.execute(
        """
        SELECT 1
        FROM (
            SELECT band_name FROM band_attrs WHERE id > 0
            UNION ALL
            SELECT band_name FROM band_name_versions
        ) known_name
        WHERE lower(btrim(known_name.band_name)) = lower(btrim(%s))
        LIMIT 1
        """,
        (band_name,),
    )
    if cur.fetchone() is not None:
        raise HTTPException(
            status_code=409,
            detail="Band name already exists in current or historical names",
        )


def _ensure_real_band(cur: Any, band_id: int, *, lock: bool = False) -> tuple[str, str, list[str]]:
    suffix = " FOR UPDATE" if lock else ""
    cur.execute(
        f"SELECT band_name, band_abbr, band_members FROM band_attrs WHERE id = %s AND id > 0{suffix}",
        (band_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Band id {band_id} not found")
    return str(row[0]), str(row[1]), [str(member) for member in (row[2] or [])]


def _ranges_overlap(
    cur: Any,
    *,
    table_name: str,
    band_id: int,
    valid_from: date | None,
    valid_to: date | None,
    exclude_id: int | None = None,
) -> bool:
    id_column = "id"
    query = f"""
        SELECT 1
        FROM {table_name}
        WHERE band_id = %s
          AND daterange(
                COALESCE(valid_from, '-infinity'::date),
                COALESCE(valid_to, 'infinity'::date),
                '[)'
              ) && daterange(
                COALESCE(%s::date, '-infinity'::date),
                COALESCE(%s::date, 'infinity'::date),
                '[)'
              )
    """
    params: list[Any] = [band_id, valid_from, valid_to]
    if exclude_id is not None:
        query += f" AND {id_column} <> %s"
        params.append(exclude_id)
    query += " LIMIT 1"
    cur.execute(query, params)
    return cur.fetchone() is not None


def _lineup_impact(cur: Any, lineup_version_id: int) -> tuple[list[int], int]:
    cur.execute(
        """
        SELECT
            COALESCE(array_agg(DISTINCT context.live_id ORDER BY context.live_id), ARRAY[]::integer[]),
            COUNT(DISTINCT performance.setlist_id)
        FROM live_band_lineup_contexts context
        LEFT JOIN live_setlist_band_performances performance
          ON performance.live_id = context.live_id
         AND performance.band_id = context.band_id
        WHERE context.base_lineup_version_id = %s
           OR context.next_lineup_version_id = %s
        """,
        (lineup_version_id, lineup_version_id),
    )
    row = cur.fetchone()
    assert row is not None
    return [int(value) for value in (row[0] or [])], int(row[1])


def _load_history(cur: Any, band_id: int) -> dict[str, Any]:
    current_name, current_abbr, current_members = _ensure_real_band(cur, band_id)
    cur.execute(
        """
        SELECT
            version.id,
            version.band_name,
            version.band_abbr,
            version.valid_from,
            version.valid_to,
            version.note,
            ARRAY(
                SELECT DISTINCT context.live_id
                FROM live_band_lineup_contexts context
                WHERE context.band_name_version_id = version.id
                ORDER BY context.live_id
            )
        FROM band_name_versions version
        WHERE version.band_id = %s
        ORDER BY version.valid_from NULLS FIRST, version.id
        """,
        (band_id,),
    )
    name_rows = cur.fetchall()
    cur.execute(
        """
        SELECT
            version.id,
            version.version_no,
            version.version_label,
            version.valid_from,
            version.valid_to,
            version.predecessor_id,
            version.change_type,
            version.note,
            ARRAY(
                SELECT member.member_name
                FROM band_lineup_version_members member
                WHERE member.lineup_version_id = version.id
                ORDER BY member.display_order
            ),
            ARRAY(
                SELECT DISTINCT context.live_id
                FROM live_band_lineup_contexts context
                WHERE context.base_lineup_version_id = version.id
                   OR context.next_lineup_version_id = version.id
                ORDER BY context.live_id
            )
        FROM band_lineup_versions version
        WHERE version.band_id = %s
        ORDER BY version.version_no, version.id
        """,
        (band_id,),
    )
    lineup_rows = cur.fetchall()
    members_by_id = {int(row[0]): [str(member) for member in (row[8] or [])] for row in lineup_rows}
    lineups: list[dict[str, Any]] = []
    for row in lineup_rows:
        members = members_by_id[int(row[0])]
        predecessor_members = members_by_id.get(int(row[5])) if row[5] is not None else None
        predecessor_set = set(predecessor_members or [])
        member_set = set(members)
        lineups.append(
            {
                "lineup_version_id": int(row[0]),
                "version_no": int(row[1]),
                "version_label": str(row[2]),
                "valid_from": row[3],
                "valid_to": row[4],
                "predecessor_id": int(row[5]) if row[5] is not None else None,
                "change_type": str(row[6]),
                "note": row[7],
                "members": members,
                "added_members": [member for member in members if member not in predecessor_set],
                "removed_members": [
                    member for member in (predecessor_members or []) if member not in member_set
                ],
                "live_ids": [int(value) for value in (row[9] or [])],
            }
        )
    return {
        "band_id": band_id,
        "current_name": current_name,
        "current_abbr": current_abbr,
        "current_members": current_members,
        "initialized": bool(name_rows) and bool(lineup_rows),
        "name_versions": [
            {
                "name_version_id": int(row[0]),
                "band_name": str(row[1]),
                "band_abbr": row[2],
                "valid_from": row[3],
                "valid_to": row[4],
                "note": row[5],
                "live_ids": [int(value) for value in (row[6] or [])],
            }
            for row in name_rows
        ],
        "lineup_versions": lineups,
    }


@router.post(
    "/bands",
    response_model=ConsoleBandCreateResponse,
    status_code=201,
    summary="新增乐队并初始化 V1 历史",
)
def create_band(
    payload: ConsoleBandCreateRequest,
    request: Request,
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                band_id = _allocate_band_id(cur, payload.id_range)
                _ensure_band_name_available(cur, payload.band_name)
                version_label = f"{payload.band_name} V1"
                cur.execute(
                    """
                    INSERT INTO band_attrs (id, band_abbr, band_name, band_members)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (band_id, payload.band_abbr, payload.band_name, payload.members),
                )
                name_version_id, lineup_version_id = _insert_initial_band_history(
                    cur,
                    band_id=band_id,
                    band_name=payload.band_name,
                    band_abbr=payload.band_abbr,
                    members=payload.members,
                    version_no=1,
                    version_label=version_label,
                    valid_from=payload.valid_from,
                    valid_to=None,
                    note="控制台新增 Band 并初始化 V1",
                )
                _write_audit(
                    cur,
                    user_id=context.user.id,
                    action="band_create",
                    band_id=band_id,
                    payload={
                        "id_range": payload.id_range,
                        "band_name": payload.band_name,
                        "band_abbr": payload.band_abbr,
                        "members": payload.members,
                        "valid_from": payload.valid_from.isoformat() if payload.valid_from else None,
                        "name_version_id": name_version_id,
                        "lineup_version_id": lineup_version_id,
                    },
                )
                history = _load_history(cur, band_id)
    except HTTPException:
        raise
    except UniqueViolation as exc:
        raise HTTPException(status_code=409, detail="Band ID or version conflict; retry the request") from exc
    except QueryCanceled as exc:
        logger.exception("create_band timeout user_id=%s", context.user.id)
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        logger.exception("create_band operational error user_id=%s", context.user.id)
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        logger.exception("create_band failed user_id=%s", context.user.id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "ok": True,
        "item": {
            "band_id": band_id,
            "band_name": payload.band_name,
            "band_abbr": payload.band_abbr,
            "band_members": payload.members,
        },
        "history": history,
    }


@router.get(
    "/bands/history/backfill-preflight",
    response_model=BandHistoryBackfillPreflightResponse,
    summary="预检旧 Setlist 阵容关系回填",
)
def preflight_band_history_backfill(_: Any = Depends(require_role("editor"))):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                return inspect_legacy_band_history_backfill(cur).summary
    except (QueryCanceled, OperationalError, Error) as exc:
        logger.exception("preflight_band_history_backfill failed")
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


@router.get(
    "/bands/{band_id}/history",
    response_model=ConsoleBandHistoryResponse,
    summary="查询乐队名称与阵容历史",
)
def get_band_history(
    band_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                return _load_history(cur, band_id)
    except HTTPException:
        raise
    except (QueryCanceled, OperationalError, Error) as exc:
        logger.exception("get_band_history failed band_id=%s", band_id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


@router.post(
    "/bands/{band_id}/initialize-current",
    response_model=ConsoleBandHistoryMutationResponse,
    status_code=201,
    summary="确认当前乐队资料并初始化版本",
)
def initialize_current_band_history(
    payload: ConsoleBandInitializeRequest,
    request: Request,
    band_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                before_name, before_abbr, before_members = _ensure_real_band(cur, band_id, lock=True)
                cur.execute(
                    """
                    SELECT EXISTS (SELECT 1 FROM band_name_versions WHERE band_id = %s),
                           EXISTS (SELECT 1 FROM band_lineup_versions WHERE band_id = %s)
                    """,
                    (band_id, band_id),
                )
                initialized_row = cur.fetchone()
                assert initialized_row is not None
                if bool(initialized_row[0]) or bool(initialized_row[1]):
                    raise HTTPException(status_code=409, detail="Band history is already initialized")

                cur.execute(
                    """
                    UPDATE band_attrs
                    SET band_name = %s, band_abbr = %s, band_members = %s
                    WHERE id = %s
                    """,
                    (payload.band_name, payload.band_abbr, payload.members, band_id),
                )
                name_version_id, lineup_version_id = _insert_initial_band_history(
                    cur,
                    band_id=band_id,
                    band_name=payload.band_name,
                    band_abbr=payload.band_abbr,
                    members=payload.members,
                    version_no=payload.version_no,
                    version_label=payload.version_label,
                    valid_from=payload.valid_from,
                    valid_to=payload.valid_to,
                    note=payload.note,
                )
                _write_audit(
                    cur,
                    user_id=context.user.id,
                    action="band_history_initialize",
                    band_id=band_id,
                    payload={
                        "before": {
                            "band_name": before_name,
                            "band_abbr": before_abbr,
                            "members": before_members,
                        },
                        "name_version_id": name_version_id,
                        "lineup_version_id": lineup_version_id,
                        "version_no": payload.version_no,
                        "version_label": payload.version_label,
                        "members": payload.members,
                    },
                )
                history = _load_history(cur, band_id)
    except HTTPException:
        raise
    except UniqueViolation as exc:
        raise HTTPException(status_code=409, detail="Band version number already exists") from exc
    except (QueryCanceled, OperationalError, Error) as exc:
        logger.exception("initialize_current_band_history failed band_id=%s", band_id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    return {"ok": True, "history": history}


@router.post(
    "/bands/{band_id}/name-versions",
    response_model=ConsoleBandHistoryMutationResponse,
    status_code=201,
    summary="新增乐队名称版本",
)
def create_band_name_version(
    payload: ConsoleBandNameVersionCreateRequest,
    request: Request,
    band_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                _ensure_real_band(cur, band_id, lock=True)
                closed_version_id: int | None = None
                if payload.make_current:
                    cur.execute(
                        """
                        SELECT id, valid_from
                        FROM band_name_versions
                        WHERE band_id = %s AND valid_to IS NULL
                        ORDER BY valid_from DESC NULLS LAST, id DESC
                        LIMIT 1
                        """,
                        (band_id,),
                    )
                    open_row = cur.fetchone()
                    if open_row is not None:
                        if open_row[1] is not None and payload.valid_from <= open_row[1]:
                            raise HTTPException(status_code=409, detail="New current name must start after the open version")
                        closed_version_id = int(open_row[0])
                        cur.execute(
                            "UPDATE band_name_versions SET valid_to = %s WHERE id = %s",
                            (payload.valid_from, closed_version_id),
                        )
                if _ranges_overlap(
                    cur,
                    table_name="band_name_versions",
                    band_id=band_id,
                    valid_from=payload.valid_from,
                    valid_to=payload.valid_to,
                ):
                    raise HTTPException(status_code=409, detail="Band name version date range overlaps an existing version")
                cur.execute(
                    """
                    INSERT INTO band_name_versions (
                        band_id, band_name, band_abbr, valid_from, valid_to, note
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        band_id,
                        payload.band_name,
                        payload.band_abbr,
                        payload.valid_from,
                        payload.valid_to,
                        payload.note,
                    ),
                )
                version_id = int(cur.fetchone()[0])
                if payload.make_current:
                    cur.execute(
                        "UPDATE band_attrs SET band_name = %s, band_abbr = %s WHERE id = %s",
                        (payload.band_name, payload.band_abbr or "", band_id),
                    )
                _write_audit(
                    cur,
                    user_id=context.user.id,
                    action="band_name_version_create",
                    band_id=band_id,
                    payload={
                        "name_version_id": version_id,
                        "closed_name_version_id": closed_version_id,
                        "band_name": payload.band_name,
                        "make_current": payload.make_current,
                    },
                )
                history = _load_history(cur, band_id)
    except HTTPException:
        raise
    except (QueryCanceled, OperationalError, Error) as exc:
        logger.exception("create_band_name_version failed band_id=%s", band_id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    return {"ok": True, "history": history}


@router.post(
    "/bands/{band_id}/lineup-versions",
    response_model=ConsoleBandHistoryMutationResponse,
    status_code=201,
    summary="新增乐队阵容版本",
)
def create_band_lineup_version(
    payload: ConsoleBandLineupVersionCreateRequest,
    request: Request,
    band_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                _ensure_real_band(cur, band_id, lock=True)
                if payload.predecessor_id is not None:
                    cur.execute(
                        "SELECT band_id FROM band_lineup_versions WHERE id = %s",
                        (payload.predecessor_id,),
                    )
                    predecessor_row = cur.fetchone()
                    if predecessor_row is None:
                        raise HTTPException(status_code=404, detail="Predecessor lineup version not found")
                    if int(predecessor_row[0]) != band_id:
                        raise HTTPException(status_code=400, detail="Predecessor belongs to another Band")
                cur.execute(
                    "SELECT COALESCE(MAX(version_no), 0) FROM band_lineup_versions WHERE band_id = %s",
                    (band_id,),
                )
                max_row = cur.fetchone()
                assert max_row is not None
                version_no = payload.version_no or int(max_row[0]) + 1
                closed_version_id: int | None = None
                if payload.make_current:
                    cur.execute(
                        """
                        SELECT id, valid_from
                        FROM band_lineup_versions
                        WHERE band_id = %s AND valid_to IS NULL
                        ORDER BY version_no DESC, id DESC
                        LIMIT 1
                        """,
                        (band_id,),
                    )
                    open_row = cur.fetchone()
                    if open_row is not None:
                        if open_row[1] is not None and payload.valid_from <= open_row[1]:
                            raise HTTPException(status_code=409, detail="New current lineup must start after the open version")
                        closed_version_id = int(open_row[0])
                        if payload.predecessor_id != closed_version_id:
                            raise HTTPException(status_code=400, detail="New current lineup must reference the open version")
                        cur.execute(
                            "UPDATE band_lineup_versions SET valid_to = %s WHERE id = %s",
                            (payload.valid_from, closed_version_id),
                        )
                if _ranges_overlap(
                    cur,
                    table_name="band_lineup_versions",
                    band_id=band_id,
                    valid_from=payload.valid_from,
                    valid_to=payload.valid_to,
                ):
                    raise HTTPException(status_code=409, detail="Band lineup version date range overlaps an existing version")
                cur.execute(
                    """
                    INSERT INTO band_lineup_versions (
                        band_id, version_no, version_label, valid_from, valid_to,
                        predecessor_id, change_type, note
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        band_id,
                        version_no,
                        payload.version_label,
                        payload.valid_from,
                        payload.valid_to,
                        payload.predecessor_id,
                        payload.change_type,
                        payload.note,
                    ),
                )
                version_id = int(cur.fetchone()[0])
                cur.executemany(
                    """
                    INSERT INTO band_lineup_version_members (
                        lineup_version_id, member_name, display_order
                    )
                    VALUES (%s, %s, %s)
                    """,
                    [
                        (version_id, member, index)
                        for index, member in enumerate(payload.members, start=1)
                    ],
                )
                if payload.make_current:
                    cur.execute(
                        "UPDATE band_attrs SET band_members = %s WHERE id = %s",
                        (payload.members, band_id),
                    )
                predecessor_members: list[str] = []
                if payload.predecessor_id is not None:
                    cur.execute(
                        """
                        SELECT member_name
                        FROM band_lineup_version_members
                        WHERE lineup_version_id = %s
                        ORDER BY display_order
                        """,
                        (payload.predecessor_id,),
                    )
                    predecessor_members = [str(row[0]) for row in cur.fetchall()]
                _write_audit(
                    cur,
                    user_id=context.user.id,
                    action="band_lineup_version_create",
                    band_id=band_id,
                    payload={
                        "lineup_version_id": version_id,
                        "closed_lineup_version_id": closed_version_id,
                        "predecessor_id": payload.predecessor_id,
                        "version_no": version_no,
                        "version_label": payload.version_label,
                        "added_members": [member for member in payload.members if member not in predecessor_members],
                        "removed_members": [
                            member for member in predecessor_members if member not in set(payload.members)
                        ],
                        "make_current": payload.make_current,
                    },
                )
                history = _load_history(cur, band_id)
    except HTTPException:
        raise
    except UniqueViolation as exc:
        raise HTTPException(status_code=409, detail="Band lineup version number already exists") from exc
    except (QueryCanceled, OperationalError, Error) as exc:
        logger.exception("create_band_lineup_version failed band_id=%s", band_id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    return {"ok": True, "history": history}


@router.get(
    "/bands/{band_id}/lineup-versions/{lineup_version_id}/impact",
    response_model=ConsoleBandLineupImpactResponse,
    summary="预览阵容资料修正影响范围",
)
def get_lineup_correction_impact(
    band_id: int = Path(..., ge=1),
    lineup_version_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM band_lineup_versions WHERE id = %s AND band_id = %s",
                    (lineup_version_id, band_id),
                )
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail="Lineup version not found")
                live_ids, row_count = _lineup_impact(cur, lineup_version_id)
    except HTTPException:
        raise
    except (QueryCanceled, OperationalError, Error) as exc:
        logger.exception("get_lineup_correction_impact failed band_id=%s", band_id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    return {
        "band_id": band_id,
        "lineup_version_id": lineup_version_id,
        "live_ids": live_ids,
        "setlist_row_count": row_count,
    }


@router.put(
    "/bands/{band_id}/lineup-versions/{lineup_version_id}",
    response_model=ConsoleBandHistoryMutationResponse,
    summary="资料修正乐队阵容版本",
)
def correct_band_lineup_version(
    payload: ConsoleBandLineupCorrectionRequest,
    request: Request,
    band_id: int = Path(..., ge=1),
    lineup_version_id: int = Path(..., ge=1),
    _: Any = Depends(require_role("editor")),
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor() as cur:
                _ensure_real_band(cur, band_id, lock=True)
                cur.execute(
                    """
                    SELECT version_label, valid_from, valid_to
                    FROM band_lineup_versions
                    WHERE id = %s AND band_id = %s
                    FOR UPDATE
                    """,
                    (lineup_version_id, band_id),
                )
                version_row = cur.fetchone()
                if version_row is None:
                    raise HTTPException(status_code=404, detail="Lineup version not found")
                live_ids, setlist_row_count = _lineup_impact(cur, lineup_version_id)
                if payload.confirmed_live_ids != live_ids:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Affected Live confirmation mismatch; expected {live_ids}",
                    )
                if _ranges_overlap(
                    cur,
                    table_name="band_lineup_versions",
                    band_id=band_id,
                    valid_from=payload.valid_from,
                    valid_to=payload.valid_to,
                    exclude_id=lineup_version_id,
                ):
                    raise HTTPException(status_code=409, detail="Band lineup version date range overlaps an existing version")
                cur.execute(
                    """
                    SELECT member_name
                    FROM band_lineup_version_members
                    WHERE lineup_version_id = %s
                    ORDER BY display_order
                    """,
                    (lineup_version_id,),
                )
                previous_members = [str(row[0]) for row in cur.fetchall()]
                cur.execute(
                    """
                    UPDATE band_lineup_versions
                    SET version_label = %s,
                        valid_from = %s,
                        valid_to = %s,
                        change_type = 'correction',
                        note = %s
                    WHERE id = %s
                    """,
                    (
                        payload.version_label,
                        payload.valid_from,
                        payload.valid_to,
                        payload.note,
                        lineup_version_id,
                    ),
                )
                cur.execute(
                    "DELETE FROM band_lineup_version_members WHERE lineup_version_id = %s",
                    (lineup_version_id,),
                )
                cur.executemany(
                    """
                    INSERT INTO band_lineup_version_members (
                        lineup_version_id, member_name, display_order
                    )
                    VALUES (%s, %s, %s)
                    """,
                    [
                        (lineup_version_id, member, index)
                        for index, member in enumerate(payload.members, start=1)
                    ],
                )
                if version_row[2] is None:
                    cur.execute(
                        "UPDATE band_attrs SET band_members = %s WHERE id = %s",
                        (payload.members, band_id),
                    )
                _write_audit(
                    cur,
                    user_id=context.user.id,
                    action="band_lineup_version_correct",
                    band_id=band_id,
                    payload={
                        "lineup_version_id": lineup_version_id,
                        "affected_live_ids": live_ids,
                        "affected_setlist_row_count": setlist_row_count,
                        "before": {
                            "version_label": str(version_row[0]),
                            "members": previous_members,
                        },
                        "after": {
                            "version_label": payload.version_label,
                            "members": payload.members,
                        },
                    },
                )
                history = _load_history(cur, band_id)
    except HTTPException:
        raise
    except (QueryCanceled, OperationalError, Error) as exc:
        logger.exception("correct_band_lineup_version failed band_id=%s", band_id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    return {"ok": True, "history": history}
