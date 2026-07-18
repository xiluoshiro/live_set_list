from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers.performance_groups import (
    PERFORMANCE_GROUP_BANDS_QUERY,
    PERFORMANCE_GROUP_HEADER_QUERY,
    PERFORMANCE_GROUP_LIVES_QUERY,
    PERFORMANCE_GROUP_VENUES_QUERY,
    _compute_display_type,
)


@pytest.fixture(autouse=True)
def _clear_dependency_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


def _build_connection_mock():
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn, cursor


# 测试点：get_performance_group_detail 应返回 200 及完整结构，包括 header、bands、venues、lives。
def test_get_performance_group_detail_returns_200_with_correct_structure():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (1, "Test Group", date(2026, 6, 1), date(2026, 6, 2), 1, 2)
    cursor.fetchall.side_effect = [
        [(1, "Band One", "b1")],
        [("Zepp Tokyo",)],
        [
            (101, date(2026, 6, 1), "Live A", "oneman", "17:00:00+09", "Zepp Tokyo", [1], "https://example.com/101", True),
            (102, date(2026, 6, 1), "Live B", "oneman", "18:00:00+09", "Zepp Tokyo", [1], "https://example.com/102", False),
        ],
    ]

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/performance-groups/1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["group_id"] == 1
    assert payload["group_title"] == "Test Group"
    assert payload["start_date"] == "2026-06-01"
    assert payload["end_date"] == "2026-06-02"
    assert payload["day_count"] == 1
    assert payload["live_count"] == 2
    assert payload["display_type"] == "single_day_multi_show"
    assert payload["bands"] == [{"band_id": 1, "band_name": "Band One", "band_abbr": "b1"}]
    assert payload["venues"] == ["Zepp Tokyo"]
    assert len(payload["lives"]) == 2
    assert cursor.execute.call_args_list[0][0][0] == PERFORMANCE_GROUP_HEADER_QUERY


# 测试点：get_performance_group_detail 对不存在的 group 应返回 404。
def test_get_performance_group_detail_returns_404_for_nonexistent_group():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = None

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/performance-groups/999")

    assert response.status_code == 404
    assert "999" in response.json()["detail"]


# 测试点：get_performance_group_detail 对 group_id < 1 应返回 400。
def test_get_performance_group_detail_returns_400_for_group_id_less_than_1():
    response = TestClient(app).get("/api/catalog/performance-groups/0")
    assert response.status_code == 400
    assert "group_id must be >= 1" in response.json()["detail"]


# 测试点：详情接口应正确聚合 group 内所有 live 的乐队信息。
def test_performance_group_detail_includes_correct_band_aggregation():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (2, "Multi Band Group", date(2026, 7, 1), date(2026, 7, 3), 3, 2)
    cursor.fetchall.side_effect = [
        [(1, "Poppin'Party", "ppp"), (2, "Roselia", "rsl")],
        [("Shibuya WWW X",), ("Zepp Shinjuku",)],
        [
            (201, date(2026, 7, 1), "Day 1", "multi_act", "17:00:00+09", "Shibuya WWW X", [1, 2], None, True),
            (202, date(2026, 7, 3), "Day 3", "festival", "15:00:00+09", "Zepp Shinjuku", [1], None, False),
        ],
    ]

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/performance-groups/2")

    payload = response.json()
    assert len(payload["bands"]) == 2
    assert payload["bands"][0]["band_id"] == 1
    assert payload["bands"][1]["band_id"] == 2


# 测试点：详情接口应正确聚合 group 内所有 live 的场馆信息。
def test_performance_group_detail_includes_correct_venue_aggregation():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (3, "Venue Group", date(2026, 8, 1), date(2026, 8, 2), 2, 2)
    cursor.fetchall.side_effect = [
        [(1, "Poppin'Party", "ppp")],
        [("Shibuya WWW X",), ("Zepp Shinjuku",)],
        [
            (301, date(2026, 8, 1), "Shibuya Show", "oneman", "17:00:00+09", "Shibuya WWW X", [1], None, True),
            (302, date(2026, 8, 2), "Zepp Show", "oneman", "17:00:00+09", "Zepp Shinjuku", [1], None, False),
        ],
    ]

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/performance-groups/3")

    payload = response.json()
    assert len(payload["venues"]) == 2
    assert "Shibuya WWW X" in payload["venues"]
    assert "Zepp Shinjuku" in payload["venues"]


# 测试点：Lives 应按 live_date ASC、start_time ASC、id ASC 排序。
def test_performance_group_detail_lives_sorted_by_date_start_time_id():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (4, "Sort Group", date(2026, 5, 1), date(2026, 5, 1), 1, 3)
    cursor.fetchall.side_effect = [
        [],
        [],
        [
            (401, date(2026, 5, 1), "First by id", "oneman", "15:00:00+09", "Venue", [], None, False),
            (402, date(2026, 5, 1), "Same time", "oneman", "15:00:00+09", "Venue", [], None, False),
            (403, date(2026, 5, 1), "Third by id", "oneman", "17:00:00+09", "Venue", [], None, False),
        ],
    ]

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/performance-groups/4")

    live_ids = [live["live_id"] for live in response.json()["lives"]]
    assert live_ids == [401, 402, 403]
    assert "ORDER BY l.live_date ASC, l.start_time ASC, l.id ASC" in PERFORMANCE_GROUP_LIVES_QUERY


# 测试点：day_count=1 且 live_count>=2 时 display_type 应为 "single_day_multi_show"。
def test_display_type_single_day_multi_show():
    assert _compute_display_type(1, 2) == "single_day_multi_show"
    assert _compute_display_type(1, 3) == "single_day_multi_show"


# 测试点：day_count>1 时 display_type 应为 "multi_day"。
def test_display_type_multi_day():
    assert _compute_display_type(2, 2) == "multi_day"
    assert _compute_display_type(5, 3) == "multi_day"


# 测试点：匿名用户访问时所有 live 的 is_favorite 都应为 False。
def test_anonymous_user_sees_is_favorite_false():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (5, "Anon Group", date(2026, 6, 1), date(2026, 6, 1), 1, 2)
    cursor.fetchall.side_effect = [
        [(1, "Band", "bd")],
        [("Venue",)],
        [
            (501, date(2026, 6, 1), "Live X", "oneman", "17:00:00+09", "Venue", [1], None, True),
            (502, date(2026, 6, 1), "Live Y", "oneman", "18:00:00+09", "Venue", [1], None, False),
        ],
    ]

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/performance-groups/5")

    lives = response.json()["lives"]
    assert all(live["is_favorite"] is False for live in lives)


# 测试点：已登录用户应能正确获取收藏状态。
def test_authenticated_user_sees_correct_favorite_status():
    from app.auth import get_current_user_optional as auth_get_current_user_optional

    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (6, "Auth Group", date(2026, 7, 1), date(2026, 7, 1), 1, 2)
    cursor.fetchall.side_effect = [
        [(1, "Band", "bd")],
        [("Venue",)],
        [
            (601, date(2026, 7, 1), "Fav Live", "oneman", "17:00:00+09", "Venue", [1], None, True),
            (602, date(2026, 7, 1), "Unfav Live", "oneman", "18:00:00+09", "Venue", [1], None, False),
        ],
    ]
    app.dependency_overrides[auth_get_current_user_optional] = lambda: MagicMock(id=99)

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        with patch(
            "app.routers.performance_groups.get_favorite_live_id_set",
            return_value={601},
        ):
            response = TestClient(app).get("/api/catalog/performance-groups/6")

    lives = response.json()["lives"]
    fav_map = {live["live_id"]: live["is_favorite"] for live in lives}
    assert fav_map[601] is True
    assert fav_map[602] is False
