"""Location maintenance is additive: it never updates a Live schedule."""

import hashlib
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from psycopg2 import Error
from psycopg2.errors import UniqueViolation
from psycopg2.extras import Json, RealDictCursor

from app.auth import AuthSessionContext, assert_valid_csrf, get_current_auth_context, require_role
from app.db import get_db_connection, get_write_db_connection
from app.geography import coordinate_url, place_url, timezone_names
from app.map_providers import haversine_distance_m, search_map_candidates
from app.routers.console_venues import (
    _raise_database_error, _load_detail, _create_name_version,
    _ensure_name_available, _write_audit,
)
from app.schemas.console import (
    ConsoleVenueEditRequest, ConsoleVenueEditResponse,
    ConsoleVenueNameVersionCreateRequest,
)
from app.schemas.geography import (
    Locality, LocalityCreate, LocalityPage, LocalityPreview, LocalityUpdate, LocationPreview, LocationWrite,
    MapCandidateSearch, MapLinkWrite, MapProvider, MapSearchProvider, VenueLocation,
)

router = APIRouter(dependencies=[Depends(require_role("editor"))])


def _state_token(value: Any) -> str:
    # Content comparison protects stale forms without creating a business revision.
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def _locality_view(row: dict[str, Any]) -> dict[str, Any]:
    data = {key: value for key, value in row.items() if key != "revision"}
    return {**data, "state_token": _state_token(data)}


def _audit(cur: Any, context: AuthSessionContext, action: str, resource: str, identifier: int, payload: Any) -> None:
    cur.execute(
        "INSERT INTO audit_logs (user_id, action, resource_type, resource_id, payload_json) VALUES (%s,%s,%s,%s,%s)",
        (context.user.id, action, resource, str(identifier), Json(payload)),
    )


def _venue(cur: Any, venue_id: int, *, lock: bool = False) -> dict[str, Any]:
    cur.execute("""SELECT id, venue_kind, locality_id, address, latitude, longitude, timezone_id,
                   location_revision, location_verified_at FROM venue_list WHERE id = %s"""
                + (" FOR UPDATE" if lock else ""), (venue_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "场馆不存在")
    return dict(row)


def _locality(cur: Any, locality_id: int | None, *, lock: bool = False) -> dict[str, Any] | None:
    if locality_id is None:
        return None
    cur.execute("SELECT * FROM geo_localities WHERE id = %s" + (" FOR UPDATE" if lock else ""), (locality_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(422, "城市不存在，请重新选择")
    return _locality_view(dict(row))


def _ensure_unique_locality(cur: Any, payload: LocalityCreate | LocalityUpdate, *, exclude_id: int | None = None) -> None:
    params: list[Any] = [payload.area_level, payload.country_code]
    if payload.area_level == "country":
        identity = "admin_area IS NULL AND locality_name IS NULL"
    elif payload.area_level == "admin_area":
        identity = "lower(btrim(admin_area)) = lower(btrim(%s)) AND locality_name IS NULL"
        params.append(payload.admin_area)
    else:
        identity = "COALESCE(lower(btrim(admin_area)), '') = COALESCE(lower(btrim(%s)), '') AND lower(btrim(locality_name)) = lower(btrim(%s))"
        params.extend((payload.admin_area, payload.locality_name))
    if exclude_id is not None:
        identity += " AND id <> %s"
        params.append(exclude_id)
    cur.execute(
        f"SELECT id FROM geo_localities WHERE area_level = %s AND country_code = %s AND {identity} LIMIT 1",
        params,
    )
    if cur.fetchone() is not None:
        raise HTTPException(409, "同一国家／地区下已存在相同层级和名称的地区")


def _locality_changed(row: dict[str, Any], payload: LocalityUpdate) -> bool:
    return any(row[key] != value for key, value in payload.model_dump(exclude={"expected_state_token"}).items())


def _locality_impact(cur: Any, locality_id: int) -> dict[str, Any]:
    cur.execute(
        """
        SELECT COUNT(*) AS venue_count
        FROM venue_list
        WHERE locality_id = %s
        """,
        (locality_id,),
    )
    venue_impact = cur.fetchone()
    cur.execute(
        """SELECT COUNT(*) FROM live_attrs live
           LEFT JOIN venue_list venue ON venue.id = live.venue_id
           WHERE live.announced_locality_id = %s OR venue.locality_id = %s""",
        (locality_id, locality_id),
    )
    live_count = cur.fetchone()["count"]
    return {
        "venue_count": venue_impact["venue_count"],
        "live_count": live_count,
    }


def _read(cur: Any, row: dict[str, Any]) -> dict[str, Any]:
    cur.execute("SELECT venue_name FROM current_venue_versions WHERE venue_id = %s", (row["id"],))
    current_name = cur.fetchone()
    if current_name is None:
        raise HTTPException(409, "场馆缺少当前名称版本，请先核对名称资料")
    venue_name = current_name["venue_name"]
    locality = _locality(cur, row["locality_id"])
    cur.execute("SELECT * FROM venue_map_links WHERE venue_id = %s ORDER BY provider", (row["id"],))
    stored = {item["provider"]: item for item in cur.fetchall()}
    links = []
    for provider in ("google", "apple", "amap"):
        item = stored.get(provider)
        point_url = None
        if row["latitude"] is not None:
            point_url = coordinate_url(provider, float(row["latitude"]), float(row["longitude"]), venue_name)
        current = bool(item)
        target = point_url
        if item and current:
            target = item["provider_url"] or place_url(provider, item["provider_place_id"], venue_name)
        links.append({
            "provider": provider, "provider_place_id": item["provider_place_id"] if item else None,
            "provider_url": item["provider_url"] if item else None,
            "verified_at": item["verified_at"] if item else None,
            "is_current": current, "url": target, "coordinate_url": point_url,
        })
    return {
        "venue_id": row["id"], "locality": locality, "address": row["address"],
        "latitude": row["latitude"], "longitude": row["longitude"],
        "timezone_id": row["timezone_id"],
        "state_token": _state_token({"venue": {key: value for key, value in row.items() if key != "location_revision"},
                                    "venue_name": venue_name, "locality": locality, "maps": stored}),
        "location_verified_at": row["location_verified_at"],
        "map_links": links,
    }


def _validate(cur: Any, row: dict[str, Any], payload: LocationWrite, *, target_kind: str | None = None) -> str | None:
    if _read(cur, row)["state_token"] != payload.expected_state_token:
        raise HTTPException(409, "场馆资料已更新，请重新加载并检查修改")
    kind = target_kind or row["venue_kind"]
    if kind == "online" and any(value is not None for value in (
        payload.locality_id, payload.address, payload.latitude, payload.longitude,
        payload.timezone_id, payload.google_place,
    )):
        raise HTTPException(422, "线上场馆不保存实体位置，请在活动中指定时间基准")
    if kind == "undisclosed" and any(value is not None for value in (
        payload.address, payload.latitude, payload.longitude, payload.google_place,
    )):
        raise HTTPException(422, "未公开具体场馆可保存地区和时区，不保存门牌、坐标或地图关联")
    _locality(cur, payload.locality_id)
    if row["locality_id"] is not None and payload.locality_id is None:
        raise HTTPException(422, "已确定地区的场馆不能清空地区")
    if kind == "physical" and not payload.address:
        raise HTTPException(422, "实体场馆必须填写公开门牌地址")
    if kind != "online" and not payload.timezone_id:
        raise HTTPException(422, "场馆必须填写自身 IANA 时区")
    return payload.timezone_id


def _changed_fields(cur: Any, row: dict[str, Any], payload: LocationWrite) -> list[str]:
    changed = []
    if row["locality_id"] != payload.locality_id:
        changed.append("locality_id")
    if row["address"] != payload.address:
        changed.append("address")
    if any(
        (float(row[key]) if row[key] is not None else None) != value
        for key, value in (("latitude", payload.latitude), ("longitude", payload.longitude))
    ):
        changed.append("coordinates")
    if row["timezone_id"] != payload.timezone_id:
        changed.append("timezone_id")
    if "google_place" in payload.model_fields_set:
        cur.execute("SELECT provider_place_id, provider_url FROM venue_map_links WHERE venue_id=%s AND provider='google'", (row["id"],))
        stored = cur.fetchone()
        target = payload.google_place
        if (stored is None) != (target is None) or (stored and target and (
            stored["provider_place_id"] != target.provider_place_id or stored["provider_url"] != target.provider_url
        )):
            changed.append("google_place")
    return changed


def _changed(cur: Any, row: dict[str, Any], payload: LocationWrite) -> bool:
    return bool(_changed_fields(cur, row, payload))


def _write_google_place(cur: Any, venue_id: int, payload: LocationWrite) -> None:
    if "google_place" not in payload.model_fields_set:
        return
    if payload.google_place is None:
        cur.execute("DELETE FROM venue_map_links WHERE venue_id=%s AND provider='google'", (venue_id,))
        return
    cur.execute(
        """INSERT INTO venue_map_links (venue_id, provider, provider_place_id, provider_url, location_revision)
           VALUES (%s,'google',%s,%s,1) ON CONFLICT (venue_id,provider) DO UPDATE SET
           provider_place_id=EXCLUDED.provider_place_id, provider_url=EXCLUDED.provider_url,
           verified_at=CURRENT_TIMESTAMP""",
        (venue_id, payload.google_place.provider_place_id, payload.google_place.provider_url),
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
            return {"items": [_locality_view(dict(item)) for item in cur.fetchall()], "total": total, "page": page, "page_size": limit}
    except Error as exc:
        _raise_database_error("list_localities", exc)


@router.post("/localities", response_model=Locality, status_code=201, summary="登记已核验城市")
def create_locality(payload: LocalityCreate, request: Request,
                    context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            _ensure_unique_locality(cur, payload)
            cur.execute(
                """INSERT INTO geo_localities (country_code, admin_area, locality_name, area_level)
                   VALUES (%s,%s,%s,%s) RETURNING *""",
                (payload.country_code, payload.admin_area, payload.locality_name, payload.area_level),
            )
            row = _locality_view(dict(cur.fetchone()))
            _audit(cur, context, "locality_create", "locality", row["id"], payload.model_dump())
            return row
    except UniqueViolation as exc:
        raise HTTPException(409, "同一国家／地区下已存在相同层级和名称的地区") from exc
    except Error as exc:
        _raise_database_error("create_locality", exc)


@router.post("/localities/{locality_id}/preview", response_model=LocalityPreview, summary="预览地区资料修改")
def preview_locality(locality_id: int, payload: LocalityUpdate):
    try:
        with get_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            row = _locality(cur, locality_id)
            assert row is not None
            if row["state_token"] != payload.expected_state_token:
                raise HTTPException(409, "地区资料已更新，请重新加载并检查修改")
            _ensure_unique_locality(cur, payload, exclude_id=locality_id)
            return {
                "before": row,
                "after": payload,
                **_locality_impact(cur, locality_id),
            }
    except Error as exc:
        _raise_database_error("preview_locality", exc)


@router.put("/localities/{locality_id}", response_model=Locality, summary="保存已核验地区资料")
def save_locality(locality_id: int, payload: LocalityUpdate, request: Request,
                  context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            row = _locality(cur, locality_id, lock=True)
            assert row is not None
            if row["state_token"] != payload.expected_state_token:
                raise HTTPException(409, "地区资料已更新，请重新加载并检查修改")
            _ensure_unique_locality(cur, payload, exclude_id=locality_id)
            if not _locality_changed(row, payload):
                return row
            impact = _locality_impact(cur, locality_id)
            before = Locality.model_validate(row).model_dump(mode="json")
            cur.execute(
                """UPDATE geo_localities
                   SET country_code=%s, admin_area=%s, locality_name=%s, area_level=%s
                   WHERE id=%s RETURNING *""",
                (payload.country_code, payload.admin_area, payload.locality_name,
                 payload.area_level, locality_id),
            )
            updated = _locality_view(dict(cur.fetchone()))
            _audit(cur, context, "locality_update", "locality", locality_id, {
                "before": before,
                "after": Locality.model_validate(updated).model_dump(mode="json"),
                "impact": impact,
            })
            return updated
    except UniqueViolation as exc:
        raise HTTPException(409, "同一国家／地区下已存在相同层级和名称的地区") from exc
    except Error as exc:
        _raise_database_error("save_locality", exc)


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
            _validate(cur, row, payload)
            before = _read(cur, row)
            cur.execute("SELECT COUNT(*) FROM live_attrs WHERE venue_id = %s", (venue_id,))
            live_count = cur.fetchone()["count"]
            changed_fields = _changed_fields(cur, row, payload)
            return {"before": before, "after": payload,
                    "live_count": live_count,
                    "changed_fields": changed_fields}
    except Error as exc:
        _raise_database_error("preview_venue_location", exc)


def _save_location(cur: Any, row: dict[str, Any], venue_id: int, payload: LocationWrite, context: AuthSessionContext, *, target_kind: str | None = None) -> dict[str, Any]:
    before = VenueLocation.model_validate(_read(cur, row)).model_dump(mode="json")
    if _changed(cur, row, payload) or (target_kind is not None and target_kind != row["venue_kind"]):
        cur.execute(
            """UPDATE venue_list SET venue_kind=%s, locality_id=%s, address=%s, latitude=%s, longitude=%s,
               timezone_id=%s,
               location_verified_at=CURRENT_TIMESTAMP WHERE id=%s
               RETURNING id, venue_kind, locality_id, address, latitude, longitude, timezone_id,
                         location_revision, location_verified_at""",
            (target_kind or row["venue_kind"], payload.locality_id, payload.address, payload.latitude, payload.longitude,
             payload.timezone_id, venue_id),
        )
        row = dict(cur.fetchone())
        _write_google_place(cur, venue_id, payload)
        after = VenueLocation.model_validate(_read(cur, row)).model_dump(mode="json")
        _audit(cur, context, "venue_location_update", "venue", venue_id, {
            "before": before,
            "after": after,
        })
    return _read(cur, row)


@router.put("/venues/{venue_id}/location", response_model=VenueLocation, summary="保存已核对的位置资料")
def save_location(venue_id: int, payload: LocationWrite, request: Request,
                  context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            row = _venue(cur, venue_id, lock=True)
            _validate(cur, row, payload)
            return _save_location(cur, row, venue_id, payload, context)
    except Error as exc:
        _raise_database_error("save_venue_location", exc)


@router.get("/venues/{venue_id}/map-candidates", response_model=MapCandidateSearch, summary="搜索地图平台场馆候选")
def search_venue_map_candidates(venue_id: int, provider: MapSearchProvider,
                                q: str = Query(min_length=1, max_length=200)):
    query = q.strip()
    if not query:
        raise HTTPException(422, "请输入场馆名称或地址")
    with get_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        row = _venue(cur, venue_id)
        if row["venue_kind"] != "physical" or row["latitude"] is None or row["longitude"] is None:
            raise HTTPException(422, "请先确认实体场馆的 WGS84 坐标，再搜索平台场馆")
        locality = _locality(cur, row["locality_id"])
        venue_latitude = float(row["latitude"])
        venue_longitude = float(row["longitude"])
        country_code = locality["country_code"] if locality else None
    outcome = search_map_candidates(provider, query, venue_latitude, venue_longitude, country_code)
    candidates = [
        {
            **candidate.__dict__,
            "distance_m": haversine_distance_m(
                venue_latitude, venue_longitude, candidate.latitude, candidate.longitude,
            ),
        }
        for candidate in outcome.candidates
    ]
    return {
        "provider": provider, "status": outcome.status,
        "message": outcome.message, "candidates": candidates,
    }


@router.put("/venues/{venue_id}/map-links", response_model=VenueLocation, summary="确认平台场馆匹配")
def save_map_link(venue_id: int, payload: MapLinkWrite, request: Request,
                  context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            row = _venue(cur, venue_id, lock=True)
            if _read(cur, row)["state_token"] != payload.expected_state_token:
                raise HTTPException(409, "场馆资料已更新，请重新核对地图匹配")
            if row["latitude"] is None or row["venue_kind"] != "physical":
                raise HTTPException(422, "请先确认场馆坐标，再关联地图场馆")
            cur.execute("SELECT * FROM venue_map_links WHERE venue_id=%s AND provider=%s", (venue_id, payload.provider))
            old = cur.fetchone()
            cur.execute(
                """INSERT INTO venue_map_links (venue_id, provider, provider_place_id, provider_url, location_revision)
                   VALUES (%s,%s,%s,%s,1) ON CONFLICT (venue_id,provider) DO UPDATE SET
                   provider_place_id=EXCLUDED.provider_place_id, provider_url=EXCLUDED.provider_url,
                   verified_at=CURRENT_TIMESTAMP""",
                (venue_id, payload.provider, payload.provider_place_id, payload.provider_url),
            )
            _audit(cur, context, "venue_map_link_update", "venue", venue_id,
                   {"before": {key: old[key] for key in ("provider_place_id", "provider_url")} if old else None,
                    "after": payload.model_dump()})
            return _read(cur, row)
    except Error as exc:
        _raise_database_error("save_venue_map_link", exc)


@router.delete("/venues/{venue_id}/map-links/{provider}", response_model=VenueLocation, summary="取消平台场馆匹配")
def delete_map_link(venue_id: int, provider: MapProvider, request: Request,
                    expected_state_token: str = Query(pattern=r"^[0-9a-f]{64}$"),
                    context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            row = _venue(cur, venue_id, lock=True)
            if _read(cur, row)["state_token"] != expected_state_token:
                raise HTTPException(409, "场馆资料已更新，请重新加载")
            cur.execute("DELETE FROM venue_map_links WHERE venue_id=%s AND provider=%s RETURNING provider_place_id, provider_url",
                        (venue_id, provider))
            old = cur.fetchone()
            if old:
                _audit(cur, context, "venue_map_link_delete", "venue", venue_id, {"provider": provider, "before": dict(old)})
            return _read(cur, row)
    except Error as exc:
        _raise_database_error("delete_venue_map_link", exc)


def _validate_name_change(cur: Any, venue_id: int, payload: ConsoleVenueEditRequest) -> None:
    change = payload.name_change
    if change is None:
        return
    cur.execute("SELECT venue_name, valid_from, valid_to FROM venue_name_versions WHERE id=%s AND venue_id=%s",
                (change.version_id, venue_id))
    version = cur.fetchone()
    if version is None or version[0] != change.expected_name:
        raise HTTPException(409, "名称资料已更新，请重新查询场馆并检查修改")
    if version[2] is not None:
        raise HTTPException(409, "正式更名只能从当前名称版本追加")
    if version[1] is not None and change.valid_from <= version[1]:
        raise HTTPException(409, "更名生效日期必须晚于当前名称版本")
    _ensure_name_available(cur, change.venue_name)



@router.post("/venues/{venue_id}/edit-preview", response_model=ConsoleVenueEditRequest, summary="预览场馆资料修改")
def preview_venue_edit(venue_id: int, payload: ConsoleVenueEditRequest):
    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                row = _venue(cur, venue_id)
                _validate(cur, row, payload.location, target_kind=payload.venue_kind)
            with conn.cursor() as cur:
                _validate_name_change(cur, venue_id, payload)
            return payload
    except Error as exc:
        _raise_database_error("preview_venue_edit", exc)


@router.put("/venues/{venue_id}/edit", response_model=ConsoleVenueEditResponse, summary="统一保存场馆资料")
def save_venue_edit(venue_id: int, payload: ConsoleVenueEditRequest, request: Request,
                    context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    try:
        with get_write_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                row = _venue(cur, venue_id, lock=True)
                _validate(cur, row, payload.location, target_kind=payload.venue_kind)
                _save_location(cur, row, venue_id, payload.location, context, target_kind=payload.venue_kind)
            with conn.cursor() as cur:
                if row["venue_kind"] != payload.venue_kind:
                    _write_audit(cur, user_id=context.user.id, action="venue_update", venue_id=venue_id,
                                 payload={"venue_kind": payload.venue_kind})
                _validate_name_change(cur, venue_id, payload)
                change = payload.name_change
                if change is not None:
                    _create_name_version(cur, venue_id, ConsoleVenueNameVersionCreateRequest(
                        venue_name=change.venue_name, valid_from=change.valid_from), context)
                detail = _load_detail(cur, venue_id)
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                location = _read(cur, _venue(cur, venue_id))
            return {"detail": detail, "location": location}
    except Error as exc:
        _raise_database_error("save_venue_edit", exc)
