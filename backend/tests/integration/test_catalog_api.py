import pytest


pytestmark = pytest.mark.integration

# 测试点：GET /api/catalog/stats 应基于 seed SQL 返回准确的汇总数据。
def test_catalog_stats_returns_seeded_counts(integration_test_client):
    """聚合统计应返回种子数据中的 band/song/venue 总数和最新 Live 日期。"""
    response = integration_test_client.get("/api/catalog/stats")

    assert response.status_code == 200
    body = response.json()
    assert body["band_count"] == 4
    assert body["song_count"] == 17
    assert body["venue_count"] == 3
    assert body["latest_live_date"] == "2026-05-30"


def test_catalog_stats_response_structure(integration_test_client):
    """验证 stats 端点返回的 JSON 字段完整且类型正确。"""
    # 测试点：响应体应包含 band_count/song_count/venue_count/latest_live_date 四个字段，且类型符合预期。
    response = integration_test_client.get("/api/catalog/stats")

    assert response.status_code == 200
    body = response.json()

    assert isinstance(body, dict)
    assert set(body.keys()) == {"band_count", "song_count", "venue_count", "latest_live_date"}
    assert isinstance(body["band_count"], int)
    assert isinstance(body["song_count"], int)
    assert isinstance(body["venue_count"], int)
    assert isinstance(body["latest_live_date"], str)
