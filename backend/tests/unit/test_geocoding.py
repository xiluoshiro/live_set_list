import json
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from app import geocoding
from app.schemas.geocoding import ResolveInput, SearchInput
from app.timezone_lookup import lookup_timezone


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_CACHE_PATH", str(tmp_path / "google-maps.sqlite3"))
    monkeypatch.setenv("GOOGLE_MAPS_SERVER_API_KEY", "server-key")


# 测试点：真实离线边界覆盖多地区、日期变更线与海洋，无网络或固定偏移兜底。
@pytest.mark.parametrize("lat,lng,zone", [
    (35.681, 139.767, "Asia/Tokyo"), (31.23, 121.47, "Asia/Shanghai"),
    (25.03, 121.56, "Asia/Taipei"), (40.71, -74.00, "America/New_York"),
    (-33.86, 151.21, "Australia/Sydney"), (-13.83, -171.75, "Pacific/Apia"), (0, -150, None),
])
def test_offline_zone_samples(lat, lng, zone):
    result = lookup_timezone(lat, lng)
    assert result["timezone_id"] == zone
    assert result["status"] == ("ready" if zone else "not_found")


# 测试点：库失败与未知 IANA 均返回可手工补录状态，不伪造解析成功。
def test_timezone_failure_is_not_default_offset():
    with patch("app.timezone_lookup._finder", side_effect=OSError("missing data")):
        assert lookup_timezone(35, 139)["status"] == "unavailable"
    with patch("app.timezone_lookup._finder") as finder:
        finder.return_value.timezone_at_land.return_value = "Missing/Zone"
        assert lookup_timezone(35, 139)["timezone_id"] is None


# 测试点：非法坐标、坐标系、语言代码与额外字段无法进入解析接口。
def test_query_validation():
    for values in ({"latitude": 139, "longitude": 35}, {"latitude": float("nan"), "longitude": 3},
                   {"latitude": 35, "longitude": float("inf")}, {"latitude": 35, "longitude": 139, "coordinate_system": "GCJ02"}):
        with pytest.raises(ValidationError):
            ResolveInput.model_validate({"parts": "timezone", "request_id": "draft", **values})
    with pytest.raises(ValidationError):
        SearchInput(query="x" * 201)
    with pytest.raises(ValidationError):
        SearchInput(query="Hall", language_code="zh-Hans")


def provider_response(items):
    response = MagicMock()
    response.__enter__.return_value.read.return_value = json.dumps(items).encode()
    return response


# 测试点：Google Text Search 携带地区和日语偏好，只保留完整地点并复用本地缓存。
def test_search_cache_and_malformed_results():
    payload = {"places": [
        {"id": "place-1", "displayName": {"text": "Hall"}, "formattedAddress": "東京都 1-1",
         "location": {"latitude": 35, "longitude": 139}, "googleMapsUri": "https://maps.google.com/?cid=1",
         "addressComponents": [{"longText": "日本", "shortText": "JP", "types": ["country"]},
                               {"longText": "東京都", "shortText": "東京都", "types": ["administrative_area_level_1"]}]},
        {"id": "bad", "displayName": {"text": "Bad"}, "formattedAddress": "Bad",
         "location": {"latitude": "nan", "longitude": 139}},
    ]}
    with patch("app.geocoding.urlopen", return_value=provider_response(payload)) as network:
        first = geocoding.geocode(query="Hall", country_code="JP", language_code="ja")
        second = geocoding.geocode(query="Hall", country_code="JP", language_code="ja")
    assert first == second
    assert network.call_count == 1
    # 测试点：国家提示使用 Text Search 支持的 regionCode 字段，避免 Google 因未知字段返回 400。
    request_body = json.loads(network.call_args.args[0].data)
    assert request_body["regionCode"] == "jp"
    assert request_body["languageCode"] == "ja"
    assert "includedRegionCodes" not in request_body
    assert len(first["items"]) == 1
    assert first["items"][0]["country_code"] == "JP"
    assert first["items"][0]["provider_place_id"] == "place-1"
    assert first["items"][0]["provider_url"] == "https://maps.google.com/?cid=1"


# 测试点：过大、无效或标量响应返回 unavailable，仍允许管理员手工填写。
@pytest.mark.parametrize("body", [b"x" * (geocoding.MAX_BYTES + 1), b"not json", b"42"],
                         ids=["oversized", "invalid-json", "scalar"])
def test_bad_response_is_unavailable(body):
    response = MagicMock()
    response.__enter__.return_value.read.return_value = body
    with patch("app.geocoding.urlopen", return_value=response):
        assert geocoding.geocode(query="Hall")["status"] == "unavailable"


# 测试点：逆地理携带目标语言，只返回地址与行政区且不伪装成 Google Place 关联。
def test_reverse_address_has_no_place_link():
    payload = {"results": [{
        "formatted_address": "日本、東京都",
        "geometry": {"location": {"lat": 35, "lng": 139}},
        "address_components": [{"long_name": "日本", "short_name": "JP", "types": ["country"]}],
    }]}
    with patch("app.geocoding._request_json", return_value=payload) as request:
        result = geocoding.geocode(latitude=35, longitude=139, language_code="ja")
    assert "language=ja" in request.call_args.args[0]
    assert result["items"][0]["country_code"] == "JP"
    assert result["items"][0]["provider_place_id"] is None
    assert result["items"][0]["provider_url"] is None


# 测试点：POI 详情携带目标语言和地区，并返回保存所需的完整 Google Place 数据。
def test_place_details_returns_complete_google_place():
    payload = {
        "id": "place-1", "displayName": {"text": "Test Hall"}, "formattedAddress": "1 Main St",
        "location": {"latitude": 35, "longitude": 139}, "googleMapsUri": "https://maps.google.com/?cid=1",
    }
    with patch("app.geocoding._request_json", return_value=payload) as request:
        result = geocoding.place_details("place-1", language_code="zh-HK", country_code="HK")
    assert "languageCode=zh-HK" in request.call_args.args[0]
    assert "regionCode=HK" in request.call_args.args[0]
    assert result["status"] == "ready"
    assert result["items"][0]["name"] == "Test Hall"
    assert result["items"][0]["provider_place_id"] == "place-1"
