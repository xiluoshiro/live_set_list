import pytest


pytestmark = pytest.mark.integration


def login(client):
    response = client.post("/api/auth/login", json={"username": "editor_tester", "password": "editor-test-pass"})
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["csrf_token"]}


# 测试点：质量中心只统计资料缺陷，不把遗留修订号差异当作地图失效。
def test_geography_quality_counts_and_actionable_items(integration_test_client, integration_admin_connection):
    client = integration_test_client
    login(client)
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            """INSERT INTO geo_localities (country_code, admin_area, locality_name, area_level)
               VALUES ('JP', '東京都', '品質市', 'locality') RETURNING id"""
        )
        locality_id = cur.fetchone()[0]
        cur.execute(
            """UPDATE venue_list
               SET locality_id=%s, address='1-1', latitude=35, longitude=139,
                   timezone_id='Asia/Tokyo', location_revision=2
               WHERE id=1""",
            (locality_id,),
        )
        cur.execute(
            """UPDATE venue_list
               SET locality_id=%s, address='2-2', latitude=0, longitude=0,
                   timezone_id='Asia/Tokyo', location_revision=2
               WHERE id=2""",
            (locality_id,),
        )
        cur.execute(
            """INSERT INTO venue_map_links
                   (venue_id, provider, provider_place_id, location_revision)
               VALUES (2, 'google', 'stale-quality-test', 1)"""
        )

    response = client.get("/api/console/geography-quality")
    assert response.status_code == 200, response.text
    body = response.json()
    assert "missing_coordinate_basis" not in body["counts"]
    assert body["counts"]["zero_coordinates"] >= 1
    assert "stale_map_link" not in body["counts"]
    assert client.get("/api/venues/2/maps").json()["map_links"][0]["source"] == "place"
    assert "timezone_review" not in body["counts"]

    zero = client.get("/api/console/geography-quality?category=zero_coordinates")
    assert zero.status_code == 200, zero.text
    assert zero.json()["total"] == zero.json()["counts"]["zero_coordinates"]
    assert any(item["venue_id"] == 2 and item["subject_type"] == "venue" for item in zero.json()["items"])
    assert client.get("/api/console/geography-quality?category=timezone_review").status_code == 422
    assert client.get("/api/console/geography-quality?category=unknown").status_code == 422
