import pytest

pytestmark = pytest.mark.integration


def login(client, role="editor"):
    response = client.post("/api/auth/login", json={"username": f"{role}_tester", "password": f"{role}-test-pass"})
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["csrf_token"]}


def city(client, headers, timezone="Asia/Tokyo"):
    response = client.post("/api/console/localities", headers=headers, json={
        "country_code": "JP", "admin_area": "東京都", "locality_name": "検証市", "timezone_id": timezone,
    })
    assert response.status_code == 201, response.text
    return response.json()


def point(locality_id=None, revision=1):
    return {"expected_revision": revision, "locality_id": locality_id, "address": "Test address",
            "latitude": 35.6, "longitude": 139.7, "timezone_id": "Asia/Tokyo", "coordinate_system": "WGS84"}


# 测试点：预览不写入，位置保存可读回且不改变旧 Live 的排期或名称引用，并记录审计。
def test_location_preview_save_and_live_isolation(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    locality = city(client, headers)
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
        assert cur.fetchone()[0]["before"]["latitude"] is None
    stale = client.put("/api/console/venues/1/location", json=payload, headers=headers)
    assert stale.status_code == 409


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
    assert client.post("/api/console/venues/1/location-preview", json=changed).json()["invalidated_map_links"] == 1
    response = client.put("/api/console/venues/1/location", json=changed, headers=headers)
    google = response.json()["map_links"][0]
    assert not google["is_current"] and google["url"] == google["coordinate_url"]
    assert client.put("/api/console/venues/1/map-links", json=link, headers=headers).status_code == 409
    response = client.delete("/api/console/venues/1/map-links/google?expected_revision=3", headers=headers)
    assert response.status_code == 200
    assert response.json()["map_links"][0]["verified_at"] is None
    assert response.json()["latitude"] == 35.7


# 测试点：城市可独立提供时区，冲突时区与线上场馆实体位置不能保存。
def test_city_only_timezone_conflict_and_online_guard(integration_test_client):
    client = integration_test_client
    headers = login(client)
    locality = city(client, headers)
    response = client.put("/api/console/venues/1/location", headers=headers, json={"expected_revision": 1, "locality_id": locality["id"]})
    assert response.status_code == 200, response.text
    assert response.json()["latitude"] is None and response.json()["timezone_source"] == "locality"
    conflict = {**point(locality["id"], 2), "timezone_id": "America/New_York"}
    assert client.put("/api/console/venues/1/location", json=conflict, headers=headers).status_code == 422
    assert client.patch("/api/console/venues/1", json={"venue_kind": "online"}, headers=headers).status_code == 409
    assert client.put("/api/console/venues/1/location", json={"expected_revision": 2}, headers=headers).status_code == 200
    assert client.patch("/api/console/venues/1", json={"venue_kind": "online"}, headers=headers).status_code == 200
    assert client.put("/api/console/venues/1/location", json=point(revision=3), headers=headers).status_code == 422


# 测试点：城市搜索分页总数完整，越界页保留总数，写操作和只读接口保持 CSRF / 角色限制。
def test_city_pagination_and_permissions(integration_test_client):
    client = integration_test_client
    headers = login(client)
    city(client, headers)
    city(client, headers)
    page = client.get("/api/console/localities?q=検証&limit=1&page=3")
    assert page.status_code == 200 and page.json()["total"] == 2 and page.json()["items"] == []
    assert client.get("/api/console/localities?q=%25").json()["total"] == 0
    assert client.put("/api/console/venues/1/location", json=point()).status_code == 403
    login(client, "viewer")
    assert client.get("/api/console/localities").status_code == 403
    assert client.get("/api/console/venues/1/location").status_code == 403
    assert client.get("/api/console/timezones").status_code == 403
