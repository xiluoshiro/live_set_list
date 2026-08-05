import pytest


pytestmark = pytest.mark.integration

# 测试点：GET /api/catalog/stats 应基于 seed SQL 返回准确的汇总数据和可筛选年份。
def test_catalog_stats_returns_seeded_counts(integration_test_client):
    """聚合统计应返回种子数据中的 band/song/venue 总数和最新 Live 日期。"""
    response = integration_test_client.get("/api/catalog/stats")

    assert response.status_code == 200
    body = response.json()
    assert body["live_count"] == 4
    assert body["band_count"] == 4
    assert body["song_count"] == 17
    assert body["venue_count"] == 3
    assert body["latest_live_date"] == "2026-05-30"
    assert body["years"] == [2026]


# 测试点：旧版概览响应体继续保持稳定，避免首页指标契约被新统计接口破坏。
def test_catalog_stats_response_structure(integration_test_client):
    """验证 stats 端点返回的 JSON 字段完整且类型正确。"""
    response = integration_test_client.get("/api/catalog/stats")

    assert response.status_code == 200
    body = response.json()

    assert isinstance(body, dict)
    assert set(body.keys()) == {"live_count", "band_count", "song_count", "venue_count", "latest_live_date", "years"}
    assert isinstance(body["live_count"], int)
    assert isinstance(body["band_count"], int)
    assert isinstance(body["song_count"], int)
    assert isinstance(body["venue_count"], int)
    assert isinstance(body["latest_live_date"], str)
    assert isinstance(body["years"], list)


# 测试点：乐队浏览右侧的无 Setlist 活动应返回全部 default_band_ids，供前端渲染 Band SVG。
def test_catalog_band_lives_uses_default_bands_for_event_without_setlist(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO live_attrs (
                id,
                live_date,
                live_title,
                url,
                opening_time,
                start_time,
                venue_id,
                live_type,
                default_band_ids
            )
            VALUES (
                901,
                DATE '2026-06-01',
                'Default Band Event',
                'https://example.com/lives/default-band-event',
                TIME WITH TIME ZONE '17:00:00+09',
                TIME WITH TIME ZONE '18:00:00+09',
                1,
                'event',
                ARRAY[1, 3]
            )
            """
        )

    response = integration_test_client.get("/api/catalog/bands/1/lives")

    assert response.status_code == 200
    item = next(item for item in response.json()["items"] if item["live_id"] == 901)
    assert item["bands"] == [1, 3]


# 测试点：未选乐队时每队只返回内部第一名，并按 band_id 升序稳定展示。
def test_catalog_statistics_returns_all_scope(integration_test_client):
    response = integration_test_client.get("/api/catalog/statistics")

    assert response.status_code == 200
    body = response.json()
    assert body["scope"] == "all"
    assert body["overview"]["live_count"] == 4
    assert body["overview"]["setlist_live_count"] == 3
    assert body["overview"]["band_count"] == 3
    assert body["years"] == [{"key": "2026", "label": "2026 年", "live_count": 4}]
    ranked_band_ids = [item["band_id"] for item in body["top_songs"]]
    assert ranked_band_ids == [1, 2, 3]
    assert body["top_songs"][0]["live_count"] >= 1
    assert body["stale_songs"] == []


# 测试点：乐队筛选按 setlist 实际演唱者返回该乐队 Top N，不混入其他乐队的演唱记录。
def test_catalog_statistics_filters_by_band(integration_test_client):
    response = integration_test_client.get("/api/catalog/statistics", params={"band_id": 1})

    assert response.status_code == 200
    body = response.json()
    assert body["filters"]["band_id"] == 1
    assert body["overview"]["live_count"] == 3
    top_song_ids = {item["song_id"] for item in body["top_songs"]}
    assert 1 in top_song_ids
    assert 2 not in top_song_ids
    assert 3 not in top_song_ids
    assert all(item["band_id"] == 1 and item["band_name"] == "Poppin'Party" for item in body["top_songs"])


# 测试点：全部、原创和翻唱久未演唱榜单各自独立截取 limit 首，并保留只演唱一次的歌曲。
def test_catalog_statistics_limits_stale_song_kinds_independently(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO song_list (id, song_name, band_id, is_cover)
            VALUES (%s, %s, 2, %s)
            """,
            [
                (
                    901 + index,
                    f"Stale {'cover' if index >= 6 else 'original'} song {index + 1}",
                    index >= 6,
                )
                for index in range(12)
            ],
        )
        cursor.execute(
            """
            INSERT INTO live_attrs (
                id,
                live_date,
                live_title,
                url,
                opening_time,
                start_time,
                venue_id,
                live_type,
                default_band_ids
            )
            VALUES (
                901,
                DATE '2020-01-01',
                'Roselia old live',
                'https://example.com/lives/roselia-old',
                TIME WITH TIME ZONE '17:00:00+09',
                TIME WITH TIME ZONE '18:00:00+09',
                1,
                'oneman',
                ARRAY[2]
            )
            """
        )
        cursor.executemany(
            """
            INSERT INTO live_setlist (
                live_id,
                song_id,
                absolute_order,
                segment_type,
                sub_order
            )
            VALUES (%s, %s, %s, 'main', %s)
            """,
            [(901, 901 + index, index + 1, index + 1) for index in range(12)],
        )
        cursor.execute(
            """
            INSERT INTO live_band_lineup_contexts (
                live_id, band_id, band_name_version_id, base_lineup_version_id
            )
            SELECT 901, 2, band_name_version_id, lineup_version_id
            FROM current_band_versions
            WHERE band_id = 2
            """
        )
        cursor.execute(
            """
            INSERT INTO live_setlist_band_performances (
                setlist_id, live_id, band_id, lineup_usage
            )
            SELECT id, live_id, 2, 'base'
            FROM live_setlist
            WHERE live_id = 901
            """
        )
        cursor.execute(
            """
            INSERT INTO live_setlist_band_performance_members (
                setlist_id, band_id, member_name, display_order
            )
            SELECT id, 2, 'Yukina', 1
            FROM live_setlist
            WHERE live_id = 901
            """
        )

    response = integration_test_client.get(
        "/api/catalog/statistics",
        params={"band_id": 2, "limit": 5},
    )

    assert response.status_code == 200
    body = response.json()
    original_songs = body["stale_songs_by_kind"]["original"]
    cover_songs = body["stale_songs_by_kind"]["cover"]
    assert len(body["stale_songs"]) == 5
    assert len(original_songs) == 5
    assert len(cover_songs) == 5
    assert {song["song_id"] for song in original_songs}.isdisjoint(
        song["song_id"] for song in cover_songs
    )

    item = next(song for song in original_songs if song["song_id"] == 901)
    assert item["is_cover"] is False
    assert item["live_count"] == 1
    assert item["latest_live_date"] == "2020-01-01"
    assert item["reference_live_date"] == "2026-03-28"
    assert item["missed_live_count"] == 1


# 测试点：收藏统计不会向匿名访问者泄露用户范围数据。
def test_catalog_statistics_requires_login_for_favorites(integration_test_client):
    response = integration_test_client.get("/api/catalog/statistics", params={"scope": "favorites"})

    assert response.status_code == 401


# 测试点：日历接口只返回指定自然月内的 Live，并按日期、开始时间、ID 稳定排序。
def test_catalog_calendar_returns_only_requested_month_and_orders(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO live_attrs (
                id, live_date, live_title, url, opening_time, start_time,
                venue_id, live_type, default_band_ids, event_status
            )
            VALUES (
                %s, DATE %s, %s, %s,
                TIME WITH TIME ZONE '16:00:00+09', TIME WITH TIME ZONE %s,
                1, 'other', %s, %s
            )
            """,
            [
                (
                    910,
                    "2026-08-29",
                    "August Late Show",
                    "https://example.com/calendar/910",
                    "19:30:00+09",
                    [1],
                    "scheduled",
                ),
                (
                    911,
                    "2026-08-29",
                    "August Early Show",
                    "https://example.com/calendar/911",
                    "15:00:00+09",
                    [2, 1],
                    "cancelled",
                ),
                (
                    912,
                    "2026-08-12",
                    "August Mid Show",
                    "https://example.com/calendar/912",
                    "18:00:00+09",
                    [3],
                    "postponed",
                ),
                (
                    913,
                    "2026-07-31",
                    "July Edge",
                    "https://example.com/calendar/913",
                    "18:00:00+09",
                    [1],
                    "scheduled",
                ),
                (
                    914,
                    "2026-09-01",
                    "September Edge",
                    "https://example.com/calendar/914",
                    "18:00:00+09",
                    [1],
                    "scheduled",
                ),
            ],
        )

    response = integration_test_client.get("/api/catalog/calendar", params={"month": "2026-08"})

    assert response.status_code == 200
    body = response.json()
    assert body["month"] == "2026-08"
    items = body["items"]
    assert [item["live_id"] for item in items] == [912, 911, 910]
    statuses = {item["live_id"]: item["event_status"] for item in items}
    assert statuses[910] == "scheduled"
    assert statuses[911] == "cancelled"
    assert statuses[912] == "postponed"
    assert items[1]["bands"] == [1, 2]
    assert items[1]["start_time"] == "15:00:00+09:00"
    assert items[2]["date_phase"] in {"past", "today", "upcoming"}
    assert all(item["live_date"].startswith("2026-08-") for item in items)


# 测试点：日历条目的 date_phase 按 Live 自身 UTC offset 计算，不依赖服务器时区。
def test_catalog_calendar_computes_date_phase_from_live_offset(
    integration_test_client,
    integration_admin_connection,
):
    # 固定时钟使 JST 当日确定在 2026-08-05，避免服务器本地日期与 JST 跨日时结果抖动。
    from datetime import datetime, timezone
    from unittest.mock import patch

    class _FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 8, 5, 4, 0, tzinfo=timezone.utc)

    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO live_attrs (
                id, live_date, live_title, url, opening_time, start_time,
                venue_id, live_type, default_band_ids, event_status
            )
            VALUES (
                %s, DATE %s, %s, %s,
                TIME WITH TIME ZONE '16:00:00+09', TIME WITH TIME ZONE %s,
                1, 'other', %s, 'scheduled'
            )
            """,
            [
                (915, "2026-08-04", "Offset Past", "https://example.com/c", "18:00:00+09", [1]),
                (916, "2026-08-05", "Offset Today", "https://example.com/c", "18:00:00+09", [1]),
                (917, "2026-08-06", "Offset Future", "https://example.com/c", "18:00:00+09", [1]),
            ],
        )

    with patch("app.live_status.datetime", _FixedDatetime):
        response = integration_test_client.get(
            "/api/catalog/calendar",
            params={"month": "2026-08"},
        )

    assert response.status_code == 200
    phases = {item["live_id"]: item["date_phase"] for item in response.json()["items"]}
    assert phases[915] == "past"
    assert phases[916] == "today"
    assert phases[917] == "upcoming"


# 测试点：月初与月末边界按左闭右开规则过滤，月末最后一天属于当月。
def test_catalog_calendar_month_boundaries(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO live_attrs (
                id, live_date, live_title, url, opening_time, start_time,
                venue_id, live_type, default_band_ids, event_status
            )
            VALUES (
                %s, DATE %s, %s, %s,
                TIME WITH TIME ZONE '16:00:00+09', TIME WITH TIME ZONE '18:00:00+09',
                1, 'other', %s, 'scheduled'
            )
            """,
            [
                (920, "2026-08-31", "Month End Show", "https://example.com/c", [1]),
                (921, "2026-09-01", "Next Month Show", "https://example.com/c", [1]),
            ],
        )

    august = integration_test_client.get("/api/catalog/calendar", params={"month": "2026-08"})
    september = integration_test_client.get("/api/catalog/calendar", params={"month": "2026-09"})

    august_ids = [item["live_id"] for item in august.json()["items"]]
    september_ids = [item["live_id"] for item in september.json()["items"]]
    assert 920 in august_ids
    assert 921 not in august_ids
    assert 921 in september_ids
    assert 920 not in september_ids


# 测试点：空月份返回空 items，而不是 404 或空态以外的错误。
def test_catalog_calendar_empty_month_returns_empty_items(integration_test_client):
    response = integration_test_client.get("/api/catalog/calendar", params={"month": "2027-01"})

    assert response.status_code == 200
    assert response.json() == {"month": "2027-01", "items": []}


# 测试点：非法月份格式返回 422，非法格式不进入数据库查询。
def test_catalog_calendar_invalid_month_returns_422(integration_test_client):
    for month in ("2026-13", "2026-00", "2026-8", "202608", "abc"):
        response = integration_test_client.get("/api/catalog/calendar", params={"month": month})
        assert response.status_code == 422
