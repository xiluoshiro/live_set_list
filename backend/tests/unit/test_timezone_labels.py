import pytest

from app.live_timezone import timezone_abbreviation


# 测试点：IANA 缩写按保存的实际时刻计算，区分同偏移地区和夏令时切换前后。
@pytest.mark.parametrize(("day", "clock", "zone", "expected"), [
    ("2026-01-15", "19:00:00+09:00", "Asia/Tokyo", "JST"),
    ("2026-07-15", "19:00:00+09:00", "Asia/Seoul", "KST"),
    ("2026-01-15", "19:00:00-05:00", "America/New_York", "EST"),
    ("2026-07-15", "19:00:00-04:00", "America/New_York", "EDT"),
    ("2026-11-01", "00:30:00-04:00", "America/New_York", "EDT"),
    ("2026-11-01", "02:30:00-05:00", "America/New_York", "EST"),
    ("2026-07-15", "19:00:00+09:00", None, None),
    ("2026-07-15", None, "Asia/Tokyo", None),
])
def test_timezone_abbreviation(day, clock, zone, expected):
    assert timezone_abbreviation(day, clock, zone) == expected
