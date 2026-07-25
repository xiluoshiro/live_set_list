from unittest.mock import MagicMock, call, patch

from fastapi.testclient import TestClient

from app.main import app
from app.routers.tours import (
    TOUR_DETAIL_BANDS_QUERY,
    TOUR_DETAIL_HEADER_QUERY,
    TOUR_DETAIL_STOPS_QUERY,
    TOUR_STATISTICS_QUERY,
    _build_tour_list_queries,
)


def _build_connection_mock():
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn, cursor


# 测试点：巡演列表应返回聚合摘要，并按边界场次日期、开演时间、ID 排序分页。
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
                "cancelled_live_count": 0,
                "stop_labels": ["福冈公演", "FINAL DAY2"],
            }
        ],
        "pagination": {"page": 1, "page_size": 20, "total": 1, "total_pages": 1},
    }
    assert cursor.execute.call_args_list == [
        call(count_query, count_params),
        call(page_query, (*page_params, 20, 0)),
    ]
    assert "ORDER BY boundary_live.live_date DESC, boundary_live.start_time DESC, t.id DESC" in page_query
    assert "ORDER BY summary.end_date DESC, summary.end_time DESC, summary.tour_id DESC" in page_query


# 测试点：巡演升序筛选必须参数化，并按第一场日期、开演时间、ID 排序。
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
    page_query = str(cursor.execute.call_args_list[1].args[0])
    assert "ORDER BY boundary_live.live_date ASC, boundary_live.start_time ASC, t.id ASC" in page_query
    assert "ORDER BY summary.start_date ASC, summary.start_time ASC, summary.tour_id ASC" in page_query


# 测试点：巡演详情应保持活动组连续，并在同日起始时把含取消场次的组排在正常组之前。
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
    assert "block_has_cancelled DESC" in TOUR_DETAIL_STOPS_QUERY
    assert "(event_status = 'cancelled') DESC" in TOUR_DETAIL_STOPS_QUERY


# 测试点：不存在的巡演 ID 应返回 404，而不是伪装成空详情。
def test_get_tour_detail_not_found_returns_404():
    conn, cursor = _build_connection_mock()
    cursor.fetchone.return_value = None

    with patch("app.routers.tours.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/tours/999")

    assert response.status_code == 404
    assert response.json()["detail"] == "Tour id 999 not found"


# 测试点：巡演统计按相邻场次的相同段落位置识别替换，并区分未配对的新增和移除歌曲。
def test_get_tour_statistics_compares_adjacent_setlists():
    conn, cursor = _build_connection_mock()
    cursor.fetchall.return_value = [
        (45, "2026-04-17", "Exitus 福冈", 1, "Song A", "main", 1, 1, False),
        (45, "2026-04-17", "Exitus 福冈", 2, "Song B", "main", 2, 2, False),
        (53, "2026-06-20", "Exitus FINAL", 3, "Song C", "main", 1, 1, False),
        (53, "2026-06-20", "Exitus FINAL", 4, "Song D", "encore", 1, 2, False),
    ]

    with patch("app.routers.tours.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/tours/7/statistics")

    assert response.status_code == 200
    payload = response.json()
    assert payload["coverage"] == {
        "stop_count": 2,
        "setlist_stop_count": 2,
        "comparable_transition_count": 1,
    }
    assert payload["overview"] == {"distinct_song_count": 4, "common_song_count": 0}
    transition = payload["transitions"][0]
    assert transition["replacements"][0]["from_song"]["song_id"] == 1
    assert transition["replacements"][0]["to_song"]["song_id"] == 3
    assert [song["song_id"] for song in transition["removed_songs"]] == [2]
    assert [song["song_id"] for song in transition["added_songs"]] == [4]
    assert cursor.execute.call_args_list == [call(TOUR_STATISTICS_QUERY, (7,))]


# 测试点：取消或无 Setlist 的中间场次不能截断有效场次链，前后正常场次仍应形成相邻比较。
def test_get_tour_statistics_reconnects_comparable_stops_across_cancelled_stops():
    conn, cursor = _build_connection_mock()
    cursor.fetchall.return_value = [
        (40, "2026-01-16", "大阪追加公演 DAY1", 1, "Song A", "main", 1, 1, False, "scheduled"),
        (296, "2026-01-16", "上海公演 DAY1", None, None, None, None, None, False, "cancelled"),
        (41, "2026-01-17", "大阪追加公演 DAY2", 1, "Song A", "main", 1, 1, False, "scheduled"),
        (297, "2026-01-17", "上海公演 DAY2", None, None, None, None, None, False, "cancelled"),
        (77, "2026-02-14", "東京公演 DAY1", 2, "Song B", "main", 1, 1, False, "scheduled"),
    ]

    with patch("app.routers.tours.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/tours/9/statistics")

    assert response.status_code == 200
    payload = response.json()
    assert payload["coverage"] == {
        "stop_count": 5,
        "setlist_stop_count": 3,
        "comparable_transition_count": 2,
    }
    assert [
        (transition["from_live_id"], transition["to_live_id"])
        for transition in payload["transitions"]
    ] == [(40, 41), (41, 77)]
    assert "l.event_status <> 'cancelled'" in TOUR_STATISTICS_QUERY


# 测试点：任意场次接口按请求的起始和目标方向比较，而不是强制改回时间顺序。
def test_get_tour_statistics_comparison_preserves_requested_direction():
    conn, cursor = _build_connection_mock()
    cursor.fetchall.return_value = [
        (45, "2026-04-17", "Exitus 福冈", 1, "Song A", "main", 1, 1, False),
        (45, "2026-04-17", "Exitus 福冈", 2, "Song B", "main", 2, 2, False),
        (53, "2026-06-20", "Exitus FINAL", 1, "Song A", "main", 1, 1, False),
        (53, "2026-06-20", "Exitus FINAL", 3, "Song C", "main", 2, 2, False),
    ]

    with patch("app.routers.tours.get_db_connection", return_value=conn):
        response = TestClient(app).get(
            "/api/catalog/tours/7/statistics/comparison?from_live_id=53&to_live_id=45"
        )

    assert response.status_code == 200
    transition = response.json()
    assert transition["from_live_id"] == 53
    assert transition["to_live_id"] == 45
    assert [song["song_id"] for song in transition["added_songs"]] == []
    assert [song["song_id"] for song in transition["removed_songs"]] == []
    assert transition["replacements"][0]["from_song"]["song_id"] == 3
    assert transition["replacements"][0]["to_song"]["song_id"] == 2


# 测试点：顺序变化应优先于位置更换，并按前一场歌单顺序而非 song_id 排列。
def test_get_tour_statistics_prefers_movement_over_replacement():
    conn, cursor = _build_connection_mock()
    cursor.fetchall.return_value = [
        (45, "2026-04-17", "Exitus 福冈", 20, "Song A", "main", 1, 1, False),
        (45, "2026-04-17", "Exitus 福冈", 10, "Song B", "main", 2, 2, False),
        (53, "2026-06-20", "Exitus FINAL", 10, "Song B", "main", 1, 1, False),
        (53, "2026-06-20", "Exitus FINAL", 20, "Song A", "main", 2, 2, False),
    ]

    with patch("app.routers.tours.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/tours/7/statistics")

    assert response.status_code == 200
    transition = response.json()["transitions"][0]
    assert transition["replacements"] == []
    assert [song["song_id"] for song in transition["moved_songs"]] == [20, 10]
    assert transition["added_songs"] == []
    assert transition["removed_songs"] == []


# 测试点：显式参与乐队过滤后应按剩余歌曲重新编号，忽略开场乐队造成的整体绝对序号偏移。
def test_get_tour_statistics_uses_filtered_order_for_explicit_bands():
    conn, cursor = _build_connection_mock()
    cursor.fetchall.return_value = [
        (13, "2024-12-14", "Stille Nacht", 20, "Song A", "M", 1, 6, True),
        (13, "2024-12-14", "Stille Nacht", 10, "Song B", "M", 2, 7, True),
        (17, "2025-02-15", "上海追加公演", 20, "Song A", "M", 1, 1, True),
        (17, "2025-02-15", "上海追加公演", 10, "Song B", "M", 2, 2, True),
    ]

    with patch("app.routers.tours.get_db_connection", return_value=conn):
        response = TestClient(app).get("/api/catalog/tours/6/statistics")

    assert response.status_code == 200
    transition = response.json()["transitions"][0]
    assert transition["replacements"] == []
    assert transition["moved_songs"] == []
    assert transition["added_songs"] == []
    assert transition["removed_songs"] == []
