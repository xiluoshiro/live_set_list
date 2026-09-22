import pytest

from app.song_catalog import classify_live_cover


# 测试点：仅按实际成员所属乐队交集判定，资料不完整时不强行认定翻唱。
@pytest.mark.parametrize("baseline,actual,complete,expected", [
    ({1, 2, 3}, {3, 4}, True, "original"),
    ({1}, {2}, True, "cover"),
    ({1}, set(), True, "unknown"),
    (set(), {1}, True, "unknown"),
    ({1}, {2}, False, "unknown"),
    ({1}, {1, 2}, False, "original"),
])
def test_cover_band_intersection(baseline, actual, complete, expected):
    assert classify_live_cover(baseline, actual, complete) == expected
