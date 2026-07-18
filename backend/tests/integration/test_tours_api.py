import psycopg2
import pytest
from psycopg2.errors import UniqueViolation


pytestmark = pytest.mark.integration


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
                "url": "https://example.com/tours/spring-2026",
                "description": "Integration fixture for public tour aggregation.",
                "bands": [
                    {"band_id": 1, "band_name": "Poppin'Party", "band_abbr": "ppp"},
                    {"band_id": 2, "band_name": "Roselia", "band_abbr": "rsl"},
                ],
                "start_date": "2026-03-28",
                "end_date": "2026-04-05",
                "collected_live_count": 2,
                "stop_labels": ["Tokyo Opening", "Tokyo Finale"],
            }
        ],
        "pagination": {"page": 1, "page_size": 20, "total": 1, "total_pages": 1},
    }


# 测试点：巡演详情按 stop_order 返回场次，并从真实 Live 数据计算乐队和 setlist 状态。
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
