import pytest


pytestmark = pytest.mark.integration


def _truncate_business_tables(integration_admin_connection) -> None:
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            TRUNCATE TABLE
                public.live_setlist,
                public.live_attrs,
                public.song_list,
                public.band_attrs,
                public.venue_list
            RESTART IDENTITY CASCADE
            """
        )


def _seed_versioned_detail_relations(integration_admin_connection, live_ids: list[int]) -> None:
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO band_name_versions (
                band_id, band_name, band_abbr, valid_from, valid_to, note
            )
            SELECT DISTINCT
                band.id, band.band_name, NULLIF(band.band_abbr, ''),
                NULL::date, NULL::date,
                'versioned detail integration test'
            FROM live_setlist setlist
            CROSS JOIN LATERAL jsonb_object_keys(setlist.band_member) AS item(band_name)
            JOIN band_attrs band ON band.band_name = item.band_name
            WHERE setlist.live_id = ANY(%s)
            ON CONFLICT DO NOTHING
            """,
            (live_ids,),
        )
        cursor.execute(
            """
            INSERT INTO band_lineup_versions (
                band_id, version_no, version_label, valid_from, valid_to,
                predecessor_id, change_type, note
            )
            SELECT DISTINCT
                band.id, 1, band.band_name || ' V1',
                NULL::date, NULL::date, NULL::bigint,
                'initial', 'versioned detail integration test'
            FROM live_setlist setlist
            CROSS JOIN LATERAL jsonb_object_keys(setlist.band_member) AS item(band_name)
            JOIN band_attrs band ON band.band_name = item.band_name
            WHERE setlist.live_id = ANY(%s)
            ON CONFLICT DO NOTHING
            """,
            (live_ids,),
        )
        cursor.execute(
            """
            INSERT INTO band_lineup_version_members (
                lineup_version_id, member_name, display_order
            )
            SELECT version.id, member.member_name, member.display_order::integer
            FROM band_lineup_versions version
            JOIN band_attrs band ON band.id = version.band_id
            CROSS JOIN LATERAL unnest(band.band_members) WITH ORDINALITY
                AS member(member_name, display_order)
            ORDER BY version.band_id, member.display_order
            ON CONFLICT DO NOTHING
            """
        )
        cursor.execute(
            """
            INSERT INTO live_band_lineup_contexts (
                live_id, band_id, band_name_version_id,
                base_lineup_version_id, next_lineup_version_id
            )
            SELECT DISTINCT
                setlist.live_id, band.id, name_version.id, lineup_version.id, NULL::bigint
            FROM live_setlist setlist
            CROSS JOIN LATERAL jsonb_object_keys(setlist.band_member) AS item(band_name)
            JOIN band_attrs band ON band.band_name = item.band_name
            JOIN band_name_versions name_version ON name_version.band_id = band.id
            JOIN band_lineup_versions lineup_version ON lineup_version.band_id = band.id
            WHERE setlist.live_id = ANY(%s)
            ON CONFLICT DO NOTHING
            """,
            (live_ids,),
        )
        cursor.execute(
            """
            INSERT INTO live_setlist_band_performances (
                setlist_id, live_id, band_id, lineup_usage
            )
            SELECT setlist.id, setlist.live_id, band.id, 'base'
            FROM live_setlist setlist
            CROSS JOIN LATERAL jsonb_each(setlist.band_member) AS item(band_name, members)
            JOIN band_attrs band ON band.band_name = item.band_name
            WHERE setlist.live_id = ANY(%s)
            ON CONFLICT DO NOTHING
            """,
            (live_ids,),
        )
        cursor.execute(
            """
            INSERT INTO live_setlist_band_performance_members (
                setlist_id, band_id, member_name, display_order, appearance_role
            )
            SELECT
                setlist.id, band.id, member.member_name,
                member.display_order::integer, NULL
            FROM live_setlist setlist
            CROSS JOIN LATERAL jsonb_each(setlist.band_member) AS item(band_name, members)
            JOIN band_attrs band ON band.band_name = item.band_name
            CROSS JOIN LATERAL jsonb_array_elements_text(
                CASE
                    WHEN jsonb_typeof(item.members) = 'array' THEN item.members
                    WHEN item.members IS NULL THEN '[]'::jsonb
                    ELSE jsonb_build_array(item.members)
                END
            ) WITH ORDINALITY AS member(member_name, display_order)
            WHERE setlist.live_id = ANY(%s)
            ON CONFLICT DO NOTHING
            """,
            (live_ids,),
        )


def test_get_lives_returns_seeded_items(integration_test_client):
    # 测试点：列表接口应基于真实测试库返回种子数据，并正确聚合 bands 与分页信息。
    response = integration_test_client.get("/api/lives?page=1&page_size=20")

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"] == {
        "page": 1,
        "page_size": 20,
        "total": 4,
        "total_pages": 1,
    }
    assert [item["live_id"] for item in payload["items"]] == [41, 2, 1, 38]
    assert payload["items"][0]["bands"] == [3]
    assert payload["items"][1]["bands"] == [1, 3]
    assert payload["items"][2]["bands"] == [1, 2]
    assert payload["items"][3]["bands"] == [1]


def test_get_lives_includes_seeded_live_without_setlist(integration_test_client):
    # 测试点：无 setlist 的 Live 应进入列表，并使用 default_band_ids 作为列表图标来源。
    response = integration_test_client.get("/api/lives?page=1&page_size=20")

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0] == {
        "live_id": 41,
        "live_date": "2026-05-30",
        "live_title": "Console Draft Live",
        "live_type": "other",
        "bands": [3],
        "url": "https://example.com/lives/console-draft",
        "is_favorite": False,
        "tour": None,
        "performance_group": None,
        "event_status": "scheduled",
        "date_phase": "past",
        "was_rescheduled": False,
    }


def test_get_lives_without_setlist_excludes_seeded_lives_with_rows(integration_test_client):
    # 测试点：without_setlist 候选只包含没有任何 setlist 行的 Live，并保留默认 Band。
    response = integration_test_client.get("/api/lives?page=1&page_size=20&without_setlist=true")

    assert response.status_code == 200
    payload = response.json()
    assert [item["live_id"] for item in payload["items"]] == [41]
    assert payload["items"][0]["bands"] == [3]
    assert payload["pagination"] == {
        "page": 1,
        "page_size": 20,
        "total": 1,
        "total_pages": 1,
    }


# 测试点：关键词、年份、类型和乐队应在分页前按 AND 组合，并保留正确的聚合列表字段。
def test_get_lives_combines_public_filters(integration_test_client):
    response = integration_test_client.get(
        "/api/lives",
        params={
            "page": 1,
            "page_size": 20,
            "q": "Shibuya",
            "year": 2026,
            "live_type": "multi_act",
            "band_id": 2,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"] == {
        "page": 1,
        "page_size": 20,
        "total": 1,
        "total_pages": 1,
    }
    assert [item["live_id"] for item in payload["items"]] == [1]
    assert payload["items"][0]["bands"] == [1, 2]


# 测试点：无 setlist 的默认 Band 应参与全部内容的关键词和 band_id 筛选。
def test_get_lives_filters_match_default_bands_only_without_setlist(integration_test_client):
    response = integration_test_client.get(
        "/api/lives",
        params={
            "page": 1,
            "page_size": 20,
            "q": "MyGO",
            "live_type": "other",
            "band_id": 3,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["live_id"] for item in payload["items"]] == [41]
    assert payload["items"][0]["bands"] == [3]


# 测试点：日期升序应同时使用 live_date 与 id 形成稳定排序。
def test_get_lives_supports_date_ascending_sort(integration_test_client):
    response = integration_test_client.get(
        "/api/lives",
        params={"page": 1, "page_size": 20, "sort": "date_asc"},
    )

    assert response.status_code == 200
    assert [item["live_id"] for item in response.json()["items"]] == [38, 1, 2, 41]


def test_get_lives_large_page_clamps_to_last_page(integration_test_client):
    # 测试点：真实测试库只有 1 页数据时，请求超大页码应钳制回最后一页。
    response = integration_test_client.get("/api/lives?page=99&page_size=20")

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"] == {
        "page": 1,
        "page_size": 20,
        "total": 4,
        "total_pages": 1,
    }
    assert [item["live_id"] for item in payload["items"]] == [41, 2, 1, 38]


def test_get_lives_empty_result_returns_empty_items(
    integration_test_client,
    integration_admin_connection,
):
    # 测试点：业务表清空后，列表接口应返回空 items，且分页统一回落到 page=1。
    _truncate_business_tables(integration_admin_connection)

    response = integration_test_client.get("/api/lives?page=3&page_size=20")

    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "pagination": {
            "page": 1,
            "page_size": 20,
            "total": 0,
            "total_pages": 1,
        },
    }


def test_get_live_detail_returns_seeded_detail_payload(
    integration_test_client,
    integration_admin_connection,
):
    # 测试点：详情接口应基于真实固化阵容返回完整字段与 full/partial 出席状态。
    _seed_versioned_detail_relations(integration_admin_connection, [1])
    response = integration_test_client.get("/api/lives/1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["live_id"] == 1
    assert payload["live_title"] == "BanG Dream! Unit Live"
    assert payload["venue"] == "Shibuya WWW X"
    assert payload["opening_time"] == "16:30:00+09"
    assert payload["start_time"] == "17:30:00+09"
    assert payload["bands"] == [1, 2]
    assert payload["band_names"] == ["Poppin'Party", "Roselia"]
    assert payload["url"] == "https://example.com/lives/1"
    assert len(payload["detail_rows"]) == 2

    first_row = payload["detail_rows"][0]
    assert first_row["row_id"] == "main1"
    assert first_row["song_name"] == "Yes! BanG_Dream!"
    assert first_row["comments"] == []
    assert first_row["other_members"] == [{"key": "嘉宾", "value": ["CHU2"]}]
    assert first_row["band_members"][0]["band_name"] == "Poppin'Party"
    assert first_row["band_members"][0]["total_count"] == 5
    assert first_row["band_members"][0]["is_full"] is True
    assert first_row["band_members"][0]["attendance_status"] == "full"

    second_row = payload["detail_rows"][1]
    assert second_row["row_id"] == "main2"
    assert second_row["comments"] == ["短版"]
    assert second_row["band_members"][0]["band_name"] == "Roselia"
    assert second_row["band_members"][0]["present_count"] == 4
    assert second_row["band_members"][0]["total_count"] == 5
    assert second_row["band_members"][0]["is_full"] is False
    assert second_row["band_members"][0]["attendance_status"] == "partial"
    assert second_row["band_members"][0]["missing_members"] == ["Rinko"]


# 测试点：活动无 Setlist 时，单条与批量详情都应回退默认 Band，并根据完整成员名单计算 partial/full。
def test_event_detail_returns_default_bands_and_computed_attendees(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO live_attrs (
                id, live_date, live_title, live_type, is_internal, url,
                opening_time, start_time, venue_id, default_band_ids, event_attendees
            )
            VALUES (
                9002, '2026-08-08', 'Event Attendees Live', 'event', false,
                'https://example.com/lives/9002', TIME WITH TIME ZONE '12:00:00+09',
                TIME WITH TIME ZONE '13:00:00+09', 1, ARRAY[1, 3],
                '{"1":["Kasumi"],"3":["Tomori","Anon","Raana","Soyo","Taki"]}'::jsonb
            )
            """
        )

    response = integration_test_client.get("/api/lives/9002")
    assert response.status_code == 200
    detail = response.json()
    assert detail["bands"] == [1, 3]
    assert detail["band_names"] == ["Poppin'Party", "MyGO!!!!!"]
    assert detail["event_attendees"] == [
        {"band_id": 1, "band_name": "Poppin'Party", "mode": "partial", "members": ["Kasumi"]},
        {
            "band_id": 3,
            "band_name": "MyGO!!!!!",
            "mode": "full",
            "members": ["Tomori", "Anon", "Raana", "Soyo", "Taki"],
        },
    ]
    assert detail["detail_rows"] == []

    batch_response = integration_test_client.post("/api/lives/details:batch", json={"live_ids": [9002]})
    assert batch_response.status_code == 200
    assert batch_response.json()["items"][0]["event_attendees"] == detail["event_attendees"]


# 测试点：跨乐队歌曲附带所属乐队，is_cover 只保留旧标签，同乐队歌曲不生成新标签。
def test_get_live_detail_applies_cross_band_cover_rules(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO song_list (id, song_name, band_id, is_cover)
            VALUES
                (9000, 'Cross Band Cover Song', 2, false),
                (9001, 'Legacy Cover Song', 2, true),
                (9002, 'Own Band Song', 1, false)
            """
        )
        cursor.execute(
            """
            INSERT INTO live_setlist (
                live_id,
                song_id,
                absolute_order,
                segment_type,
                sub_order,
                is_short,
                band_member,
                other_member,
                comment
            )
            VALUES
                (1, 9000, 99, 'SP', 99, true, '{"Poppin''Party": ["Kasumi"]}'::jsonb, NULL, NULL),
                (1, 9001, 100, 'SP', 100, false, '{"Poppin''Party": ["Kasumi"]}'::jsonb, NULL, NULL),
                (1, 9002, 101, 'SP', 101, false, '{"Poppin''Party": ["Kasumi"]}'::jsonb, NULL, NULL)
            """
        )

    _seed_versioned_detail_relations(integration_admin_connection, [1])
    response = integration_test_client.get("/api/lives/1")

    assert response.status_code == 200
    rows_by_song = {row["song_name"]: row for row in response.json()["detail_rows"]}
    assert rows_by_song["Cross Band Cover Song"]["comments"] == ["短版", "翻唱"]
    assert rows_by_song["Cross Band Cover Song"]["cover_band"] == {
        "band_id": 2,
        "band_name": "Roselia",
    }
    assert rows_by_song["Legacy Cover Song"]["comments"] == ["翻唱"]
    assert rows_by_song["Legacy Cover Song"]["cover_band"] is None
    assert rows_by_song["Own Band Song"]["comments"] == []
    assert rows_by_song["Own Band Song"]["cover_band"] is None


def test_get_live_detail_not_found_returns_404(integration_test_client):
    # 测试点：请求不存在的 live_id 时，详情接口应返回 404。
    response = integration_test_client.get("/api/lives/999999")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


def test_get_live_detail_unmapped_band_uses_fallback_rules(
    integration_test_client,
    integration_admin_connection,
):
    # 测试点：旧 JSON 中没有稳定 band_id 映射的乐队不得再进入公开出演真源。
    _seed_versioned_detail_relations(integration_admin_connection, [2])
    response = integration_test_client.get("/api/lives/2")

    assert response.status_code == 200
    payload = response.json()
    assert payload["bands"] == [1, 3]
    assert payload["band_names"] == ["Poppin'Party", "MyGO!!!!!"]

    first_row = payload["detail_rows"][0]
    assert first_row["row_id"] == "main1"
    assert [band["band_name"] for band in first_row["band_members"]] == ["MyGO!!!!!"]
    assert first_row["band_members"][0]["band_id"] == 3
    assert first_row["band_members"][0]["present_count"] == 3
    assert first_row["band_members"][0]["total_count"] == 5
    assert first_row["band_members"][0]["is_full"] is False
    assert first_row["other_members"] == [{"key": "支援", "value": ["Keyboard"]}]


def test_get_live_details_batch_returns_seeded_items_and_missing_ids(
    integration_test_client,
    integration_admin_connection,
):
    # 测试点：批量详情接口应在真实库场景下支持去重、保序，并返回 missing_live_ids。
    _seed_versioned_detail_relations(integration_admin_connection, [1, 2])
    response = integration_test_client.post(
        "/api/lives/details:batch",
        json={"live_ids": [2, 999, 1, 2]},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["missing_live_ids"] == [999]
    assert [item["live_id"] for item in payload["items"]] == [2, 1]

    first_item = payload["items"][0]
    assert first_item["venue"] == "Zepp Shinjuku"
    assert first_item["opening_time"] == "15:00:00+09"
    assert first_item["start_time"] == "16:00:00+09"
    assert first_item["bands"] == [1, 3]
    assert first_item["band_names"] == ["Poppin'Party", "MyGO!!!!!"]

    first_row = first_item["detail_rows"][0]
    assert first_row["row_id"] == "main1"
    assert first_row["band_members"][0]["band_name"] == "MyGO!!!!!"
    assert first_row["band_members"][0]["total_count"] == 5
    assert first_row["other_members"] == [{"key": "支援", "value": ["Keyboard"]}]


def test_get_live_details_batch_all_missing_returns_empty_items(integration_test_client):
    # 测试点：批量请求的 live_id 全部不存在时，应返回空 items 和去重后的 missing_live_ids。
    response = integration_test_client.post(
        "/api/lives/details:batch",
        json={"live_ids": [999, 1000, 999]},
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "missing_live_ids": [999, 1000],
    }
