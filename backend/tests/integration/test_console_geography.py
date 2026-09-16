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


def point(locality_id=None, revision=1):
    return {"expected_revision": revision, "locality_id": locality_id, "address": "Test address",
            "latitude": 35.6, "longitude": 139.7, "timezone_id": "Asia/Tokyo",
            "coordinate_system": "WGS84", "coordinate_basis": "building",
            "verification_source": "map_verified", "verification_note": "测试地图核验"}


def verified(**values):
    return {**values, "verification_source": "official", "verification_note": "测试官方资料核验"}


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
            json=verified(expected_revision=1, locality_id=locality_ids[country_code]),
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
    payload = point(locality["id"])
    preview = client.post("/api/console/venues/1/location-preview", json=payload)
    assert preview.status_code == 200, preview.text
    assert preview.json()["effective_timezone_id"] == "Asia/Tokyo"
    assert client.get("/api/console/venues/1/location").json()["latitude"] is None
    saved = client.put("/api/console/venues/1/location", json=payload, headers=headers)
    assert saved.status_code == 200, saved.text
    assert saved.json()["location_revision"] == 2
    assert saved.json()["locality"]["id"] == locality["id"]
    assert saved.json()["timezone_source"] == "venue"
    assert client.get("/api/console/venues/1/location").json() == saved.json()
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT row_to_json(l) FROM live_attrs l WHERE venue_id=1 ORDER BY id")
        assert cur.fetchall() == before_lives
        cur.execute("SELECT payload_json FROM audit_logs WHERE action='venue_location_update'")
        audit = cur.fetchone()[0]
        assert audit["before"]["latitude"] is None
        assert audit["after"]["coordinate_basis"] == "building"
        assert audit["verification"] == {"source": "map_verified", "note": "测试地图核验"}
        assert "verification_source" not in audit["after"]
    stale = client.put("/api/console/venues/1/location", json=payload, headers=headers)
    assert stale.status_code == 409


# 测试点：所在地预览只把有效时区真正变化的 Venue 快照列入人工复核，地址变化不会误报。
def test_location_preview_classifies_live_timezone_impact(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    tokyo = city(client, headers)
    saved = client.put(
        "/api/console/venues/1/location",
        headers=headers,
        json=verified(expected_revision=1, locality_id=tokyo["id"]),
    )
    assert saved.status_code == 200, saved.text
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

    address_only = client.post("/api/console/venues/1/location-preview", json={
        "expected_revision": 2, "locality_id": tokyo["id"], "address": "Updated address",
    })
    assert address_only.status_code == 200, address_only.text
    assert address_only.json()["timezone_unchanged_live_count"] == 1
    assert address_only.json()["timezone_review_live_count"] == 0
    assert address_only.json()["timezone_unaffected_live_count"] == 1
    assert address_only.json()["timezone_review_lives"] == []

    new_york_response = client.post("/api/console/localities", headers=headers, json={
        "country_code": "US", "admin_area": "New York", "locality_name": "New York",
        "timezone_id": "America/New_York",
    })
    assert new_york_response.status_code == 201, new_york_response.text
    changed = client.post("/api/console/venues/1/location-preview", json={
        "expected_revision": 2, "locality_id": new_york_response.json()["id"],
    })
    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert body["live_count"] == 2
    assert body["timezone_unchanged_live_count"] == 0
    assert body["timezone_review_live_count"] == 1
    assert body["timezone_unaffected_live_count"] == 1
    assert body["timezone_review_lives_truncated"] is False
    assert body["timezone_review_lives"] == [{
        "live_id": 1,
        "live_date": "2026-03-28",
        "live_title": "BanG Dream! Unit Live",
        "timezone_id": "Asia/Tokyo",
        "timezone_source_revision": 2,
    }]


# 测试点：三级地区可按唯一身份建档，修改会预览并传播 Venue 修订但不改写 Live 时区快照。
def test_locality_create_preview_update_and_revision_propagation(integration_test_client, integration_admin_connection):
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
        "expected_revision": 1, "locality_id": tokyo["id"], "address": "Test address",
        "latitude": 35.6, "longitude": 139.7, "timezone_id": None, "coordinate_system": "WGS84",
        "coordinate_basis": "entrance", "verification_source": "official",
        "verification_note": "场馆公开入口",
    }
    saved_location = client.put("/api/console/venues/1/location", headers=headers, json=location_payload)
    assert saved_location.status_code == 200, saved_location.text
    assert saved_location.json()["coordinate_basis"] == "entrance"
    link = client.put("/api/console/venues/1/map-links", headers=headers, json={
        "expected_revision": 2, "provider": "google", "provider_place_id": "verified-place",
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
        "expected_revision": 1, "country_code": "JP", "admin_area": "東京都",
        "locality_name": "検証市", "timezone_id": "America/New_York", "area_level": "locality",
    }
    preview = client.post(f"/api/console/localities/{tokyo['id']}/preview", json=update)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["venue_count"] == 1
    assert body["inherited_timezone_venue_count"] == 1
    assert body["live_count"] == 2
    assert body["timezone_review_live_count"] == 1
    assert body["timezone_unaffected_live_count"] == 1
    assert body["invalidated_map_links"] == 1
    assert [item["live_id"] for item in body["timezone_review_lives"]] == [1]

    saved = client.put(f"/api/console/localities/{tokyo['id']}", headers=headers, json=update)
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 2
    assert saved.json()["timezone_id"] == "America/New_York"
    location = client.get("/api/console/venues/1/location").json()
    assert location["location_revision"] == 3
    assert location["effective_timezone_id"] == "America/New_York"
    assert not location["map_links"][0]["is_current"]
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT timezone_id, timezone_source_revision FROM live_attrs WHERE id=1")
        assert cur.fetchone() == ("Asia/Tokyo", 2)
        cur.execute("SELECT payload_json FROM audit_logs WHERE action='locality_update'")
        audit = cur.fetchone()[0]
        assert audit["before"]["timezone_id"] == "Asia/Tokyo"
        assert audit["after"]["timezone_id"] == "America/New_York"
        assert audit["timezone_review_live_ids"] == [1]
    assert client.put(f"/api/console/localities/{tokyo['id']}", headers=headers, json=update).status_code == 409


# 测试点：已确认 POI 优先，改坐标后关联失效并回退坐标，过期关联请求不能写入。
def test_map_matching_invalidation_and_removal(integration_test_client):
    client = integration_test_client
    headers = login(client)
    assert client.put("/api/console/venues/1/location", json=point(), headers=headers).status_code == 200
    link = {"expected_revision": 2, "provider": "google", "provider_place_id": "verified-place"}
    response = client.put("/api/console/venues/1/map-links", json=link, headers=headers)
    assert response.status_code == 200, response.text
    google = response.json()["map_links"][0]
    assert google["is_current"] and "query_place_id=verified-place" in google["url"]
    changed = {**point(revision=2), "latitude": 35.7}
    preview = client.post("/api/console/venues/1/location-preview", json=changed).json()
    assert preview["invalidated_map_links"] == 1
    assert preview["invalidated_map_providers"] == ["google"]
    assert preview["changed_fields"] == ["coordinates"]
    response = client.put("/api/console/venues/1/location", json=changed, headers=headers)
    google = response.json()["map_links"][0]
    assert not google["is_current"] and google["url"] == google["coordinate_url"]
    assert client.put("/api/console/venues/1/map-links", json=link, headers=headers).status_code == 409
    response = client.delete("/api/console/venues/1/map-links/google?expected_revision=3", headers=headers)
    assert response.status_code == 200
    assert response.json()["map_links"][0]["verified_at"] is None
    assert response.json()["latitude"] == 35.7


# 测试点：候选接口返回 WGS84 距离，确认关联只审计目标 ID 和链接，不持久化候选资料。
def test_map_candidate_search_and_confirmed_audit(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    assert client.put("/api/console/venues/1/location", json=point(), headers=headers).status_code == 200
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
        "expected_revision": 2, "provider": "google",
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
        json=verified(expected_revision=1, locality_id=locality["id"]),
    )
    assert response.status_code == 200, response.text
    assert response.json()["latitude"] is None and response.json()["timezone_source"] == "locality"
    conflict = {**point(locality["id"], 2), "timezone_id": "America/New_York"}
    assert client.put("/api/console/venues/1/location", json=conflict, headers=headers).status_code == 422
    assert client.patch("/api/console/venues/1", json={"venue_kind": "undisclosed"}, headers=headers).status_code == 200
    assert client.put(
        "/api/console/venues/1/location", headers=headers,
        json=verified(expected_revision=2, locality_id=locality["id"], address="不应保存"),
    ).status_code == 422
    assert client.put("/api/console/venues/1/map-links", headers=headers, json={
        "expected_revision": 2, "provider": "google", "provider_place_id": "not-allowed",
    }).status_code == 422
    assert client.patch("/api/console/venues/1", json={"venue_kind": "online"}, headers=headers).status_code == 409
    assert client.put(
        "/api/console/venues/1/location", json=verified(expected_revision=2), headers=headers,
    ).status_code == 200
    assert client.patch("/api/console/venues/1", json={"venue_kind": "online"}, headers=headers).status_code == 200
    assert client.put("/api/console/venues/1/location", json=point(revision=3), headers=headers).status_code == 422


# 测试点：精确坐标必须说明点位口径，实际修改还必须留下独立于公开地址的核验依据。
def test_coordinate_basis_and_verification_evidence_are_required(integration_test_client):
    client = integration_test_client
    headers = login(client)
    missing_basis = {
        "expected_revision": 1, "latitude": 35.6, "longitude": 139.7,
        "verification_source": "official", "verification_note": "资料核验",
    }
    assert client.post("/api/console/venues/1/location-preview", json=missing_basis).status_code == 422
    missing_evidence = {
        "expected_revision": 1, "latitude": 35.6, "longitude": 139.7,
        "coordinate_basis": "center",
    }
    response = client.put("/api/console/venues/1/location", json=missing_evidence, headers=headers)
    assert response.status_code == 422
    assert "核验来源和核验说明" in response.text


# 测试点：城市搜索分页总数完整，越界页保留总数，写操作和只读接口保持 CSRF / 角色限制。
def test_city_pagination_and_permissions(integration_test_client):
    client = integration_test_client
    headers = login(client)
    city(client, headers, name="検証市")
    city(client, headers, name="検証区")
    page = client.get("/api/console/localities?q=検証&limit=1&page=3")
    assert page.status_code == 200 and page.json()["total"] == 2 and page.json()["items"] == []
    assert client.get("/api/console/localities?q=%25").json()["total"] == 0
    assert client.put("/api/console/venues/1/location", json=point()).status_code == 403
    assert client.put(
        "/api/console/localities/1",
        json={
            "expected_revision": 1,
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


# 测试点：新 Live 从已核验场馆／城市写入 IANA 快照，旧固定 offset 不参与推导。
def test_live_uses_verified_venue_and_city_timezone(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    locality_response = client.post("/api/console/localities", headers=headers, json={
        "country_code": "US", "admin_area": "New York", "locality_name": "New York", "timezone_id": "America/New_York",
    })
    assert locality_response.status_code == 201, locality_response.text
    locality_id = locality_response.json()["id"]
    saved = client.put("/api/console/venues/1/location", headers=headers, json={
        **verified(expected_revision=1, locality_id=locality_id),
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
        cur.execute("SELECT timezone_id, timezone_source, timezone_offset_minutes FROM live_attrs WHERE id=%s", (item["live_id"],))
        assert cur.fetchone() == ("America/New_York", "venue", -240)
