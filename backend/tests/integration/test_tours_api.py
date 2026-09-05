import os

import psycopg2
import pytest
from psycopg2.errors import UniqueViolation


pytestmark = pytest.mark.integration
TEST_DEFAULT_ADMIN_USERNAME = os.getenv("AUTH_DEFAULT_ADMIN_USERNAME", "admin").strip().lower()
TEST_DEFAULT_ADMIN_PASSWORD = os.getenv("AUTH_DEFAULT_ADMIN_PASSWORD", "test-admin-pass")


def _login_and_get_csrf_for(integration_test_client, *, username: str, password: str) -> str:
    response = integration_test_client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return str(response.json()["csrf_token"])


def _get_user_id(conn, username: str) -> int:
    conn.autocommit = True
    with conn.cursor() as cursor:
        cursor.execute("SELECT id FROM app_users WHERE username = %s", (username,))
        row = cursor.fetchone()
    assert row is not None
    return int(row[0])


def _get_latest_audit_row(conn, *, user_id: int):
    conn.autocommit = True
    with conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT action, resource_id, payload_json
            FROM audit_logs
            WHERE user_id = %s
            ORDER BY id DESC
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone()
    assert row is not None
    return row


# 测试点：只读运行时角色可以读取 V13 新表，保证匿名巡演接口具备最小权限。
def test_readonly_role_can_select_tour_tables(integration_db_config):
    with psycopg2.connect(
        host=integration_db_config["host"],
        port=int(integration_db_config["port"]),
        dbname=integration_db_config["dbname"],
        user=integration_db_config["user"],
        password=integration_db_config["password"],
        connect_timeout=5,
    ) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM tour_attrs")
            assert cursor.fetchone() == (1,)


# 测试点：巡演列表按 seed 关系聚合日期、乐队和已收录场次数，并支持年份与乐队筛选。
def test_tours_list_returns_seeded_summary_and_filters(integration_test_client):
    response = integration_test_client.get(
        "/api/catalog/tours",
        params={"year": 2026, "band_id": 1, "q": "Spring", "page_size": 20},
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "tour_id": 1,
                "tour_title": "BanG Dream! Spring Tour 2026",
                "url": "https://example.com/lives/1",
                "description": None,
                "bands": [
                    {"band_id": 1, "band_name": "Poppin'Party", "band_abbr": "ppp"},
                    {"band_id": 2, "band_name": "Roselia", "band_abbr": "rsl"},
                ],
                "start_date": "2026-03-28",
                "end_date": "2026-04-05",
                    "collected_live_count": 2,
                    "cancelled_live_count": 0,
                    "stop_labels": ["Tokyo Opening", "Tokyo Finale"],
            }
        ],
        "pagination": {"page": 1, "page_size": 20, "total": 1, "total_pages": 1},
    }


# 测试点：巡演详情按日期和 Live ID 返回场次，并从真实 Live 数据计算乐队和 setlist 状态。
def test_tour_detail_returns_seeded_stops(integration_test_client):
    response = integration_test_client.get("/api/catalog/tours/1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["collected_live_count"] == 2
    assert [stop["live_id"] for stop in payload["stops"]] == [1, 2]
    assert [stop["stop_label"] for stop in payload["stops"]] == ["Tokyo Opening", "Tokyo Finale"]
    assert payload["stops"][0]["bands"] == [1, 2]
    assert payload["stops"][1]["bands"] == [1, 3]
    assert all(stop["has_setlist"] is True for stop in payload["stops"])
    assert all(stop["is_favorite"] is False for stop in payload["stops"])


# 测试点：显式指定乐队的巡演统计只纳入指定乐队歌曲，不混入其他参演乐队的 Setlist。
def test_tour_statistics_returns_seeded_setlist_changes(integration_test_client):
    response = integration_test_client.get("/api/catalog/tours/1/statistics")

    assert response.status_code == 200
    payload = response.json()
    assert payload["coverage"] == {
        "stop_count": 2,
        "setlist_stop_count": 2,
        "comparable_transition_count": 1,
    }
    assert payload["overview"] == {"distinct_song_count": 3, "common_song_count": 0}
    assert [song["song_id"] for song in payload["songs"]] == [1, 2, 4]
    transition = payload["transitions"][0]
    assert transition["replacements"] == []
    assert [song["song_id"] for song in transition["removed_songs"]] == [1, 2]
    assert [song["song_id"] for song in transition["added_songs"]] == [4]


# 测试点：未显式设置参与乐队时，巡演展示、筛选和统计都应继续使用全部场次的有效乐队。
def test_tour_without_explicit_bands_aggregates_stop_bands(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute("DELETE FROM tour_bands WHERE tour_id = 1")

    detail = integration_test_client.get("/api/catalog/tours/1")
    filtered = integration_test_client.get("/api/catalog/tours", params={"band_id": 3, "page_size": 20})
    statistics = integration_test_client.get("/api/catalog/tours/1/statistics")

    assert detail.status_code == 200
    assert [band["band_id"] for band in detail.json()["bands"]] == [1, 2, 3]
    assert filtered.status_code == 200
    assert [tour["tour_id"] for tour in filtered.json()["items"]] == [1]
    assert statistics.status_code == 200
    assert statistics.json()["overview"] == {"distinct_song_count": 4, "common_song_count": 0}
    assert [song["song_id"] for song in statistics.json()["songs"]] == [1, 2, 3, 4]


# 测试点：所有现有 Live 公共读取路径都返回一致的巡演反向引用。
def test_live_read_paths_return_consistent_tour_reference(integration_test_client):
    expected = {"tour_id": 1, "tour_title": "BanG Dream! Spring Tour 2026"}

    lives = integration_test_client.get("/api/lives").json()["items"]
    assert next(item for item in lives if item["live_id"] == 1)["tour"] == expected
    assert next(item for item in lives if item["live_id"] == 41)["tour"] is None

    detail = integration_test_client.get("/api/lives/1").json()
    assert detail["tour"] == expected

    batch = integration_test_client.post("/api/lives/details:batch", json={"live_ids": [1, 2]}).json()
    assert all(item["tour"] == expected for item in batch["items"])

    search = integration_test_client.get("/api/catalog/search", params={"q": "Unit"}).json()
    assert search["lives"][0]["tour"] == expected

    band_lives = integration_test_client.get("/api/catalog/bands/1/lives").json()["items"]
    assert next(item for item in band_lives if item["live_id"] == 1)["tour"] == expected


# 测试点：数据库唯一约束阻止同一 Live 同时归属多个巡演。
def test_tour_lives_rejects_multiple_tours_for_one_live(integration_admin_connection):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO tour_attrs (tour_title) VALUES ('Conflicting Tour') RETURNING id"
        )
        conflicting_tour_id = int(cursor.fetchone()[0])
        with pytest.raises(UniqueViolation):
            cursor.execute(
                "INSERT INTO tour_lives (tour_id, live_id, stop_order) VALUES (%s, 1, 1)",
                (conflicting_tour_id,),
            )


# 测试点：editor 创建巡演时，主记录、乐队、场次和汇总审计应在同一事务中完整落库。
def test_editor_can_create_console_tour_with_audit(
    integration_test_client,
    integration_admin_connection,
):
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )
    response = integration_test_client.post(
        "/api/console/tours",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "tour_title": "Console Integration Tour",
            "band_ids": [3],
            "stops": [{"live_id": 41, "stop_label": "Final"}],
        },
    )

    assert response.status_code == 201
    tour_id = response.json()["item"]["tour_id"]
    detail = integration_test_client.get(f"/api/catalog/tours/{tour_id}").json()
    assert [band["band_id"] for band in detail["bands"]] == [3]
    assert [(stop["live_id"], stop["stop_label"]) for stop in detail["stops"]] == [(41, "Final")]
    user_id = _get_user_id(integration_admin_connection, TEST_DEFAULT_ADMIN_USERNAME)
    audit = _get_latest_audit_row(integration_admin_connection, user_id=user_id)
    assert audit[0] == "tour_create"
    assert audit[1] == str(tour_id)
    assert audit[2]["live_ids"] == [41]


# 测试点：更新巡演使用完整目标集合替换关系，并保留当前巡演已有 Live 的合法归属。
def test_editor_can_replace_console_tour_relations(
    integration_test_client,
    integration_admin_connection,
):
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )
    response = integration_test_client.put(
        "/api/console/tours/1",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "tour_title": "Updated Spring Tour",
            "band_ids": [1],
            "stops": [
                {"live_id": 41, "stop_label": "Preview"},
                {"live_id": 1, "stop_label": "Opening"},
            ],
        },
    )

    assert response.status_code == 200
    detail = integration_test_client.get("/api/catalog/tours/1").json()
    assert [band["band_id"] for band in detail["bands"]] == [1]
    assert [stop["live_id"] for stop in detail["stops"]] == [1, 41]
    assert detail["tour_title"] == "Updated Spring Tour"


# 测试点：匿名、viewer 和缺少 CSRF 的请求均不能写巡演，也不能留下部分数据。
def test_console_tour_write_requires_editor_and_csrf(
    integration_test_client,
    integration_admin_connection,
):
    payload = {
        "tour_title": "Unauthorized Tour",
        "band_ids": [1],
        "stops": [{"live_id": 41, "stop_label": None}],
    }
    anonymous = integration_test_client.post("/api/console/tours", json=payload)
    viewer_csrf = _login_and_get_csrf_for(
        integration_test_client,
        username="viewer_tester",
        password="viewer-test-pass",
    )
    viewer = integration_test_client.post(
        "/api/console/tours",
        headers={"X-CSRF-Token": viewer_csrf},
        json=payload,
    )
    _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )
    missing_csrf = integration_test_client.post("/api/console/tours", json=payload)

    assert anonymous.status_code == 401
    assert viewer.status_code == 403
    assert missing_csrf.status_code == 403
    with integration_admin_connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM tour_attrs WHERE tour_title = 'Unauthorized Tour'")
        assert cursor.fetchone() == (0,)


# 测试点：巡演列表按 未开始→进行中→已结束/已取消 分组排序，组内保持原有时间排序。
def test_tours_list_groups_by_status_then_time(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    live_ids = [9601, 9602, 9603, 9604]
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO live_attrs (
                id, live_date, live_title, url, opening_time, start_time,
                venue_id, venue_name_version_id, live_type, default_band_ids, event_status
            )
            VALUES
                (9601, CURRENT_DATE - 20, 'StatusTourProbe Ended Live', 'https://example.com/9601',
                 TIME WITH TIME ZONE '17:00:00+09', TIME WITH TIME ZONE '18:00:00+09',
                 1, (SELECT id FROM venue_name_versions WHERE venue_id = 1),
                 'oneman', ARRAY[1], 'scheduled'),
                (9602, CURRENT_DATE, 'StatusTourProbe Today Live', 'https://example.com/9602',
                 TIME WITH TIME ZONE '17:00:00+09', TIME WITH TIME ZONE '18:00:00+09',
                 1, (SELECT id FROM venue_name_versions WHERE venue_id = 1),
                 'oneman', ARRAY[1], 'scheduled'),
                (9603, CURRENT_DATE + 40, 'StatusTourProbe Far Future Live', 'https://example.com/9603',
                 TIME WITH TIME ZONE '17:00:00+09', TIME WITH TIME ZONE '18:00:00+09',
                 1, (SELECT id FROM venue_name_versions WHERE venue_id = 1),
                 'oneman', ARRAY[1], 'scheduled'),
                (9604, CURRENT_DATE + 70, 'StatusTourProbe Cancelled Live', 'https://example.com/9604',
                 TIME WITH TIME ZONE '17:00:00+09', TIME WITH TIME ZONE '18:00:00+09',
                 1, (SELECT id FROM venue_name_versions WHERE venue_id = 1),
                 'oneman', ARRAY[1], 'cancelled')
            """
        )
        cur.executemany(
            """
            INSERT INTO tour_attrs (tour_title) VALUES (%s)
            """,
            [("StatusTourProbe Ended Tour",), ("StatusTourProbe Today Tour",),
             ("StatusTourProbe Far Future Tour",), ("StatusTourProbe Cancelled Tour",)],
        )
        cur.execute(
            """
            SELECT id FROM tour_attrs
            WHERE tour_title LIKE 'StatusTourProbe%'
            ORDER BY id
            """
        )
        tour_ids = [int(row[0]) for row in cur.fetchall()]
        cur.executemany(
            "INSERT INTO tour_lives (tour_id, live_id, stop_order) VALUES (%s, %s, 1)",
            [(tour_ids[0], 9601), (tour_ids[1], 9602), (tour_ids[2], 9603), (tour_ids[3], 9604)],
        )

    def _ordered_ids(sort: str) -> list[int]:
        response = integration_test_client.get(
            "/api/catalog/tours",
            params={"page": 1, "page_size": 20, "q": "StatusTourProbe", "sort": sort},
        )
        assert response.status_code == 200, response.text
        assert response.json()["pagination"]["total"] == 4
        return [item["tour_id"] for item in response.json()["items"]]

    # date_desc：未开始组内按结束日期倒序（9603 远→9604 取消同组），进行中居中，已结束最后。
    assert _ordered_ids("date_desc") == [tour_ids[2], tour_ids[1], tour_ids[3], tour_ids[0]]
    # date_asc：组内按开始日期正序，已结束组（9601 最早→9604 取消最远）顺序随之翻转。
    assert _ordered_ids("date_asc") == [tour_ids[2], tour_ids[1], tour_ids[0], tour_ids[3]]

    with integration_admin_connection.cursor() as cur:
        cur.execute(
            "DELETE FROM tour_lives WHERE tour_id = ANY(%s) OR live_id = ANY(%s)",
            (tour_ids, live_ids),
        )
        cur.execute("DELETE FROM tour_attrs WHERE id = ANY(%s)", (tour_ids,))
        cur.execute("DELETE FROM live_attrs WHERE id = ANY(%s)", (live_ids,))
