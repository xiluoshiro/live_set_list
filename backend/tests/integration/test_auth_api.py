import pytest

from app.auth import hash_password


pytestmark = pytest.mark.integration


def _insert_user(
    integration_admin_connection,
    *,
    username: str = "admin",
    password: str = "secret-pass",
    display_name: str = "Administrator",
    role: str = "admin",
    is_active: bool = True,
) -> int:
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO public.app_users (
                username,
                password_hash,
                display_name,
                role,
                is_active
            )
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
            """,
            (username, hash_password(password), display_name, role, is_active),
        )
        row = cursor.fetchone()
    return int(row[0])


# 测试点：真实测试库中登录成功后，应返回用户信息、csrf_token，并写入会话 cookie。
def test_auth_login_success_against_test_database(
    integration_test_client,
    integration_admin_connection,
):
    _insert_user(integration_admin_connection, username="admin", password="secret-pass")

    response = integration_test_client.post(
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
    assert payload["favorite_live_ids"] == []
    assert isinstance(payload["csrf_token"], str)
    assert payload["csrf_token"] != ""
    assert "live_set_list_session=" in response.headers["set-cookie"]


# 测试点：真实测试库中密码错误时，应返回统一的 401 错误码。
def test_auth_login_invalid_password_returns_401(
    integration_test_client,
    integration_admin_connection,
):
    _insert_user(integration_admin_connection, username="admin", password="secret-pass")

    response = integration_test_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "wrong-pass"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "AUTH_INVALID_CREDENTIALS"


# 测试点：真实测试库中登录后请求 `/api/auth/me`，应恢复登录态并返回新的 csrf_token。
def test_auth_me_returns_authenticated_user_after_login(
    integration_test_client,
    integration_admin_connection,
):
    _insert_user(integration_admin_connection, username="admin", password="secret-pass")

    login_response = integration_test_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "secret-pass"},
    )
    first_csrf = login_response.json()["csrf_token"]

    response = integration_test_client.get("/api/auth/me")

    assert response.status_code == 200
    payload = response.json()
    assert payload["authenticated"] is True
    assert payload["user"]["username"] == "admin"
    assert payload["favorite_live_ids"] == []
    assert isinstance(payload["csrf_token"], str)
    assert payload["csrf_token"] != ""
    assert payload["csrf_token"] != first_csrf


# 测试点：真实测试库中退出登录后，当前 session 应失效，后续 `/api/auth/me` 返回未登录。
def test_auth_logout_revokes_session_against_test_database(
    integration_test_client,
    integration_admin_connection,
):
    _insert_user(integration_admin_connection, username="admin", password="secret-pass")

    login_response = integration_test_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "secret-pass"},
    )
    csrf_token = login_response.json()["csrf_token"]

    logout_response = integration_test_client.post(
        "/api/auth/logout",
        headers={"X-CSRF-Token": csrf_token},
    )
    me_response = integration_test_client.get("/api/auth/me")

    assert logout_response.status_code == 204
    assert "live_set_list_session=\"\"" in logout_response.headers["set-cookie"]
    assert me_response.status_code == 200
    assert me_response.json() == {"authenticated": False}


# 测试点：真实测试库中退出登录若缺少 CSRF token，应返回 403 而不是直接放行。
def test_auth_logout_requires_csrf_token(
    integration_test_client,
    integration_admin_connection,
):
    _insert_user(integration_admin_connection, username="admin", password="secret-pass")

    integration_test_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "secret-pass"},
    )
    response = integration_test_client.post("/api/auth/logout")

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "AUTH_CSRF_INVALID"
