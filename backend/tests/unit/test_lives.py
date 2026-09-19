from unittest.mock import MagicMock, call, patch

import pytest
from fastapi.testclient import TestClient
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled

from app.main import app
from app.routers.lives import (
    BATCH_LIVE_DETAIL_HEADERS_QUERY,
    BATCH_LIVE_DETAIL_ROWS_QUERY,
    LIVE_DETAIL_HEADER_QUERY,
    LIVE_DETAIL_PERFORMANCES_QUERY,
    LIVE_DETAIL_ROWS_QUERY,
    LIVES_PAGE_QUERY,
    LIVES_WITHOUT_SETLIST_COUNT_QUERY,
    LIVES_WITHOUT_SETLIST_PAGE_QUERY,
)


def _build_connection_mock(count_value: int, rows: list[tuple]):
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = (count_value,)
    cursor.fetchall.return_value = rows
    return conn, cursor


def _build_detail_connection_mock(
    header_row: tuple | None,
    detail_rows: list[tuple],
    performance_rows: list[tuple] | None = None,
):
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = header_row
    cursor.fetchall.side_effect = [detail_rows, performance_rows or []]
    return conn, cursor


def _build_batch_detail_connection_mock(
    header_rows: list[tuple],
    detail_rows: list[tuple],
    performance_rows: list[tuple] | None = None,
):
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.side_effect = [header_rows, detail_rows, performance_rows or []]
    return conn, cursor


def _request_detail_for_mode(mode, header_row, detail_rows, performance_rows=None):
    live_id = header_row[0]
    if mode == "single":
        conn, _ = _build_detail_connection_mock(header_row, detail_rows, performance_rows)
    else:
        assert mode == "batch"
        conn, _ = _build_batch_detail_connection_mock(
            [header_row], [(live_id, *row) for row in detail_rows], performance_rows,
        )
    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        if mode == "single":
            response = client.get(f"/api/lives/{live_id}")
        else:
            response = client.post("/api/lives/details:batch", json={"live_ids": [live_id]})
    assert response.status_code == 200
    payload = response.json()
    if mode == "batch":
        assert payload["missing_live_ids"] == []
        assert len(payload["items"]) == 1
        return payload["items"][0]
    return payload


# 测试点：列表返回完整字段与分页，URL 连同查询参数原样透传，并保留空 URL。
def test_get_lives_success_returns_items_and_pagination():
    rows = [
        (1, "2026-03-28", "Title 1", [1, 2], "https://example.com/live/1?from=list", "oneman", None, None, 7, "Group 7"),
        (2, "2026-03-27", "Title 2", [], None, "festival", None, None, None, None),
    ]
    conn, cursor = _build_connection_mock(47, rows)

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/lives?page=1&page_size=20")

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"] == {
        "page": 1,
        "page_size": 20,
        "total": 47,
        "total_pages": 3,
    }
    assert payload["items"] == [
        {
            "live_id": 1,
            "live_date": "2026-03-28",
            "live_title": "Title 1",
            "live_type": "oneman",
            "bands": [1, 2],
            "url": "https://example.com/live/1?from=list",
            "is_favorite": False,
            "tour": None,
            "performance_group": {"group_id": 7, "group_title": "Group 7"},
            "event_status": "scheduled",
            "date_phase": "past",
            "was_rescheduled": False,
        },
        {
            "live_id": 2,
            "live_date": "2026-03-27",
            "live_title": "Title 2",
            "live_type": "festival",
            "bands": [],
            "url": None,
            "is_favorite": False,
            "tour": None,
            "performance_group": None,
            "event_status": "scheduled",
            "date_phase": "past",
            "was_rescheduled": False,
        },
    ]
    assert cursor.execute.call_count == 2
    assert cursor.execute.call_args_list[1] == call(LIVES_PAGE_QUERY, (20, 0))


def test_get_lives_without_setlist_uses_filtered_pagination_queries():
    # 测试点：without_setlist 查询返回候选记录与分页数量，筛选和优先级由真实数据库测试验证。
    rows = [(41, "2026-05-30", "Draft Live", [], None, "other", None, None, None, None)]
    conn, cursor = _build_connection_mock(1, rows)

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/lives?page=1&page_size=20&without_setlist=true")

    assert response.status_code == 200
    assert [item["live_id"] for item in response.json()["items"]] == [41]
    assert response.json()["pagination"]["total"] == 1
    assert cursor.execute.call_args_list == [
        call(LIVES_WITHOUT_SETLIST_COUNT_QUERY),
        call(LIVES_WITHOUT_SETLIST_PAGE_QUERY, (20, 0)),
    ]


# 测试点：筛选值必须通过参数绑定传入，关键词中的通配符需要按字面量转义。
def test_get_lives_filtered_query_binds_escaped_parameters():
    conn, cursor = _build_connection_mock(0, [])

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get(
            "/api/lives",
            params={
                "page": 1,
                "page_size": 20,
                "q": r"100%_Live\\",
                "year": 2026,
                "live_type": "oneman",
                "band_id": 2,
                "sort": "date_asc",
            },
        )

    assert response.status_code == 200
    count_call, page_call = cursor.execute.call_args_list
    assert count_call.args[1][0] == r"%100\%\_Live\\\\%"
    assert count_call.args[1][-2:] == ("oneman", 2)
    assert page_call.args[1][-2:] == (20, 0)


# 测试点：年份、类型、乐队和排序的非法值应由 FastAPI 参数校验拒绝。
@pytest.mark.parametrize(
    "query",
    [
        "year=1899",
        "live_type=unknown",
        "band_id=0",
        "sort=title_asc",
    ],
)
def test_get_lives_rejects_invalid_filter_values(query):
    client = TestClient(app)
    response = client.get(f"/api/lives?page=1&page_size=20&{query}")

    assert response.status_code == 422


def test_get_lives_invalid_page_size_returns_400():
    # 测试点：page_size 非 15/20 时应返回 400 参数错误。
    client = TestClient(app)
    response = client.get("/api/lives?page=1&page_size=10")

    assert response.status_code == 400
    assert response.json()["detail"] == "page_size must be 15 or 20"


@pytest.mark.parametrize(
    ("exc", "expected_status", "expected_detail", "exact_match"),
    [
        (QueryCanceled("statement timeout"), 504, "Database query timeout", True),
        (OperationalError("timeout expired"), 504, "Database connection timeout", True),
        (Error("db down"), 500, "Database error", False),
    ],
)
def test_get_lives_db_errors_log_context(exc, expected_status, expected_detail, exact_match):
    # 测试点：get_lives 三类数据库异常都要记录 page/page_size 与 error_type。
    with patch("app.routers.lives.logger.exception") as logger_exception, patch(
        "app.routers.lives.get_db_connection", side_effect=exc
    ):
        client = TestClient(app)
        response = client.get("/api/lives?page=3&page_size=20")

    assert response.status_code == expected_status
    if exact_match:
        assert response.json()["detail"] == expected_detail
    else:
        assert expected_detail in response.json()["detail"]
    logger_exception.assert_called_once()
    assert logger_exception.call_args.args[0].startswith("get_lives failed")
    assert logger_exception.call_args.args[1] == 3
    assert logger_exception.call_args.args[2] == 20
    assert logger_exception.call_args.args[3] == type(exc).__name__


def test_get_lives_large_page_clamps_to_last_page():
    # 测试点：页码超出范围时应钳制到最后一页，并使用正确 offset 查询。
    conn, cursor = _build_connection_mock(21, [])

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/lives?page=99&page_size=20")

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["page"] == 2
    assert payload["pagination"]["total_pages"] == 2
    assert cursor.execute.call_args_list[1] == call(LIVES_PAGE_QUERY, (20, 20))


def test_get_lives_empty_result_returns_page_1_and_empty_items():
    # 测试点：无数据时返回空列表，并统一分页为 page=1 / total_pages=1。
    conn, _ = _build_connection_mock(0, [])

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/lives?page=3&page_size=20")

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"] == []
    assert payload["pagination"] == {
        "page": 1,
        "page_size": 20,
        "total": 0,
        "total_pages": 1,
    }


def test_get_live_detail_success_maps_rows_and_rules():
    # 测试点：详情接口只按固化版本化出演计算 full/partial，并保留结构化曲目位置字段。
    header_row = (
        40,
        "2026-03-28",
        "Live 40",
        "武道馆",
        "17:00:00+09:00",
        "18:00:00+09:00",
        [1, 2],
        ["Poppin'Party", "Afterglow"],
        "https://example.com/live/40",
        "multi_act",
        None,
        None,
        7,
        "Group 7",
        [],
        "scheduled",
        None,
        [],
        9,
        "physical",
    )
    detail_rows = [
        (
            "M1",
            "Song 1",
            {"键盘支援": "远程连线", "嘉宾": "[\"Ommy\", \"荒幡亮平\"]"},
            True,
            True,
            1,
            "Poppin'Party",
            12,
            "M",
            1,
            301,
        ),
        ("EN1", "Song 2", None, False, True, 2, "Afterglow", 13, "EN", 1, 302),
    ]
    performance_rows = [
        (
            40, "M1", 1, "Poppin'Party", "base", None, 11, "Poppin'Party V1",
            ["A", "B", "C", "D", "E"], None, None, [], ["A", "B", "C", "D", "E"], {},
        ),
        (
            40, "M1", 2, "Afterglow", "base", None, 12, "Afterglow V1",
            ["A", "B", "C", "D", "E", "F"], None, None, [], ["A", "B", "C", "D"], {},
        ),
    ]
    conn, cursor = _build_detail_connection_mock(
        header_row,
        detail_rows,
        performance_rows,
    )

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/lives/40")

    assert response.status_code == 200
    payload = response.json()

    assert payload["live_id"] == 40
    assert payload["live_title"] == "Live 40"
    assert payload["venue"] == "武道馆"
    assert payload["venue_id"] == 9
    assert payload["venue_kind"] == "physical"
    assert payload["opening_time"] == "17:00:00+09:00"
    assert payload["start_time"] == "18:00:00+09:00"
    assert payload["bands"] == [1, 2]
    assert payload["band_names"] == ["Poppin'Party", "Afterglow"]
    assert payload["url"] == "https://example.com/live/40"
    assert payload["performance_group"] == {"group_id": 7, "group_title": "Group 7"}
    assert len(payload["detail_rows"]) == 2

    first_row = payload["detail_rows"][0]
    assert first_row["row_id"] == "M1"
    assert first_row["absolute_order"] == 12
    assert first_row["segment_type"] == "M"
    assert first_row["sub_order"] == 1
    assert first_row["song_id"] == 301
    assert first_row["song_name"] == "Song 1"
    assert first_row["comments"] == ["短版", "翻唱"]
    assert first_row["cover_band"] is None
    assert first_row["other_members"] == [
        {"key": "嘉宾", "value": ["Ommy", "荒幡亮平"]},
        {"key": "键盘支援", "value": ["远程连线"]},
    ]

    first_row_bands = first_row["band_members"]
    assert first_row_bands[0]["band_name"] == "Poppin'Party"
    assert first_row_bands[0]["present_count"] == 5
    assert first_row_bands[0]["total_count"] == 5
    assert first_row_bands[0]["is_full"] is True
    assert first_row_bands[0]["attendance_status"] == "full"
    assert first_row_bands[0]["lineup_version"]["version_label"] == "Poppin'Party V1"
    assert first_row_bands[1]["band_name"] == "Afterglow"
    assert first_row_bands[1]["present_count"] == 4
    assert first_row_bands[1]["total_count"] == 6
    assert first_row_bands[1]["is_full"] is False
    assert first_row_bands[1]["attendance_status"] == "partial"
    assert first_row_bands[1]["missing_members"] == ["E", "F"]

    second_row = payload["detail_rows"][1]
    assert second_row["absolute_order"] == 13
    assert second_row["segment_type"] == "EN"
    assert second_row["song_id"] == 302
    assert second_row["comments"] == ["翻唱"]
    assert second_row["cover_band"] is None
    assert second_row["other_members"] == []
    assert second_row["band_members"] == []

    assert cursor.execute.call_args_list[0] == call(LIVE_DETAIL_HEADER_QUERY, (40,))
    assert cursor.execute.call_args_list[1] == call(LIVE_DETAIL_ROWS_QUERY, (40,))
    assert cursor.execute.call_args_list[2] == call(LIVE_DETAIL_PERFORMANCES_QUERY, ([40],))


# 测试点：单条与批量详情均按 Setlist UUID 隔离重复展示编号的出演关系。
@pytest.mark.parametrize("mode", ["single", "batch"])
def test_detail_entrypoints_isolate_duplicate_display_ids_by_setlist_id(mode):
    header_row = (
        90, "2026-08-09", "Duplicate M1 Live", "Venue", "17:00:00+09:00", "18:00:00+09:00",
        [6, 8], ["RAISE A SUILEN", "MyGO!!!!!"], None, "festival", None, None, None, None,
    )
    detail_rows = [
        ("M1", "RAS Song", None, False, False, 6, "RAISE A SUILEN", 1, "M", 1, 601, "setlist-ras"),
        ("M1", "MyGO Song", None, False, False, 8, "MyGO!!!!!", 2, "M", 1, 801, "setlist-mygo"),
    ]
    performance_rows = [
        (
            90, "M1", 6, "RAISE A SUILEN", "base", None, 61, "RAS V1",
            ["Raychell"], None, None, [], ["Raychell"], {}, "setlist-ras",
        ),
        (
            90, "M1", 8, "MyGO!!!!!", "base", None, 81, "MyGO V1",
            ["羊宮妃那"], None, None, [], ["羊宮妃那"], {}, "setlist-mygo",
        ),
    ]
    payload = _request_detail_for_mode(mode, header_row, detail_rows, performance_rows)
    rows = payload["detail_rows"]
    assert [(row["setlist_id"], row["row_id"]) for row in rows] == [
        ("setlist-ras", "M1"),
        ("setlist-mygo", "M1"),
    ]
    assert [[member["band_name"] for member in row["band_members"]] for row in rows] == [
        ["RAISE A SUILEN"],
        ["MyGO!!!!!"],
    ]


# 测试点：handover 可明确选择旧阵容为正式基准，并将新阵容新增成员分类为 incoming。
def test_get_live_detail_handover_returns_full_plus_and_incoming_member():
    header_row = (
        41,
        "2018-05-13",
        "Handover Live",
        "Venue",
        "17:00:00+09:00",
        "18:00:00+09:00",
        [4],
        ["Roselia"],
        None,
        "oneman",
        None,
        None,
        None,
        None,
    )
    detail_rows = [
        ("M1", "Handover Song", None, False, False),
    ]
    performance_rows = [
        (
            41, "M1", 4, "Roselia", "handover", "base", 21, "Roselia V1",
            ["A", "B", "C", "D", "E"], 22, "Roselia V2",
            ["A", "B", "C", "D", "F"], ["A", "B", "C", "D", "E", "F"], {},
        ),
    ]
    conn, _ = _build_detail_connection_mock(
        header_row,
        detail_rows,
        performance_rows,
    )

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/lives/41")

    assert response.status_code == 200
    member = response.json()["detail_rows"][0]["band_members"][0]
    assert member["attendance_status"] == "full_plus"
    assert member["expected_count"] == 5
    assert member["missing_members"] == []
    assert member["extra_members"] == [{"member_name": "F", "category": "incoming"}]
    assert member["lineup_usage"] == "handover"
    assert member["handover_baseline"] == "base"
    assert member["next_lineup_version"]["version_label"] == "Roselia V2"


# 测试点：handover 选择新阵容基准时，新成员计入正式阵容，仍出演的旧成员分类为 former。
def test_get_live_detail_handover_can_use_next_lineup_as_baseline():
    header_row = (
        42, "2018-05-13", "Handover Live", "Venue", "17:00:00+09:00", "18:00:00+09:00",
        [4], ["Roselia"], None, "oneman", None, None, None, None,
    )
    performance_rows = [
        (
            42, "M1", 4, "Roselia", "handover", "next", 21, "Roselia V1",
            ["A", "B", "C", "D", "E"], 22, "Roselia V2",
            ["A", "B", "C", "D", "F"], ["A", "B", "C", "D", "E", "F"], {},
        ),
    ]
    conn, _ = _build_detail_connection_mock(
        header_row,
        [("M1", "Handover Song", None, False, False)],
        performance_rows,
    )

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/lives/42")

    assert response.status_code == 200
    member = response.json()["detail_rows"][0]["band_members"][0]
    assert member["handover_baseline"] == "next"
    assert member["attendance_status"] == "full_plus"
    assert member["extra_members"] == [{"member_name": "E", "category": "former"}]


# 测试点：无 Setlist 的活动详情应回退默认 Band，并返回查询时计算 mode 的完整出席成员名单。
def test_get_live_detail_event_uses_default_bands_and_computed_attendees():
    header_row = (
        88,
        "2026-08-08",
        "Event Live",
        "活动会场",
        "12:00:00+09:00",
        "13:00:00+09:00",
        [3, 8],
        ["MyGO!!!!!", "Ave Mujica"],
        "https://example.com/live/88",
        "event",
        None,
        None,
        None,
        None,
        [
            {"band_id": 3, "band_name": "MyGO!!!!!", "mode": "partial", "members": ["高松燈"]},
            {
                "band_id": 8,
                "band_name": "Ave Mujica",
                "mode": "full",
                "members": ["三角初華", "若葉睦"],
            },
        ],
    )
    conn, _ = _build_detail_connection_mock(header_row, [], [])

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/lives/88")

    assert response.status_code == 200
    payload = response.json()
    assert payload["bands"] == [3, 8]
    assert payload["band_names"] == ["MyGO!!!!!", "Ave Mujica"]
    assert payload["event_attendees"] == [
        {"band_id": 3, "band_name": "MyGO!!!!!", "mode": "partial", "members": ["高松燈"]},
        {
            "band_id": 8,
            "band_name": "Ave Mujica",
            "mode": "full",
            "members": ["三角初華", "若葉睦"],
        },
    ]
    assert payload["detail_rows"] == []


def test_get_live_detail_not_found_returns_404():
    # 测试点：详情接口在 live_id 不存在时返回 404。
    conn, _ = _build_detail_connection_mock(None, [], [])

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/lives/999999")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


def test_get_live_detail_invalid_id_returns_400():
    # 测试点：live_id 非法时直接返回参数错误。
    client = TestClient(app)
    response = client.get("/api/lives/0")

    assert response.status_code == 400
    assert response.json()["detail"] == "live_id must be >= 1"


@pytest.mark.parametrize(
    ("exc", "expected_status", "expected_detail", "exact_match"),
    [
        (QueryCanceled("statement timeout"), 504, "Database query timeout", True),
        (OperationalError("timeout expired"), 504, "Database connection timeout", True),
        (Error("db down"), 500, "Database error", False),
    ],
)
def test_get_live_detail_db_errors_log_context(exc, expected_status, expected_detail, exact_match):
    # 测试点：get_live_detail 三类数据库异常都要记录 live_id 与 error_type。
    with patch("app.routers.lives.logger.exception") as logger_exception, patch(
        "app.routers.lives.get_db_connection", side_effect=exc
    ):
        client = TestClient(app)
        response = client.get("/api/lives/123")

    assert response.status_code == expected_status
    if exact_match:
        assert response.json()["detail"] == expected_detail
    else:
        assert expected_detail in response.json()["detail"]
    logger_exception.assert_called_once()
    assert logger_exception.call_args.args[0].startswith("get_live_detail failed")
    assert logger_exception.call_args.args[1] == 123
    assert logger_exception.call_args.args[2] == type(exc).__name__


# 测试点：单条与批量详情均排序乐队 ID，并保留查询层名称顺序及末尾的未映射名称。
@pytest.mark.parametrize("mode", ["single", "batch"])
def test_detail_entrypoints_preserve_band_name_order(mode):
    header_row = (
        88, "2026-03-28", "Live 88", "有明竞技场", "16:00:00+09:00", "17:00:00+09:00",
        [30, 10, 20], ["Band10", "Band20", "Band30", "未映射A", "未映射B"],
        "https://example.com/live/88", "oneman", None, None, None, None,
    )
    payload = _request_detail_for_mode(mode, header_row, [("M1", "Song 1", None, False, False)])
    assert payload["bands"] == [10, 20, 30]
    assert payload["band_names"] == ["Band10", "Band20", "Band30", "未映射A", "未映射B"]


# 测试点：两种详情入口保留 header 和行字段；旧短行或结构化行缺少版本化出演时成员均为空。
@pytest.mark.parametrize(
    ("mode", "venue", "url_query", "live_type", "detail_row", "expected_row_fields"),
    [
        pytest.param(
            "single", "K Arena Yokohama", "from=test", "festival",
            ("M1", "Song 1", None, False, False), {}, id="single-legacy-row",
        ),
        pytest.param(
            "batch", "幕张メッセ", "batch=true", "oneman",
            ("M1", "Song 1", None, False, False, 3, "Band3", 7, "M", 1, 9001),
            {"absolute_order": 7, "segment_type": "M", "song_id": 9001}, id="batch-structured-row",
        ),
    ],
)
def test_detail_entrypoints_without_versioned_performances(
    mode, venue, url_query, live_type, detail_row, expected_row_fields,
):
    url = f"https://example.com/live/66?{url_query}"
    header_row = (
        66, "2026-04-01", "Live 66", venue, "00:00:00+09:00", "23:59:00+09:00",
        [3, 1, 3, 2], ["Band1", "Band2", "Band3", "未映射"],
        url, live_type, None, None, None, None,
    )
    payload = _request_detail_for_mode(mode, header_row, [detail_row])
    assert payload["venue"] == venue
    assert payload["opening_time"] == "00:00:00+09:00"
    assert payload["start_time"] == "23:59:00+09:00"
    assert payload["url"] == url
    assert payload["bands"] == [1, 2, 3]
    assert payload["band_names"] == ["Band1", "Band2", "Band3", "未映射"]
    row = payload["detail_rows"][0]
    assert row["band_members"] == []
    for field, expected in expected_row_fields.items():
        assert row[field] == expected


def test_get_live_details_batch_success_and_partial_missing():
    # 测试点：批量详情应去重保序，并按各自行成员隔离计算旧翻唱与跨乐队翻唱。
    header_rows = [
        (1, "2026-03-28", "Live 1", "场馆 1", "16:30:00+09:00", "17:30:00+09:00", [1], ["Poppin'Party"], "https://example.com/live/1", "oneman", None, None, 7, "Group 7"),
        (2, "2026-03-27", "Live 2", "场馆 2", "17:00:00+09:00", "18:00:00+09:00", [2], ["Afterglow"], "https://example.com/live/2", "festival", None, None, None, None),
    ]
    detail_rows = [
        (
            2,
            "A1",
            "Song A",
            {"嘉宾": "Guest A"},
            True,
            True,
            1,
            "Poppin'Party",
        ),
        (
            1,
            "B1",
            "Song B",
            None,
            False,
            False,
            2,
            "Afterglow",
        ),
    ]
    performance_rows = [
        (
            2, "A1", 2, "Afterglow", "base", None, 12, "Afterglow V1",
            ["A", "B", "C", "D", "E", "F"], None, None, [], ["A", "B", "C", "D", "E"], {},
        ),
        (
            1, "B1", 1, "Poppin'Party", "base", None, 11, "Poppin'Party V1",
            ["A", "B", "C", "D", "E"], None, None, [], ["A", "B", "C", "D"], {},
        ),
    ]
    conn, cursor = _build_batch_detail_connection_mock(header_rows, detail_rows, performance_rows)

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post("/api/lives/details:batch", json={"live_ids": [2, 999, 2, 1]})

    assert response.status_code == 200
    payload = response.json()
    assert payload["missing_live_ids"] == [999]
    assert [item["live_id"] for item in payload["items"]] == [2, 1]

    first_item = payload["items"][0]
    assert first_item["venue"] == "场馆 2"
    assert first_item["opening_time"] == "17:00:00+09:00"
    assert first_item["start_time"] == "18:00:00+09:00"
    assert first_item["url"] == "https://example.com/live/2"
    assert payload["items"][1]["performance_group"] == {"group_id": 7, "group_title": "Group 7"}
    assert first_item["detail_rows"][0]["comments"] == ["短版", "翻唱"]
    assert first_item["detail_rows"][0]["cover_band"] is None
    assert first_item["detail_rows"][0]["other_members"] == [{"key": "嘉宾", "value": ["Guest A"]}]
    assert first_item["detail_rows"][0]["band_members"][0]["total_count"] == 6
    assert first_item["detail_rows"][0]["band_members"][0]["is_full"] is False
    assert first_item["detail_rows"][0]["band_members"][0]["attendance_status"] == "partial"
    second_item = payload["items"][1]
    assert second_item["detail_rows"][0]["comments"] == ["翻唱"]
    assert second_item["detail_rows"][0]["cover_band"] == {"band_id": 2, "band_name": "Afterglow"}

    assert cursor.execute.call_args_list[0] == call(BATCH_LIVE_DETAIL_HEADERS_QUERY, ([2, 999, 1],))
    assert cursor.execute.call_args_list[1] == call(BATCH_LIVE_DETAIL_ROWS_QUERY, ([2, 999, 1],))
    assert cursor.execute.call_args_list[2] == call(LIVE_DETAIL_PERFORMANCES_QUERY, ([2, 999, 1],))


def test_get_live_details_batch_invalid_live_id_returns_400():
    # 测试点：批量详情中的任一 live_id 非法时，接口应直接返回 400。
    client = TestClient(app)
    response = client.post("/api/lives/details:batch", json={"live_ids": [1, 0, 2]})

    assert response.status_code == 400
    assert response.json()["detail"] == "all live_ids must be >= 1"


def test_get_live_details_batch_empty_live_ids_returns_422():
    # 测试点：live_ids 为空数组应触发请求体验证错误（min_length=1）。
    client = TestClient(app)
    response = client.post("/api/lives/details:batch", json={"live_ids": []})

    assert response.status_code == 422


def test_get_live_details_batch_live_ids_over_limit_returns_422():
    # 测试点：live_ids 超过上限（100）应触发请求体验证错误（max_length=100）。
    client = TestClient(app)
    response = client.post("/api/lives/details:batch", json={"live_ids": list(range(1, 102))})

    assert response.status_code == 422


def test_get_live_details_batch_all_missing_returns_empty_items():
    # 测试点：当所有 live_id 都不存在时，items 为空且 missing_live_ids 返回去重后的请求顺序。
    conn, _ = _build_batch_detail_connection_mock([], [])

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post("/api/lives/details:batch", json={"live_ids": [999, 1000, 999]})

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"] == []
    assert payload["missing_live_ids"] == [999, 1000]


def test_get_live_details_batch_normalizes_other_members_without_legacy_band_data():
    # 测试点：批量接口只规范化 other_member，且不得从旧 Band JSON 合成出演。
    header_rows = [
        (1, "2026-03-28", "Live 1", "场馆 1", "16:30:00+09:00", "17:30:00+09:00", [1], ["Poppin'Party"], "https://example.com/live/1", "oneman", None, None, None, None),
    ]
    detail_rows = [
        (
            1,
            "M1",
            "Song X",
            {"嘉宾": "[\"Alice\", \"Bob\"]", "支援": "\"Solo\""},
            False,
            False,
        ),
    ]
    conn, _ = _build_batch_detail_connection_mock(header_rows, detail_rows)

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post("/api/lives/details:batch", json={"live_ids": [1]})

    assert response.status_code == 200
    payload = response.json()
    assert payload["missing_live_ids"] == []

    row = payload["items"][0]["detail_rows"][0]
    assert row["band_members"] == []
    other_member_map = {item["key"]: item["value"] for item in row["other_members"]}
    assert other_member_map["嘉宾"] == ["Alice", "Bob"]
    assert other_member_map["支援"] == ["Solo"]


@pytest.mark.parametrize(
    ("exc", "expected_status", "expected_detail", "exact_match"),
    [
        (QueryCanceled("statement timeout"), 504, "Database query timeout", True),
        (OperationalError("timeout expired"), 504, "Database connection timeout", True),
        (Error("db down"), 500, "Database error", False),
    ],
)
def test_get_live_details_batch_db_errors_log_context_and_deduped_count(
    exc, expected_status, expected_detail, exact_match
):
    # 测试点：batch 三类数据库异常都要记录 error_type，且 live_ids_count 取去重后的数量。
    with patch("app.routers.lives.logger.exception") as logger_exception, patch(
        "app.routers.lives.get_db_connection", side_effect=exc
    ):
        client = TestClient(app)
        response = client.post("/api/lives/details:batch", json={"live_ids": [1, 2, 2, 3]})

    assert response.status_code == expected_status
    if exact_match:
        assert response.json()["detail"] == expected_detail
    else:
        assert expected_detail in response.json()["detail"]
    logger_exception.assert_called_once()
    assert logger_exception.call_args.args[0].startswith("get_live_details_batch failed")
    assert logger_exception.call_args.args[1] == 3
    assert logger_exception.call_args.args[2] == type(exc).__name__
