import pytest
from urllib.parse import parse_qs, urlsplit

from app import map_providers


# 测试点：高德 GCJ-02 只在适配边界转换，往返后的数据库 WGS84 坐标保持米级精度。
def test_gcj02_round_trip_keeps_wgs84_precision():
    latitude, longitude = 31.2304, 121.4737
    gcj_latitude, gcj_longitude = map_providers.wgs84_to_gcj02(latitude, longitude)
    restored_latitude, restored_longitude = map_providers.gcj02_to_wgs84(gcj_latitude, gcj_longitude)

    assert (gcj_latitude, gcj_longitude) != (latitude, longitude)
    assert restored_latitude == pytest.approx(latitude, abs=0.00001)
    assert restored_longitude == pytest.approx(longitude, abs=0.00001)


# 测试点：供应商凭据未配置时返回可解释状态，不发网络请求也不阻塞手工关联。
def test_unconfigured_provider_returns_fallback_status(monkeypatch):
    monkeypatch.delenv("GOOGLE_MAPS_PLACES_API_KEY", raising=False)
    monkeypatch.setattr(map_providers, "_request_json", lambda *_args, **_kwargs: pytest.fail("unexpected network request"))

    result = map_providers.search_map_candidates("google", "Test Hall", 35.0, 139.0, "JP")

    assert result.status == "not_configured"
    assert result.candidates == []
    assert "手工关联" in (result.message or "")


# 测试点：Google 候选详情链接只持久化 Place ID 和本站查询词，不保存供应商返回的展示名称或链接。
def test_google_candidate_uses_place_id_url_without_provider_content(monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_PLACES_API_KEY", "test-key")
    monkeypatch.setattr(map_providers, "_request_json", lambda *_args, **_kwargs: {
        "places": [{"id": "google-id", "displayName": {"text": "Provider Display Name"},
                    "formattedAddress": "Provider Address", "location": {"latitude": 35, "longitude": 139}}],
    })

    result = map_providers.search_map_candidates("google", "Our Venue", 35, 139, "JP")

    assert len(result.candidates) == 1
    url = urlsplit(result.candidates[0].provider_url)
    assert parse_qs(url.query) == {"api": ["1"], "query": ["Our Venue"], "query_place_id": ["google-id"]}
    assert "Provider Display Name" not in result.candidates[0].provider_url


# 测试点：Apple 搜索结果绑定地点 ID 详情页，不能退化为同坐标的普通搜索链接。
def test_apple_candidate_uses_place_id_detail_url(monkeypatch):
    monkeypatch.setenv("APPLE_MAPS_SERVER_API_TOKEN", "test-token")
    monkeypatch.setattr(map_providers, "_request_json", lambda *_args, **_kwargs: {
        "results": [{"id": "apple-id", "name": "Test Hall", "formattedAddressLines": ["1 Main St"],
                     "coordinate": {"latitude": 35, "longitude": 139}}],
    })

    result = map_providers.search_map_candidates("apple", "Test Hall", 35, 139, "JP")

    assert len(result.candidates) == 1
    url = urlsplit(result.candidates[0].provider_url)
    assert url.path == "/place"
    assert parse_qs(url.query) == {"place-id": ["apple-id"]}


# 测试点：高德候选保留平台 ID 和详情链接，但候选位置先从 GCJ-02 转成 WGS84 再交给业务层。
def test_amap_candidate_is_normalized_to_wgs84(monkeypatch):
    monkeypatch.setenv("AMAP_WEB_SERVICE_API_KEY", "test-key")
    monkeypatch.setattr(map_providers, "_request_json", lambda *_args, **_kwargs: {
        "status": "1",
        "pois": [{
            "id": "B000A", "name": "上海测试场馆", "address": "测试路 1 号",
            "location": "121.478223,31.228458",
        }],
    })

    result = map_providers.search_map_candidates("amap", "上海测试场馆", 31.2304, 121.4737, "CN")

    assert result.status == "ready"
    assert len(result.candidates) == 1
    candidate = result.candidates[0]
    assert candidate.provider_place_id == "B000A"
    assert candidate.source_coordinate_system == "GCJ02"
    assert candidate.latitude != 31.228458
    assert candidate.longitude != 121.478223
    assert "poiid=B000A" in candidate.provider_url
