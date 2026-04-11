import pytest


pytestmark = pytest.mark.integration
TEST_DEFAULT_ADMIN_USERNAME = "admin"
TEST_DEFAULT_ADMIN_PASSWORD = "test-admin-pass"


def _login_and_get_csrf(integration_test_client) -> str:
    response = integration_test_client.post(
        "/api/auth/login",
        json={"username": TEST_DEFAULT_ADMIN_USERNAME, "password": TEST_DEFAULT_ADMIN_PASSWORD},
    )
    assert response.status_code == 200
    return response.json()["csrf_token"]


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
