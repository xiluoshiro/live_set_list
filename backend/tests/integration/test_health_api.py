import pytest


pytestmark = pytest.mark.integration


def test_db_healthcheck_success_against_test_database(integration_test_client):
    # 测试点：真实测试库可连通时，健康检查应返回 {"ok": true, "result": 1}。
    response = integration_test_client.get("/api/health/db")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "result": 1}
