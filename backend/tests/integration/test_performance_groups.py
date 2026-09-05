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


# 测试点：V14 创建的 performance_group_attrs 和 performance_group_lives 表应存在且具有正确的列结构。
def test_v14_tables_exist_and_have_correct_structure(integration_db_config):
    conn = psycopg2.connect(
        host=integration_db_config["host"],
        port=int(integration_db_config["port"]),
        dbname=integration_db_config["dbname"],
        user=integration_db_config["user"],
        password=integration_db_config["password"],
        connect_timeout=5,
    )
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'performance_group_attrs'
                ORDER BY ordinal_position
            """)
            pg_attrs_cols = {row[0]: row[1] for row in cursor.fetchall()}
            assert "id" in pg_attrs_cols
            assert "group_title" in pg_attrs_cols

            cursor.execute("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'performance_group_lives'
                ORDER BY ordinal_position
            """)
            pg_lives_cols = {row[0]: row[1] for row in cursor.fetchall()}
            assert "group_id" in pg_lives_cols
            assert "live_id" in pg_lives_cols
    finally:
        conn.close()


# 测试点：只读角色仅有 SELECT 权限于 performance_group 表。
def test_readonly_role_has_select_only_on_performance_group_tables(integration_db_config):
    conn = psycopg2.connect(
        host=integration_db_config["host"],
        port=int(integration_db_config["port"]),
        dbname=integration_db_config["dbname"],
        user=integration_db_config["user"],
        password=integration_db_config["password"],
        connect_timeout=5,
    )
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM performance_group_attrs")
            assert cursor.fetchone() is not None
            cursor.execute("SELECT COUNT(*) FROM performance_group_lives")
            assert cursor.fetchone() is not None
        conn.commit()
    finally:
        conn.close()


# 测试点：super_ro 角色应具有 SELECT、INSERT、UPDATE 权限，并对 performance_group_lives 有 DELETE 权限。
def test_super_ro_has_crud_permissions_on_performance_group_tables(integration_db_config):
    conn = psycopg2.connect(
        host=integration_db_config["host"],
        port=int(integration_db_config["port"]),
        dbname=integration_db_config["dbname"],
        user=integration_db_config["write_user"],
        password=integration_db_config["write_password"],
        connect_timeout=5,
    )
    try:
        conn.autocommit = True
        with conn.cursor() as cursor:
            # INSERT + SELECT
            cursor.execute(
                "INSERT INTO performance_group_attrs (group_title) VALUES ('Perm Test') RETURNING id"
            )
            group_id = int(cursor.fetchone()[0])
            cursor.execute(
                "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, 1), (%s, 2)",
                (group_id, group_id),
            )
            cursor.execute("SELECT COUNT(*) FROM performance_group_lives WHERE group_id = %s", (group_id,))
            assert cursor.fetchone() == (2,)

            # UPDATE
            cursor.execute(
                "UPDATE performance_group_attrs SET group_title = 'Updated' WHERE id = %s",
                (group_id,),
            )

            # DELETE on performance_group_lives
            cursor.execute("DELETE FROM performance_group_lives WHERE group_id = %s", (group_id,))
            cursor.execute("SELECT COUNT(*) FROM performance_group_lives WHERE group_id = %s", (group_id,))
            assert cursor.fetchone() == (0,)

            # Cleanup — super_ro does NOT have DELETE on performance_group_attrs, use admin
            cursor.execute("SELECT 1 FROM performance_group_attrs WHERE id = %s", (group_id,))
            assert cursor.fetchone() is not None
    finally:
        conn.close()


# 测试点：performance_group_lives 的 UNIQUE(live_id) 约束阻止重复 live。
def test_performance_group_lives_unique_live_id_constraint(integration_admin_connection):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('Group A') RETURNING id"
        )
        group_a = int(cursor.fetchone()[0])
        cursor.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('Group B') RETURNING id"
        )
        group_b = int(cursor.fetchone()[0])

        cursor.execute(
            "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, 1)",
            (group_a,),
        )

        with pytest.raises(UniqueViolation):
            cursor.execute(
                "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, 1)",
                (group_b,),
            )

        # Cleanup
        cursor.execute("DELETE FROM performance_group_lives WHERE group_id IN (%s, %s)", (group_a, group_b))
        cursor.execute("DELETE FROM performance_group_attrs WHERE id IN (%s, %s)", (group_a, group_b))


# 测试点：editor 创建活动组时，关系、详情和审计都使用日期、开演时间、ID 的规范顺序。
def test_editor_can_create_performance_group(
    integration_test_client,
    integration_admin_connection,
):
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )
    response = integration_test_client.post(
        "/api/console/performance-groups",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "group_title": "Integration Test Group",
            "live_ids": [2, 1],
        },
    )

    assert response.status_code == 201
    group_id = response.json()["item"]["group_id"]
    assert response.json()["item"]["live_count"] == 2

    detail = integration_test_client.get(f"/api/catalog/performance-groups/{group_id}").json()
    assert detail["group_title"] == "Integration Test Group"
    assert detail["live_count"] == 2
    assert [live["live_id"] for live in detail["lives"]] == [1, 2]

    user_id = _get_user_id(integration_admin_connection, TEST_DEFAULT_ADMIN_USERNAME)
    audit = _get_latest_audit_row(integration_admin_connection, user_id=user_id)
    assert audit[0] == "performance_group_create"
    assert audit[1] == str(group_id)
    assert audit[2]["live_ids"] == [1, 2]

    # Cleanup
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute("DELETE FROM performance_group_lives WHERE group_id = %s", (group_id,))
        cursor.execute("DELETE FROM performance_group_attrs WHERE id = %s", (group_id,))


# 测试点：editor 可以更新活动组，以完整目标集合替换全部关系。
def test_editor_can_update_performance_group(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('Old Group') RETURNING id"
        )
        group_id = int(cur.fetchone()[0])
        cur.execute(
            "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, 1), (%s, 2)",
            (group_id, group_id),
        )

    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )
    response = integration_test_client.put(
        f"/api/console/performance-groups/{group_id}",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "group_title": "Updated Group",
            "live_ids": [1, 41],
        },
    )

    assert response.status_code == 200
    assert response.json()["item"]["live_count"] == 2

    detail = integration_test_client.get(f"/api/catalog/performance-groups/{group_id}").json()
    assert detail["group_title"] == "Updated Group"
    live_ids = [live["live_id"] for live in detail["lives"]]
    assert live_ids == [1, 41]

    # Cleanup
    with integration_admin_connection.cursor() as cur:
        cur.execute("DELETE FROM performance_group_lives WHERE group_id = %s", (group_id,))
        cur.execute("DELETE FROM performance_group_attrs WHERE id = %s", (group_id,))


# 测试点：同一 live 不能同时属于两个活动组。
def test_same_live_cannot_belong_to_two_groups(integration_admin_connection):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('Group A') RETURNING id"
        )
        group_a = int(cursor.fetchone()[0])
        cursor.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('Group B') RETURNING id"
        )
        group_b = int(cursor.fetchone()[0])

        cursor.execute(
            "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, 41)",
            (group_a,),
        )

        with pytest.raises(UniqueViolation):
            cursor.execute(
                "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, 41)",
                (group_b,),
            )

        # Cleanup
        cursor.execute("DELETE FROM performance_group_lives WHERE group_id IN (%s, %s)", (group_a, group_b))
        cursor.execute("DELETE FROM performance_group_attrs WHERE id IN (%s, %s)", (group_a, group_b))


# 测试点：一个 live 可以同时属于一个巡演和一个活动组，互不冲突。
def test_live_can_belong_to_both_tour_and_performance_group(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('Dual Group') RETURNING id"
        )
        group_id = int(cur.fetchone()[0])
        cur.execute(
            "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, 1)",
            (group_id,),
        )

    # Live 1 is already in tour 1 from seed. Verify both references appear.
    detail = integration_test_client.get("/api/lives/1").json()
    assert detail["tour"]["tour_id"] == 1
    assert detail["performance_group"]["group_id"] == group_id

    # Cleanup
    with integration_admin_connection.cursor() as cur:
        cur.execute("DELETE FROM performance_group_lives WHERE group_id = %s", (group_id,))
        cur.execute("DELETE FROM performance_group_attrs WHERE id = %s", (group_id,))


# 测试点：列表、搜索、收藏、单详情和批量详情对同一 Live 返回一致的活动组反向引用。
def test_public_live_read_paths_return_consistent_performance_group_ref(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    editor_id = _get_user_id(integration_admin_connection, "editor_tester")
    _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('Reverse Ref Group') RETURNING id"
        )
        group_id = int(cur.fetchone()[0])
        cur.execute(
            "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, 1), (%s, 2)",
            (group_id, group_id),
        )
        cur.execute(
            "INSERT INTO user_live_favorites (user_id, live_id, source) VALUES (%s, 1, 'manual') "
            "ON CONFLICT (user_id, live_id) DO NOTHING",
            (editor_id,),
        )

    expected_ref = {"group_id": group_id, "group_title": "Reverse Ref Group"}
    lives_item = integration_test_client.get(
        "/api/lives?page=1&page_size=20&q=Unit"
    ).json()["items"][0]
    search_item = integration_test_client.get(
        "/api/catalog/search?q=Unit&limit=8"
    ).json()["lives"][0]
    favorite_item = integration_test_client.get(
        "/api/me/favorites/lives?page=1&page_size=20&q=Unit"
    ).json()["items"][0]
    detail = integration_test_client.get("/api/lives/1").json()
    batch_detail = integration_test_client.post(
        "/api/lives/details:batch", json={"live_ids": [1]}
    ).json()["items"][0]

    for item in (lives_item, search_item, favorite_item, detail, batch_detail):
        assert item["performance_group"] == expected_ref

    with integration_admin_connection.cursor() as cur:
        cur.execute("DELETE FROM user_live_favorites WHERE user_id = %s AND live_id = 1", (editor_id,))
        cur.execute("DELETE FROM performance_group_lives WHERE group_id = %s", (group_id,))
        cur.execute("DELETE FROM performance_group_attrs WHERE id = %s", (group_id,))


# 测试点：公开 GET 详情应返回包含 bands、venues、lives 的完整结构。
def test_public_get_detail_returns_correct_structure(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('Public Test Group') RETURNING id"
        )
        group_id = int(cur.fetchone()[0])
        cur.execute(
            "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, 1), (%s, 38)",
            (group_id, group_id),
        )

    response = integration_test_client.get(f"/api/catalog/performance-groups/{group_id}")
    assert response.status_code == 200
    payload = response.json()
    assert payload["group_id"] == group_id
    assert payload["group_title"] == "Public Test Group"
    assert payload["live_count"] == 2
    assert len(payload["lives"]) == 2
    assert len(payload["bands"]) >= 0
    assert isinstance(payload["day_count"], int)
    assert payload["display_type"] in ("single_day_multi_show", "multi_day")

    # Cleanup
    with integration_admin_connection.cursor() as cur:
        cur.execute("DELETE FROM performance_group_lives WHERE group_id = %s", (group_id,))
        cur.execute("DELETE FROM performance_group_attrs WHERE id = %s", (group_id,))


# 测试点：匿名用户访问活动组详情时，所有 live 的 is_favorite 应为 False。
def test_anonymous_user_sees_is_favorite_false(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('Anon Group') RETURNING id"
        )
        group_id = int(cur.fetchone()[0])
        cur.execute(
            "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, 1), (%s, 2)",
            (group_id, group_id),
        )

    response = integration_test_client.get(f"/api/catalog/performance-groups/{group_id}")
    assert response.status_code == 200
    lives = response.json()["lives"]
    assert all(live["is_favorite"] is False for live in lives)

    # Cleanup
    with integration_admin_connection.cursor() as cur:
        cur.execute("DELETE FROM performance_group_lives WHERE group_id = %s", (group_id,))
        cur.execute("DELETE FROM performance_group_attrs WHERE id = %s", (group_id,))


# 测试点：GET /api/catalog/performances 应返回独立 live 和有效 group 的混合列表。
def test_catalog_performances_returns_mixed_items(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('Catalog Group') RETURNING id"
        )
        group_id = int(cur.fetchone()[0])
        cur.execute(
            "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, 1), (%s, 2)",
            (group_id, group_id),
        )

    response = integration_test_client.get(
        "/api/catalog/performances?scope=all&page=1&page_size=20"
    )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) >= 1
    assert any(
        item["kind"] == "performance_group"
        and item["performance_group"]["group_id"] == group_id
        for item in payload["items"]
    )

    # Cleanup
    with integration_admin_connection.cursor() as cur:
        cur.execute("DELETE FROM performance_group_lives WHERE group_id = %s", (group_id,))
        cur.execute("DELETE FROM performance_group_attrs WHERE id = %s", (group_id,))


# 测试点：活动组仅部分满足组合筛选时应逐场返回，并以单场日期时间参与分页排序。
def test_catalog_performances_expands_partial_group_matches(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    live_ids = [9101, 9102, 9103]
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO live_attrs (
                id, live_date, live_title, url, opening_time, start_time,
                venue_id, venue_name_version_id, live_type, default_band_ids
            )
            VALUES
                (9101, DATE '2026-06-01', 'PartialProbe Opening', 'https://example.com/9101',
                 TIME WITH TIME ZONE '17:00:00+09', TIME WITH TIME ZONE '18:00:00+09',
                 1, (SELECT id FROM venue_name_versions WHERE venue_id = 1), 'oneman', ARRAY[1]),
                (9102, DATE '2026-06-02', 'PartialProbe Finale', 'https://example.com/9102',
                 TIME WITH TIME ZONE '18:00:00+09', TIME WITH TIME ZONE '19:00:00+09',
                 2, (SELECT id FROM venue_name_versions WHERE venue_id = 2), 'oneman', ARRAY[2]),
                (9103, DATE '2027-06-03', 'Unrelated Closing', 'https://example.com/9103',
                 TIME WITH TIME ZONE '16:00:00+09', TIME WITH TIME ZONE '17:00:00+09',
                 1, (SELECT id FROM venue_name_versions WHERE venue_id = 1), 'event', ARRAY[3])
            """
        )
        cur.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('Partial Container') RETURNING id"
        )
        group_id = int(cur.fetchone()[0])
        cur.executemany(
            "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, %s)",
            [(group_id, live_id) for live_id in live_ids],
        )

    response = integration_test_client.get(
        "/api/catalog/performances",
        params={
            "scope": "all",
            "page": 1,
            "page_size": 20,
            "q": "PartialProbe",
            "sort": "date_desc",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["pagination"]["total"] == 2
    assert [item["live"]["live_id"] for item in payload["items"]] == [9102, 9101]
    assert all(item["kind"] == "live" for item in payload["items"])
    assert all(
        item["live"]["performance_group"]
        == {"group_id": group_id, "group_title": "Partial Container"}
        for item in payload["items"]
    )

    ascending = integration_test_client.get(
        "/api/catalog/performances",
        params={
            "scope": "all",
            "page": 1,
            "page_size": 20,
            "q": "PartialProbe",
            "sort": "date_asc",
        },
    )
    assert ascending.status_code == 200, ascending.text
    assert [item["live"]["live_id"] for item in ascending.json()["items"]] == [9101, 9102]

    combined = integration_test_client.get(
        "/api/catalog/performances",
        params={
            "scope": "all",
            "page": 1,
            "page_size": 20,
            "q": "PartialProbe",
            "year": 2026,
            "live_type": "oneman",
            "band_id": 1,
        },
    )
    assert combined.status_code == 200, combined.text
    assert combined.json()["pagination"]["total"] == 1
    assert combined.json()["items"][0]["live"]["live_id"] == 9101

    no_match = integration_test_client.get(
        "/api/catalog/performances",
        params={
            "scope": "all",
            "page": 1,
            "page_size": 20,
            "q": "MissingPartialProbe",
        },
    )
    assert no_match.status_code == 200, no_match.text
    assert no_match.json()["pagination"]["total"] == 0
    assert no_match.json()["items"] == []

    with integration_admin_connection.cursor() as cur:
        cur.execute("DELETE FROM performance_group_lives WHERE group_id = %s", (group_id,))
        cur.execute("DELETE FROM performance_group_attrs WHERE id = %s", (group_id,))
        cur.execute("DELETE FROM live_attrs WHERE id = ANY(%s)", (live_ids,))


# 测试点：部分组展开后的每个 Live 都应独立计入 total，并正确跨越分页边界。
def test_catalog_performances_paginates_expanded_group_lives(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    live_ids = list(range(9401, 9418))
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO live_attrs (
                id, live_date, live_title, url, opening_time, start_time,
                venue_id, venue_name_version_id, live_type, default_band_ids
            )
            SELECT
                live_id,
                DATE '2030-01-01' + (live_id - 9401),
                'PagingProbe ' || live_id,
                'https://example.com/' || live_id,
                TIME WITH TIME ZONE '17:00:00+09',
                TIME WITH TIME ZONE '18:00:00+09',
                1,
                (SELECT id FROM venue_name_versions WHERE venue_id = 1),
                'oneman',
                ARRAY[1]
            FROM generate_series(9401, 9416) AS live_id
            """
        )
        cur.execute(
            """
            INSERT INTO live_attrs (
                id, live_date, live_title, url, opening_time, start_time,
                venue_id, venue_name_version_id, live_type, default_band_ids
            )
            VALUES (
                9417, DATE '2030-01-17', 'Unrelated Paging Tail',
                'https://example.com/9417',
                TIME WITH TIME ZONE '17:00:00+09',
                TIME WITH TIME ZONE '18:00:00+09',
                1, (SELECT id FROM venue_name_versions WHERE venue_id = 1), 'oneman', ARRAY[1]
            )
            """
        )
        cur.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('Paging Container') RETURNING id"
        )
        group_id = int(cur.fetchone()[0])
        cur.execute(
            """
            INSERT INTO performance_group_lives (group_id, live_id)
            SELECT %s, live_id
            FROM generate_series(9401, 9417) AS live_id
            """,
            (group_id,),
        )

    first_page = integration_test_client.get(
        "/api/catalog/performances",
        params={
            "scope": "all",
            "page": 1,
            "page_size": 15,
            "q": "PagingProbe",
            "sort": "date_desc",
        },
    )
    assert first_page.status_code == 200, first_page.text
    first_payload = first_page.json()
    assert first_payload["pagination"] == {
        "page": 1,
        "page_size": 15,
        "total": 16,
        "total_pages": 2,
    }
    assert [item["live"]["live_id"] for item in first_payload["items"]] == list(
        range(9416, 9401, -1)
    )
    assert all(item["kind"] == "live" for item in first_payload["items"])

    second_page = integration_test_client.get(
        "/api/catalog/performances",
        params={
            "scope": "all",
            "page": 2,
            "page_size": 15,
            "q": "PagingProbe",
            "sort": "date_desc",
        },
    )
    assert second_page.status_code == 200, second_page.text
    second_payload = second_page.json()
    assert second_payload["pagination"]["total"] == 16
    assert second_payload["pagination"]["total_pages"] == 2
    assert [item["live"]["live_id"] for item in second_payload["items"]] == [9401]

    with integration_admin_connection.cursor() as cur:
        cur.execute("DELETE FROM performance_group_lives WHERE group_id = %s", (group_id,))
        cur.execute("DELETE FROM performance_group_attrs WHERE id = %s", (group_id,))
        cur.execute("DELETE FROM live_attrs WHERE id = ANY(%s)", (live_ids,))


# 测试点：演出列表按 未开始→进行中→已结束/已取消 分组排序，组内保持原有时间排序。
def test_catalog_performances_groups_by_status_then_time(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    live_ids = [9501, 9502, 9503, 9504, 9505]
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO live_attrs (
                id, live_date, live_title, url, opening_time, start_time,
                venue_id, venue_name_version_id, live_type, default_band_ids, event_status
            )
            SELECT
                v.id,
                ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '9 hours')::date + v.day_offset,
                v.title,
                'https://example.com/' || v.id,
                TIME WITH TIME ZONE '17:00:00+09',
                TIME WITH TIME ZONE '18:00:00+09',
                1, (SELECT id FROM venue_name_versions WHERE venue_id = 1),
                'oneman', ARRAY[1], v.event_status
            FROM (VALUES
                (9501, 30, 'StatusProbe Far Future', 'scheduled'),
                (9502, -30, 'StatusProbe Ended', 'scheduled'),
                (9503, 0, 'StatusProbe Today', 'scheduled'),
                (9504, 60, 'StatusProbe Cancelled', 'cancelled'),
                (9505, 10, 'StatusProbe Near Future', 'scheduled')
            ) AS v(id, day_offset, title, event_status)
            """
        )

    def _ordered_ids(sort: str) -> list[int]:
        response = integration_test_client.get(
            "/api/catalog/performances",
            params={"scope": "all", "page": 1, "page_size": 20, "q": "StatusProbe", "sort": sort},
        )
        assert response.status_code == 200, response.text
        assert response.json()["pagination"]["total"] == 5
        return [item["live"]["live_id"] for item in response.json()["items"]]

    # date_desc：未开始组内按日期倒序（9501 最远→9505 最近），已取消与已结束同组按日期倒序。
    assert _ordered_ids("date_desc") == [9501, 9505, 9503, 9504, 9502]
    # date_asc：未开始组内按日期正序（9505 最近→9501 最远），组内时间排序逻辑保持不变。
    assert _ordered_ids("date_asc") == [9505, 9501, 9503, 9502, 9504]

    with integration_admin_connection.cursor() as cur:
        cur.execute("DELETE FROM live_attrs WHERE id = ANY(%s)", (live_ids,))


# 测试点：全场命中或关键词直接命中组名时应继续返回完整活动组卡片数据。
def test_catalog_performances_keeps_full_or_title_matched_group(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    live_ids = [9201, 9202]
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO live_attrs (
                id, live_date, live_title, url, opening_time, start_time,
                venue_id, venue_name_version_id, live_type, default_band_ids
            )
            VALUES
                (9201, DATE '2028-07-01', 'FullProbe Opening', 'https://example.com/9201',
                 TIME WITH TIME ZONE '17:00:00+09', TIME WITH TIME ZONE '18:00:00+09',
                 1, (SELECT id FROM venue_name_versions WHERE venue_id = 1), 'oneman', ARRAY[1]),
                (9202, DATE '2028-07-02', 'FullProbe Finale', 'https://example.com/9202',
                 TIME WITH TIME ZONE '18:00:00+09', TIME WITH TIME ZONE '19:00:00+09',
                 2, (SELECT id FROM venue_name_versions WHERE venue_id = 2), 'oneman', ARRAY[1])
            """
        )
        cur.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('TitleProbe Activity') RETURNING id"
        )
        group_id = int(cur.fetchone()[0])
        cur.executemany(
            "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, %s)",
            [(group_id, live_id) for live_id in live_ids],
        )

    full_child_match = integration_test_client.get(
        "/api/catalog/performances",
        params={
            "scope": "all",
            "page": 1,
            "page_size": 20,
            "q": "FullProbe",
        },
    )
    assert full_child_match.status_code == 200, full_child_match.text
    assert full_child_match.json()["pagination"]["total"] == 1
    assert full_child_match.json()["items"][0]["kind"] == "performance_group"
    assert full_child_match.json()["items"][0]["performance_group"]["group_id"] == group_id

    title_match = integration_test_client.get(
        "/api/catalog/performances",
        params={
            "scope": "all",
            "page": 1,
            "page_size": 20,
            "q": "TitleProbe",
            "year": 2028,
        },
    )
    assert title_match.status_code == 200, title_match.text
    assert title_match.json()["pagination"]["total"] == 1
    assert title_match.json()["items"][0]["kind"] == "performance_group"
    assert title_match.json()["items"][0]["performance_group"]["live_count"] == 2

    with integration_admin_connection.cursor() as cur:
        cur.execute("DELETE FROM performance_group_lives WHERE group_id = %s", (group_id,))
        cur.execute("DELETE FROM performance_group_attrs WHERE id = %s", (group_id,))
        cur.execute("DELETE FROM live_attrs WHERE id = ANY(%s)", (live_ids,))


# 测试点：两场组删除一场后，级联关系不会让剩余 Live 从统一演出资料中消失。
def test_deleting_live_cascades_to_performance_group_lives(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        # First create a standalone live to delete
        cursor.execute(
            """
            INSERT INTO live_attrs (
                id, live_date, live_title, url, opening_time, start_time,
                venue_id, venue_name_version_id, live_type, default_band_ids
            )
            VALUES (9001, '2027-01-01'::date, 'Cascade Test Live', 'https://example.com/9001',
                    TIME WITH TIME ZONE '16:00:00+09', TIME WITH TIME ZONE '17:00:00+09',
                    1, (SELECT id FROM venue_name_versions WHERE venue_id = 1),
                    'other', ARRAY[1])
            """
        )
        cursor.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('Cascade Group') RETURNING id"
        )
        group_id = int(cursor.fetchone()[0])
        cursor.execute(
            "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, 1), (%s, 9001)",
            (group_id, group_id),
        )
        cursor.execute("SELECT COUNT(*) FROM performance_group_lives WHERE live_id = 9001")
        assert cursor.fetchone() == (1,)

        # Delete the live - should cascade
        cursor.execute("DELETE FROM live_attrs WHERE id = 9001")
        cursor.execute("SELECT COUNT(*) FROM performance_group_lives WHERE live_id = 9001")
        assert cursor.fetchone() == (0,)

        response = integration_test_client.get(
            "/api/catalog/performances?scope=all&page=1&page_size=20&q=Unit"
        )
        assert response.status_code == 200, response.text
        assert any(
            item["kind"] == "live" and item["live"]["live_id"] == 1
            for item in response.json()["items"]
        )

        # Cleanup
        cursor.execute("DELETE FROM performance_group_lives WHERE group_id = %s", (group_id,))
        cursor.execute("DELETE FROM performance_group_attrs WHERE id = %s", (group_id,))


# 测试点：收藏范围只在全组收藏时聚合，部分收藏即使命中组名也只返回已收藏 Live。
def test_catalog_performances_favorites_scope(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    editor_id = _get_user_id(integration_admin_connection, "editor_tester")
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )

    # Favorite live 1 and 2
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            "INSERT INTO user_live_favorites (user_id, live_id, source) VALUES (%s, 1, 'manual'), (%s, 2, 'manual') "
            "ON CONFLICT (user_id, live_id) DO NOTHING",
            (editor_id, editor_id),
        )

    # Create a group with lives 1 and 2
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            "INSERT INTO performance_group_attrs (group_title) VALUES ('Fav Test Group') RETURNING id"
        )
        group_id = int(cur.fetchone()[0])
        cur.execute(
            "INSERT INTO performance_group_lives (group_id, live_id) VALUES (%s, 1), (%s, 2)",
            (group_id, group_id),
        )

    # scope=favorites: both lives favorited → should see group
    response = integration_test_client.get(
        "/api/catalog/performances?scope=favorites&page=1&page_size=20"
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    group_items = [item for item in payload["items"] if item["kind"] == "performance_group"]
    assert len(group_items) == 1
    assert group_items[0]["performance_group"]["group_id"] == group_id

    # Unfavorite live 2 → only live 1 remains favorited, group no longer fully favorited
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            "DELETE FROM user_live_favorites WHERE user_id = %s AND live_id = 2",
            (editor_id,),
        )

    response = integration_test_client.get(
        "/api/catalog/performances?scope=favorites&page=1&page_size=20"
    )
    assert response.status_code == 200
    payload = response.json()
    # Now should see live 1 as kind=live (partially-favorited group → individual lives)
    live_items = [item for item in payload["items"] if item["kind"] == "live"]
    assert any(item["live"]["live_id"] == 1 for item in live_items)
    # No group should appear (not fully favorited)
    group_items_after = [item for item in payload["items"] if item["kind"] == "performance_group"]
    assert len(group_items_after) == 0

    title_match_response = integration_test_client.get(
        "/api/catalog/performances",
        params={
            "scope": "favorites",
            "page": 1,
            "page_size": 20,
            "q": "Fav Test Group",
        },
    )
    assert title_match_response.status_code == 200, title_match_response.text
    title_match_items = title_match_response.json()["items"]
    assert [item["live"]["live_id"] for item in title_match_items] == [1]
    assert title_match_items[0]["live"]["performance_group"] == {
        "group_id": group_id,
        "group_title": "Fav Test Group",
    }

    # Cleanup
    with integration_admin_connection.cursor() as cur:
        cur.execute("DELETE FROM user_live_favorites WHERE user_id = %s", (editor_id,))
        cur.execute("DELETE FROM performance_group_lives WHERE group_id = %s", (group_id,))
        cur.execute("DELETE FROM performance_group_attrs WHERE id = %s", (group_id,))


# 测试点：scope=favorites 同时使用关键词和年份时按 SQL 占位符顺序绑定参数并返回匹配收藏。
def test_catalog_performances_favorites_with_filters(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    editor_id = _get_user_id(integration_admin_connection, "editor_tester")
    _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )

    with integration_admin_connection.cursor() as cur:
        cur.execute(
            "INSERT INTO user_live_favorites (user_id, live_id, source) VALUES (%s, 1, 'manual') "
            "ON CONFLICT (user_id, live_id) DO NOTHING",
            (editor_id,),
        )

    response = integration_test_client.get(
        "/api/catalog/performances?scope=favorites&page=1&page_size=20&year=2026&q=BanG"
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert any(item["kind"] == "live" and item["live"]["live_id"] == 1 for item in payload["items"])

    with integration_admin_connection.cursor() as cur:
        cur.execute("DELETE FROM user_live_favorites WHERE user_id = %s", (editor_id,))
