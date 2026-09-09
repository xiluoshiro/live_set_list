"""Location maintenance is additive: it never updates a Live schedule."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from psycopg2 import Error
from psycopg2.extras import Json, RealDictCursor

from app.auth import AuthSessionContext, assert_valid_csrf, get_current_auth_context, require_role
from app.db import get_db_connection, get_write_db_connection
from app.geography import coordinate_url, place_url, timezone_names
from app.routers.console_venues import _raise_database_error
from app.schemas.geography import (
    Locality, LocalityCreate, LocalityPage, LocationPreview, LocationWrite,
    MapLinkWrite, MapProvider, VenueLocation,
)

router = APIRouter(dependencies=[Depends(require_role("editor"))])


def _audit(cur: Any, context: AuthSessionContext, action: str, resource: str, identifier: int, payload: Any) -> None:
    cur.execute(
        "INSERT INTO audit_logs (user_id, action, resource_type, resource_id, payload_json) VALUES (%s,%s,%s,%s,%s)",
        (context.user.id, action, resource, str(identifier), Json(payload)),
    )


def _venue(cur: Any, venue_id: int, *, lock: bool = False) -> dict[str, Any]:
    cur.execute("SELECT * FROM venue_list WHERE id = %s" + (" FOR UPDATE" if lock else ""), (venue_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "场馆不存在")
    if row["merged_into_venue_id"] is not None:
        raise HTTPException(409, "场馆已合并，请维护目标场馆")
    return dict(row)


def _locality(cur: Any, locality_id: int | None) -> dict[str, Any] | None:
    if locality_id is None:
        return None
    cur.execute("SELECT * FROM geo_localities WHERE id = %s", (locality_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(422, "城市不存在，请重新选择")
    return dict(row)


def _read(cur: Any, row: dict[str, Any]) -> dict[str, Any]:
    locality = _locality(cur, row["locality_id"])
    effective = row["timezone_id"] or (locality["timezone_id"] if locality else None)
    cur.execute("SELECT * FROM venue_map_links WHERE venue_id = %s ORDER BY provider", (row["id"],))
    stored = {item["provider"]: item for item in cur.fetchall()}
    links = []
    for provider in ("google", "apple", "amap"):
        item = stored.get(provider)
        point_url = None
        if row["latitude"] is not None:
            point_url = coordinate_url(provider, float(row["latitude"]), float(row["longitude"]), row["venue"])
        current = bool(item and item["location_revision"] == row["location_revision"])
        target = point_url
        if item and current:
            target = item["provider_url"] or place_url(provider, item["provider_place_id"], row["venue"])
        links.append({
            "provider": provider, "provider_place_id": item["provider_place_id"] if item else None,
            "provider_url": item["provider_url"] if item else None,
            "verified_at": item["verified_at"] if item else None,
            "is_current": current, "url": target, "coordinate_url": point_url,
        })
    return {
        "venue_id": row["id"], "locality": locality, "address": row["address"],
        "latitude": row["latitude"], "longitude": row["longitude"], "timezone_id": row["timezone_id"],
        "effective_timezone_id": effective,
        "timezone_source": ("venue" if row["timezone_id"] else "locality") if effective else None,
        "location_revision": row["location_revision"], "location_verified_at": row["location_verified_at"],
        "map_links": links,
    }


def _validate(cur: Any, row: dict[str, Any], payload: LocationWrite) -> str | None:
    if row["location_revision"] != payload.expected_revision:
        raise HTTPException(409, "场馆资料已更新，请重新加载并检查修改")
    if row["venue_kind"] == "online" and any(value is not None for value in (
        payload.locality_id, payload.address, payload.latitude, payload.longitude, payload.timezone_id,
    )):
        raise HTTPException(422, "线上场馆不保存实体位置，请在活动中指定时间基准")
    locality = _locality(cur, payload.locality_id)
    city_zone = locality["timezone_id"] if locality else None
    if payload.timezone_id and city_zone and payload.timezone_id != city_zone:
        raise HTTPException(422, "场馆时区与城市时区不一致，请先核对所在地资料")
    return payload.timezone_id or city_zone


def _changed(row: dict[str, Any], payload: LocationWrite) -> bool:
    return any(
        (float(row[key]) if key in ("latitude", "longitude") and row[key] is not None else row[key]) != value
        for key, value in payload.model_dump(exclude={"expected_revision", "coordinate_system"}).items()
    )


@router.get("/timezones", response_model=list[str], summary="可用 IANA 时区")
def list_timezones():
    return sorted(timezone_names())


@router.get("/localities", response_model=LocalityPage, summary="搜索已核验城市")
def list_localities(q: str = Query(default="", max_length=120), page: int = Query(default=1, ge=1),
                    limit: int = Query(default=20, ge=1, le=100)):
    pattern = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    where = "concat_ws(' ', country_code, admin_area, locality_name) ILIKE %s ESCAPE '\\'"
    try:
        with get_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"SELECT COUNT(*) AS total FROM geo_localities WHERE {where}", (pattern,))
            total = cur.fetchone()["total"]
            cur.execute(f"SELECT * FROM geo_localities WHERE {where} ORDER BY country_code, locality_name, id LIMIT %s OFFSET %s",
                        (pattern, limit, (page - 1) * limit))
            return {"items": cur.fetchall(), "total": total, "page": page, "page_size": limit}
    except Error as exc:
        _raise_database_error("list_localities", exc)


@router.post("/localities", response_model=Locality, status_code=201, summary="登记已核验城市")
def create_locality(payload: LocalityCreate, request: Request,
                    context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "INSERT INTO geo_localities (country_code, admin_area, locality_name, timezone_id) VALUES (%s,%s,%s,%s) RETURNING *",
                (payload.country_code, payload.admin_area, payload.locality_name, payload.timezone_id),
            )
            row = dict(cur.fetchone())
            _audit(cur, context, "locality_create", "locality", row["id"], payload.model_dump())
            return row
    except Error as exc:
        _raise_database_error("create_locality", exc)


@router.get("/venues/{venue_id}/location", response_model=VenueLocation, summary="场馆所在地与地图")
def get_location(venue_id: int):
    try:
        with get_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            return _read(cur, _venue(cur, venue_id))
    except Error as exc:
        _raise_database_error("get_venue_location", exc)


@router.post("/venues/{venue_id}/location-preview", response_model=LocationPreview, summary="预览位置资料修改")
def preview_location(venue_id: int, payload: LocationWrite):
    try:
        with get_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            row = _venue(cur, venue_id)
            effective = _validate(cur, row, payload)
            before = _read(cur, row)
            cur.execute("SELECT COUNT(*) AS total FROM live_attrs WHERE venue_id = %s", (venue_id,))
            total = cur.fetchone()["total"]
            return {"before": before, "after": payload, "effective_timezone_id": effective, "live_count": total,
                    "invalidated_map_links": sum(item["is_current"] for item in before["map_links"]) if _changed(row, payload) else 0}
    except Error as exc:
        _raise_database_error("preview_venue_location", exc)


@router.put("/venues/{venue_id}/location", response_model=VenueLocation, summary="保存已核对的位置资料")
def save_location(venue_id: int, payload: LocationWrite, request: Request,
                  context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            row = _venue(cur, venue_id, lock=True)
            _validate(cur, row, payload)
            before = VenueLocation.model_validate(_read(cur, row)).model_dump(mode="json")
            if _changed(row, payload):
                cur.execute(
                    """UPDATE venue_list SET locality_id=%s, address=%s, latitude=%s, longitude=%s, timezone_id=%s,
                       location_revision=location_revision+1, location_verified_at=CURRENT_TIMESTAMP WHERE id=%s RETURNING *""",
                    (payload.locality_id, payload.address, payload.latitude, payload.longitude, payload.timezone_id, venue_id),
                )
                row = dict(cur.fetchone())
                _audit(cur, context, "venue_location_update", "venue", venue_id,
                       {"before": before, "after": payload.model_dump(mode="json"), "source": "editor_verified_wgs84"})
            return _read(cur, row)
    except Error as exc:
        _raise_database_error("save_venue_location", exc)


@router.put("/venues/{venue_id}/map-links", response_model=VenueLocation, summary="确认平台场馆匹配")
def save_map_link(venue_id: int, payload: MapLinkWrite, request: Request,
                  context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            row = _venue(cur, venue_id, lock=True)
            if row["location_revision"] != payload.expected_revision:
                raise HTTPException(409, "场馆资料已更新，请重新核对地图匹配")
            if row["latitude"] is None or row["venue_kind"] == "online":
                raise HTTPException(422, "请先确认场馆坐标，再关联地图场馆")
            cur.execute("SELECT * FROM venue_map_links WHERE venue_id=%s AND provider=%s", (venue_id, payload.provider))
            old = cur.fetchone()
            cur.execute(
                """INSERT INTO venue_map_links (venue_id, provider, provider_place_id, provider_url, location_revision)
                   VALUES (%s,%s,%s,%s,%s) ON CONFLICT (venue_id,provider) DO UPDATE SET
                   provider_place_id=EXCLUDED.provider_place_id, provider_url=EXCLUDED.provider_url,
                   location_revision=EXCLUDED.location_revision, verified_at=CURRENT_TIMESTAMP""",
                (venue_id, payload.provider, payload.provider_place_id, payload.provider_url, payload.expected_revision),
            )
            _audit(cur, context, "venue_map_link_update", "venue", venue_id,
                   {"before": {key: old[key] for key in ("provider_place_id", "provider_url")} if old else None,
                    "after": payload.model_dump()})
            return _read(cur, row)
    except Error as exc:
        _raise_database_error("save_venue_map_link", exc)


@router.delete("/venues/{venue_id}/map-links/{provider}", response_model=VenueLocation, summary="取消平台场馆匹配")
def delete_map_link(venue_id: int, provider: MapProvider, request: Request,
                    expected_revision: int = Query(ge=1),
                    context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            row = _venue(cur, venue_id, lock=True)
            if row["location_revision"] != expected_revision:
                raise HTTPException(409, "场馆资料已更新，请重新加载")
            cur.execute("DELETE FROM venue_map_links WHERE venue_id=%s AND provider=%s RETURNING provider_place_id, provider_url",
                        (venue_id, provider))
            old = cur.fetchone()
            if old:
                _audit(cur, context, "venue_map_link_delete", "venue", venue_id, {"provider": provider, "before": dict(old)})
            return _read(cur, row)
    except Error as exc:
        _raise_database_error("delete_venue_map_link", exc)
