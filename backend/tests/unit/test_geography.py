from datetime import date, time, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from pydantic import ValidationError

from app.geography import coordinate_url, place_url, resolve_local_time, validate_timezone
from app.schemas.geography import LocationWrite, MapLinkWrite


# 测试点：夏令时空缺钟点拒绝保存，重复钟点必须显式选择且得到不同 UTC 偏移。
def test_local_clock_rejects_gap_and_requires_fold():
    with pytest.raises(ValueError, match="不存在"):
        resolve_local_time(date(2024, 3, 10), time(2, 30), "America/New_York")
    with pytest.raises(ValueError, match="重复"):
        resolve_local_time(date(2024, 11, 3), time(1, 30), "America/New_York")
    first = resolve_local_time(date(2024, 11, 3), time(1, 30), "America/New_York", 0)
    second = resolve_local_time(date(2024, 11, 3), time(1, 30), "America/New_York", 1)
    assert first.utcoffset() == timedelta(hours=-4)
    assert second.utcoffset() == timedelta(hours=-5)


# 测试点：普通日期依据指定 IANA 规则计算，非法时区和偏移字符串不作为时区名称接受。
def test_normal_clock_and_timezone_validation():
    value = resolve_local_time(date(2024, 1, 1), time(18), "Asia/Tokyo")
    assert value.utcoffset() == timedelta(hours=9)
    for invalid in ("+09:00", "../../UTC", "Not/AZone"):
        with pytest.raises(ValueError):
            validate_timezone(invalid)


# 测试点：坐标成对、范围、点位口径和源坐标系均被校验，零坐标不会被当作空值。
def test_location_schema_validates_coordinate_contract():
    point = LocationWrite(expected_revision=1, latitude=0, longitude=0, coordinate_basis="building")
    assert point.latitude == 0 and point.longitude == 0
    for fields in ({"latitude": 10}, {"latitude": 91, "longitude": 0},
                   {"latitude": float("nan"), "longitude": 0}, {"coordinate_system": "GCJ02"},
                   {"latitude": 0, "longitude": 0}, {"coordinate_basis": "center"},
                   {"timezone_id": "Asia/Tokyo"}, {"address": 123}, {"timezone_id": 123}):
        with pytest.raises(ValidationError):
            LocationWrite.model_validate({"expected_revision": 1, **fields})


# 测试点：地图网址仅允许对应平台 HTTPS 地址，拒绝伪装域名、凭据和脚本协议。
@pytest.mark.parametrize("url", ["javascript:alert(1)", "https://maps.apple.com.evil.test/place",
                                  "https://user@maps.apple.com/place", "https://www.google.com/maps",
                                  "http://maps.apple.com/place", "https://maps.apple.com:123/place"])
def test_map_link_rejects_unsafe_or_wrong_provider_url(url):
    with pytest.raises(ValidationError):
        MapLinkWrite(expected_revision=1, provider="apple", provider_url=url)


# 测试点：各平台坐标顺序与编码正确，高德链接明确声明 WGS84，POI 与坐标链接独立。
def test_provider_links_keep_coordinate_and_place_identity_separate():
    google = parse_qs(urlsplit(coordinate_url("google", 35.1, 139.2, "A & B")).query)
    amap = parse_qs(urlsplit(coordinate_url("amap", 35.1, 139.2, "A & B")).query)
    apple = parse_qs(urlsplit(coordinate_url("apple", 0, 0, "A & B")).query)
    assert google["query"] == ["35.100000,139.200000"]
    assert amap["position"] == ["139.200000,35.100000"] and amap["coordinate"] == ["wgs84"]
    assert amap["name"] == ["A & B"]
    assert apple["ll"] == ["0.000000,0.000000"]
    assert parse_qs(urlsplit(place_url("google", "POI & ID", "Venue")).query)["query_place_id"] == ["POI & ID"]


# 测试点：关联写入拒绝客户端提供的候选资料，避免供应商内容进入永久审计。
def test_map_link_rejects_candidate_snapshot():
    with pytest.raises(ValidationError):
        MapLinkWrite(
            expected_revision=1, provider="google", provider_place_id="candidate",
            provider_url="https://www.google.com/maps/place/candidate",
            candidate={"name": "Candidate Hall"},
        )
