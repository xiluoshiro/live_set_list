import pytest


pytestmark = pytest.mark.integration

# 测试点：GET /api/catalog/stats 应基于 seed SQL 返回准确的汇总数据和可筛选年份。
def test_catalog_stats_returns_seeded_counts(integration_test_client):
    """聚合统计应返回种子数据中的 band/song/venue 总数和最新 Live 日期。"""
    response = integration_test_client.get("/api/catalog/stats")

    assert response.status_code == 200
    body = response.json()
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
    assert set(body.keys()) == {"band_count", "song_count", "venue_count", "latest_live_date", "years"}
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
