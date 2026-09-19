from datetime import UTC, date, datetime
import pytest
from app.live_status import build_public_live_status, derive_date_phase, visitor_timezone, visitor_live_date

# 测试点：同一瞬间与同一演出按访问者时区判断日期，不采用场馆的当前日期。
def test_visitor_timezone_controls_today():
    now = datetime(2026, 7, 22, 15, 30, tzinfo=UTC)
    for zone, expected in [("Asia/Tokyo", "today"), ("Asia/Shanghai", "upcoming")]:
        token = visitor_timezone.set(zone)
        try:
            assert derive_date_phase(date(2026, 7, 23), "19:00:00+09:00", now) == expected
        finally:
            visitor_timezone.reset(token)

# 测试点：开演优先、开场兜底；跨月演出归入访问者实际日期，未知时间保留公布日期。
def test_visitor_calendar_dates():
    token = visitor_timezone.set("America/Los_Angeles")
    try:
        assert visitor_live_date("2026-09-01", "00:30:00+09:00") == date(2026, 8, 31)
        assert visitor_live_date("2026-09-01", None, "00:30:00+09:00") == date(2026, 8, 31)
        assert visitor_live_date("2026-09-01") == date(2026, 9, 1)
    finally:
        visitor_timezone.reset(token)

# 测试点：无时间无需独立偏移字段，状态仍按访问者当天正确计算。
def test_unannounced_times_need_no_timezone():
    assert derive_date_phase("2026-09-01", now_utc=datetime(2026, 9, 1, tzinfo=UTC)) == "today"

# 测试点：手工取消状态及正式改期标记独立于访问者日期，未知状态拒绝。
def test_manual_status():
    result = build_public_live_status(event_status="cancelled",live_date="2026-09-01",was_rescheduled=True,
                                     now_utc=datetime(2026,9,1,tzinfo=UTC))
    assert result == {"event_status":"cancelled","date_phase":"today","was_rescheduled":True}
    with pytest.raises(ValueError):
        build_public_live_status(event_status="bad",live_date="2026-09-01",was_rescheduled=False)
