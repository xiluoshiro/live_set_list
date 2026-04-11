import pytest
import psycopg2
from psycopg2 import errors

from app.auth import hash_password, normalize_username

pytestmark = pytest.mark.integration
TEST_DEFAULT_ADMIN_USERNAME = "admin"
TEST_DEFAULT_ADMIN_PASSWORD = "test-admin-pass"


def _login_and_get_csrf_for(
    integration_test_client,
    *,
    username: str,
    password: str,
) -> str:
    response = integration_test_client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return response.json()["csrf_token"]


def _login_and_get_csrf(integration_test_client) -> str:
    return _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )


def _logout(integration_test_client, csrf_token: str) -> None:
    response = integration_test_client.post(
        "/api/auth/logout",
        headers={"X-CSRF-Token": csrf_token},
    )
    assert response.status_code == 204


def _create_user(
    integration_admin_connection,
    *,
    username: str,
    password: str,
    display_name: str,
    role: str = "viewer",
) -> int:
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO app_users (username, password_hash, display_name, role)
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            (
                normalize_username(username),
                hash_password(password),
                display_name,
                role,
            ),
        )
        row = cursor.fetchone()

    assert row is not None
    return int(row[0])


def _get_audit_action_rows(
    integration_admin_connection,
    *,
    user_id: int,
) -> list[tuple[str, str | None]]:
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT action, resource_id
            FROM audit_logs
            WHERE user_id = %s
            ORDER BY id
            """,
            (user_id,),
        )
        rows = cursor.fetchall()

    return [(str(row[0]), str(row[1]) if row[1] is not None else None) for row in rows]


def _assert_insufficient_privilege(
    conn: psycopg2.extensions.connection,
    cur: psycopg2.extensions.cursor,
    sql: str,
    params: tuple[object, ...] | None = None,
) -> None:
    with pytest.raises(errors.InsufficientPrivilege):
        cur.execute(sql, params)
    conn.rollback()


# 测试点：匿名请求 lives 列表和详情时，is_favorite 应统一返回 false。
def test_lives_endpoints_return_is_favorite_false_for_anonymous_user(
    integration_test_client,
):
    list_response = integration_test_client.get("/api/lives", params={"page": 1, "page_size": 20})
    detail_response = integration_test_client.get("/api/lives/1")

    assert list_response.status_code == 200
    list_payload = list_response.json()
    assert [item["is_favorite"] for item in list_payload["items"]] == [False, False]

    assert detail_response.status_code == 200
    assert detail_response.json()["is_favorite"] is False


# 测试点：登录后收藏 live，应能通过收藏列表、全量列表和详情接口共同观察到收藏状态。
def test_favorite_live_adds_server_side_state_and_marks_lives_responses(
    integration_test_client,
):
    csrf_token = _login_and_get_csrf(integration_test_client)

    favorite_response = integration_test_client.put(
        "/api/me/favorites/lives/1",
        headers={"X-CSRF-Token": csrf_token},
    )
    favorite_list_response = integration_test_client.get(
        "/api/me/favorites/lives",
        params={"page": 1, "page_size": 20},
    )
    lives_response = integration_test_client.get("/api/lives", params={"page": 1, "page_size": 20})
    detail_response = integration_test_client.get("/api/lives/1")
    me_response = integration_test_client.get("/api/auth/me")

    assert favorite_response.status_code == 204

    assert favorite_list_response.status_code == 200
    favorite_list_payload = favorite_list_response.json()
    assert favorite_list_payload["pagination"] == {
        "page": 1,
        "page_size": 20,
        "total": 1,
        "total_pages": 1,
    }
    assert favorite_list_payload["items"] == [
        {
            "live_id": 1,
            "live_date": "2026-03-28",
            "live_title": "BanG Dream! Unit Live",
            "bands": [1, 2],
            "url": "https://example.com/lives/1",
            "is_favorite": True,
        }
    ]

    assert lives_response.status_code == 200
    lives_by_id = {item["live_id"]: item for item in lives_response.json()["items"]}
    assert lives_by_id[1]["is_favorite"] is True
    assert lives_by_id[2]["is_favorite"] is False

    assert detail_response.status_code == 200
    assert detail_response.json()["is_favorite"] is True

    assert me_response.status_code == 200
    assert me_response.json()["favorite_live_ids"] == [1]


# 测试点：收藏与取消收藏都应保持幂等，重复调用不应报错。
def test_favorite_live_put_and_delete_are_idempotent(
    integration_test_client,
):
    csrf_token = _login_and_get_csrf(integration_test_client)

    first_put = integration_test_client.put(
        "/api/me/favorites/lives/2",
        headers={"X-CSRF-Token": csrf_token},
    )
    second_put = integration_test_client.put(
        "/api/me/favorites/lives/2",
        headers={"X-CSRF-Token": csrf_token},
    )
    first_delete = integration_test_client.delete(
        "/api/me/favorites/lives/2",
        headers={"X-CSRF-Token": csrf_token},
    )
    second_delete = integration_test_client.delete(
        "/api/me/favorites/lives/2",
        headers={"X-CSRF-Token": csrf_token},
    )
    favorite_list_response = integration_test_client.get(
        "/api/me/favorites/lives",
        params={"page": 1, "page_size": 20},
    )

    assert first_put.status_code == 204
    assert second_put.status_code == 204
    assert first_delete.status_code == 204
    assert second_delete.status_code == 204
    assert favorite_list_response.status_code == 200
    assert favorite_list_response.json()["items"] == []


# 测试点：新登录且从未收藏的用户，请求收藏列表时应返回空 items 和统一分页结构。
def test_get_my_favorite_lives_returns_empty_items_for_new_user(
    integration_test_client,
    integration_admin_connection,
):
    _create_user(
        integration_admin_connection,
        username="viewer_empty",
        password="test-viewer-pass",
        display_name="Viewer Empty",
    )
    _login_and_get_csrf_for(
        integration_test_client,
        username="viewer_empty",
        password="test-viewer-pass",
    )

    response = integration_test_client.get(
        "/api/me/favorites/lives",
        params={"page": 1, "page_size": 20},
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "pagination": {
            "page": 1,
            "page_size": 20,
            "total": 0,
            "total_pages": 1,
        },
    }


# 测试点：收藏列表也应沿用 lives 列表的 page_size 校验规则，只接受 15 或 20。
def test_get_my_favorite_lives_rejects_invalid_page_size(
    integration_test_client,
):
    _login_and_get_csrf(integration_test_client)

    response = integration_test_client.get(
        "/api/me/favorites/lives",
        params={"page": 1, "page_size": 10},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "page_size must be 15 or 20"


# 测试点：收藏接口应要求登录，写操作还必须校验 CSRF Token。
def test_favorite_endpoints_require_auth_and_csrf(
    integration_test_client,
):
    anonymous_get = integration_test_client.get("/api/me/favorites/lives", params={"page": 1, "page_size": 20})

    _login_and_get_csrf(integration_test_client)
    missing_csrf_put = integration_test_client.put("/api/me/favorites/lives/1")
    missing_csrf_delete = integration_test_client.delete("/api/me/favorites/lives/1")

    assert anonymous_get.status_code == 401
    assert anonymous_get.json()["detail"]["code"] == "AUTH_SESSION_EXPIRED"
    assert missing_csrf_put.status_code == 403
    assert missing_csrf_put.json()["detail"]["code"] == "AUTH_CSRF_INVALID"
    assert missing_csrf_delete.status_code == 403
    assert missing_csrf_delete.json()["detail"]["code"] == "AUTH_CSRF_INVALID"


# 测试点：收藏不存在的 live_id 时，应返回 404 而不是静默成功。
def test_favorite_endpoints_return_404_for_missing_live(
    integration_test_client,
):
    csrf_token = _login_and_get_csrf(integration_test_client)

    put_response = integration_test_client.put(
        "/api/me/favorites/lives/999",
        headers={"X-CSRF-Token": csrf_token},
    )
    delete_response = integration_test_client.delete(
        "/api/me/favorites/lives/999",
        headers={"X-CSRF-Token": csrf_token},
    )

    assert put_response.status_code == 404
    assert put_response.json()["detail"] == "Live id 999 not found"
    assert delete_response.status_code == 404
    assert delete_response.json()["detail"] == "Live id 999 not found"


# 测试点：取消收藏后，收藏列表、lives 列表、详情和 `/api/auth/me` 都应同步回落为未收藏状态。
def test_unfavorite_live_clears_server_side_state_and_marks_lives_responses(
    integration_test_client,
):
    csrf_token = _login_and_get_csrf(integration_test_client)

    favorite_response = integration_test_client.put(
        "/api/me/favorites/lives/1",
        headers={"X-CSRF-Token": csrf_token},
    )
    unfavorite_response = integration_test_client.delete(
        "/api/me/favorites/lives/1",
        headers={"X-CSRF-Token": csrf_token},
    )
    favorite_list_response = integration_test_client.get(
        "/api/me/favorites/lives",
        params={"page": 1, "page_size": 20},
    )
    lives_response = integration_test_client.get("/api/lives", params={"page": 1, "page_size": 20})
    detail_response = integration_test_client.get("/api/lives/1")
    me_response = integration_test_client.get("/api/auth/me")

    assert favorite_response.status_code == 204
    assert unfavorite_response.status_code == 204

    assert favorite_list_response.status_code == 200
    assert favorite_list_response.json() == {
        "items": [],
        "pagination": {
            "page": 1,
            "page_size": 20,
            "total": 0,
            "total_pages": 1,
        },
    }

    assert lives_response.status_code == 200
    lives_by_id = {item["live_id"]: item for item in lives_response.json()["items"]}
    assert lives_by_id[1]["is_favorite"] is False
    assert lives_by_id[2]["is_favorite"] is False

    assert detail_response.status_code == 200
    assert detail_response.json()["is_favorite"] is False

    assert me_response.status_code == 200
    assert me_response.json()["favorite_live_ids"] == []


# 测试点：CSRF token 一旦被 `/api/auth/me` 刷新，旧 token 与错误 token 都不应再放行收藏写操作。
def test_favorite_endpoints_reject_invalid_or_stale_csrf_token(
    integration_test_client,
):
    login_csrf_token = _login_and_get_csrf(integration_test_client)
    me_response = integration_test_client.get("/api/auth/me")
    refreshed_csrf_token = me_response.json()["csrf_token"]

    stale_put_response = integration_test_client.put(
        "/api/me/favorites/lives/1",
        headers={"X-CSRF-Token": login_csrf_token},
    )
    invalid_delete_response = integration_test_client.delete(
        "/api/me/favorites/lives/1",
        headers={"X-CSRF-Token": "invalid-csrf-token"},
    )
    valid_put_response = integration_test_client.put(
        "/api/me/favorites/lives/1",
        headers={"X-CSRF-Token": refreshed_csrf_token},
    )

    assert me_response.status_code == 200
    assert refreshed_csrf_token != login_csrf_token

    assert stale_put_response.status_code == 403
    assert stale_put_response.json()["detail"]["code"] == "AUTH_CSRF_INVALID"
    assert invalid_delete_response.status_code == 403
    assert invalid_delete_response.json()["detail"]["code"] == "AUTH_CSRF_INVALID"
    assert valid_put_response.status_code == 204


# 测试点：不同登录用户的收藏状态必须完全隔离，不能互相污染 `is_favorite` 与收藏列表。
def test_favorites_are_isolated_between_users(
    integration_test_client,
    integration_admin_connection,
):
    _create_user(
        integration_admin_connection,
        username="viewer_a",
        password="test-viewer-a-pass",
        display_name="Viewer A",
    )
    _create_user(
        integration_admin_connection,
        username="viewer_b",
        password="test-viewer-b-pass",
        display_name="Viewer B",
    )

    csrf_token_a = _login_and_get_csrf_for(
        integration_test_client,
        username="viewer_a",
        password="test-viewer-a-pass",
    )
    favorite_response_a = integration_test_client.put(
        "/api/me/favorites/lives/1",
        headers={"X-CSRF-Token": csrf_token_a},
    )
    _logout(integration_test_client, csrf_token_a)

    login_response_b = integration_test_client.post(
        "/api/auth/login",
        json={"username": "viewer_b", "password": "test-viewer-b-pass"},
    )
    csrf_token_b = login_response_b.json()["csrf_token"]
    favorites_response_b = integration_test_client.get(
        "/api/me/favorites/lives",
        params={"page": 1, "page_size": 20},
    )
    lives_response_b = integration_test_client.get("/api/lives", params={"page": 1, "page_size": 20})
    detail_response_b = integration_test_client.get("/api/lives/1")
    _logout(integration_test_client, csrf_token_b)

    csrf_token_a_again = _login_and_get_csrf_for(
        integration_test_client,
        username="viewer_a",
        password="test-viewer-a-pass",
    )
    favorites_response_a = integration_test_client.get(
        "/api/me/favorites/lives",
        params={"page": 1, "page_size": 20},
    )
    lives_response_a = integration_test_client.get("/api/lives", params={"page": 1, "page_size": 20})
    detail_response_a = integration_test_client.get("/api/lives/1")

    assert favorite_response_a.status_code == 204

    assert login_response_b.status_code == 200
    assert favorites_response_b.status_code == 200
    assert favorites_response_b.json()["items"] == []
    assert lives_response_b.status_code == 200
    lives_by_id_b = {item["live_id"]: item for item in lives_response_b.json()["items"]}
    assert lives_by_id_b[1]["is_favorite"] is False
    assert detail_response_b.status_code == 200
    assert detail_response_b.json()["is_favorite"] is False

    assert csrf_token_a_again != ""
    assert favorites_response_a.status_code == 200
    assert [item["live_id"] for item in favorites_response_a.json()["items"]] == [1]
    assert lives_response_a.status_code == 200
    lives_by_id_a = {item["live_id"]: item for item in lives_response_a.json()["items"]}
    assert lives_by_id_a[1]["is_favorite"] is True
    assert lives_by_id_a[2]["is_favorite"] is False
    assert detail_response_a.status_code == 200
    assert detail_response_a.json()["is_favorite"] is True


# 测试点：幂等收藏与取消收藏只应在状态真正变化时写入审计日志，不能重复记账。
def test_favorite_write_endpoints_only_log_state_changes(
    integration_test_client,
    integration_admin_connection,
):
    csrf_token = _login_and_get_csrf(integration_test_client)

    first_put = integration_test_client.put(
        "/api/me/favorites/lives/2",
        headers={"X-CSRF-Token": csrf_token},
    )
    second_put = integration_test_client.put(
        "/api/me/favorites/lives/2",
        headers={"X-CSRF-Token": csrf_token},
    )
    first_delete = integration_test_client.delete(
        "/api/me/favorites/lives/2",
        headers={"X-CSRF-Token": csrf_token},
    )
    second_delete = integration_test_client.delete(
        "/api/me/favorites/lives/2",
        headers={"X-CSRF-Token": csrf_token},
    )
    audit_rows = _get_audit_action_rows(integration_admin_connection, user_id=1)

    assert first_put.status_code == 204
    assert second_put.status_code == 204
    assert first_delete.status_code == 204
    assert second_delete.status_code == 204
    assert audit_rows == [
        ("login_success", "1"),
        ("favorite_add", "2"),
        ("favorite_remove", "2"),
    ]


# 测试点：`live_project_user_rw` 只应拥有收藏链路所需的最小权限，既能写收藏，也不能越权写认证或主业务表。
def test_live_project_user_rw_permission_contract(
    integration_test_client,
    integration_admin_connection,
    integration_db_config,
):
    user_id = _create_user(
        integration_admin_connection,
        username="viewer_perm",
        password="test-viewer-perm-pass",
        display_name="Viewer Perm",
    )
    _login_and_get_csrf_for(
        integration_test_client,
        username="viewer_perm",
        password="test-viewer-perm-pass",
    )

    with psycopg2.connect(
        host=integration_db_config["host"],
        port=int(integration_db_config["port"]),
        dbname=integration_db_config["dbname"],
        user=integration_db_config["user_rw_user"],
        password=integration_db_config["user_rw_password"],
        connect_timeout=5,
    ) as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM public.live_attrs")
            count_row = cur.fetchone()
            assert count_row is not None
            assert int(count_row[0]) >= 2

            cur.execute(
                """
                INSERT INTO public.user_live_favorites (user_id, live_id, source)
                VALUES (%s, %s, 'manual')
                RETURNING id
                """,
                (user_id, 1),
            )
            favorite_row = cur.fetchone()
            assert favorite_row is not None
            assert int(favorite_row[0]) >= 1

            cur.execute(
                """
                SELECT live_id
                FROM public.user_live_favorites
                WHERE user_id = %s
                """,
                (user_id,),
            )
            assert cur.fetchall() == [(1,)]

            cur.execute(
                """
                DELETE FROM public.user_live_favorites
                WHERE user_id = %s AND live_id = %s
                """,
                (user_id, 1),
            )
            assert cur.rowcount == 1

            cur.execute(
                """
                INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id)
                VALUES (%s, 'favorite_add', 'favorite', '1')
                """,
                (user_id,),
            )
            assert cur.rowcount == 1

    audit_rows = _get_audit_action_rows(integration_admin_connection, user_id=user_id)
    assert audit_rows == [("login_success", str(user_id)), ("favorite_add", "1")]

    with psycopg2.connect(
        host=integration_db_config["host"],
        port=int(integration_db_config["port"]),
        dbname=integration_db_config["dbname"],
        user=integration_db_config["user_rw_user"],
        password=integration_db_config["user_rw_password"],
        connect_timeout=5,
    ) as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            _assert_insufficient_privilege(
                conn,
                cur,
                """
                INSERT INTO public.app_users (username, password_hash, display_name, role)
                VALUES ('forbidden_user', 'hash', 'Forbidden User', 'viewer')
                """,
            )

            _assert_insufficient_privilege(
                conn,
                cur,
                """
                UPDATE public.live_attrs
                SET live_title = live_title
                WHERE id = 1
                """,
            )

            _assert_insufficient_privilege(
                conn,
                cur,
                """
                INSERT INTO public.auth_sessions (
                    user_id,
                    session_token_hash,
                    csrf_token_hash,
                    expires_at
                )
                VALUES (%s, 'session-hash', 'csrf-hash', now())
                """,
                (user_id,),
            )
