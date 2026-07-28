from unittest.mock import MagicMock, call, patch

from fastapi.testclient import TestClient

from app.main import app
from app.routers.catalog import (
    BAND_LIST_QUERY,
    BAND_LIVES_COUNT_QUERY,
    BAND_LIVES_PAGE_QUERY,
    BAND_META_QUERY,
    SEARCH_BANDS_QUERY,
    SEARCH_LIVES_QUERY,
    SEARCH_SONGS_QUERY,
    SEARCH_VENUES_QUERY,
)


def _build_connection_mock():
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn, cursor


def test_search_catalog_returns_grouped_public_results():
    # 测试点：公共搜索应按 Live、乐队、歌曲和场地分组返回，且匿名访问不查收藏表。
    conn, cursor = _build_connection_mock()
    cursor.fetchall.side_effect = [
        [(1, "2026-03-28", "Poppin'Party Live", [1], "https://example.com/live/1", "oneman", None, None, 5, "Party Weekend")],
        [(1, "Poppin'Party", "PoPiPa", ["Kasumi"], 12)],
        [(7, "STAR BEAT!", 1, "Poppin'Party", 5)],
        [(3, "有明アリーナ", 4)],
    ]

    with patch("app.routers.catalog.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/catalog/search?q=Party&limit=8")

    assert response.status_code == 200
    payload = response.json()
    assert payload["query"] == "Party"
    assert payload["lives"][0] == {
        "live_id": 1,
        "live_date": "2026-03-28",
        "live_title": "Poppin'Party Live",
        "live_type": "oneman",
        "bands": [1],
        "url": "https://example.com/live/1",
        "is_favorite": False,
        "tour": None,
        "performance_group": {"group_id": 5, "group_title": "Party Weekend"},
        "event_status": "scheduled",
        "date_phase": "past",
        "was_rescheduled": False,
    }
    assert payload["bands"] == [{"band_id": 1, "band_name": "Poppin'Party", "band_abbr": "PoPiPa", "band_members": ["Kasumi"], "live_count": 12}]
    assert payload["songs"] == [
        {"song_id": 7, "song_name": "STAR BEAT!", "band_id": 1, "band_name": "Poppin'Party", "live_count": 5}
    ]
    assert payload["venues"] == [{"venue_id": 3, "venue_name": "有明アリーナ", "live_count": 4}]
    assert cursor.execute.call_args_list == [
        call(SEARCH_LIVES_QUERY, ("%Party%", "%Party%", "%Party%", "%Party%", "%Party%", 8)),
        call(SEARCH_BANDS_QUERY, ("%Party%", "%Party%", 8)),
        call(SEARCH_SONGS_QUERY, ("%Party%", 8)),
        call(SEARCH_VENUES_QUERY, ("%Party%", 8)),
    ]


def test_search_catalog_blank_query_returns_400():
    # 测试点：公共搜索拒绝空白关键词，避免无意拉取全库结果。
    client = TestClient(app)
    response = client.get("/api/catalog/search?q=%20%20")

    assert response.status_code == 400
    assert response.json()["detail"] == "q must not be blank"


def test_list_catalog_bands_uses_public_band_query():
    # 测试点：乐队浏览应从当前开放版本取成员，并统一使用 effective_live_bands 统计关联 Live。
    conn, cursor = _build_connection_mock()
    cursor.fetchall.return_value = [
        (1, "Poppin'Party", "PoPiPa", ["Kasumi"], 12),
        (2, "Roselia", "Roselia", ["Yukina"], 8),
    ]

    with patch("app.routers.catalog.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/catalog/bands?limit=30")

    assert response.status_code == 200
    assert response.json()["items"] == [
        {"band_id": 1, "band_name": "Poppin'Party", "band_abbr": "PoPiPa", "band_members": ["Kasumi"], "live_count": 12},
        {"band_id": 2, "band_name": "Roselia", "band_abbr": "Roselia", "band_members": ["Yukina"], "live_count": 8},
    ]
    assert "FROM current_band_versions b" in BAND_LIST_QUERY
    assert "WHERE b.band_id > 0" in BAND_LIST_QUERY
    assert "ORDER BY b.band_id" in BAND_LIST_QUERY
    assert "LEFT JOIN effective_live_bands effective" in BAND_LIST_QUERY
    assert "JOIN effective_live_bands selected" in BAND_LIVES_PAGE_QUERY
    assert "effective_live_bands effective" in BAND_LIVES_PAGE_QUERY
    assert cursor.execute.call_args_list == [call(BAND_LIST_QUERY, (30,))]


def test_get_catalog_band_lives_returns_band_and_paginated_lives():
    # 测试点：乐队页应返回乐队摘要、分页信息和可打开详情的 Live 行。
    conn, cursor = _build_connection_mock()
    cursor.fetchone.side_effect = [(1, "Poppin'Party", "PoPiPa", ["Kasumi"], 22), (22,)]
    cursor.fetchall.return_value = [
        (9, "2026-06-01", "Band Live 9", [1, 2], "https://example.com/live/9", "multi_act", None, None, 5, "Party Weekend"),
    ]

    with patch("app.routers.catalog.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/catalog/bands/1/lives?page=2&page_size=20")

    assert response.status_code == 200
    payload = response.json()
    assert payload["band"] == {"band_id": 1, "band_name": "Poppin'Party", "band_abbr": "PoPiPa", "band_members": ["Kasumi"], "live_count": 22}
    assert payload["pagination"] == {"page": 2, "page_size": 20, "total": 22, "total_pages": 2}
    assert payload["items"][0]["live_id"] == 9
    assert payload["items"][0]["bands"] == [1, 2]
    assert payload["items"][0]["performance_group"] == {"group_id": 5, "group_title": "Party Weekend"}
    assert cursor.execute.call_args_list == [
        call(BAND_META_QUERY, (1,)),
        call(BAND_LIVES_COUNT_QUERY, (1,)),
        call(BAND_LIVES_PAGE_QUERY, (1, 20, 20)),
    ]
