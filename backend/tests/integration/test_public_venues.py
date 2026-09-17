import pytest


pytestmark = pytest.mark.integration


def _login_editor(client):
    response = client.post(
        "/api/auth/login",
        json={"username": "editor_tester", "password": "editor-test-pass"},
    )
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["csrf_token"]}


# 测试点：公开 Venue 接口应通过只读连接返回真实地点、地图入口和关联 Live。
def test_public_venue_detail_reads_location_maps_and_lives(integration_test_client):
    client = integration_test_client
    headers = _login_editor(client)
    locality = client.post(
        "/api/console/localities",
        headers=headers,
        json={
            "country_code": "JP",
            "admin_area": "東京都",
            "locality_name": "千代田区",
            "timezone_id": "Asia/Tokyo",
        },
    )
    assert locality.status_code == 201, locality.text
    location = client.put(
        "/api/console/venues/1/location",
        headers=headers,
        json={
            "expected_revision": 1,
            "locality_id": locality.json()["id"],
            "address": "北の丸公園2-3",
            "latitude": 35.693317,
            "longitude": 139.749885,
            "coordinate_system": "WGS84",
            "timezone_id": "Asia/Tokyo",
        },
    )
    assert location.status_code == 200, location.text
    linked = client.put(
        "/api/console/venues/1/map-links",
        headers=headers,
        json={"expected_revision": 2, "provider": "google", "provider_place_id": "verified-place"},
    )
    assert linked.status_code == 200, linked.text

    response = client.get("/api/venues/1")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["venue_id"] == 1
    assert payload["address"] == "北の丸公園2-3"
    assert payload["locality"] == {"country_code": "JP", "admin_area": "東京都", "locality_name": "千代田区"}
    assert payload["timezone_id"] == "Asia/Tokyo"
    assert payload["timezone_source"] == "venue"
    assert payload["map_links"][0]["provider"] == "google"
    assert payload["map_links"][0]["source"] == "place"
    assert "query_place_id=verified-place" in payload["map_links"][0]["url"]
    assert payload["name_versions"][-1]["is_current"] is True
    assert payload["pagination"]["total"] >= len(payload["lives"]) > 0
