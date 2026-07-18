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


def _connection_mock():
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn, cursor


def _payload(**overrides):
    payload = {
        "tour_title": " Test Tour ",
        "band_ids": [2, 1],
        "stops": [
            {"live_id": 41, "stop_label": " Opening "},
        ],
    }
    payload.update(overrides)
    return payload


# 测试点：巡演场次候选必须在计数和分页查询中排除已存在于 tour_lives 的 Live。
def test_tour_live_candidates_filter_occupied_before_pagination():
    _authenticate_editor()
    conn, cursor = _connection_mock()
    cursor.fetchone.return_value = (1,)
    cursor.fetchall.return_value = [
        (41, date(2026, 5, 30), "Available Live", "Zepp", None, None, [1]),
    ]

    with patch("app.routers.console_tours.get_db_connection", return_value=conn):
        response = TestClient(app).get(
            "/api/console/tours/live-candidates?q=Available&page=1&page_size=20"
        )

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "live_id": 41,
                "live_date": "2026-05-30",
                "live_title": "Available Live",
                "venue": "Zepp",
                "tour_id": None,
                "tour_title": None,
                "band_ids": [1],
            }
        ],
        "total": 1,
        "page": 1,
        "page_size": 20,
        "total_pages": 1,
    }
    executed_sql = [str(call.args[0]) for call in cursor.execute.call_args_list]
    assert len(executed_sql) == 2
    assert all(
        "NOT EXISTS (SELECT 1 FROM tour_lives occupied" in sql
        for sql in executed_sql
    )
    assert "LEFT JOIN tour_lives" not in executed_sql[1]


# 测试点：创建巡演应规范化文本、按请求顺序写入关系，并生成一条汇总审计日志。
def test_create_console_tour_persists_complete_collection_and_audit():
    _authenticate_editor()
    conn, cursor = _connection_mock()
    cursor.fetchall.side_effect = [[(1,), (2,)], [(41,)], [], [(41, [1, 2])]]
    cursor.fetchone.return_value = (7,)

    with patch("app.routers.console_tours.get_write_db_connection", return_value=conn):
        response = TestClient(app).post(
            "/api/console/tours",
            json=_payload(),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 201
    assert response.json() == {
        "ok": True,
        "item": {"tour_id": 7, "tour_title": "Test Tour", "band_count": 2, "stop_count": 1},
    }
    executed_sql = [str(call.args[0]) for call in cursor.execute.call_args_list]
    assert any("INSERT INTO tour_bands" in sql for sql in executed_sql)
    assert any("INSERT INTO tour_lives" in sql for sql in executed_sql)
    assert any("INSERT INTO audit_logs" in sql for sql in executed_sql)


# 测试点：请求中的重复 Band 或 Live 应在写库前由 schema 拒绝。
@pytest.mark.parametrize(
    "overrides",
    [
        {"band_ids": [1, 1]},
        {"stops": [{"live_id": 41}, {"live_id": 41}]},
    ],
)
def test_console_tour_rejects_duplicate_relation_values(overrides):
    _authenticate_editor()
    response = TestClient(app).post(
        "/api/console/tours",
        json=_payload(**overrides),
        headers={"X-CSRF-Token": CSRF_TOKEN},
    )
    assert response.status_code == 422


# 测试点：Live 已属于其他巡演时应返回包含冲突归属的 409，且不创建巡演主记录。
def test_create_console_tour_returns_structured_live_conflict():
    _authenticate_editor()
    conn, cursor = _connection_mock()
    cursor.fetchall.side_effect = [[(1,), (2,)], [(41,)], [(41, 3, "Existing Tour")]]

    with patch("app.routers.console_tours.get_write_db_connection", return_value=conn):
        response = TestClient(app).post(
            "/api/console/tours",
            json=_payload(),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "TOUR_LIVE_CONFLICT",
        "message": "Live already belongs to another tour: 41",
        "conflicts": [{"live_id": 41, "tour_id": 3, "tour_title": "Existing Tour"}],
    }
    assert not any("INSERT INTO tour_attrs" in str(call.args[0]) for call in cursor.execute.call_args_list)


# 测试点：显式参与乐队必须真实出现在至少一场所选 Live 中，空乐队列表则允许自动聚合。
def test_create_console_tour_validates_explicit_band_presence_but_allows_empty():
    _authenticate_editor()
    invalid_conn, invalid_cursor = _connection_mock()
    invalid_cursor.fetchall.side_effect = [[(2,)], [(41,)], [], [(41, [1])]]
    with patch("app.routers.console_tours.get_write_db_connection", return_value=invalid_conn):
        invalid_response = TestClient(app).post(
            "/api/console/tours",
            json=_payload(band_ids=[2]),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    empty_conn, empty_cursor = _connection_mock()
    empty_cursor.fetchall.side_effect = [[], [(41,)], [], [(41, [1])]]
    empty_cursor.fetchone.return_value = (8,)
    with patch("app.routers.console_tours.get_write_db_connection", return_value=empty_conn):
        empty_response = TestClient(app).post(
            "/api/console/tours",
            json=_payload(band_ids=[]),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert invalid_response.status_code == 422
    assert "not present in any selected Live" in invalid_response.json()["detail"]
    assert empty_response.status_code == 201
    assert empty_response.json()["item"]["band_count"] == 0
