from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled, UniqueViolation
from psycopg2.extras import Json

from app.auth import AuthSessionContext, assert_valid_csrf, get_current_auth_context, require_role
from app.db import get_db_connection, get_write_db_connection
from app.logging_config import get_logger
from app.schemas.band_history import (
    ConsoleBandCreateRequest,
    ConsoleBandCreateResponse,
    ConsoleBandHistoryMutationResponse,
    ConsoleBandHistoryResponse,
    ConsoleBandLineupVersionCreateRequest,
    ConsoleBandNameVersionCreateRequest,
    ConsoleBandTransitionLiveCandidate,
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
        f"SELECT band_name, band_abbr FROM band_attrs WHERE id = %s AND id > 0{suffix}",
        (band_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Band id {band_id} not found")
    cur.execute(
        """
        SELECT band_name, band_abbr, band_members
        FROM current_band_versions
        WHERE band_id = %s
        """,
        (band_id,),
    )
    current_row = cur.fetchone()
    if current_row is None:
        raise HTTPException(status_code=409, detail=f"Band id {band_id} has no current version projection")
    return (
        str(current_row[0]),
        str(current_row[1] or ""),
        [str(member) for member in (current_row[2] or [])],
    )


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
            version.transition_live_id,
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
    members_by_id = {int(row[0]): [str(member) for member in (row[9] or [])] for row in lineup_rows}
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
                "transition_live_id": int(row[7]) if row[7] is not None else None,
                "note": row[8],
                "members": members,
                "added_members": [member for member in members if member not in predecessor_set],
                "removed_members": [
                    member for member in (predecessor_members or []) if member not in member_set
                ],
                "live_ids": [int(value) for value in (row[10] or [])],
            }
        )
    current_name_row = next((row for row in name_rows if row[4] is None), None)
    current_lineup_row = next((row for row in lineup_rows if row[4] is None), None)
    if current_name_row is None or current_lineup_row is None:
        raise HTTPException(status_code=409, detail="Band must have exactly one current name and lineup")
    return {
        "band_id": band_id,
        "current_name": current_name,
        "current_abbr": current_abbr,
        "current_members": current_members,
        "current_name_version_id": int(current_name_row[0]),
        "current_lineup_version_id": int(current_lineup_row[0]),
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
                    INSERT INTO band_attrs (id, band_abbr, band_name)
                    VALUES (%s, %s, %s)
                    """,
                    (band_id, payload.band_abbr, payload.band_name),
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
                _ensure_band_name_available(cur, payload.band_name)
                cur.execute(
                    """
                    SELECT id, valid_from
                    FROM band_name_versions
                    WHERE band_id = %s AND valid_to IS NULL
                    FOR UPDATE
                    """,
                    (band_id,),
                )
                open_rows = cur.fetchall()
                if len(open_rows) != 1:
                    raise HTTPException(status_code=409, detail="Band must have exactly one open name version")
                closed_version_id = int(open_rows[0][0])
                if open_rows[0][1] is not None and payload.valid_from <= open_rows[0][1]:
                    raise HTTPException(status_code=409, detail="New name valid_from must be later than the open version")
                cur.execute(
                    "UPDATE band_name_versions SET valid_to = %s WHERE id = %s",
                    (payload.valid_from, closed_version_id),
                )
                cur.execute(
                    """
                    INSERT INTO band_name_versions (
                        band_id, band_name, band_abbr, valid_from, valid_to, note
                    )
                    VALUES (%s, %s, %s, %s, NULL, %s)
                    RETURNING id
                    """,
                    (
                        band_id,
                        payload.band_name,
                        payload.band_abbr,
                        payload.valid_from,
                        payload.note,
                    ),
                )
                version_id = int(cur.fetchone()[0])
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
                        "valid_from": payload.valid_from.isoformat(),
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
                cur.execute(
                    """
                    SELECT id, version_no, valid_from
                    FROM band_lineup_versions
                    WHERE band_id = %s AND valid_to IS NULL
                    FOR UPDATE
                    """,
                    (band_id,),
                )
                open_rows = cur.fetchall()
                if len(open_rows) != 1:
                    raise HTTPException(
                        status_code=409,
                        detail="Band must have exactly one open lineup version",
                    )
                open_version_id = int(open_rows[0][0])
                version_no = int(open_rows[0][1]) + 1
                open_valid_from = open_rows[0][2]
                if open_valid_from is not None and payload.valid_from <= open_valid_from:
                    raise HTTPException(
                        status_code=409,
                        detail="New lineup valid_from must be later than the open version",
                    )

                if payload.transition_live_id is not None:
                    cur.execute(
                        """
                        SELECT live.id
                        FROM live_attrs live
                        JOIN effective_live_bands effective ON effective.live_id = live.id
                        LEFT JOIN live_band_lineup_contexts context
                          ON context.live_id = live.id
                         AND context.band_id = effective.band_id
                        WHERE live.id = %s
                          AND effective.band_id = %s
                          AND live.event_status <> 'cancelled'
                          AND (
                              context.live_id IS NULL
                              OR (
                                  context.base_lineup_version_id = %s
                                  AND context.next_lineup_version_id IS NULL
                              )
                          )
                        """,
                        (payload.transition_live_id, band_id, open_version_id),
                    )
                    if cur.fetchone() is None:
                        raise HTTPException(
                            status_code=400,
                            detail="Transition Live must already exist and be associated with this Band",
                        )

                cur.execute(
                    "UPDATE band_lineup_versions SET valid_to = %s WHERE id = %s",
                    (payload.valid_from, open_version_id),
                )
                cur.execute(
                    """
                    INSERT INTO band_lineup_versions (
                        band_id, version_no, version_label, valid_from, valid_to,
                        predecessor_id, change_type, transition_live_id, note
                    )
                    VALUES (%s, %s, %s, %s, NULL, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        band_id,
                        version_no,
                        payload.version_label,
                        payload.valid_from,
                        open_version_id,
                        payload.change_type,
                        payload.transition_live_id,
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
                if payload.transition_live_id is not None:
                    cur.execute(
                        """
                        INSERT INTO live_band_lineup_contexts (
                            live_id,
                            band_id,
                            band_name_version_id,
                            base_lineup_version_id,
                            next_lineup_version_id,
                            note
                        )
                        SELECT
                            %s,
                            %s,
                            current.band_name_version_id,
                            %s,
                            %s,
                            'Band lineup transition'
                        FROM current_band_versions current
                        WHERE current.band_id = %s
                        ON CONFLICT (live_id, band_id) DO UPDATE
                        SET base_lineup_version_id = EXCLUDED.base_lineup_version_id,
                            next_lineup_version_id = EXCLUDED.next_lineup_version_id,
                            note = EXCLUDED.note
                        """,
                        (
                            payload.transition_live_id,
                            band_id,
                            open_version_id,
                            version_id,
                            band_id,
                        ),
                    )
                cur.execute(
                    """
                    SELECT member_name
                    FROM band_lineup_version_members
                    WHERE lineup_version_id = %s
                    ORDER BY display_order
                    """,
                    (open_version_id,),
                )
                predecessor_members = [str(row[0]) for row in cur.fetchall()]
                _write_audit(
                    cur,
                    user_id=context.user.id,
                    action="band_lineup_version_create",
                    band_id=band_id,
                    payload={
                        "lineup_version_id": version_id,
                        "closed_lineup_version_id": open_version_id,
                        "predecessor_id": open_version_id,
                        "version_no": version_no,
                        "version_label": payload.version_label,
                        "added_members": [member for member in payload.members if member not in predecessor_members],
                        "removed_members": [
                            member for member in predecessor_members if member not in set(payload.members)
                        ],
                        "valid_from": payload.valid_from.isoformat(),
                        "change_type": payload.change_type,
                        "transition_live_id": payload.transition_live_id,
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
    "/bands/{band_id}/transition-live-candidates",
    response_model=list[ConsoleBandTransitionLiveCandidate],
    summary="按日期查询可绑定的交接 Live",
)
def get_transition_live_candidates(
    band_id: int = Path(..., ge=1),
    live_date: date = Query(...),
    _: Any = Depends(require_role("editor")),
):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                _ensure_real_band(cur, band_id)
                cur.execute(
                    """
                    SELECT live.id, live.live_title, live.live_date
                    FROM live_attrs live
                    JOIN effective_live_bands effective ON effective.live_id = live.id
                    JOIN current_band_versions current ON current.band_id = effective.band_id
                    LEFT JOIN live_band_lineup_contexts context
                      ON context.live_id = live.id
                     AND context.band_id = effective.band_id
                    WHERE effective.band_id = %s
                      AND live.live_date = %s
                      AND live.event_status <> 'cancelled'
                      AND (
                          context.live_id IS NULL
                          OR (
                              context.base_lineup_version_id = current.lineup_version_id
                              AND context.next_lineup_version_id IS NULL
                          )
                      )
                    ORDER BY live.id
                    """,
                    (band_id, live_date),
                )
                rows = cur.fetchall()
    except HTTPException:
        raise
    except (QueryCanceled, OperationalError, Error) as exc:
        logger.exception("get_transition_live_candidates failed band_id=%s", band_id)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    return [
        {"live_id": int(row[0]), "live_name": str(row[1]), "live_date": row[2]}
        for row in rows
    ]
