from unittest.mock import MagicMock, call, patch

from fastapi.testclient import TestClient

from app.geography import coordinate_url, place_url
from app.main import app
from app.routers.venues import (
    VENUE_HEADER_QUERY,
    VENUE_LIVE_COUNT_QUERY,
    VENUE_LIVES_QUERY,
    VENUE_MAP_LINKS_QUERY,
    VENUE_NAME_VERSIONS_QUERY,
)


def _build_connection_mock():
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn, cursor


# 测试点：合并来源 ID 应返回主 Venue，并优先使用当前 POI 链接、对其余地图生成坐标链接。
def test_get_venue_detail_resolves_canonical_venue_and_map_sources():
    conn, cursor = _build_connection_mock()
    header = (
        99,
        7,
        7,
        "日本武道館",
        "physical",
        "JP",
        "東京都",
        "千代田区",
        "北の丸公園2-3",
        35.693317,
        139.749885,
        "Asia/Tokyo",
    )
    cursor.fetchone.side_effect = [header, (1,)]
    cursor.fetchall.side_effect = [
        [("日本武道館", "1964-10-03", None, True)],
        [("google", "ChIJ-current", None)],
        [(51, "2026-08-01", "Test Live", "oneman", [1, 2], None, "scheduled", False, "18:00:00+09:00", "17:00:00+09:00")],
    ]

    with patch("app.routers.venues.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/venues/99?page=1&page_size=20")

    assert response.status_code == 200
    payload = response.json()
    assert payload["venue_id"] == 7
    assert payload["venue_name"] == "日本武道館"
    assert payload["address"] == "北の丸公園2-3"
    assert payload["timezone_id"] == "Asia/Tokyo"
    assert "timezone_source" not in payload
    assert payload["map_links"] == [
        {"provider": "google", "url": place_url("google", "ChIJ-current", "日本武道館"), "source": "place"},
        {"provider": "apple", "url": coordinate_url("apple", 35.693317, 139.749885, "日本武道館"), "source": "coordinates"},
        {"provider": "amap", "url": coordinate_url("amap", 35.693317, 139.749885, "日本武道館"), "source": "coordinates"},
    ]
    assert payload["lives"][0]["live_id"] == 51
    assert payload["pagination"] == {"page": 1, "page_size": 20, "total": 1, "total_pages": 1}
    assert cursor.execute.call_args_list == [
        call(VENUE_HEADER_QUERY, (99,)),
        call(VENUE_NAME_VERSIONS_QUERY, (7,)),
        call(VENUE_MAP_LINKS_QUERY, (7,)),
        call(VENUE_LIVE_COUNT_QUERY, (7,)),
        call(VENUE_LIVES_QUERY, (7, 20, 0)),
    ]


# 测试点：没有实体坐标的 Venue 不应暴露无效地图入口。
def test_get_venue_maps_returns_empty_for_non_physical_venue():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (
        8,
        None,
        8,
        "Online Live",
        "online",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        1,
    )

    with patch("app.routers.venues.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/venues/8/maps")

    assert response.status_code == 200
    assert response.json() == {"venue_id": 8, "venue_name": "Online Live", "map_links": []}
    assert cursor.execute.call_args_list == [call(VENUE_HEADER_QUERY, (8,))]


# 测试点：不存在的 Venue 必须明确返回 404。
def test_get_venue_detail_not_found_returns_404():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = None

    with patch("app.routers.venues.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/venues/404")

    assert response.status_code == 404
    assert response.json() == {"detail": "Venue id 404 not found"}


# 测试点：场馆详情分页只接受站点统一的 15 或 20 条规格。
def test_get_venue_detail_rejects_unsupported_page_size():
    response = TestClient(app).get("/api/venues/7?page_size=10")

    assert response.status_code == 400
    assert response.json() == {"detail": "page_size must be 15 or 20"}
