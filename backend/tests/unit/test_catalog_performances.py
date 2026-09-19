from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app


def _build_connection_mock():
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn, cursor


def _live_row(live_id, live_date, live_title, band_ids, tour_id=None, tour_title=None,
              group_id=None, group_title=None, live_type="oneman", url="https://example.com"):
    return (
        "live",
        live_id,
        live_date,
        live_title,
        url,
        live_type,
        band_ids or [],
        tour_id,
        tour_title,
        group_id,
        group_title,
        None, None, None, None, None, None, None, None, None,
    )


def _group_row(group_id, group_title, start_date, end_date, day_count, live_count,
               display_type, bands, venues):
    return (
        "performance_group",
        None, None, None, None, None, None, None, None, None, None,
        group_id,
        group_title,
        start_date,
        end_date,
        day_count,
        live_count,
        display_type,
        bands,
        venues,
    )


# 测试点：scope=all 时应返回混合的 live 和 performance_group 项目。
def test_get_catalog_performances_with_scope_all_returns_mixed_items():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (3,)
    cursor.fetchall.return_value = [
        _live_row(1, date(2026, 6, 15), "Standalone Live", [1]),
        _group_row(
            10, "Two-Day Group", date(2026, 5, 1), date(2026, 5, 2), 2, 2,
            "multi_day",
            [{"band_id": 1, "band_name": "Band", "band_abbr": "bd"}],
            ["Venue A", "Venue B"],
        ),
        _live_row(2, date(2026, 4, 1), "Another Live", [2]),
    ]

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/performances?scope=all&page=1&page_size=20")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 3
    assert payload["items"][0]["kind"] in ("live", "performance_group")
    assert payload["pagination"]["total"] == 3


# 测试点：未属于任何 activity group 的 Live 应以 kind=live 形式出现。
def test_standalone_lives_appear_as_kind_live():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (1,)
    cursor.fetchall.return_value = [
        _live_row(55, date(2026, 7, 1), "Standalone", [1, 2], tour_id=3, tour_title="My Tour"),
    ]

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/performances?scope=all&page=1&page_size=20")

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["kind"] == "live"
    assert item["live"]["live_id"] == 55
    assert item["live"]["tour"]["tour_id"] == 3


# 测试点：查询返回的聚合记录应映射为 performance_group，并保留场次数量。
def test_valid_groups_appear_as_kind_performance_group():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (1,)
    cursor.fetchall.return_value = [
        _group_row(
            1, "Valid Group", date(2026, 3, 1), date(2026, 3, 3), 3, 3,
            "multi_day",
            [{"band_id": 1, "band_name": "Poppin'Party", "band_abbr": "ppp"}],
            ["Venue X"],
        ),
    ]

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/performances?scope=all&page=1&page_size=20")

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["kind"] == "performance_group"
    assert item["performance_group"]["group_id"] == 1
    assert item["performance_group"]["live_count"] == 3


# 测试点：scope=favorites 且未登录时应返回 401。
def test_scope_favorites_returns_401_when_not_logged_in():
    response = TestClient(app).get("/api/catalog/performances?scope=favorites&page=1&page_size=20")
    assert response.status_code == 401


# 测试点：登录后收藏查询返回映射后的收藏记录。
def test_scope_favorites_maps_authenticated_query_results():
    app.dependency_overrides.clear()
    from app.auth import get_current_user_optional as auth_get_current_user_optional

    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (1,)
    cursor.fetchall.return_value = [
        _group_row(
            1, "Fully Fav Group", date(2026, 6, 1), date(2026, 6, 1), 1, 2,
            "single_day_multi_show",
            [],
            ["Venue"],
        ),
    ]
    app.dependency_overrides[auth_get_current_user_optional] = lambda: MagicMock(id=99)

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get(
            "/api/catalog/performances?scope=favorites&page=1&page_size=20"
        )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["kind"] == "performance_group"
    assert items[0]["performance_group"]["group_id"] == 1


# 测试点：关键词、年份、类型和乐队筛选必须进入计数及分页 SQL，并按占位符顺序绑定值。
@pytest.mark.parametrize(
    ("query", "bound_params"),
    [
        pytest.param("q=Special", ("%Special%",) * 11, id="keyword"),
        pytest.param(
            "year=2026",
            (date(2026, 1, 1), date(2027, 1, 1)) * 2, id="year",
        ),
        pytest.param("live_type=oneman", ("oneman",) * 2, id="live-type"),
        pytest.param("band_id=3", (3, 3), id="band"),
    ],
)
def test_catalog_filters_bind_values_to_count_and_page(query, bound_params):
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (1,)
    cursor.fetchall.return_value = [
        _live_row(100, date(2026, 6, 1), "Special Concert", [3]),
    ]
    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get(
            f"/api/catalog/performances?scope=all&{query}&page=1&page_size=20"
        )
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["live"]["live_title"] == "Special Concert"
    assert cursor.execute.call_count == 2
    count_call, page_call = cursor.execute.call_args_list
    assert count_call.args[1] == bound_params
    assert page_call.args[1] == (*bound_params, 20, 0)


# 测试点：查询返回的单场记录应保留所属活动组的 ID 和标题。
def test_filters_expand_partially_matching_group_into_lives():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (1,)
    cursor.fetchall.return_value = [
        _live_row(
            400,
            date(2026, 4, 1),
            "Matching Child Live",
            [2],
            group_id=5,
            group_title="Matching Group",
        ),
    ]

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get(
            "/api/catalog/performances?scope=all&band_id=2&page=1&page_size=20"
        )

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["kind"] == "live"
    assert item["live"]["live_id"] == 400
    assert item["live"]["performance_group"] == {
        "group_id": 5,
        "group_title": "Matching Group",
    }


# 测试点：page_size 必须为 15 或 20，其他值应返回 400。
def test_invalid_page_size_returns_400():
    response = TestClient(app).get("/api/catalog/performances?scope=all&page=1&page_size=10")
    assert response.status_code == 400
    assert "page_size" in response.json()["detail"]
