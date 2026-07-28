from datetime import date
from unittest.mock import MagicMock, patch

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


# 测试点：包含 2+ 场 live 的有效 group 应以 kind=performance_group 形式出现。
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


# 测试点：少于 2 场 live 的 group 不应以 group 形式返回（HAVING COUNT >= 2 过滤）。
def test_groups_with_fewer_than_2_lives_not_returned():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (0,)
    cursor.fetchall.return_value = []

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/performances?scope=all&page=1&page_size=20")

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["total"] == 0


# 测试点：scope=favorites 且未登录时应返回 401。
def test_scope_favorites_returns_401_when_not_logged_in():
    response = TestClient(app).get("/api/catalog/performances?scope=favorites&page=1&page_size=20")
    assert response.status_code == 401


# 测试点：scope=favorites 应只返回完整收藏项，并按日期、开演时间、ID 统一倒序。
def test_scope_favorites_returns_only_favorited_items():
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
    page_sql = str(cursor.execute.call_args_list[1].args[0])
    assert "gs.end_time AS sort_time" in page_sql
    assert "ORDER BY sort_date DESC, sort_time DESC, sort_id DESC" in page_sql


# 测试点：搜索关键词 q 应过滤独立 live 的标题。
def test_filters_q_filter_standalone_lives():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (1,)
    cursor.fetchall.return_value = [
        _live_row(100, date(2026, 6, 1), "Special Concert", [1]),
    ]

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get(
            "/api/catalog/performances?scope=all&q=Special&page=1&page_size=20"
        )

    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["live"]["live_title"] == "Special Concert"


# 测试点：year 参数应过滤独立 live 的年份范围。
def test_filters_year_filter_standalone_lives():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (0,)
    cursor.fetchall.return_value = []

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get(
            "/api/catalog/performances?scope=all&year=2026&page=1&page_size=20"
        )

    assert response.status_code == 200


# 测试点：live_type 过滤应只影响独立 live 的查询条件。
def test_filters_live_type_filter_standalone_lives():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (1,)
    cursor.fetchall.return_value = [
        _live_row(200, date(2026, 7, 1), "Oneman Live", [1], live_type="oneman"),
    ]

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get(
            "/api/catalog/performances?scope=all&live_type=oneman&page=1&page_size=20"
        )

    assert response.status_code == 200


# 测试点：band_id 过滤应过滤独立 live 对其参与乐队的依赖。
def test_filters_band_id_filter_standalone_lives():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (1,)
    cursor.fetchall.return_value = [
        _live_row(300, date(2026, 5, 1), "Band Live", [3]),
    ]

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get(
            "/api/catalog/performances?scope=all&band_id=3&page=1&page_size=20"
        )

    assert response.status_code == 200


# 测试点：活动组仅部分命中筛选时，接口应返回带活动组引用的单场 Live。
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


# 测试点：sort=date_desc 应按最后一场日期、开演时间倒序，ID 只作稳定兜底。
def test_sort_date_desc_uses_correct_ordering():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (2,)
    cursor.fetchall.return_value = [
        _live_row(10, date(2026, 12, 30), "December Live", [1]),
        _group_row(
            1, "Earlier Group", date(2026, 1, 1), date(2026, 1, 2), 2, 2,
            "multi_day", [], ["V"],
        ),
    ]

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get(
            "/api/catalog/performances?scope=all&sort=date_desc&page=1&page_size=20"
        )

    assert response.status_code == 200
    page_sql = str(cursor.execute.call_args_list[1].args[0])
    assert "gs.end_time AS sort_time" in page_sql
    assert "ORDER BY sort_date DESC, sort_time DESC, sort_id DESC" in page_sql


# 测试点：sort=date_asc 应按第一场日期、开演时间升序，ID 只作稳定兜底。
def test_sort_date_asc_uses_correct_ordering():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (2,)
    cursor.fetchall.return_value = [
        _group_row(
            1, "Early Group", date(2026, 1, 1), date(2026, 2, 1), 2, 2,
            "multi_day", [], ["V"],
        ),
        _live_row(10, date(2026, 6, 1), "June Live", [1]),
    ]

    with patch("app.routers.performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get(
            "/api/catalog/performances?scope=all&sort=date_asc&page=1&page_size=20"
        )

    assert response.status_code == 200
    page_sql = str(cursor.execute.call_args_list[1].args[0])
    assert "gs.start_time AS sort_time" in page_sql
    assert "ORDER BY sort_date ASC, sort_time ASC, sort_id ASC" in page_sql


# 测试点：page_size 必须为 15 或 20，其他值应返回 400。
def test_invalid_page_size_returns_400():
    response = TestClient(app).get("/api/catalog/performances?scope=all&page=1&page_size=10")
    assert response.status_code == 400
    assert "page_size" in response.json()["detail"]
