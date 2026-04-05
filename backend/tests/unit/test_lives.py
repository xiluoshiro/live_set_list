from unittest.mock import MagicMock, call, patch

from fastapi.testclient import TestClient
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled

from app.main import app
from app.routers.lives import (
    BAND_ID_LOOKUP_QUERY,
    BATCH_LIVE_DETAIL_HEADERS_QUERY,
    BATCH_LIVE_DETAIL_ROWS_QUERY,
    LIVE_DETAIL_HEADER_QUERY,
    LIVE_DETAIL_ROWS_QUERY,
    LIVES_PAGE_QUERY,
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
    band_lookup_rows: list[tuple],
):
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = header_row
    cursor.fetchall.side_effect = [detail_rows, band_lookup_rows]
    return conn, cursor


def _build_batch_detail_connection_mock(
    header_rows: list[tuple],
    detail_rows: list[tuple],
):
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.side_effect = [header_rows, detail_rows]
    return conn, cursor


def test_get_lives_success_returns_items_and_pagination():
    # 测试点：正常请求时，返回 items 与 pagination，且字段映射符合接口契约。
    rows = [
        (1, "2026-03-28", "Title 1", [1, 2], None),
        (2, "2026-03-27", "Title 2", [], None),
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
            "bands": [1, 2],
            "url": None,
        },
        {
            "live_id": 2,
            "live_date": "2026-03-27",
            "live_title": "Title 2",
            "bands": [],
            "url": None,
        },
    ]
    assert cursor.execute.call_count == 2
    assert cursor.execute.call_args_list[1] == call(LIVES_PAGE_QUERY, (20, 0))


def test_get_lives_invalid_page_size_returns_400():
    # 测试点：page_size 非 15/20 时应返回 400 参数错误。
    client = TestClient(app)
    response = client.get("/api/lives?page=1&page_size=10")

    assert response.status_code == 400
    assert response.json()["detail"] == "page_size must be 15 or 20"


def test_get_lives_db_error_returns_500():
    # 测试点：数据库异常时应返回 500，避免服务静默失败。
    with patch("app.routers.lives.get_db_connection", side_effect=Error("db down")):
        client = TestClient(app)
        response = client.get("/api/lives?page=1&page_size=20")

    assert response.status_code == 500
    assert "Database error" in response.json()["detail"]


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
    # 测试点：详情接口正确映射 band_members/other_members/comments，并应用 is_full>=5 规则。
    header_row = (40, "2026-03-28", "Live 40", [1, 2], ["Poppin'Party", "Afterglow"], None)
    detail_rows = [
        (
            "M1",
            "Song 1",
            {"Poppin'Party": ["A", "B", "C", "D", "E"], "Afterglow": ["A", "B", "C", "D"]},
            {"键盘支援": "远程连线", "嘉宾": "[\"Ommy\", \"荒幡亮平\"]"},
            True,
        ),
        ("EN1", "Song 2", {"Unknown Band": ["Solo"]}, None, False),
    ]
    band_lookup_rows = [(1, "Poppin'Party"), (2, "Afterglow")]
    conn, cursor = _build_detail_connection_mock(header_row, detail_rows, band_lookup_rows)

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/lives/40")

    assert response.status_code == 200
    payload = response.json()

    assert payload["live_id"] == 40
    assert payload["live_title"] == "Live 40"
    assert payload["bands"] == [1, 2]
    assert payload["band_names"] == ["Poppin'Party", "Afterglow"]
    assert payload["url"] is None
    assert len(payload["detail_rows"]) == 2

    first_row = payload["detail_rows"][0]
    assert first_row["row_id"] == "M1"
    assert first_row["song_name"] == "Song 1"
    assert first_row["comments"] == ["短版"]
    assert first_row["other_members"] == [
        {"key": "嘉宾", "value": ["Ommy", "荒幡亮平"]},
        {"key": "键盘支援", "value": ["远程连线"]},
    ]

    first_row_bands = first_row["band_members"]
    assert first_row_bands[0]["band_name"] == "Poppin'Party"
    assert first_row_bands[0]["present_count"] == 5
    assert first_row_bands[0]["total_count"] == 5
    assert first_row_bands[0]["is_full"] is True
    assert first_row_bands[1]["band_name"] == "Afterglow"
    assert first_row_bands[1]["present_count"] == 4
    assert first_row_bands[1]["is_full"] is False

    second_row = payload["detail_rows"][1]
    assert second_row["comments"] == []
    assert second_row["other_members"] == []
    assert second_row["band_members"][0]["band_id"] is None
    assert second_row["band_members"][0]["is_full"] is False

    assert cursor.execute.call_args_list[0] == call(LIVE_DETAIL_HEADER_QUERY, (40,))
    assert cursor.execute.call_args_list[1] == call(LIVE_DETAIL_ROWS_QUERY, (40,))
    assert cursor.execute.call_args_list[2] == call(BAND_ID_LOOKUP_QUERY, (["Afterglow", "Poppin'Party", "Unknown Band"],))


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


def test_get_live_detail_band_names_follow_bands_and_put_unmapped_last():
    # 测试点：band_names 顺序与 bands（band_id 升序）一致，未映射 band_id 的名称置于末尾。
    header_row = (
        88,
        "2026-03-28",
        "Live 88",
        [30, 10, 20],
        ["未映射A", "Band20", "Band10", "未映射B", "Band30"],
        None,
    )
    detail_rows = [
        ("M1", "Song 1", {"Band30": ["A"], "Band10": ["B"], "Band20": ["C"]}, None, False),
    ]
    band_lookup_rows = [(10, "Band10"), (20, "Band20"), (30, "Band30")]
    conn, _ = _build_detail_connection_mock(header_row, detail_rows, band_lookup_rows)

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/lives/88")

    assert response.status_code == 200
    payload = response.json()
    assert payload["bands"] == [10, 20, 30]
    assert payload["band_names"] == ["Band10", "Band20", "Band30", "未映射A", "未映射B"]


def test_get_live_details_batch_success_and_partial_missing():
    # 测试点：批量详情接口应支持去重、保序、部分缺失，并一次性聚合返回详情。
    header_rows = [
        (1, "2026-03-28", "Live 1", [1], ["Poppin'Party"], None),
        (2, "2026-03-27", "Live 2", [2], ["Afterglow"], None),
    ]
    detail_rows = [
        (
            2,
            "A1",
            "Song A",
            [{"band_id": 2, "band_name": "Afterglow", "present_members": ["A", "B", "C", "D", "E"]}],
            {"嘉宾": "Guest A"},
            True,
        ),
        (
            1,
            "B1",
            "Song B",
            [{"band_id": 1, "band_name": "Poppin'Party", "present_members": ["A", "B", "C", "D"]}],
            None,
            False,
        ),
    ]
    conn, cursor = _build_batch_detail_connection_mock(header_rows, detail_rows)

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post("/api/lives/details:batch", json={"live_ids": [2, 999, 2, 1]})

    assert response.status_code == 200
    payload = response.json()
    assert payload["missing_live_ids"] == [999]
    assert [item["live_id"] for item in payload["items"]] == [2, 1]

    first_item = payload["items"][0]
    assert first_item["detail_rows"][0]["comments"] == ["短版"]
    assert first_item["detail_rows"][0]["other_members"] == [{"key": "嘉宾", "value": ["Guest A"]}]
    second_item = payload["items"][1]
    assert second_item["detail_rows"][0]["comments"] == []

    assert cursor.execute.call_args_list[0] == call(BATCH_LIVE_DETAIL_HEADERS_QUERY, ([2, 999, 1],))
    assert cursor.execute.call_args_list[1] == call(BATCH_LIVE_DETAIL_ROWS_QUERY, ([2, 999, 1],))


def test_get_live_details_batch_band_names_follow_bands_and_put_unmapped_last():
    # 测试点：批量详情中 band_names 也遵循 bands 升序，且未映射名称统一后置。
    header_rows = [
        (
            8,
            "2026-03-30",
            "Live 8",
            [30, 10, 20],
            ["未映射A", "Band20", "Band10", "未映射B", "Band30"],
            None,
        ),
    ]
    detail_rows = [
        (
            8,
            "A1",
            "Song A",
            [
                {"band_id": 20, "band_name": "Band20", "present_members": ["A"]},
                {"band_id": 30, "band_name": "Band30", "present_members": ["B"]},
                {"band_id": 10, "band_name": "Band10", "present_members": ["C"]},
            ],
            None,
            False,
        )
    ]
    conn, _ = _build_batch_detail_connection_mock(header_rows, detail_rows)

    with patch("app.routers.lives.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post("/api/lives/details:batch", json={"live_ids": [8]})

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["bands"] == [10, 20, 30]
    assert payload["items"][0]["band_names"] == ["Band10", "Band20", "Band30", "未映射A", "未映射B"]


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


def test_get_live_details_batch_query_timeout_returns_504():
    # 测试点：数据库查询超时（QueryCanceled）应映射为 504。
    with patch("app.routers.lives.get_db_connection", side_effect=QueryCanceled("statement timeout")):
        client = TestClient(app)
        response = client.post("/api/lives/details:batch", json={"live_ids": [1, 2]})

    assert response.status_code == 504
    assert response.json()["detail"] == "Database query timeout"


def test_get_live_details_batch_connection_timeout_returns_504():
    # 测试点：数据库连接超时（timeout expired）应映射为 504。
    with patch("app.routers.lives.get_db_connection", side_effect=OperationalError("timeout expired")):
        client = TestClient(app)
        response = client.post("/api/lives/details:batch", json={"live_ids": [1, 2]})

    assert response.status_code == 504
    assert response.json()["detail"] == "Database connection timeout"


def test_get_live_details_batch_db_error_returns_500():
    # 测试点：其他数据库异常应返回 500，且保留错误语义。
    with patch("app.routers.lives.get_db_connection", side_effect=Error("db down")):
        client = TestClient(app)
        response = client.post("/api/lives/details:batch", json={"live_ids": [1]})

    assert response.status_code == 500
    assert "Database error" in response.json()["detail"]


def test_get_live_details_batch_normalizes_band_and_other_members():
    # 测试点：批量接口应过滤非法 band_members 项，并规范化 other_members 字段。
    header_rows = [
        (1, "2026-03-28", "Live 1", [1], ["Poppin'Party"], None),
    ]
    detail_rows = [
        (
            1,
            "M1",
            "Song X",
            [
                123,
                {"band_id": "not-int", "band_name": "Afterglow", "present_members": "Ran"},
                {"band_id": 1, "band_name": None, "present_members": ["A", "B"]},
            ],
            {"嘉宾": "[\"Alice\", \"Bob\"]", "支援": "\"Solo\""},
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
    assert row["band_members"] == [
        {
            "band_id": None,
            "band_name": "Afterglow",
            "present_members": ["Ran"],
            "present_count": 1,
            "total_count": 5,
            "is_full": False,
        }
    ]
    other_member_map = {item["key"]: item["value"] for item in row["other_members"]}
    assert other_member_map["嘉宾"] == ["Alice", "Bob"]
    assert other_member_map["支援"] == ["Solo"]
