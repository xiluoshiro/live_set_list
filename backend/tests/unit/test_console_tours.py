import hashlib
from datetime import UTC, datetime, timedelta
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
        "url": " ",
        "description": "Summary",
        "band_ids": [2, 1],
        "stops": [
            {"live_id": 41, "stop_order": 1, "stop_label": " Opening "},
        ],
    }
    payload.update(overrides)
    return payload


# 测试点：创建巡演应规范化文本、按请求顺序写入关系，并生成一条汇总审计日志。
def test_create_console_tour_persists_complete_collection_and_audit():
    _authenticate_editor()
    conn, cursor = _connection_mock()
    cursor.fetchall.side_effect = [[(1,), (2,)], [(41,)], []]
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


# 测试点：请求中的重复 Band、Live 或场次顺序应在写库前由 schema 拒绝。
@pytest.mark.parametrize(
    "overrides",
    [
        {"band_ids": [1, 1]},
        {"stops": [{"live_id": 41, "stop_order": 1}, {"live_id": 41, "stop_order": 2}]},
        {"stops": [{"live_id": 41, "stop_order": 1}, {"live_id": 42, "stop_order": 1}]},
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
