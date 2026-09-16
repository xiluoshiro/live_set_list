from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from psycopg2 import Error
from psycopg2.extras import RealDictCursor

from app.auth import AuthSessionContext, assert_valid_csrf, get_current_auth_context, require_role
from app.db import get_db_connection, get_write_db_connection
from app.live_timezone import ResolvedLiveTimezone
from app.routers.console_venues import _raise_database_error
from app.routers.console_write import (
    _normalize_optional_time_for_timezone,
    _normalize_persisted_time_with_timezone,
    _timezone_offset_for_live,
    _write_console_audit_log,
)
from app.schemas.timezone_reviews import (
    TimezoneReviewApplyRequest,
    TimezoneReviewItem,
    TimezoneReviewMutationResponse,
    TimezoneReviewPage,
    TimezoneReviewRetainRequest,
)

router = APIRouter(dependencies=[Depends(require_role("editor"))])

REVIEW_SELECT = """
    SELECT
        live.id AS live_id,
        live.live_date,
        live.live_title,
        live.venue_id,
        venue.venue AS venue_name,
        live.timezone_source,
        live.timezone_id AS snapshot_timezone_id,
        live.timezone_source_revision AS snapshot_source_revision,
        CASE
            WHEN live.timezone_source = 'venue' THEN COALESCE(venue.timezone_id, venue_locality.timezone_id)
            WHEN live.timezone_source = 'locality' THEN announced_locality.timezone_id
        END AS current_timezone_id,
        CASE
            WHEN live.timezone_source = 'venue' THEN venue.location_revision
            WHEN live.timezone_source = 'locality' THEN announced_locality.revision
        END AS current_source_revision,
        live.opening_time,
        live.start_time,
        live.opening_time_fold,
        live.start_time_fold,
        live.timezone_offset_minutes AS snapshot_offset_minutes,
        retained.reason AS retained_reason,
        retained.created_at AS retained_at,
        CASE
            WHEN live.timezone_source = 'legacy_offset' THEN 'legacy_exception'
            WHEN live.timezone_source = 'explicit' THEN 'unaffected'
            WHEN live.timezone_id IS DISTINCT FROM (
                CASE
                    WHEN live.timezone_source = 'venue' THEN COALESCE(venue.timezone_id, venue_locality.timezone_id)
                    WHEN live.timezone_source = 'locality' THEN announced_locality.timezone_id
                END
            ) AND retained.id IS NOT NULL THEN 'retained'
            WHEN live.timezone_id IS DISTINCT FROM (
                CASE
                    WHEN live.timezone_source = 'venue' THEN COALESCE(venue.timezone_id, venue_locality.timezone_id)
                    WHEN live.timezone_source = 'locality' THEN announced_locality.timezone_id
                END
            ) THEN 'needs_review'
            WHEN live.timezone_source_revision IS DISTINCT FROM (
                CASE
                    WHEN live.timezone_source = 'venue' THEN venue.location_revision
                    WHEN live.timezone_source = 'locality' THEN announced_locality.revision
                END
            ) THEN 'revision_only'
            ELSE 'current'
        END AS status
    FROM live_attrs live
    LEFT JOIN venue_list venue ON venue.id = live.venue_id
    LEFT JOIN geo_localities venue_locality ON venue_locality.id = venue.locality_id
    LEFT JOIN geo_localities announced_locality ON announced_locality.id = live.announced_locality_id
    LEFT JOIN LATERAL (
        SELECT resolution.id, resolution.reason, resolution.created_at
        FROM live_timezone_review_resolutions resolution
        WHERE resolution.live_id = live.id
          AND resolution.decision = 'retain'
          AND resolution.snapshot_timezone_id = live.timezone_id
          AND resolution.snapshot_source_revision IS NOT DISTINCT FROM live.timezone_source_revision
          AND resolution.target_timezone_id = CASE
                WHEN live.timezone_source = 'venue' THEN COALESCE(venue.timezone_id, venue_locality.timezone_id)
                WHEN live.timezone_source = 'locality' THEN announced_locality.timezone_id
              END
          AND resolution.target_source_revision = CASE
                WHEN live.timezone_source = 'venue' THEN venue.location_revision
                WHEN live.timezone_source = 'locality' THEN announced_locality.revision
              END
        ORDER BY resolution.created_at DESC, resolution.id DESC
        LIMIT 1
    ) retained ON TRUE
"""


def _wall_time(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "replace") and hasattr(value, "isoformat"):
        return value.replace(tzinfo=None).isoformat(timespec="seconds")
    return str(value)[:8]


def _serialize_item(row: dict[str, Any], *, strict_preview: bool = False) -> dict[str, Any]:
    opening = _normalize_persisted_time_with_timezone(row["opening_time"]) if row["opening_time"] is not None else None
    start = _normalize_persisted_time_with_timezone(row["start_time"]) if row["start_time"] is not None else None
    current_opening = None
    current_start = None
    current_offset = None
    preview_error = None
    target_timezone = row["current_timezone_id"]
    target_revision = row["current_source_revision"]
    if row["timezone_source"] in {"venue", "locality"} and target_timezone and target_revision:
        resolved = ResolvedLiveTimezone(str(target_timezone), row["timezone_source"], int(target_revision))
        try:
            current_opening = _normalize_optional_time_for_timezone(
                _wall_time(row["opening_time"]), live_date=row["live_date"], resolved=resolved,
                fold=row["opening_time_fold"], legacy_offset_minutes=row["snapshot_offset_minutes"],
            )
            current_start = _normalize_optional_time_for_timezone(
                _wall_time(row["start_time"]), live_date=row["live_date"], resolved=resolved,
                fold=row["start_time_fold"], legacy_offset_minutes=row["snapshot_offset_minutes"],
            )
            current_offset = _timezone_offset_for_live(
                live_date=row["live_date"], opening_time=current_opening, start_time=current_start,
                resolved=resolved, legacy_offset_minutes=row["snapshot_offset_minutes"],
            )
        except HTTPException as exc:
            if strict_preview:
                raise
            preview_error = str(exc.detail)
    elif row["status"] == "needs_review":
        preview_error = "当前来源没有可用的 IANA 时区或修订号"
    return {
        **row,
        "opening_time": opening,
        "start_time": start,
        "current_opening_time": current_opening,
        "current_start_time": current_start,
        "current_offset_minutes": current_offset,
        "preview_error": preview_error,
    }


def _get_item(cur: Any, live_id: int) -> dict[str, Any]:
    cur.execute(REVIEW_SELECT + " WHERE live.id = %s", (live_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "Live 不存在")
    return _serialize_item(dict(row))


def _audit_item(row: dict[str, Any]) -> dict[str, Any]:
    return TimezoneReviewItem.model_validate(_serialize_item(row)).model_dump(mode="json")


@router.get("/timezone-reviews", response_model=TimezoneReviewPage, summary="Live 时区复核列表")
def list_timezone_reviews(
    review_status: Literal[
        "all", "needs_review", "retained", "revision_only", "current", "unaffected", "legacy_exception"
    ] = Query(default="needs_review", alias="status"),
    q: str = Query(default="", max_length=255),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    try:
        with get_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            normalized = q.strip()
            filters = "WHERE (%(q)s = '' OR base.live_title ILIKE %(pattern)s OR COALESCE(base.venue_name, '') ILIKE %(pattern)s)"
            if review_status != "all":
                filters += " AND base.status = %(status)s"
            params: dict[str, Any] = {"q": normalized, "pattern": f"%{normalized}%", "status": review_status}
            cur.execute(
                f"WITH base AS ({REVIEW_SELECT}) SELECT status, COUNT(*) AS count FROM base GROUP BY status"
            )
            counts = {str(row["status"]): int(row["count"]) for row in cur.fetchall()}
            cur.execute(f"WITH base AS ({REVIEW_SELECT}) SELECT COUNT(*) AS total FROM base {filters}", params)
            total = int(cur.fetchone()["total"])
            params.update({"limit": limit, "offset": (page - 1) * limit})
            cur.execute(
                f"WITH base AS ({REVIEW_SELECT}) SELECT * FROM base {filters} "
                "ORDER BY base.live_date DESC, base.live_id DESC LIMIT %(limit)s OFFSET %(offset)s",
                params,
            )
            items = [_serialize_item(dict(row)) for row in cur.fetchall()]
            return {
                "items": items, "page": page, "page_size": limit, "total": total,
                "total_pages": max(1, (total + limit - 1) // limit), "counts": counts,
            }
    except HTTPException:
        raise
    except Error as exc:
        _raise_database_error("list_timezone_reviews", exc)


def _locked_review(cur: Any, live_id: int, payload: TimezoneReviewRetainRequest | TimezoneReviewApplyRequest) -> dict[str, Any]:
    cur.execute(REVIEW_SELECT + " WHERE live.id = %s FOR UPDATE OF live", (live_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "Live 不存在")
    current = dict(row)
    expected = (
        payload.expected_snapshot_timezone_id,
        payload.expected_snapshot_source_revision,
        payload.expected_current_timezone_id,
        payload.expected_current_source_revision,
    )
    actual = (
        current["snapshot_timezone_id"],
        current["snapshot_source_revision"],
        current["current_timezone_id"],
        current["current_source_revision"],
    )
    if actual != expected:
        raise HTTPException(409, "Live 或来源地区资料已更新，请重新加载复核项")
    if current["status"] not in {"needs_review", "retained"}:
        raise HTTPException(409, "该 Live 当前不需要时区复核")
    return current


@router.post(
    "/timezone-reviews/{live_id}/retain",
    response_model=TimezoneReviewMutationResponse,
    summary="保留 Live 历史时区快照",
)
def retain_timezone_snapshot(
    live_id: int,
    payload: TimezoneReviewRetainRequest,
    request: Request,
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            before = _locked_review(cur, live_id, payload)
            cur.execute(
                """
                INSERT INTO live_timezone_review_resolutions (
                    live_id, decision, snapshot_timezone_id, snapshot_source_revision,
                    target_timezone_id, target_source_revision, reason, decided_by
                ) VALUES (%s, 'retain', %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                RETURNING id
                """,
                (
                    live_id, before["snapshot_timezone_id"], before["snapshot_source_revision"],
                    before["current_timezone_id"], before["current_source_revision"], payload.reason, context.user.id,
                ),
            )
            if cur.fetchone() is not None:
                _write_console_audit_log(
                    cur, user_id=context.user.id, action="live_timezone_review_retain",
                    resource_type="live", resource_id=str(live_id),
                    payload_json={"before": _audit_item(before), "reason": payload.reason},
                )
            return {"item": _get_item(cur, live_id)}
    except HTTPException:
        raise
    except Error as exc:
        _raise_database_error("retain_live_timezone", exc)


@router.post(
    "/timezone-reviews/{live_id}/apply-current",
    response_model=TimezoneReviewMutationResponse,
    summary="采用当前来源时区修正 Live",
)
def apply_current_timezone(
    live_id: int,
    payload: TimezoneReviewApplyRequest,
    request: Request,
    context: AuthSessionContext = Depends(get_current_auth_context),
):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            before = _locked_review(cur, live_id, payload)
            opening_fold = (
                payload.opening_time_fold
                if "opening_time_fold" in payload.model_fields_set
                else before["opening_time_fold"]
            )
            start_fold = (
                payload.start_time_fold
                if "start_time_fold" in payload.model_fields_set
                else before["start_time_fold"]
            )
            preview_source = {**before, "opening_time_fold": opening_fold, "start_time_fold": start_fold}
            after_preview = _serialize_item(preview_source, strict_preview=True)
            cur.execute(
                """
                UPDATE live_attrs
                SET opening_time = %s,
                    start_time = %s,
                    timezone_id = %s,
                    timezone_source_revision = %s,
                    timezone_offset_minutes = %s,
                    opening_time_fold = %s,
                    start_time_fold = %s
                WHERE id = %s
                """,
                (
                    after_preview["current_opening_time"], after_preview["current_start_time"],
                    before["current_timezone_id"], before["current_source_revision"],
                    after_preview["current_offset_minutes"], opening_fold, start_fold, live_id,
                ),
            )
            cur.execute(
                """
                INSERT INTO live_timezone_review_resolutions (
                    live_id, decision, snapshot_timezone_id, snapshot_source_revision,
                    target_timezone_id, target_source_revision, decided_by
                ) VALUES (%s, 'apply_current', %s, %s, %s, %s, %s)
                """,
                (
                    live_id, before["snapshot_timezone_id"], before["snapshot_source_revision"],
                    before["current_timezone_id"], before["current_source_revision"], context.user.id,
                ),
            )
            _write_console_audit_log(
                cur, user_id=context.user.id, action="live_timezone_review_apply",
                resource_type="live", resource_id=str(live_id),
                payload_json={
                    "before": _audit_item(before),
                    "after": {
                        "timezone_id": before["current_timezone_id"],
                        "timezone_source_revision": before["current_source_revision"],
                        "opening_time": after_preview["current_opening_time"],
                        "start_time": after_preview["current_start_time"],
                        "timezone_offset_minutes": after_preview["current_offset_minutes"],
                    },
                    "change_kind": "timezone_data_correction",
                },
            )
            return {"item": _get_item(cur, live_id)}
    except HTTPException:
        raise
    except Error as exc:
        _raise_database_error("apply_live_timezone", exc)
