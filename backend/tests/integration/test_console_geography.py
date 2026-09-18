import pytest
from unittest.mock import patch

from app.map_providers import MapCandidate, MapSearchResult

pytestmark = pytest.mark.integration


def login(client, role="editor"):
    response = client.post("/api/auth/login", json={"username": f"{role}_tester", "password": f"{role}-test-pass"})
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["csrf_token"]}


def city(client, headers, timezone="Asia/Tokyo", name="検証市"):
    response = client.post("/api/console/localities", headers=headers, json={
        "country_code": "JP", "admin_area": "東京都", "locality_name": name, "timezone_id": timezone,
    })
    assert response.status_code == 201, response.text
    return response.json()


def token(client, venue_id=1):
    response = client.get(f"/api/console/venues/{venue_id}/location")
    assert response.status_code == 200, response.text
    return response.json()["state_token"]


def point(client, locality_id=None):
    return {"expected_state_token": token(client), "locality_id": locality_id, "address": "Test address",
            "latitude": 35.6, "longitude": 139.7, "timezone_id": "Asia/Tokyo",
            "coordinate_system": "WGS84"}


def verified(**values):
    return values


# 测试点：国家和行政区级所在地缺少城市名时，默认列表、场馆位置与公开详情仍能返回。
def test_region_only_localities_remain_readable(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    entries = [
        ("JP", "東京都", "Asia/Tokyo", "admin_area"),
        ("HK", None, "Asia/Hong_Kong", "country"),
        ("SG", None, "Asia/Singapore", "country"),
    ]
    locality_ids = {}
    with integration_admin_connection.cursor() as cur:
        for country_code, admin_area, timezone_id, area_level in entries:
            cur.execute(
                """INSERT INTO geo_localities (country_code, admin_area, locality_name, timezone_id, area_level)
                   VALUES (%s, %s, NULL, %s, %s) RETURNING id""",
                (country_code, admin_area, timezone_id, area_level),
            )
            locality_ids[country_code] = cur.fetchone()[0]

    page = client.get("/api/console/localities")
    assert page.status_code == 200, page.text
    assert {(item["country_code"], item["area_level"], item["locality_name"])
            for item in page.json()["items"]} == {
                ("JP", "admin_area", None), ("HK", "country", None), ("SG", "country", None),
            }
    for venue_id, country_code in ((1, "JP"), (2, "HK")):
        saved = client.put(
            f"/api/console/venues/{venue_id}/location",
            headers=headers,
            json=verified(expected_state_token=token(client, venue_id), locality_id=locality_ids[country_code]),
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["locality"]["locality_name"] is None
        location = client.get(f"/api/console/venues/{venue_id}/location")
        assert location.status_code == 200, location.text
        assert location.json()["locality"]["area_level"] == ("admin_area" if country_code == "JP" else "country")
        public = client.get(f"/api/venues/{venue_id}")
        assert public.status_code == 200, public.text
        assert public.json()["locality"]["locality_name"] is None


# 测试点：V32 默认城市层级可返回，位置保存不改变旧 Live 排期或名称引用并记录审计。
def test_location_preview_save_and_live_isolation(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    locality = city(client, headers)
    assert locality["area_level"] == "locality"
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT row_to_json(l) FROM live_attrs l WHERE venue_id=1 ORDER BY id")
        before_lives = cur.fetchall()
    payload = point(client, locality["id"])
    preview = client.post("/api/console/venues/1/location-preview", json=payload)
    assert preview.status_code == 200, preview.text
    assert preview.json()["effective_timezone_id"] == "Asia/Tokyo"
    assert client.get("/api/console/venues/1/location").json()["latitude"] is None
    saved = client.put("/api/console/venues/1/location", json=payload, headers=headers)
    assert saved.status_code == 200, saved.text
    assert saved.json()["state_token"] != payload["expected_state_token"]
    assert "location_revision" not in saved.json()
    assert saved.json()["locality"]["id"] == locality["id"]
    assert saved.json()["timezone_source"] == "venue"
    assert client.get("/api/console/venues/1/location").json() == saved.json()
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT row_to_json(l) FROM live_attrs l WHERE venue_id=1 ORDER BY id")
        assert cur.fetchall() == before_lives
        cur.execute("SELECT location_revision FROM venue_list WHERE id=1")
        assert cur.fetchone()[0] == 1
        cur.execute("SELECT payload_json FROM audit_logs WHERE action='venue_location_update'")
        audit = cur.fetchone()[0]
        assert audit["before"]["latitude"] is None
        assert audit["after"]["latitude"] == 35.6
        assert "coordinate_basis" not in audit["after"]
        assert "verification" not in audit
    stale = client.put("/api/console/venues/1/location", json=payload, headers=headers)
    assert stale.status_code == 409


# 测试点：所在地预览只统计关联 Live 数量，不创建历史时区复核明细。
def test_location_preview_counts_lives_without_timezone_reviews(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    tokyo = city(client, headers)
    saved = client.put(
        "/api/console/venues/1/location",
        headers=headers,
        json=verified(expected_state_token=token(client), locality_id=tokyo["id"]),
    )
    assert saved.status_code == 200, saved.text
    address_only = client.post("/api/console/venues/1/location-preview", json={
        "expected_state_token": token(client), "locality_id": tokyo["id"], "address": "Updated address",
    })
    assert address_only.status_code == 200, address_only.text
    assert address_only.json()["live_count"] == 2
    assert "timezone_review_live_count" not in address_only.json()

    new_york_response = client.post("/api/console/localities", headers=headers, json={
        "country_code": "US", "admin_area": "New York", "locality_name": "New York",
        "timezone_id": "America/New_York",
    })
    assert new_york_response.status_code == 201, new_york_response.text
    changed = client.post("/api/console/venues/1/location-preview", json={
        "expected_state_token": token(client), "locality_id": new_york_response.json()["id"],
    })
    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert body["live_count"] == 2
    assert "timezone_review_lives" not in body


# 测试点：地区纠错不修改 Venue 或地图，旧地区表单被拒绝且 Live 快照保持不变。
def test_locality_correction_preserves_venue_and_maps(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    tokyo = city(client, headers)
    duplicate = client.post("/api/console/localities", headers=headers, json={
        "country_code": "JP", "admin_area": "東京都", "locality_name": "検証市",
        "timezone_id": "Asia/Tokyo", "area_level": "locality",
    })
    assert duplicate.status_code == 409
    admin_area = client.post("/api/console/localities", headers=headers, json={
        "country_code": "JP", "admin_area": "沖縄県", "locality_name": None,
        "timezone_id": "Asia/Tokyo", "area_level": "admin_area",
    })
    assert admin_area.status_code == 201, admin_area.text
    assert admin_area.json()["locality_name"] is None
    country = client.post("/api/console/localities", headers=headers, json={
        "country_code": "HK", "admin_area": None, "locality_name": None,
        "timezone_id": "Asia/Hong_Kong", "area_level": "country",
    })
    assert country.status_code == 201, country.text
    invalid = client.post("/api/console/localities", headers=headers, json={
        "country_code": "JP", "admin_area": None, "locality_name": None,
        "timezone_id": "Asia/Tokyo", "area_level": "admin_area",
    })
    assert invalid.status_code == 422

    location_payload = {
        "expected_state_token": token(client), "locality_id": tokyo["id"], "address": "Test address",
        "latitude": 35.6, "longitude": 139.7, "timezone_id": None, "coordinate_system": "WGS84",
    }
    saved_location = client.put("/api/console/venues/1/location", headers=headers, json=location_payload)
    assert saved_location.status_code == 200, saved_location.text
    assert "coordinate_basis" not in saved_location.json()
    link = client.put("/api/console/venues/1/map-links", headers=headers, json={
        "expected_state_token": token(client), "provider": "google", "provider_place_id": "verified-place",
    })
    assert link.status_code == 200, link.text
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            """UPDATE live_attrs
               SET timezone_id='Asia/Tokyo', timezone_source='venue', timezone_source_revision=2
               WHERE id=1"""
        )
        cur.execute(
            """UPDATE live_attrs
               SET timezone_id='Asia/Tokyo', timezone_source='explicit', timezone_source_revision=NULL
               WHERE id=41"""
        )

    update = {
        "expected_state_token": tokyo["state_token"], "country_code": "JP", "admin_area": "東京都",
        "locality_name": "検証市", "timezone_id": "America/New_York", "area_level": "locality",
    }
    preview = client.post(f"/api/console/localities/{tokyo['id']}/preview", json=update)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["venue_count"] == 1
    assert "inherited_timezone_venue_count" not in body
    assert body["live_count"] == 2
    assert "invalidated_map_links" not in body
    assert "timezone_review_lives" not in body

    saved = client.put(f"/api/console/localities/{tokyo['id']}", headers=headers, json=update)
    assert saved.status_code == 200, saved.text
    assert saved.json()["state_token"] != tokyo["state_token"]
    assert "revision" not in saved.json()
    assert saved.json()["timezone_id"] == "America/New_York"
    location = client.get("/api/console/venues/1/location").json()
    assert "location_revision" not in location
    assert location["effective_timezone_id"] is None
    assert location["map_links"][0]["is_current"]
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT timezone_id, timezone_source_revision FROM live_attrs WHERE id=1")
        assert cur.fetchone() == ("Asia/Tokyo", 2)
        cur.execute("SELECT payload_json FROM audit_logs WHERE action='locality_update'")
        audit = cur.fetchone()[0]
        assert audit["before"]["timezone_id"] == "Asia/Tokyo"
        assert audit["after"]["timezone_id"] == "America/New_York"
        assert "timezone_review_live_ids" not in audit
    assert client.put(f"/api/console/localities/{tokyo['id']}", headers=headers, json=update).status_code == 409


# 测试点：坐标纠错保留已确认 POI，旧地图请求拒绝，显式取消才移除关联。
def test_map_matching_survives_correction_and_explicit_removal(integration_test_client):
    client = integration_test_client
    headers = login(client)
    assert client.put("/api/console/venues/1/location", json=point(client), headers=headers).status_code == 200
    link = {"expected_state_token": token(client), "provider": "google", "provider_place_id": "verified-place"}
    response = client.put("/api/console/venues/1/map-links", json=link, headers=headers)
    assert response.status_code == 200, response.text
    google = response.json()["map_links"][0]
    assert google["is_current"] and "query_place_id=verified-place" in google["url"]
    changed = {**point(client), "latitude": 35.7}
    preview = client.post("/api/console/venues/1/location-preview", json=changed).json()
    assert "invalidated_map_links" not in preview
    assert preview["changed_fields"] == ["coordinates"]
    response = client.put("/api/console/venues/1/location", json=changed, headers=headers)
    google = response.json()["map_links"][0]
    assert google["is_current"] and "query_place_id=verified-place" in google["url"]
    assert client.put("/api/console/venues/1/map-links", json=link, headers=headers).status_code == 409
    response = client.delete(f"/api/console/venues/1/map-links/google?expected_state_token={token(client)}", headers=headers)
    assert response.status_code == 200
    assert response.json()["map_links"][0]["verified_at"] is None
    assert response.json()["latitude"] == 35.7


# 测试点：候选接口返回 WGS84 距离，确认关联只审计目标 ID 和链接，不持久化候选资料。
def test_map_candidate_search_and_confirmed_audit(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    assert client.put("/api/console/venues/1/location", json=point(client), headers=headers).status_code == 200
    candidate = MapCandidate(
        provider_place_id="candidate-place", provider_url="https://www.google.com/maps/place/candidate",
        name="Candidate Hall", address="1 Candidate Street", latitude=35.6001, longitude=139.7001,
        source_coordinate_system="WGS84",
    )
    with patch("app.routers.console_geography.search_map_candidates", return_value=MapSearchResult("ready", None, [candidate])):
        response = client.get("/api/console/venues/1/map-candidates?provider=google&q=Candidate")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ready"
    assert body["candidates"][0]["provider_place_id"] == "candidate-place"
    assert 0 < body["candidates"][0]["distance_m"] < 20

    selected = body["candidates"][0]
    saved = client.put("/api/console/venues/1/map-links", headers=headers, json={
        "expected_state_token": token(client), "provider": "google",
        "provider_place_id": selected["provider_place_id"], "provider_url": selected["provider_url"],
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["map_links"][0]["is_current"] is True
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT payload_json FROM audit_logs WHERE action='venue_map_link_update'")
        audit = cur.fetchone()[0]
    assert audit["after"]["provider_place_id"] == "candidate-place"
    assert audit["after"]["provider_url"] == selected["provider_url"]
    assert "candidate" not in audit["after"]


# 测试点：physical、undisclosed 与 online 使用不同位置范围，冲突时区和越界资料不能保存。
def test_city_only_timezone_conflict_and_online_guard(integration_test_client):
    client = integration_test_client
    headers = login(client)
    locality = city(client, headers)
    response = client.put(
        "/api/console/venues/1/location", headers=headers,
        json=verified(expected_state_token=token(client), locality_id=locality["id"]),
    )
    assert response.status_code == 200, response.text
    assert response.json()["latitude"] is None and response.json()["timezone_source"] is None
    conflict = {**point(client, locality["id"]), "timezone_id": "America/New_York"}
    assert client.put("/api/console/venues/1/location", json=conflict, headers=headers).status_code == 422
    assert client.patch("/api/console/venues/1", json={"venue_kind": "undisclosed"}, headers=headers).status_code == 200
    assert client.put(
        "/api/console/venues/1/location", headers=headers,
        json=verified(expected_state_token=token(client), locality_id=locality["id"], address="不应保存"),
    ).status_code == 422
    assert client.put("/api/console/venues/1/map-links", headers=headers, json={
        "expected_state_token": token(client), "provider": "google", "provider_place_id": "not-allowed",
    }).status_code == 422
    assert client.patch("/api/console/venues/1", json={"venue_kind": "online"}, headers=headers).status_code == 409
    assert client.put(
        "/api/console/venues/1/location", json=verified(expected_state_token=token(client)), headers=headers,
    ).status_code == 200
    assert client.patch("/api/console/venues/1", json={"venue_kind": "online"}, headers=headers).status_code == 200
    assert client.put("/api/console/venues/1/location", json=point(client), headers=headers).status_code == 422


# 测试点：成对 WGS84 坐标可直接保存，已删除的核验字段会被严格拒绝。
def test_coordinates_need_no_verification_fields(integration_test_client):
    client = integration_test_client
    headers = login(client)
    plain_point = {
        "expected_state_token": token(client), "latitude": 35.6, "longitude": 139.7,
    }
    response = client.put("/api/console/venues/1/location", json=plain_point, headers=headers)
    assert response.status_code == 200, response.text
    for removed in ("coordinate_basis", "verification_source", "verification_note"):
        assert client.put("/api/console/venues/1/location", json={
            **plain_point, "expected_state_token": token(client), removed: "other",
        }, headers=headers).status_code == 422


# 测试点：城市搜索分页总数完整，越界页保留总数，写操作和只读接口保持 CSRF / 角色限制。
def test_city_pagination_and_permissions(integration_test_client):
    client = integration_test_client
    headers = login(client)
    city(client, headers, name="検証市")
    city(client, headers, name="検証区")
    page = client.get("/api/console/localities?q=検証&limit=1&page=3")
    assert page.status_code == 200 and page.json()["total"] == 2 and page.json()["items"] == []
    assert client.get("/api/console/localities?q=%25").json()["total"] == 0
    unauthorized_payload = point(client)
    assert client.put("/api/console/venues/1/location", json=unauthorized_payload).status_code == 403
    assert client.put(
        "/api/console/localities/1",
        json={
            "expected_state_token": "0" * 64,
            "country_code": "JP",
            "admin_area": "東京都",
            "locality_name": "検証市",
            "timezone_id": "Asia/Tokyo",
            "area_level": "locality",
        },
    ).status_code == 403
    login(client, "viewer")
    assert client.get("/api/console/localities").status_code == 403
    assert client.get("/api/console/venues/1/location").status_code == 403
    assert client.get("/api/console/timezones").status_code == 403


# 测试点：场地 IANA 时区决定 Live 偏移，场地缺时区时退回固定 +09:00。
def test_live_uses_venue_iana_or_default_offset(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    locality_response = client.post("/api/console/localities", headers=headers, json={
        "country_code": "US", "admin_area": "New York", "locality_name": "New York", "timezone_id": "America/New_York",
    })
    assert locality_response.status_code == 201, locality_response.text
    locality_id = locality_response.json()["id"]
    saved = client.put("/api/console/venues/1/location", headers=headers, json={
        "expected_state_token": token(client), "locality_id": locality_id, "latitude": 40.7,
        "longitude": -74.0, "timezone_id": "America/New_York",
    })
    assert saved.status_code == 200, saved.text
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT id FROM venue_name_versions WHERE venue_id=1 AND valid_to IS NULL")
        version_id = cur.fetchone()[0]
    response = client.post("/api/console/lives", headers=headers, json={
        "live_date": "2026-07-22", "live_title": "IANA Venue Live", "live_type": "oneman",
        "url": "https://example.com/iana-venue", "opening_time": "18:00", "start_time": "19:00",
        "venue_id": 1, "venue_name_version_id": version_id,
    })
    assert response.status_code == 201, response.text
    item = response.json()["item"]
    assert item["timezone_id"] == "America/New_York"
    assert item["timezone_source"] == "venue"
    assert item["opening_time"] == "18:00:00-04:00"
    assert item["start_time"] == "19:00:00-04:00"
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT timezone_id, timezone_source, timezone_offset_minutes, timezone_source_revision FROM live_attrs WHERE id=%s", (item["live_id"],))
        assert cur.fetchone() == ("America/New_York", "venue", -240, None)

    fallback = client.post("/api/console/lives", headers=headers, json={
        "live_date": "2026-07-22", "live_title": "Default Offset Live", "live_type": "oneman",
        "url": "https://example.com/default-offset", "opening_time": "18:00", "start_time": "19:00",
        "venue_id": None, "venue_name_version_id": None, "announced_locality_id": locality_id,
    })
    assert fallback.status_code == 201, fallback.text
    assert fallback.json()["item"]["opening_time"] == "18:00:00+09:00"
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT timezone_id, timezone_source, timezone_offset_minutes, timezone_source_revision FROM live_attrs WHERE id=%s", (fallback.json()["item"]["live_id"],))
        assert cur.fetchone() == (None, "legacy_offset", 540, None)

    forbidden = client.post("/api/console/lives", headers=headers, json={
        "live_date": "2026-07-22", "live_title": "Forbidden Override", "live_type": "oneman",
        "url": "https://example.com/forbidden", "opening_time": "18:00", "start_time": "19:00",
        "venue_id": None, "venue_name_version_id": None, "explicit_timezone_id": "Asia/Tokyo",
    })
    assert forbidden.status_code == 422


# 测试点：补录和逐项纠错不产生版本或使地图失效，仅正式更名新增名称历史，搬迁新建 Venue。
def test_corrections_keep_identity_and_only_rename_creates_version(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    detail = client.get("/api/console/venues/1").json()
    version_count = len(detail["name_versions"])
    payload = point(client)
    saved = client.put("/api/console/venues/1/location", headers=headers, json=payload)
    assert saved.status_code == 200, saved.text
    linked = client.put("/api/console/venues/1/map-links", headers=headers, json={
        "expected_state_token": token(client), "provider": "google", "provider_place_id": "stable-place",
    })
    assert linked.status_code == 200, linked.text
    for change in ({"timezone_id": "America/New_York"}, {"address": "Corrected address"},
                   {"latitude": 35.6001}, {"timezone_id": None}, {"timezone_id": "Asia/Tokyo"}):
        payload = {**payload, **change, "expected_state_token": token(client)}
        response = client.put("/api/console/venues/1/location", headers=headers, json=payload)
        assert response.status_code == 200, response.text
        assert response.json()["map_links"][0]["is_current"]
        assert len(client.get("/api/console/venues/1").json()["name_versions"]) == version_count
        assert client.put("/api/console/venues/1/location", headers=headers, json=payload).status_code == 409
        with integration_admin_connection.cursor() as cur:
            cur.execute("SELECT location_revision FROM venue_list WHERE id=1")
            assert cur.fetchone()[0] == 1

    payload["expected_state_token"] = token(client)
    unchanged = client.put("/api/console/venues/1/location", headers=headers, json=payload)
    assert unchanged.status_code == 200, unchanged.text
    assert unchanged.json()["state_token"] == payload["expected_state_token"]

    renamed = client.post("/api/console/venues/1/name-versions", headers=headers, json={
        "venue_name": "Renamed stable venue", "valid_from": "2027-01-01",
    })
    assert renamed.status_code == 201, renamed.text
    assert len(renamed.json()["name_versions"]) == version_count + 1
    assert client.get("/api/venues/1/maps").json()["map_links"][0]["source"] == "place"
    correction = client.patch(
        f"/api/console/venues/1/name-versions/{renamed.json()['venue_name_version_id']}",
        headers=headers, json={"venue_name": "Renamed venue spelling correction"},
    )
    assert correction.status_code == 200, correction.text
    assert len(correction.json()["name_versions"]) == version_count + 1
    moved = client.post("/api/console/venues", headers=headers, json={
        "venue_name": "Venue at new address", "venue_kind": "physical",
    })
    assert moved.status_code == 201 and moved.json()["item"]["venue_id"] != 1
    assert client.get("/api/console/venues/1/location").json()["address"] == "Corrected address"


# 测试点：地区纠错不写入引用场地；地点旧快照和并发地图请求仍会被拒绝。
def test_locality_and_map_concurrency_without_versions(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    locality = city(client, headers)
    assert client.put("/api/console/venues/1/location", headers=headers, json=point(client, locality["id"])).status_code == 200
    stale_location = point(client, locality["id"])
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT to_jsonb(v) FROM venue_list v WHERE id=1")
        before = cur.fetchone()[0]
    changed = client.put(f"/api/console/localities/{locality['id']}", headers=headers, json={
        "expected_state_token": locality["state_token"], "country_code": "JP", "admin_area": "東京都",
        "locality_name": "Corrected locality name", "timezone_id": "Asia/Tokyo",
    })
    assert changed.status_code == 200, changed.text
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT to_jsonb(v) FROM venue_list v WHERE id=1")
        assert cur.fetchone()[0] == before
        cur.execute("SELECT revision FROM geo_localities WHERE id=%s", (locality["id"],))
        assert cur.fetchone()[0] == 1
    assert client.put("/api/console/venues/1/location", headers=headers, json=stale_location).status_code == 409
    link = {"expected_state_token": token(client), "provider": "google", "provider_place_id": "first-place"}
    assert client.put("/api/console/venues/1/map-links", headers=headers, json=link).status_code == 200
    assert client.put("/api/console/venues/1/map-links", headers=headers, json={**link, "provider_place_id": "lost-update"}).status_code == 409
