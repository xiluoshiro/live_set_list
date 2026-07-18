from unittest.mock import MagicMock, call, patch

from fastapi.testclient import TestClient

from app.main import app
from app.routers.tours import (
    TOUR_DETAIL_BANDS_QUERY,
    TOUR_DETAIL_HEADER_QUERY,
    TOUR_DETAIL_STOPS_QUERY,
    _build_tour_list_queries,
)


def _build_connection_mock():
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn, cursor


# 测试点：巡演列表应返回聚合日期、显式乐队、场次标签和统一分页结构。
def test_get_tours_returns_public_summaries():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (1,)
    cursor.fetchall.return_value = [
        (
            7,
            "Ave Mujica LIVE TOUR 2026「Exitus」",
            "https://example.com/tours/7",
            None,
            [{"band_id": 9, "band_name": "Ave Mujica", "band_abbr": "AM"}],
            "2026-04-17",
            "2026-06-20",
            6,
            ["福冈公演", "FINAL DAY2"],
        )
    ]
    count_query, count_params, page_query, page_params = _build_tour_list_queries(
        query=None,
        year=None,
        band_id=None,
        sort="date_desc",
    )

    with patch("app.routers.tours.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/tours?page=1&page_size=20")

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "tour_id": 7,
                "tour_title": "Ave Mujica LIVE TOUR 2026「Exitus」",
                "url": "https://example.com/tours/7",
                "description": None,
                "bands": [{"band_id": 9, "band_name": "Ave Mujica", "band_abbr": "AM"}],
                "start_date": "2026-04-17",
                "end_date": "2026-06-20",
                "collected_live_count": 6,
                "stop_labels": ["福冈公演", "FINAL DAY2"],
            }
        ],
        "pagination": {"page": 1, "page_size": 20, "total": 1, "total_pages": 1},
    }
    assert cursor.execute.call_args_list == [
        call(count_query, count_params),
        call(page_query, (*page_params, 20, 0)),
    ]


# 测试点：巡演筛选必须参数化，并把关键词通配符按字面量转义。
def test_get_tours_binds_keyword_year_and_band_filters():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (0,)
    cursor.fetchall.return_value = []

    with patch("app.routers.tours.get_db_connection", return_value=conn):
        response = TestClient(app).get(
            "/api/catalog/tours",
            params={"q": r"100%_Tour\\", "year": 2026, "band_id": 9, "sort": "date_asc"},
        )

    assert response.status_code == 200
    count_params = cursor.execute.call_args_list[0].args[1]
    assert count_params[:3] == (r"%100\%\_Tour\\\\%",) * 3
    assert str(count_params[3]) == "2026-01-01"
    assert str(count_params[4]) == "2027-01-01"
    assert count_params[5:] == (9, 9, 9)


# 测试点：巡演详情应按人工顺序返回场次，并保留单场 setlist 与收藏语义。
def test_get_tour_detail_returns_ordered_stops():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = (
        7,
        "Ave Mujica LIVE TOUR 2026「Exitus」",
        "https://example.com/tours/7",
        None,
        "2026-04-17",
        "2026-06-20",
        2,
        ["福冈公演", "FINAL DAY2"],
    )
    cursor.fetchall.side_effect = [
        [(9, "Ave Mujica", "AM")],
        [
            (1, "福冈公演", 45, "2026-04-17", "Exitus 福冈", "oneman", "Zepp Fukuoka", [9], None, True),
            (2, "FINAL DAY2", 53, "2026-06-20", "Exitus FINAL", "oneman", "SGC HALL", [9], None, True),
        ],
    ]

    with patch("app.routers.tours.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/tours/7")

    assert response.status_code == 200
    payload = response.json()
    assert [stop["live_id"] for stop in payload["stops"]] == [45, 53]
    assert payload["stops"][0]["is_favorite"] is False
    assert payload["stops"][0]["has_setlist"] is True
    assert cursor.execute.call_args_list == [
        call(TOUR_DETAIL_HEADER_QUERY, (7,)),
        call(TOUR_DETAIL_BANDS_QUERY, (7, 7, 7, 7)),
        call(TOUR_DETAIL_STOPS_QUERY, (7,)),
    ]


# 测试点：不存在的巡演 ID 应返回 404，而不是伪装成空详情。
def test_get_tour_detail_not_found_returns_404():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = None

    with patch("app.routers.tours.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/tours/999")

    assert response.status_code == 404
    assert response.json()["detail"] == "Tour id 999 not found"
