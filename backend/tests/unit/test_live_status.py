from datetime import UTC, date, datetime, time, timedelta, timezone

import pytest

from app.live_status import build_public_live_status, derive_date_phase


# 测试点：日期阶段必须按 Live 自身保存的 UTC offset 判断“当日”，不能使用服务器时区。
def test_derive_date_phase_uses_live_fixed_offset():
    now_utc = datetime(2026, 7, 22, 15, 30, tzinfo=UTC)

    assert derive_date_phase(date(2026, 7, 23), "19:00:00+09:00", now_utc) == "today"
    assert derive_date_phase(date(2026, 7, 23), "19:00:00+08:00", now_utc) == "upcoming"


# 测试点：日期阶段只比较 Live 当地日期，开演时间早晚不改变当日状态。
def test_derive_date_phase_ignores_time_within_local_day():
    now_utc = datetime(2026, 7, 23, 12, 0, tzinfo=UTC)

    assert derive_date_phase(
        date(2026, 7, 23),
        time(0, 1, tzinfo=timezone(timedelta(hours=8))),
        now_utc,
    ) == "today"
    assert derive_date_phase(date(2026, 7, 22), "23:59:59+08", now_utc) == "past"
    assert derive_date_phase(date(2026, 7, 24), "00:00:00+08:00", now_utc) == "upcoming"


# 测试点：开演时间未公布时必须由独立 UTC offset 继续准确派生当地日期阶段。
def test_derive_date_phase_uses_independent_offset_when_start_time_is_unannounced():
    now_utc = datetime(2026, 7, 22, 15, 30, tzinfo=UTC)

    assert derive_date_phase(
        date(2026, 7, 23),
        None,
        now_utc,
        timezone_offset_minutes=540,
    ) == "today"


# 测试点：公开状态应保留人工状态与正式改期标记，并拒绝数据库中的未知状态值。
def test_build_public_live_status_keeps_manual_status_and_validates_code():
    result = build_public_live_status(
        event_status="cancelled",
        live_date=date(2026, 7, 23),
        start_time="19:00:00+08:00",
        was_rescheduled=True,
        now_utc=datetime(2026, 7, 23, 1, 0, tzinfo=UTC),
    )

    assert result == {
        "event_status": "cancelled",
        "date_phase": "today",
        "was_rescheduled": True,
    }
    with pytest.raises(ValueError, match="unknown event_status"):
        build_public_live_status(
            event_status="aborted",
            live_date=date(2026, 7, 23),
            start_time="19:00:00+08:00",
            was_rescheduled=False,
        )
