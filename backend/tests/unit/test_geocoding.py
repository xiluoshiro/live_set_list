import json
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from email.message import Message

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import geocoding
from app.schemas.geocoding import ResolveInput, SearchInput
from app.timezone_lookup import lookup_timezone


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("VENUE_GEOCODING_CACHE_PATH", str(tmp_path / "geocoding.sqlite3"))
    monkeypatch.setenv("VENUE_GEOCODING_URL", "https://nominatim.openstreetmap.org")


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


# 测试点：非法数字、经纬颠倒越界、非 WGS84 与额外字段无法进入解析接口。
def test_query_validation():
    for values in ({"latitude": 139, "longitude": 35}, {"latitude": float("nan"), "longitude": 3},
                   {"latitude": 35, "longitude": float("inf")}, {"latitude": 35, "longitude": 139, "coordinate_system": "GCJ02"}):
        with pytest.raises(ValidationError):
            ResolveInput.model_validate({"parts": "timezone", "request_id": "draft", **values})
    with pytest.raises(ValidationError):
        SearchInput(query="x" * 201)


def provider_response(items):
    response = MagicMock()
    response.__enter__.return_value.read.return_value = json.dumps(items).encode()
    return response


# 测试点：合法查询缓存复用、非法候选被过滤，搜索不会默选或写业务数据。
def test_search_cache_and_malformed_results():
    items = [{"lat": "35", "lon": "139", "display_name": "東京都", "name": "Hall", "address": {"country_code": "jp", "state": "東京都"}},
             {"lat": "nan", "lon": "139", "display_name": "invalid"}]
    with patch("app.geocoding.urlopen", return_value=provider_response(items)) as network:
        first = geocoding.geocode(query="Hall")
        second = geocoding.geocode(query="Hall")
    assert first == second
    assert network.call_count == 1
    assert len(first["items"]) == 1
    assert first["items"][0]["country_code"] == "JP"
    assert first["items"][0]["locality_name"] is None


# 测试点：独立连接并发共享同一查询额度，而非每个线程／worker 各自放行。
def test_shared_rate_gate():
    def reserve(index):
        try:
            geocoding._reserve("service", str(index))
            return 200
        except HTTPException as exc:
            return exc.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(reserve, range(2)))
    assert sorted(results) == [200, 429]


# 测试点：上游限流延续至共享节流器，后续请求不继续冲击上游。
def test_upstream_rate_limit():
    headers = Message(); headers["Retry-After"] = "30"
    with patch("app.geocoding.urlopen", side_effect=HTTPError("url", 429, "limit", headers, None)):
        with pytest.raises(HTTPException) as caught:
            geocoding.geocode(query="Hall")
    assert caught.value.status_code == 429
    with pytest.raises(HTTPException):
        geocoding._reserve(geocoding.service_url(), "different query")


# 测试点：过大或无效响应与无结果分开，服务失败仍允许手工填写。
@pytest.mark.parametrize("body", [b"x" * (geocoding.MAX_BYTES + 1), b"not json", b"42"], ids=["oversized", "invalid-json", "scalar"])
def test_bad_response_is_unavailable(body):
    response = MagicMock(); response.__enter__.return_value.read.return_value = body
    with patch("app.geocoding.urlopen", return_value=response):
        assert geocoding.geocode(query="Hall")["status"] == "unavailable"


# 测试点：逆地理无结果和国家级地址均可返回，不伪造门牌或城市。
def test_reverse_empty_and_country_shape():
    with patch("app.geocoding._query", return_value={}):
        assert geocoding.geocode(latitude=0, longitude=0)["status"] == "not_found"
    with patch("app.geocoding._query", return_value={"lat": 22.3, "lon": 114.1, "display_name": "香港", "address": {"country_code": "hk"}}):
        result = geocoding.geocode(latitude=22.3, longitude=114.1)
    assert result["items"][0]["locality_name"] is None


# 测试点：非两位国家代码不会被截断成另一个有效国家并参与地区匹配。
def test_country_code_is_not_truncated():
    with patch("app.geocoding._query", return_value={"lat": 35, "lon": 139, "display_name": "Hall", "address": {"country_code": "jpn"}}):
        result = geocoding.geocode(latitude=35, longitude=139)
    assert result["items"][0]["country_code"] is None
