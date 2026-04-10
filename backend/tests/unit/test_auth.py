from argparse import Namespace
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from app.auth import (
    AuthSessionContext,
    AuthUser,
    assert_valid_csrf,
    get_current_auth_context,
    hash_password,
    require_role,
)
from app.main import app


def _build_write_connection_mock(
    *,
    fetchone_side_effect: list[tuple | None] | None = None,
    fetchall_side_effect: list[list[tuple]] | None = None,
):
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.side_effect = fetchone_side_effect or []
    cursor.fetchall.side_effect = fetchall_side_effect or []
    return conn, cursor


def _make_request_with_headers(headers: dict[str, str] | None = None) -> Request:
    encoded_headers = []
    for key, value in (headers or {}).items():
        encoded_headers.append((key.lower().encode("utf-8"), value.encode("utf-8")))
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "path": "/api/auth/logout",
            "raw_path": b"/api/auth/logout",
            "query_string": b"",
            "headers": encoded_headers,
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
            "scheme": "http",
        }
    )


# 测试点：登录成功时会写入 session cookie，并返回当前用户与收藏初始化数据。
def test_login_success_returns_user_csrf_and_cookie():
    user_row = (1, "admin", "Administrator", "admin", True, hash_password("secret-pass"))
    conn, _ = _build_write_connection_mock(
        fetchone_side_effect=[user_row],
        fetchall_side_effect=[[(3,), (9,)]],
    )

    with patch("app.auth.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post(
            "/api/auth/login",
            json={"username": "Admin", "password": "secret-pass"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["user"] == {
        "id": 1,
        "username": "admin",
        "display_name": "Administrator",
        "role": "admin",
    }
    assert payload["favorite_live_ids"] == [3, 9]
    assert isinstance(payload["csrf_token"], str)
    assert payload["csrf_token"] != ""
    assert "live_set_list_session=" in response.headers["set-cookie"]


# 测试点：密码错误时应返回统一的 401 错误码，并记录失败审计。
def test_login_invalid_password_returns_401():
    user_row = (1, "admin", "Administrator", "admin", True, hash_password("real-pass"))
    conn, _ = _build_write_connection_mock(
        fetchone_side_effect=[user_row],
    )

    with patch("app.auth.get_write_db_connection", return_value=conn), patch(
        "app.auth.write_audit_log_entry"
    ) as audit_log:
        client = TestClient(app)
        response = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "wrong-pass"},
        )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "AUTH_INVALID_CREDENTIALS"
    audit_log.assert_called_once()


# 测试点：未登录请求 `/api/auth/me` 时应明确返回 authenticated=false。
def test_me_without_session_returns_unauthenticated():
    client = TestClient(app)
    response = client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.json() == {"authenticated": False}


# 测试点：已登录请求 `/api/auth/me` 时会重新签发 CSRF token，并返回收藏列表。
def test_me_with_session_returns_authenticated_payload():
    context = AuthSessionContext(
        session_id=8,
        user=AuthUser(id=1, username="admin", display_name="Administrator", role="admin", is_active=True),
        csrf_token_hash="old-hash",
        expires_at=None,  # type: ignore[arg-type]
    )
    conn, cursor = _build_write_connection_mock(
        fetchall_side_effect=[[(5,), (11,)]],
    )

    with patch("app.routers.auth.get_current_auth_context_optional", return_value=context), patch(
        "app.auth.get_write_db_connection", return_value=conn
    ):
        client = TestClient(app)
        response = client.get("/api/auth/me")

    assert response.status_code == 200
    payload = response.json()
    assert payload["authenticated"] is True
    assert payload["user"]["username"] == "admin"
    assert payload["favorite_live_ids"] == [5, 11]
    assert isinstance(payload["csrf_token"], str)
    assert payload["csrf_token"] != ""
    assert cursor.execute.call_count == 2


# 测试点：退出登录时必须调用 session 注销逻辑，并通过响应头清掉 cookie。
def test_logout_with_session_revokes_session_and_deletes_cookie():
    context = AuthSessionContext(
        session_id=9,
        user=AuthUser(id=1, username="admin", display_name="Administrator", role="admin", is_active=True),
        csrf_token_hash="hash",
        expires_at=None,  # type: ignore[arg-type]
    )

    with patch("app.routers.auth.get_current_auth_context_optional", return_value=context), patch(
        "app.routers.auth.logout_current_session"
    ) as logout_session:
        client = TestClient(app)
        response = client.post("/api/auth/logout", headers={"X-CSRF-Token": "csrf-token"})

    assert response.status_code == 204
    logout_session.assert_called_once()
    assert "live_set_list_session=" in response.headers["set-cookie"]


# 测试点：缺少有效 session 时，强制认证依赖应返回统一的 401 错误结构。
def test_get_current_auth_context_raises_401_when_session_missing():
    request = _make_request_with_headers()

    with pytest.raises(Exception) as exc_info:
        get_current_auth_context(request)

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["code"] == "AUTH_SESSION_EXPIRED"


# 测试点：CSRF 校验会拒绝缺失或错误的 token，只允许哈希匹配的请求通过。
def test_assert_valid_csrf_checks_missing_invalid_and_valid_token():
    valid_request = _make_request_with_headers({"X-CSRF-Token": "csrf-pass"})
    missing_request = _make_request_with_headers()
    invalid_request = _make_request_with_headers({"X-CSRF-Token": "wrong"})
    with patch("app.auth._hash_token", side_effect=lambda token: f"hash:{token}"):
        context = AuthSessionContext(
            session_id=1,
            user=AuthUser(id=1, username="admin", display_name="Administrator", role="admin", is_active=True),
            csrf_token_hash="hash:csrf-pass",
            expires_at=None,  # type: ignore[arg-type]
        )

        with pytest.raises(Exception) as missing_exc:
            assert_valid_csrf(missing_request, context)
        with pytest.raises(Exception) as invalid_exc:
            assert_valid_csrf(invalid_request, context)

        assert_valid_csrf(valid_request, context)

    assert missing_exc.value.status_code == 403
    assert missing_exc.value.detail["code"] == "AUTH_CSRF_INVALID"
    assert invalid_exc.value.status_code == 403
    assert invalid_exc.value.detail["code"] == "AUTH_CSRF_INVALID"


# 测试点：角色依赖按优先级拦截低权限账号，避免每个路由重复判断。
def test_require_role_rejects_lower_priority_user():
    role_dependency = require_role("editor")
    viewer = AuthUser(id=2, username="viewer", display_name="Viewer", role="viewer", is_active=True)
    admin = AuthUser(id=1, username="admin", display_name="Administrator", role="admin", is_active=True)

    with pytest.raises(Exception) as exc_info:
        role_dependency(viewer)

    assert role_dependency(admin) == admin
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail["code"] == "AUTH_FORBIDDEN"


# 测试点：管理员初始化脚本会规范用户名并以 upsert 方式写入账号。
def test_bootstrap_admin_main_upserts_user():
    import importlib.util
    import sys

    script_path = Path(__file__).resolve().parents[3] / "scripts" / "bootstrap_admin.py"
    spec = importlib.util.spec_from_file_location("bootstrap_admin_module_for_test", script_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = (7,)

    with patch.object(
        module,
        "parse_args",
        return_value=Namespace(
            username="Admin",
            password="secret-pass",
            display_name="Administrator",
            role="admin",
        ),
    ), patch.object(module, "get_write_db_connection", return_value=conn), patch(
        "builtins.print"
    ) as print_mock:
        exit_code = module.main()

    assert exit_code == 0
    sql_params = cursor.execute.call_args.args[1]
    assert sql_params[0] == "admin"
    assert sql_params[2] == "Administrator"
    assert sql_params[3] == "admin"
    print_mock.assert_called_once_with("Bootstrap admin/user success: id=7 username=admin role=admin")
