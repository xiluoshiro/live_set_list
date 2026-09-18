import pytest

pytestmark = pytest.mark.integration


# 测试点：API 与纯 SQL 用例交替执行仍逐例清空用户/会话；仅 API 初始化用户，复用的哈希可真实登录。
@pytest.mark.parametrize("use_api", [True, False, True, False], ids=["api-first", "sql-after-api", "api-again", "sql-again"])
def test_fixture_data_is_reset_and_auth_setup_is_on_demand(
    request, integration_admin_connection, use_api,
):
    with integration_admin_connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM app_users")
        assert cursor.fetchone() == (0,)
        cursor.execute("SELECT COUNT(*) FROM auth_sessions")
        assert cursor.fetchone() == (0,)
    assert "integration_app_client" not in request.fixturenames
    assert "integration_user_rows" not in request.fixturenames
    if not use_api:
        return

    client = request.getfixturevalue("integration_test_client")
    user_rows = request.getfixturevalue("integration_user_rows")
    assert client.get("/api/auth/me").json() == {"authenticated": False}
    with integration_admin_connection.cursor() as cursor:
        cursor.execute("SELECT id, role FROM app_users WHERE id = 1")
        assert cursor.fetchone() == (1, "admin")
        cursor.execute(
            "SELECT username, password_hash, display_name, role FROM app_users WHERE username = ANY(%s) ORDER BY id",
            ([row[0] for row in user_rows],),
        )
        assert tuple(cursor.fetchall()) == user_rows
    login = client.post(
        "/api/auth/login", json={"username": "editor_tester", "password": "editor-test-pass"},
    )
    assert login.status_code == 200
    assert login.json()["user"]["role"] == "editor"
    assert client.cookies.get("live_set_list_session")
    with integration_admin_connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM auth_sessions")
        assert cursor.fetchone() == (1,)
        # 留下用户修改与登录会话，下一例必须由 seed 清除，而非依赖本例手工清理。
        cursor.execute("UPDATE app_users SET display_name = 'Changed', is_active = false WHERE username = 'editor_tester'")
