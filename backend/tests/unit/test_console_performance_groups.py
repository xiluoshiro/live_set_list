import hashlib
from datetime import UTC, date, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.auth import AuthSessionContext, AuthUser, get_current_auth_context, get_current_user
from app.main import app

CSRF_TOKEN = "csrf-token"


@pytest.fixture(autouse=True)
def _clear_dependency_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


def _authenticate_editor() -> None:
    user = AuthUser(id=42, username="editor", display_name="Editor", role="editor", is_active=True)
    context = AuthSessionContext(
        session_id=7,
        user=user,
        csrf_token_hash=hashlib.sha256(CSRF_TOKEN.encode("utf-8")).hexdigest(),
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_auth_context] = lambda: context


def _authenticate_viewer() -> None:
    user = AuthUser(id=43, username="viewer", display_name="Viewer", role="viewer", is_active=True)
    context = AuthSessionContext(
        session_id=8,
        user=user,
        csrf_token_hash=hashlib.sha256(CSRF_TOKEN.encode("utf-8")).hexdigest(),
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_auth_context] = lambda: context


def _connection_mock():
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn, cursor


def _upsert_payload(**overrides):
    payload = {
        "group_title": " Test Group ",
        "live_ids": [41, 42],
    }
    payload.update(overrides)
    return payload


# 测试点：live-candidates 应返回分页结果，并排除已关联任意 activity group 的 live。
def test_get_performance_group_live_candidates_returns_paginated_results_excluding_assigned():
    _authenticate_editor()
    conn, cursor = _connection_mock()
    cursor.fetchone.return_value = (3,)
    cursor.fetchall.return_value = [
        (101, date(2026, 5, 30), "Available Live", "13:00:00+09:00", "Zepp", [1]),
        (102, date(2026, 5, 29), "Another Live", "18:00:00+09:00", "WWW X", [2]),
    ]

    with patch("app.routers.console_performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get(
            "/api/console/performance-groups/live-candidates?page=1&page_size=20"
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 3
    assert len(payload["items"]) == 2
    assert payload["items"][0]["live_id"] == 101
    assert payload["items"][0]["start_time"] == "13:00:00+09:00"
    executed_sql = [str(call.args[0]) for call in cursor.execute.call_args_list]
    assert all(
        "NOT EXISTS (SELECT 1 FROM performance_group_lives occupied" in sql
        for sql in executed_sql
    )


# 测试点：标题和数字关键词均绑定到候选总数/分页 SQL 的标题匹配与精确 ID 分支。
@pytest.mark.parametrize(
    ("query", "live_id", "title"),
    [pytest.param("Special", 201, "Special Live", id="title"), pytest.param("42", 42, "Some Live", id="id")],
)
def test_performance_group_candidates_bind_search_to_count_and_page(query, live_id, title):
    _authenticate_editor()
    conn, cursor = _connection_mock()
    cursor.fetchone.return_value = (1,)
    cursor.fetchall.return_value = [(live_id, date(2026, 6, 1), title, "17:00:00+09:00", "Venue", [1])]
    with patch("app.routers.console_performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get(
            "/api/console/performance-groups/live-candidates", params={"q": query, "page": 1, "page_size": 20},
        )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 1
    assert payload["items"][0]["live_id"] == live_id
    assert payload["items"][0]["live_title"] == title
    assert cursor.execute.call_count == 2
    for call_args in cursor.execute.call_args_list:
        assert "(l.live_title ILIKE %s OR CAST(l.id AS text) = %s)" in str(call_args.args[0])
    assert cursor.execute.call_args_list[0].args[1] == (f"%{query}%", query)
    assert cursor.execute.call_args_list[1].args[1] == (f"%{query}%", query, 20, 0)


# 测试点：控制台活动组列表返回全部可编辑组，不依赖公共演出分页。
def test_get_console_performance_groups_returns_all_editable_groups():
    _authenticate_editor()
    conn, cursor = _connection_mock()
    cursor.fetchall.return_value = [(2, "Group B"), (1, "Group A")]

    with patch("app.routers.console_performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/console/performance-groups")

    assert response.status_code == 200
    assert response.json()["items"] == [
        {"group_id": 2, "group_title": "Group B"},
        {"group_id": 1, "group_title": "Group A"},
    ]
    assert "ORDER BY group_title ASC, id ASC" in str(cursor.execute.call_args.args[0])


# 测试点：console GET 应返回活动组编辑数据，lives 按日期、开演时间、ID 排序。
def test_get_console_performance_group_returns_200_with_sorted_lives():
    _authenticate_editor()
    conn, cursor = _connection_mock()
    cursor.fetchone.return_value = ("Test Group",)
    cursor.fetchall.return_value = [
        (101, date(2026, 6, 1), "Early Show", "15:00:00+09", "Venue A", [1]),
        (102, date(2026, 6, 1), "Late Show", "19:00:00+09", "Venue A", [1]),
        (103, date(2026, 6, 2), "Next Day", "15:00:00+09", "Venue B", [2]),
    ]

    with patch("app.routers.console_performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/console/performance-groups/1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["group_id"] == 1
    assert payload["group_title"] == "Test Group"
    live_ids = [live["live_id"] for live in payload["lives"]]
    assert live_ids == [101, 102, 103]


# 测试点：console GET 对不存在的活动组应返回 404。
def test_get_console_performance_group_returns_404_for_nonexistent_group():
    _authenticate_editor()
    conn, cursor = _connection_mock()
    cursor.fetchone.return_value = None

    with patch("app.routers.console_performance_groups.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/console/performance-groups/999")

    assert response.status_code == 404
    assert "999" in response.json()["detail"]


# 测试点：创建活动组应写入数据库并返回 201 及新建 group 摘要。
def test_create_performance_group_returns_201_and_writes_to_db():
    _authenticate_editor()
    conn, cursor = _connection_mock()
    cursor.fetchall.side_effect = [
        [(41,), (42,)],               # _not_found_ids → both exist
        [],                           # conflict check → no conflicts
        [(41,), (42,)],               # _validate_performance_group_relations returns ordered live_ids
    ]
    cursor.fetchone.return_value = (7,)  # INSERT RETURNING id

    with patch("app.routers.console_performance_groups.get_write_db_connection", return_value=conn):
        response = TestClient(app).post(
            "/api/console/performance-groups",
            json=_upsert_payload(),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 201
    assert response.json() == {
        "ok": True,
        "item": {"group_id": 7, "group_title": "Test Group", "live_count": 2},
    }
    executed_sql = [str(call.args[0]) for call in cursor.execute.call_args_list]
    assert any("INSERT INTO performance_group_attrs" in sql for sql in executed_sql)
    assert any("INSERT INTO performance_group_lives" in sql for sql in executed_sql)
    assert any("INSERT INTO audit_logs" in sql for sql in executed_sql)


# 测试点：少于两场与重复 Live ID 均在请求验证阶段拒绝，不进入写库流程。
@pytest.mark.parametrize("live_ids", [pytest.param([41], id="too-few"), pytest.param([41, 41], id="duplicate")])
def test_create_performance_group_rejects_invalid_live_ids(live_ids):
    _authenticate_editor()
    with patch("app.routers.console_performance_groups.get_write_db_connection") as get_connection:
        response = TestClient(app).post(
            "/api/console/performance-groups",
            json=_upsert_payload(live_ids=live_ids),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )
    assert response.status_code == 422
    get_connection.assert_not_called()


# 测试点：Live 已属于其他活动组时应返回 409 并包含冲突信息。
def test_create_performance_group_handles_live_already_in_another_group():
    _authenticate_editor()
    conn, cursor = _connection_mock()
    cursor.fetchall.side_effect = [
        [(41,), (42,)],               # _not_found_ids → both exist
        [(41, 3, "Existing Group")],  # conflict check → conflict found
    ]

    with patch("app.routers.console_performance_groups.get_write_db_connection", return_value=conn):
        response = TestClient(app).post(
            "/api/console/performance-groups",
            json=_upsert_payload(),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "PERFORMANCE_GROUP_LIVE_CONFLICT"
    assert detail["conflicts"][0]["live_id"] == 41


# 测试点：更新活动组应对已有 group 替换全部 lives 并返回 200。
def test_update_performance_group_returns_200_with_updated_data():
    _authenticate_editor()
    conn, cursor = _connection_mock()
    cursor.fetchone.side_effect = [
        ("Old Title",),  # existing check
        (2,),            # COUNT previous lives
    ]
    cursor.fetchall.side_effect = [
        [(41,), (42,), (43,)],         # _not_found_ids → all exist
        [],                            # conflict check → no conflicts
        [(41,), (42,), (43,)],         # _validate_performance_group_relations returns ordered live_ids
    ]

    with patch("app.routers.console_performance_groups.get_write_db_connection", return_value=conn):
        response = TestClient(app).put(
            "/api/console/performance-groups/10",
            json=_upsert_payload(group_title="Updated Group", live_ids=[41, 42, 43]),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "item": {"group_id": 10, "group_title": "Updated Group", "live_count": 3},
    }


# 测试点：更新不存在的活动组应返回 404。
def test_update_performance_group_returns_404_for_nonexistent_group():
    _authenticate_editor()
    conn, cursor = _connection_mock()
    cursor.fetchone.return_value = None  # existing check

    with patch("app.routers.console_performance_groups.get_write_db_connection", return_value=conn):
        response = TestClient(app).put(
            "/api/console/performance-groups/999",
            json=_upsert_payload(),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 404


# 测试点：更新时若新 live 已属于其他组且非当前组，应返回 409 冲突。
def test_update_performance_group_handles_live_conflict():
    _authenticate_editor()
    conn, cursor = _connection_mock()
    cursor.fetchone.side_effect = [
        ("Some Title",),  # existing check
        (2,),             # COUNT previous lives
    ]
    cursor.fetchall.side_effect = [
        [(41,), (42,)],               # _not_found_ids → both exist
        [(42, 5, "Other Group")],     # conflict check → conflict found
    ]

    with patch("app.routers.console_performance_groups.get_write_db_connection", return_value=conn):
        response = TestClient(app).put(
            "/api/console/performance-groups/1",
            json=_upsert_payload(),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 409
    assert "PERFORMANCE_GROUP_LIVE_CONFLICT" in response.json()["detail"]["code"]


# 测试点：创建/更新路由各自拒绝缺少 CSRF 的 editor 和携带有效 CSRF 的 viewer，且不访问写库。
@pytest.mark.parametrize(
    ("method", "path"),
    [pytest.param("POST", "/api/console/performance-groups", id="create"),
     pytest.param("PUT", "/api/console/performance-groups/1", id="update")],
)
@pytest.mark.parametrize("role", [pytest.param("editor", id="missing-csrf"), pytest.param("viewer", id="insufficient-role")])
def test_performance_group_writes_require_editor_and_csrf(method, path, role):
    if role == "editor":
        _authenticate_editor()
        headers = {}
    else:
        _authenticate_viewer()
        headers = {"X-CSRF-Token": CSRF_TOKEN}
    with patch("app.routers.console_performance_groups.get_write_db_connection") as get_connection:
        response = TestClient(app).request(method, path, json=_upsert_payload(), headers=headers)
    assert response.status_code == 403
    get_connection.assert_not_called()
