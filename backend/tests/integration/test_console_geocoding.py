from unittest.mock import patch
import pytest
from psycopg2 import sql

pytestmark = pytest.mark.integration


def login(client, role="editor"):
    response = client.post("/api/auth/login", json={"username": f"{role}_tester", "password": f"{role}-test-pass"})
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["csrf_token"]}


def fingerprint(conn):
    with conn.cursor() as cur:
        results = []
        for table in ("venue_list", "venue_name_versions", "venue_map_links", "geo_localities", "live_attrs", "live_schedule_history"):
            cur.execute(sql.SQL("SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text, '[]')) FROM {} t").format(sql.Identifier(table)))
            results.append(cur.fetchone()[0])
        return results


# 测试点：解析接口受角色和 CSRF 保护，名称搜索不要求先有 Venue 坐标。
def test_auth_and_search_contract(integration_test_client):
    client = integration_test_client
    assert client.get("/api/console/geography/capabilities").status_code == 401
    headers = login(client, "viewer")
    assert client.get("/api/console/geography/capabilities").status_code == 403
    headers = login(client)
    assert client.get("/api/console/geography/capabilities").status_code == 200
    assert client.post("/api/console/geography/search", json={"query": "Hall"}).status_code == 403
    with patch("app.routers.console_geocoding.geocode", return_value={"status": "not_found", "items": [], "message": None,
               "attribution": "OSM", "attribution_url": "https://www.openstreetmap.org/copyright"}) as lookup:
        result = client.post("/api/console/geography/search", json={"query": "Hall"}, headers=headers)
    assert result.status_code == 200, result.text
    lookup.assert_called_once_with(query="Hall", country_code=None)


# 测试点：地址和时区解析全程只读，国家级地区可匹配，不新增城市或修改排期。
def test_resolution_is_read_only(integration_test_client, integration_admin_connection):
    client, conn = integration_test_client, integration_admin_connection
    headers = login(client)
    with conn.cursor() as cur:
        cur.execute("INSERT INTO geo_localities(country_code,area_level,timezone_id) VALUES ('HK','country','Asia/Hong_Kong')")
    before = fingerprint(conn)
    payload = {"latitude": 22.3, "longitude": 114.1, "request_id": "draft-1", "parts": "timezone"}
    result = client.post("/api/console/geography/resolve", headers=headers, json=payload)
    assert result.status_code == 200, result.text
    assert result.json()["timezone"]["timezone_id"] == "Asia/Hong_Kong"
    address = {"status": "ready", "message": None, "attribution": "OSM", "attribution_url": "https://www.openstreetmap.org/copyright",
               "items": [{"name": "香港", "address": "香港", "latitude": 22.3, "longitude": 114.1,
                          "country_code": "HK", "admin_area": None, "locality_name": None}]}
    with patch("app.routers.console_geocoding.geocode", return_value=address):
        result = client.post("/api/console/geography/resolve", headers=headers, json={**payload, "parts": "address"})
    assert result.status_code == 200, result.text
    assert result.json()["localities"][0]["area_level"] == "country"
    assert result.json()["timezone"]["status"] == "not_requested"
    assert fingerprint(conn) == before
