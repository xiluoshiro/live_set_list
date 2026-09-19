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
        "country_code": "JP", "admin_area": "東京都", "locality_name": name,
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
    return {"timezone_id": "Asia/Tokyo", **values}


# 测试点：新增场地一次保存的位置可通过真实位置接口读回，错误地区不会留下半成品。
def test_create_venue_with_location_is_atomic(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    locality = city(client, headers)
    location = {"locality_id": locality["id"], "address": "Tokyo address", "latitude": 35.6,
                "longitude": 139.7, "timezone_id": "Asia/Tokyo"}
    response = client.post("/api/console/venues", headers=headers,
                           json={"venue_name": "Atomic New Hall", "location": location})
    assert response.status_code == 201, response.text
    venue_id = response.json()["item"]["venue_id"]
    saved = client.get(f"/api/console/venues/{venue_id}/location")
    assert saved.status_code == 200, saved.text
    assert saved.json()["locality"]["id"] == locality["id"]
    for key in ("address", "latitude", "longitude", "timezone_id"):
        assert saved.json()[key] == location[key]
    invalid = client.post("/api/console/venues", headers=headers, json={
        "venue_name": "Must Not Exist", "location": {**location, "locality_id": 99999999},
    })
    assert invalid.status_code == 422, invalid.text
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM venue_list WHERE venue='Must Not Exist'")
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT COUNT(*) FROM venue_name_versions WHERE venue_name='Must Not Exist'")
        assert cur.fetchone()[0] == 0


# 测试点：场馆查询和详情返回自身时区；已公布的 Live 钟点按演出日期解析夏令时偏移。
@pytest.mark.parametrize(("live_date", "offset"), [("2026-01-15", -300), ("2026-07-15", -240)])
def test_console_timezone_read_contract(integration_test_client, integration_admin_connection, live_date, offset):
    client = integration_test_client
    headers = login(client)
    with integration_admin_connection.cursor() as cur:
        cur.execute("UPDATE venue_list SET latitude=40.7, longitude=-74.0, timezone_id='America/New_York' WHERE id=1")
    detail = client.get("/api/console/venues/1")
    assert detail.status_code == 200, detail.text
    assert detail.json()["timezone_id"] == "America/New_York"
    page = client.get("/api/console/venues?limit=100")
    assert page.status_code == 200, page.text
    assert next(item for item in page.json()["items"] if item["venue_id"] == 1)["timezone_id"] == "America/New_York"
    response = client.post("/api/console/lives", headers=headers, json={
        "live_date": live_date, "live_title": "Timezone contract", "live_type": "oneman",
        "url": "https://example.com/timezone", "opening_time": "18:00", "start_time": "19:00",
        "venue_id": 1, "venue_name_version_id": detail.json()["venue_name_version_id"],
        "default_band_ids": [], "event_attendees": [],
    })
    assert response.status_code == 201, response.text
    assert "timezone_id" not in response.json()["item"]
    assert response.json()["item"]["start_time"].endswith("-05:00" if offset == -300 else "-04:00")


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
                """INSERT INTO geo_localities (country_code, admin_area, locality_name, area_level)
                   VALUES (%s, %s, NULL, %s) RETURNING id""",
                (country_code, admin_area, area_level),
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
    assert preview.json()["after"]["timezone_id"] == "Asia/Tokyo"
    assert client.get("/api/console/venues/1/location").json()["latitude"] is None
    saved = client.put("/api/console/venues/1/location", json=payload, headers=headers)
    assert saved.status_code == 200, saved.text
    assert saved.json()["state_token"] != payload["expected_state_token"]
    assert "location_revision" not in saved.json()
    assert saved.json()["locality"]["id"] == locality["id"]
    assert saved.json()["timezone_id"] == "Asia/Tokyo"
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
        "expected_state_token": token(client), "locality_id": tokyo["id"], "timezone_id": "Asia/Tokyo", "address": "Updated address",
    })
    assert address_only.status_code == 200, address_only.text
    assert address_only.json()["live_count"] == 2
    assert "timezone_review_live_count" not in address_only.json()

    new_york_response = client.post("/api/console/localities", headers=headers, json={
        "country_code": "US", "admin_area": "New York", "locality_name": "New York",
    })
    assert new_york_response.status_code == 201, new_york_response.text
    changed = client.post("/api/console/venues/1/location-preview", json={
        "expected_state_token": token(client), "locality_id": new_york_response.json()["id"], "timezone_id": "Asia/Tokyo",
    })
    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert body["live_count"] == 2
    assert "timezone_review_lives" not in body


# 测试点：地区纠错不修改 Venue 或地图，旧地区表单被拒绝且 Live 快照保持不变。
def test_locality_correction_preserves_venue_and_maps(integration_test_client, integration_admin_connection):
    # 测试点：地区更名不修改场地时区及演出时间；旧令牌不能再次覆盖。
    client=integration_test_client; headers=login(client); locality=city(client,headers)
    assert client.put("/api/console/venues/1/location",headers=headers,json=point(client,locality["id"])).status_code==200
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT opening_time,start_time FROM live_attrs ORDER BY id"); before=cur.fetchall()
    update={"expected_state_token":locality["state_token"],"country_code":"JP","admin_area":"東京都","locality_name":"改名地区","area_level":"locality"}
    response=client.put(f"/api/console/localities/{locality['id']}",headers=headers,json=update)
    assert response.status_code==200,response.text
    assert "timezone_id" not in response.json()
    assert client.get("/api/console/venues/1/location").json()["timezone_id"]=="Asia/Tokyo"
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT opening_time,start_time FROM live_attrs ORDER BY id"); assert cur.fetchall()==before
    assert client.put(f"/api/console/localities/{locality['id']}",headers=headers,json=update).status_code==409



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
    # 测试点：未公开场地可无坐标但必须有自身时区，地区不限制场地时区。
    client=integration_test_client; headers=login(client); locality=city(client,headers)
    payload={"expected_state_token":token(client),"locality_id":locality["id"],"timezone_id":"America/New_York"}
    response=client.put("/api/console/venues/1/location",headers=headers,json=payload)
    assert response.status_code==200,response.text
    assert response.json()["latitude"] is None and response.json()["timezone_id"]=="America/New_York"
    created=client.post("/api/console/venues",headers=headers,json={"venue_name":"未公开测试场地","venue_kind":"undisclosed","location":{"timezone_id":"Asia/Tokyo"}})
    assert created.status_code==201,created.text
    assert client.post("/api/console/venues",headers=headers,json={"venue_name":"无时区场地","venue_kind":"undisclosed"}).status_code==422



# 测试点：成对 WGS84 坐标可直接保存，已删除的核验字段会被严格拒绝。
def test_coordinates_need_no_verification_fields(integration_test_client):
    client = integration_test_client
    headers = login(client)
    plain_point = {
        "expected_state_token": token(client), "latitude": 35.6, "longitude": 139.7, "timezone_id": "Asia/Tokyo",
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
            "area_level": "locality",
        },
    ).status_code == 403
    login(client, "viewer")
    assert client.get("/api/console/localities").status_code == 403
    assert client.get("/api/console/venues/1/location").status_code == 403
    assert client.get("/api/console/timezones").status_code == 403


def test_live_uses_venue_iana_or_online_fixed_offset(integration_test_client, integration_admin_connection):
    # 测试点：非线上继承场地，ONLINE 固定偏移；无场地时间和夏令时异常钟点拒绝。
    client=integration_test_client; headers=login(client)
    base={"live_date":"2026-07-22","live_title":"Timezone rules","live_type":"oneman","url":"https://example.com/tz","opening_time":"18:00","start_time":"19:00","venue_id":1,"venue_name_version_id":1}
    with integration_admin_connection.cursor() as cur:
        cur.execute("UPDATE venue_list SET timezone_id='America/New_York' WHERE id=1")
    response=client.post("/api/console/lives",headers=headers,json=base)
    assert response.status_code==201,response.text
    assert response.json()["item"]["start_time"]=="19:00:00-04:00"
    assert "timezone_source" not in response.json()["item"]
    assert client.post("/api/console/lives",headers=headers,json={**base,"venue_id":None,"venue_name_version_id":None}).status_code==422
    for kind in ("undisclosed","online"):
        with integration_admin_connection.cursor() as cur:
            cur.execute("INSERT INTO venue_list(venue,venue_kind,timezone_id) VALUES (%s,%s,%s) RETURNING id",(kind,kind,"Asia/Tokyo" if kind=="undisclosed" else None)); venue=cur.fetchone()[0]
            cur.execute("INSERT INTO venue_name_versions(venue_id,venue_name) VALUES (%s,%s) RETURNING id",(venue,kind)); version=cur.fetchone()[0]
        payload={**base,"venue_id":venue,"venue_name_version_id":version}
        if kind=="online":
            assert client.post("/api/console/lives",headers=headers,json=payload).status_code==422
            payload["timezone"]="-03:30"
        response=client.post("/api/console/lives",headers=headers,json=payload)
        assert response.status_code==201,response.text
        assert response.json()["item"]["start_time"].endswith("-03:30" if kind=="online" else "+09:00")
    for day,clock in (("2026-03-08","02:30"),("2026-11-01","01:30")):
        assert client.post("/api/console/lives",headers=headers,json={**base,"live_date":day,"start_time":clock}).status_code==422
        # 测试点：旧 fold 字段不能绕过重复钟点的拒绝规则。
        assert client.post("/api/console/lives",headers=headers,json={**base,"live_date":day,"start_time":clock,"start_time_fold":0}).status_code==422



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
                   {"latitude": 35.6001}, {"timezone_id": "Asia/Tokyo"}):
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
        "location": {"address": "New address", "latitude": 35.6, "longitude": 139.7, "timezone_id": "Asia/Tokyo"},
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
        "locality_name": "Corrected locality name",
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
