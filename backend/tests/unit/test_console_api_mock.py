import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, call, patch

import pytest
from fastapi.testclient import TestClient
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled, UniqueViolation

from app.auth import AuthSessionContext, AuthUser, get_current_auth_context, get_current_user
from app.band_history_write import PersistedLineupContext
from app.main import app


CSRF_TOKEN = "csrf-token"


@pytest.fixture(autouse=True)
def _clear_dependency_overrides():
    """Keep FastAPI dependency overrides isolated between mock console API tests."""
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


def _csrf_hash(token: str = CSRF_TOKEN) -> str:
    """Build the same CSRF hash shape used by the auth layer for mock contexts."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _make_user(role: str = "editor") -> AuthUser:
    """Create a role-specific authenticated user for FastAPI dependency overrides."""
    return AuthUser(id=42, username=f"{role}_user", display_name=f"{role.title()} User", role=role, is_active=True)


def _make_context(role: str = "editor") -> AuthSessionContext:
    """Create an authenticated session context with a valid CSRF hash for write calls."""
    return AuthSessionContext(
        session_id=7,
        user=_make_user(role),
        csrf_token_hash=_csrf_hash(),
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )


def _set_authenticated_role(role: str = "editor") -> None:
    """Override auth dependencies so mock tests can exercise role-specific HTTP behavior."""
    user = _make_user(role)
    context = AuthSessionContext(
        session_id=7,
        user=user,
        csrf_token_hash=_csrf_hash(),
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_auth_context] = lambda: context


def _build_connection_mock(
    *,
    fetchone_side_effect: list[tuple | None] | None = None,
    fetchall_side_effect: list[list[tuple]] | None = None,
) -> tuple[MagicMock, MagicMock]:
    """Create a context-manager DB connection mock with configurable cursor reads."""
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.side_effect = fetchone_side_effect or []
    cursor.fetchall.side_effect = fetchall_side_effect or []
    return conn, cursor


def _valid_song_payload(**overrides):
    """Return a minimal valid song-create request body with optional field overrides."""
    payload = {"song_name": "Mock Song", "band_id": 1, "cover": False}
    payload.update(overrides)
    return payload


def _valid_live_payload(**overrides):
    """Return a minimal valid live-create request body with optional field overrides."""
    payload = {
        "live_date": "2026-05-29",
        "live_title": "Mock Live",
        "live_type": "oneman",
        "url": "https://example.com/mock-live",
        "opening_time": "18:00",
        "start_time": "19:00:30",
        "timezone": "+09:00",
        "venue_id": 2,
    }
    payload.update(overrides)
    return payload


def _valid_venue_payload(**overrides):
    """Return a minimal valid venue-create request body with optional field overrides."""
    payload = {"venue_name": "Mock Venue"}
    payload.update(overrides)
    return payload


def _valid_band_payload(**overrides):
    """Return a minimal valid Band-create request body with optional field overrides."""
    payload = {
        "id_range": "regular",
        "band_name": "Mock Band",
        "band_abbr": "mock",
        "members": ["Member A"],
        "valid_from": None,
    }
    payload.update(overrides)
    return payload


def _valid_setlist_payload(**row_overrides):
    """Return a minimal valid setlist append request body with optional first-row overrides."""
    row = {
        "song_id": 1,
        "absolute_order": 3,
        "segment_type": "EN",
        "sub_order": 1,
        "is_short": False,
        "band_performances": [
            {
                "band_id": 1,
                "lineup_usage": "base",
                "handover_baseline": None,
                "members": ["Kasumi", "Tae"],
            }
        ],
        "other_member": {},
        "comment": "mock encore",
    }
    row.update(row_overrides)
    return {"setlist_rows": [row]}


# 测试点：console 只读查询接口在未登录和低权限时应被后端拒绝。
def test_console_lookup_mock_requires_authenticated_editor_role():
    client = TestClient(app)

    anonymous_response = client.get("/api/console/songs")
    _set_authenticated_role("viewer")
    viewer_response = client.get("/api/console/songs")

    assert anonymous_response.status_code == 401
    assert anonymous_response.json()["detail"]["code"] == "AUTH_SESSION_EXPIRED"
    assert viewer_response.status_code == 403
    assert viewer_response.json()["detail"]["code"] == "AUTH_FORBIDDEN"


# 测试点：console 只读查询接口不需要 CSRF，歌曲结果应同时返回服务端分页信息。
def test_console_lookup_mock_returns_items_without_csrf_for_editor():
    _set_authenticated_role("editor")
    songs_conn, _ = _build_connection_mock(
        fetchone_side_effect=[(1,)],
        fetchall_side_effect=[[(1, "Yes! BanG_Dream!", 1, False, "Poppin'Party")]],
    )
    bands_conn, _ = _build_connection_mock(
        fetchall_side_effect=[[(2, "Roselia", "rsl", ["Yukina", "Sayo"])]],
    )
    venues_conn, _ = _build_connection_mock(
        fetchall_side_effect=[[(3, "Zepp Shinjuku")]],
    )

    with patch("app.routers.console_read.get_db_connection", side_effect=[songs_conn, bands_conn, venues_conn]):
        client = TestClient(app)
        songs_response = client.get("/api/console/songs?q=BanG&limit=10&page=1")
        bands_response = client.get("/api/console/bands?q=rsl&limit=10")
        venues_response = client.get("/api/console/venues?q=Zepp&limit=10")

    assert songs_response.status_code == 200
    assert songs_response.json() == {
        "items": [
            {
                "song_id": 1,
                "song_name": "Yes! BanG_Dream!",
                "band_id": 1,
                "cover": False,
                "band_name": "Poppin'Party",
            }
        ],
        "page": 1,
        "page_size": 10,
        "total": 1,
        "total_pages": 1,
    }
    assert bands_response.status_code == 200
    assert bands_response.json() == {
        "items": [{"band_id": 2, "band_name": "Roselia", "band_abbr": "rsl", "band_members": ["Yukina", "Sayo"]}],
    }
    assert venues_response.status_code == 200
    assert venues_response.json() == {"items": [{"venue_id": 3, "venue_name": "Zepp Shinjuku"}]}


# 测试点：console 只读查询接口在无匹配结果时应返回空 items，而不是报错。
def test_console_lookup_mock_returns_empty_items_for_no_match():
    _set_authenticated_role("admin")
    conn, _ = _build_connection_mock(fetchall_side_effect=[[]])

    with patch("app.routers.console_read.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/console/venues?q=not-found")

    assert response.status_code == 200
    assert response.json() == {"items": []}


# 测试点：Live 编辑候选必须支持类型筛选和分页，并能加载带计算 mode 的完整编辑数据。
def test_console_live_edit_reads_candidates_and_detail():
    _set_authenticated_role("editor")
    candidates_conn, candidates_cursor = _build_connection_mock(
        fetchone_side_effect=[(1,)],
        fetchall_side_effect=[[(55, "2026-07-05", "Event Live", "event", "Mock Venue")]],
    )
    detail_conn, _ = _build_connection_mock(
        fetchone_side_effect=[(
            55,
            "2026-07-05",
            "Event Live",
            "event",
            "https://example.com/event",
            "09:00:00+09",
            "21:30:00+09",
            2,
            "Mock Venue",
            [3],
            [{"band_id": 3, "mode": "full", "members": ["高松燈", "千早愛音"]}],
        )],
    )

    with patch("app.routers.console_read.get_db_connection", side_effect=[candidates_conn, detail_conn]):
        client = TestClient(app)
        candidates_response = client.get("/api/console/lives?q=55&live_type=event&page=1&page_size=20")
        detail_response = client.get("/api/console/lives/55")

    assert candidates_response.status_code == 200
    assert candidates_response.json() == {
        "items": [{
            "live_id": 55,
            "live_date": "2026-07-05",
            "live_title": "Event Live",
            "live_type": "event",
            "venue_name": "Mock Venue",
            "event_status": "scheduled",
            "date_phase": "past",
        }],
        "page": 1,
        "page_size": 20,
        "total": 1,
        "total_pages": 1,
    }
    assert detail_response.status_code == 200
    assert candidates_cursor.execute.call_args_list[0].args[1] == ("%55%", "55", "event")
    assert detail_response.json()["item"]["timezone"] == "+09:00"
    assert detail_response.json()["item"]["event_attendees"] == [
        {"band_id": 3, "mode": "full", "members": ["高松燈", "千早愛音"]}
    ]


# 测试点：console 只读查询接口应拒绝非法 limit 或页码，避免无界或无效查询。
@pytest.mark.parametrize(
    "path",
    [
        "/api/console/songs?limit=0",
        "/api/console/bands?limit=-1",
        "/api/console/venues?limit=101",
        "/api/console/songs?limit=abc",
        "/api/console/songs?page=0",
    ],
)
def test_console_lookup_mock_rejects_invalid_limit(path: str):
    _set_authenticated_role("editor")

    client = TestClient(app)
    response = client.get(path)

    assert response.status_code == 422


# 测试点：console 只读查询接口应把数据库超时和一般错误映射为稳定错误响应。
@pytest.mark.parametrize(
    ("exc", "expected_status", "expected_detail"),
    [
        (QueryCanceled("statement timeout"), 504, "Database query timeout"),
        (OperationalError("timeout expired"), 504, "Database connection timeout"),
        (Error("db down"), 500, "Database error"),
    ],
)
def test_console_lookup_mock_surfaces_database_errors(exc: Exception, expected_status: int, expected_detail: str):
    _set_authenticated_role("editor")

    with patch("app.routers.console_read.get_db_connection", side_effect=exc):
        client = TestClient(app)
        response = client.get("/api/console/songs")

    assert response.status_code == expected_status
    assert expected_detail in response.json()["detail"]


# 测试点：console 插入接口在未登录和低权限时应被后端拒绝。
@pytest.mark.parametrize(
    ("method", "path", "json_body"),
    [
        ("post", "/api/console/bands", _valid_band_payload()),
        ("post", "/api/console/songs", _valid_song_payload()),
        ("post", "/api/console/venues", _valid_venue_payload()),
        ("post", "/api/console/lives", _valid_live_payload()),
        ("put", "/api/console/lives/1", _valid_live_payload()),
        ("post", "/api/console/lives/1/setlist", _valid_setlist_payload()),
    ],
)
def test_console_insert_mock_requires_authenticated_editor_role(method: str, path: str, json_body: dict):
    client = TestClient(app)
    anonymous_response = getattr(client, method)(path, json=json_body, headers={"X-CSRF-Token": CSRF_TOKEN})
    _set_authenticated_role("viewer")
    viewer_response = getattr(client, method)(path, json=json_body, headers={"X-CSRF-Token": CSRF_TOKEN})

    assert anonymous_response.status_code == 401
    assert anonymous_response.json()["detail"]["code"] == "AUTH_SESSION_EXPIRED"
    assert viewer_response.status_code == 403
    assert viewer_response.json()["detail"]["code"] == "AUTH_FORBIDDEN"


# 测试点：console 插入接口必须校验 CSRF token，缺失或错误 token 都应拒绝。
@pytest.mark.parametrize(
    ("path", "json_body"),
    [
        ("/api/console/bands", _valid_band_payload()),
        ("/api/console/songs", _valid_song_payload()),
        ("/api/console/venues", _valid_venue_payload()),
        ("/api/console/lives", _valid_live_payload()),
        ("/api/console/lives/1/setlist", _valid_setlist_payload()),
    ],
)
def test_console_insert_mock_requires_valid_csrf(path: str, json_body: dict):
    _set_authenticated_role("editor")

    client = TestClient(app)
    missing_response = client.post(path, json=json_body)
    invalid_response = client.post(path, json=json_body, headers={"X-CSRF-Token": "wrong-token"})

    assert missing_response.status_code == 403
    assert missing_response.json()["detail"]["code"] == "AUTH_CSRF_INVALID"
    assert invalid_response.status_code == 403
    assert invalid_response.json()["detail"]["code"] == "AUTH_CSRF_INVALID"


# 测试点：Live 更新与其他控制台写接口一样必须拒绝缺失或错误的 CSRF token。
def test_console_update_live_mock_requires_valid_csrf():
    _set_authenticated_role("editor")
    client = TestClient(app)

    missing_response = client.put("/api/console/lives/1", json=_valid_live_payload())
    invalid_response = client.put(
        "/api/console/lives/1",
        json=_valid_live_payload(),
        headers={"X-CSRF-Token": "wrong-token"},
    )

    assert missing_response.status_code == 403
    assert missing_response.json()["detail"]["code"] == "AUTH_CSRF_INVALID"
    assert invalid_response.status_code == 403
    assert invalid_response.json()["detail"]["code"] == "AUTH_CSRF_INVALID"


# 测试点：console 插入接口应通过请求 schema 拒绝缺失字段、错误类型和非法边界值。
@pytest.mark.parametrize(
    ("path", "json_body"),
    [
        ("/api/console/bands", _valid_band_payload(id_range="unknown")),
        ("/api/console/bands", _valid_band_payload(members=[])),
        ("/api/console/songs", {}),
        ("/api/console/songs", _valid_song_payload(song_name="   ")),
        ("/api/console/songs", _valid_song_payload(cover="not-bool")),
        ("/api/console/venues", {}),
        ("/api/console/venues", _valid_venue_payload(venue_name="   ")),
        ("/api/console/lives", {}),
        ("/api/console/lives", _valid_live_payload(live_date="not-date")),
        ("/api/console/lives", _valid_live_payload(live_type="")),
        ("/api/console/lives", _valid_live_payload(live_type="invalid  ")),
        ("/api/console/lives", _valid_live_payload(live_type="   ")),
        ("/api/console/lives", _valid_live_payload(live_type="专场")),
        ("/api/console/lives", _valid_live_payload(venue_id=0)),
        ("/api/console/lives/1/setlist", {}),
        ("/api/console/lives/1/setlist", {"setlist_rows": []}),
        ("/api/console/lives/1/setlist", _valid_setlist_payload(song_id=0)),
        ("/api/console/lives/1/setlist", _valid_setlist_payload(absolute_order=0)),
        ("/api/console/lives/1/setlist", _valid_setlist_payload(band_member={})),
    ],
)
def test_console_insert_mock_rejects_schema_invalid_payloads(path: str, json_body: dict):
    _set_authenticated_role("editor")

    client = TestClient(app)
    response = client.post(path, json=json_body, headers={"X-CSRF-Token": CSRF_TOKEN})

    assert response.status_code == 422


# 测试点：新增歌曲允许使用 id=0 的 Other bands 作为归属乐队。
def test_console_create_song_mock_accepts_other_bands_id_zero():
    _set_authenticated_role("editor")
    conn, cursor = _build_connection_mock(fetchone_side_effect=[(1,), (99,)])

    with patch("app.routers.console_write.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post(
            "/api/console/songs",
            json=_valid_song_payload(song_name="Other Band Cover", band_id=0, cover=True),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 201
    assert response.json()["item"] == {
        "song_id": 99,
        "song_name": "Other Band Cover",
        "band_id": 0,
        "cover": True,
    }
    assert cursor.execute.call_args_list[1] == call(
        """
                    INSERT INTO song_list (song_name, band_id, is_cover)
                    VALUES (%s, %s, %s)
                    RETURNING id
                    """,
        ("Other Band Cover", 0, True),
    )


# 测试点：新增歌曲成功时应返回创建结果，并写入歌曲行和审计日志。
def test_console_create_song_mock_success_persists_and_audits():
    _set_authenticated_role("editor")
    conn, cursor = _build_connection_mock(fetchone_side_effect=[(1,), (99,)])

    with patch("app.routers.console_write.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post(
            "/api/console/songs",
            json=_valid_song_payload(song_name="FIRE BIRD", band_id=2, cover=True),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 201
    assert response.json() == {
        "ok": True,
        "item": {"song_id": 99, "song_name": "FIRE BIRD", "band_id": 2, "cover": True},
    }
    assert cursor.execute.call_count == 3
    assert "INSERT INTO song_list" in cursor.execute.call_args_list[1].args[0]
    assert "INSERT INTO audit_logs" in cursor.execute.call_args_list[2].args[0]


# 测试点：新增歌曲应区分关联 band 不存在和歌曲唯一键冲突。
def test_console_create_song_mock_business_errors():
    _set_authenticated_role("editor")
    missing_band_conn, _ = _build_connection_mock(fetchone_side_effect=[None])

    duplicate_conn, duplicate_cursor = _build_connection_mock(fetchone_side_effect=[(1,)])

    def duplicate_execute(query: str, params=None):
        if "INSERT INTO song_list" in query:
            raise UniqueViolation("duplicate song")

    duplicate_cursor.execute.side_effect = duplicate_execute

    with patch("app.routers.console_write.get_write_db_connection", return_value=missing_band_conn):
        client = TestClient(app)
        missing_band_response = client.post(
            "/api/console/songs",
            json=_valid_song_payload(band_id=999),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    with patch("app.routers.console_write.get_write_db_connection", return_value=duplicate_conn):
        duplicate_response = client.post(
            "/api/console/songs",
            json=_valid_song_payload(song_name="Yes! BanG_Dream!"),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert missing_band_response.status_code == 404
    assert missing_band_response.json()["detail"] == "Band id 999 not found"
    assert duplicate_response.status_code == 409
    assert duplicate_response.json()["detail"] == "Song name already exists: Yes! BanG_Dream!"


# 测试点：歌曲管理更新会写入三个可编辑属性，并记录 song_update 审计。
def test_console_update_song_mock_success_persists_and_audits():
    _set_authenticated_role("editor")
    conn, cursor = _build_connection_mock(fetchone_side_effect=[(1,), (99,)])

    with patch("app.routers.console_write.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.put(
            "/api/console/songs/99",
            json=_valid_song_payload(song_name="Updated Song", band_id=2, cover=True),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 200
    assert response.json()["item"] == {
        "song_id": 99,
        "song_name": "Updated Song",
        "band_id": 2,
        "cover": True,
    }
    assert "UPDATE song_list" in cursor.execute.call_args_list[1].args[0]
    assert cursor.execute.call_args_list[1].args[1] == ("Updated Song", 2, True, 99)
    assert "INSERT INTO audit_logs" in cursor.execute.call_args_list[2].args[0]


# 测试点：新增 venue 成功时应只写入 venue_list 的 NOT NULL 业务列 venue，并记录审计日志。
def test_console_create_venue_mock_success_persists_and_audits():
    _set_authenticated_role("editor")
    conn, cursor = _build_connection_mock(fetchone_side_effect=[(88,)])

    with patch("app.routers.console_write.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post(
            "/api/console/venues",
            json=_valid_venue_payload(venue_name="  New Venue  "),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 201
    assert response.json() == {
        "ok": True,
        "item": {"venue_id": 88, "venue_name": "New Venue"},
    }
    assert cursor.execute.call_count == 2
    assert "INSERT INTO venue_list (venue)" in cursor.execute.call_args_list[0].args[0]
    assert cursor.execute.call_args_list[0].args[1] == ("New Venue",)
    assert "INSERT INTO audit_logs" in cursor.execute.call_args_list[1].args[0]


# 测试点：新增 Live 成功时应补齐时间秒数和时区，并返回规范化的空默认 Band。
def test_console_create_live_mock_success_normalizes_times_and_audits():
    _set_authenticated_role("admin")
    conn, cursor = _build_connection_mock(fetchone_side_effect=[(1,), (77,)])

    with patch("app.routers.console_write.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post(
            "/api/console/lives",
            json=_valid_live_payload(opening_time="18:00", start_time="19:00:30", timezone="+09:00"),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 201
    assert response.json()["item"] == {
        "live_id": 77,
        "live_date": "2026-05-29",
        "live_title": "Mock Live",
        "live_type": "oneman",
        "url": "https://example.com/mock-live",
        "opening_time": "18:00:00+09:00",
        "start_time": "19:00:30+09:00",
        "venue_id": 2,
        "default_band_ids": [],
        "event_attendees": [],
        "band_lineup_contexts": [],
        "event_status": "scheduled",
        "status_note": None,
        "date_phase": "past",
    }
    assert "INSERT INTO live_attrs" in cursor.execute.call_args_list[1].args[0]
    assert "INSERT INTO audit_logs" in cursor.execute.call_args_list[2].args[0]


# 测试点：新增 Live 应校验默认 Band 存在，并将去重升序后的数组写入数据库。
def test_console_create_live_mock_validates_and_persists_default_bands():
    _set_authenticated_role("editor")
    conn, cursor = _build_connection_mock(
        fetchone_side_effect=[(1,), (79,)],
        fetchall_side_effect=[[(1,), (3,)]],
    )

    with patch("app.routers.console_write.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post(
            "/api/console/lives",
            json=_valid_live_payload(default_band_ids=[3, 1, 3]),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 201
    assert response.json()["item"]["default_band_ids"] == [1, 3]
    assert cursor.execute.call_args_list[1].args[1] == ([1, 3],)
    assert cursor.execute.call_args_list[2].args[1][-4] == [1, 3]


# 测试点：活动出席成员应按 Band 目录顺序持久化完整名单，并仅在响应中计算 partial/full。
def test_console_create_event_persists_members_and_computes_modes():
    _set_authenticated_role("editor")
    conn, cursor = _build_connection_mock(
        fetchone_side_effect=[(1,), (80,)],
        fetchall_side_effect=[
            [
                (3, ["高松燈", "千早愛音"]),
                (8, ["三角初華", "若葉睦", "八幡海鈴"]),
            ]
        ],
    )

    with patch("app.routers.console_write.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post(
            "/api/console/lives",
            json=_valid_live_payload(
                live_type="event",
                default_band_ids=[8, 3],
                event_attendees=[
                    {"band_id": 3, "members": ["千早愛音", "高松燈"]},
                    {"band_id": 8, "members": ["若葉睦"]},
                ],
            ),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 201
    assert response.json()["item"]["event_attendees"] == [
        {"band_id": 3, "mode": "full", "members": ["高松燈", "千早愛音"]},
        {"band_id": 8, "mode": "partial", "members": ["若葉睦"]},
    ]
    persisted_json = cursor.execute.call_args_list[2].args[1][-3]
    assert persisted_json.adapted == {"3": ["高松燈", "千早愛音"], "8": ["若葉睦"]}


# 测试点：更新 Live 应先读取既有阵容上下文，再复用成员规范化并记录字段差异审计。
def test_console_update_live_mock_persists_changes_and_audits():
    _set_authenticated_role("editor")
    existing = {
        "live_date": "2026-05-29",
        "live_title": "Old Live",
        "live_type": "event",
        "url": "https://example.com/old",
        "opening_time": "18:00:00+09:00",
        "start_time": "19:00:30+09:00",
        "venue_id": 2,
        "default_band_ids": [3],
        "event_attendees": {"3": ["高松燈"]},
    }
    conn, cursor = _build_connection_mock(
        fetchone_side_effect=[(existing,), (1,), (1,)],
        fetchall_side_effect=[[], [(3, ["高松燈", "千早愛音"])]],
    )

    with patch("app.routers.console_write.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.put(
            "/api/console/lives/55",
            json=_valid_live_payload(
                live_title="Updated Live",
                live_type="event",
                default_band_ids=[3],
                event_attendees=[{"band_id": 3, "members": ["千早愛音", "高松燈"]}],
            ),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 200
    assert response.json()["item"]["event_attendees"] == [
        {"band_id": 3, "mode": "full", "members": ["高松燈", "千早愛音"]}
    ]
    update_call = next(call for call in cursor.execute.call_args_list if "UPDATE live_attrs" in call.args[0])
    audit_call = next(call for call in cursor.execute.call_args_list if "INSERT INTO audit_logs" in call.args[0])
    assert update_call.args[1][-1] == 55
    audit_json = audit_call.args[1][-1]
    assert audit_json.adapted["changes"]["live_title"] == {"before": "Old Live", "after": "Updated Live"}


# 测试点：完全相同的 Live PUT 可读取既有阵容上下文，但不得执行 UPDATE 或制造无意义审计。
def test_console_update_live_mock_noop_skips_update_and_audit():
    _set_authenticated_role("editor")
    existing = {
        "live_date": "2026-05-29",
        "live_title": "Mock Live",
        "live_type": "oneman",
        "url": "https://example.com/mock-live",
        "opening_time": "18:00:00+09:00",
        "start_time": "19:00:30+09:00",
        "venue_id": 2,
        "default_band_ids": [],
        "event_attendees": {},
    }
    conn, cursor = _build_connection_mock(
        fetchone_side_effect=[(existing,), (1,), (1,)],
        fetchall_side_effect=[[]],
    )

    with patch("app.routers.console_write.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.put(
            "/api/console/lives/55",
            json=_valid_live_payload(default_band_ids=[], event_attendees=[]),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 200
    assert cursor.execute.call_count == 4
    assert all("UPDATE live_attrs" not in call.args[0] for call in cursor.execute.call_args_list)
    assert all("INSERT INTO audit_logs" not in call.args[0] for call in cursor.execute.call_args_list)


# 测试点：非活动 Live 不允许提交活动专用的出席成员数据。
def test_console_create_non_event_rejects_event_attendees():
    _set_authenticated_role("editor")
    client = TestClient(app)

    response = client.post(
        "/api/console/lives",
        json=_valid_live_payload(
            live_type="oneman",
            default_band_ids=[3],
            event_attendees=[{"band_id": 3, "members": ["高松燈"]}],
        ),
        headers={"X-CSRF-Token": CSRF_TOKEN},
    )

    assert response.status_code == 422


# 测试点：新增 Live 应拒绝 default_band_ids 中不存在的 Band。
def test_console_create_live_mock_rejects_missing_default_band():
    _set_authenticated_role("editor")
    conn, _ = _build_connection_mock(
        fetchone_side_effect=[(1,)],
        fetchall_side_effect=[[(1,)]],
    )

    with patch("app.routers.console_write.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post(
            "/api/console/lives",
            json=_valid_live_payload(default_band_ids=[1, 999]),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "Band ids not found: 999"


# 测试点：新增 Live 允许当天结束时刻 24:00，并接受四十五分钟 UTC 偏移。
def test_console_create_live_mock_accepts_24_00_and_quarter_hour_timezone():
    _set_authenticated_role("editor")
    conn, _ = _build_connection_mock(fetchone_side_effect=[(1,), (78,)])

    with patch("app.routers.console_write.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post(
            "/api/console/lives",
            json=_valid_live_payload(opening_time="24:00", start_time="24:00", timezone="+05:45"),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 201
    assert response.json()["item"]["opening_time"] == "24:00:00+05:45"


# 测试点：新增 Live 应拒绝非法时间、非法时区和不存在的 venue。
@pytest.mark.parametrize(
    ("payload", "expected_status", "expected_detail"),
    [
        (_valid_live_payload(opening_time="18:0x"), 400, "Invalid time format: 18:0x"),
        (_valid_live_payload(opening_time="24:01"), 400, "Invalid time value: 24:01"),
        (_valid_live_payload(timezone="+14:15"), 400, "Invalid timezone value: +14:15"),
        (_valid_live_payload(timezone="+9"), 422, None),
        (_valid_live_payload(venue_id=999), 404, "Venue id 999 not found"),
    ],
)
def test_console_create_live_mock_business_errors(payload: dict, expected_status: int, expected_detail: str | None):
    _set_authenticated_role("editor")
    conn, _ = _build_connection_mock(fetchone_side_effect=[None])

    with patch("app.routers.console_write.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post("/api/console/lives", json=payload, headers={"X-CSRF-Token": CSRF_TOKEN})

    assert response.status_code == expected_status
    if expected_detail is not None:
        assert response.json()["detail"] == expected_detail


# 测试点：追加 setlist 成功时应只追加新行，并返回插入行数和当前总行数。
def test_console_append_setlist_mock_success_inserts_rows_and_audits():
    _set_authenticated_role("editor")
    conn, cursor = _build_connection_mock(
        fetchone_side_effect=[
            (1,),
            None,
            ("setlist-row-1",),
            ("setlist-row-2",),
            ("setlist-row-3",),
            ("setlist-row-4",),
            (4,),
        ],
        fetchall_side_effect=[[(1,), (2,), (3,), (4,)], []],
    )
    lineup_contexts = {
        1: PersistedLineupContext(
            band_id=1,
            band_name_version_id=1,
            band_name="Poppin'Party",
            base_lineup_version_id=1,
            base_members=("Kasumi", "Tae"),
            next_lineup_version_id=None,
            next_members=(),
        )
    }
    payload = {
        "setlist_rows": [
            _valid_setlist_payload(song_id=1, absolute_order=3, segment_type="EN")["setlist_rows"][0],
            _valid_setlist_payload(song_id=2, absolute_order=4, segment_type="SP", is_short=True)["setlist_rows"][0],
            _valid_setlist_payload(song_id=3, absolute_order=5, segment_type="OP")["setlist_rows"][0],
            _valid_setlist_payload(song_id=4, absolute_order=6, segment_type="WEN")["setlist_rows"][0],
        ]
    }

    with (
        patch("app.routers.console_write.get_write_db_connection", return_value=conn),
        patch("app.routers.console_write.load_lineup_contexts", return_value=lineup_contexts),
    ):
        client = TestClient(app)
        response = client.post("/api/console/lives/1/setlist", json=payload, headers={"X-CSRF-Token": CSRF_TOKEN})

    insert_setlist_calls = [
        execute_call
        for execute_call in cursor.execute.call_args_list
        if "INSERT INTO live_setlist (" in execute_call.args[0]
    ]
    assert response.status_code == 201
    assert response.json() == {
        "ok": True,
        "item": {"live_id": 1, "inserted_row_count": 4, "total_setlist_row_count": 4},
    }
    assert len(insert_setlist_calls) == 4
    assert "INSERT INTO audit_logs" in cursor.execute.call_args_list[-1].args[0]


# 测试点：追加 setlist 在请求内片段或顺序非法时，应在访问数据库前拒绝。
@pytest.mark.parametrize(
    ("payload", "expected_status", "expected_detail"),
    [
        (_valid_setlist_payload(segment_type=""), 422, "at least 1 character"),
        (
            {
                "setlist_rows": [
                    _valid_setlist_payload(song_id=1, absolute_order=3)["setlist_rows"][0],
                    _valid_setlist_payload(song_id=2, absolute_order=3)["setlist_rows"][0],
                ]
            },
            400,
            "Duplicate absolute_order in setlist_rows: 3",
        ),
    ],
)
def test_console_append_setlist_mock_rejects_pre_db_business_errors(
    payload: dict,
    expected_status: int,
    expected_detail: str,
):
    _set_authenticated_role("editor")

    with patch("app.routers.console_write.get_write_db_connection") as get_connection:
        client = TestClient(app)
        response = client.post("/api/console/lives/1/setlist", json=payload, headers={"X-CSRF-Token": CSRF_TOKEN})

    assert response.status_code == expected_status
    if expected_detail is not None:
        assert expected_detail in str(response.json())
    get_connection.assert_not_called()


# 测试点：追加 setlist 若任一 song_id 缺失，应整批拒绝且不插入任何 setlist 行。
def test_console_append_setlist_mock_missing_song_rejects_batch_without_partial_insert():
    _set_authenticated_role("editor")
    conn, cursor = _build_connection_mock(
        fetchone_side_effect=[(1,), None],
        fetchall_side_effect=[[(1,)]],
    )
    payload = {
        "setlist_rows": [
            _valid_setlist_payload(song_id=1, absolute_order=3)["setlist_rows"][0],
            _valid_setlist_payload(song_id=999, absolute_order=4)["setlist_rows"][0],
        ]
    }

    with patch("app.routers.console_write.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post("/api/console/lives/1/setlist", json=payload, headers={"X-CSRF-Token": CSRF_TOKEN})

    assert response.status_code == 404
    assert response.json()["detail"] == "Song ids not found: 999"
    assert all("INSERT INTO live_setlist" not in execute_call.args[0] for execute_call in cursor.execute.call_args_list)


# 测试点：追加 setlist 应先锁定目标 Live；若已有 setlist 数据则返回 409 且不插入新行。
def test_console_append_setlist_mock_existing_setlist_rejects_with_409():
    _set_authenticated_role("editor")
    conn, cursor = _build_connection_mock(
        fetchone_side_effect=[(1,), (1,)],
        fetchall_side_effect=[[(1,)]],
    )

    with patch("app.routers.console_write.get_write_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.post(
            "/api/console/lives/1/setlist",
            json=_valid_setlist_payload(song_id=1, absolute_order=3),
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 409
    assert response.json()["detail"] == "Live id 1 already has setlist data"
    assert "FOR UPDATE" in str(cursor.execute.call_args_list[0].args[0])
    assert all("INSERT INTO live_setlist" not in execute_call.args[0] for execute_call in cursor.execute.call_args_list)


# 测试点：Setlist 管理更新会在同一事务中校验歌曲、替换完整行集合并写审计。
def test_console_replace_setlist_mock_replaces_complete_collection():
    _set_authenticated_role("editor")
    conn, cursor = _build_connection_mock(
        fetchone_side_effect=[(1,), ("setlist-row-1",)],
        fetchall_side_effect=[[(1,)]],
    )
    lineup_contexts = {
        1: PersistedLineupContext(
            band_id=1,
            band_name_version_id=1,
            band_name="Poppin'Party",
            base_lineup_version_id=1,
            base_members=("Kasumi", "Tae"),
            next_lineup_version_id=None,
            next_members=(),
        )
    }
    payload = _valid_setlist_payload(song_id=1, absolute_order=1, segment_type="M")
    payload["setlist_rows"][0]["comment"] = "Encore note"

    with (
        patch("app.routers.console_write.get_write_db_connection", return_value=conn),
        patch("app.routers.console_write.load_lineup_contexts", return_value=lineup_contexts),
    ):
        client = TestClient(app)
        response = client.put(
            "/api/console/lives/1/setlist",
            json=payload,
            headers={"X-CSRF-Token": CSRF_TOKEN},
        )

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "item": {"live_id": 1, "inserted_row_count": 1, "total_setlist_row_count": 1},
    }
    assert any("DELETE FROM live_setlist" in execute_call.args[0] for execute_call in cursor.execute.call_args_list)
    insert_call = next(
        execute_call for execute_call in cursor.execute.call_args_list if "INSERT INTO live_setlist" in execute_call.args[0]
    )
    assert insert_call.args[1][-1] == "Encore note"
    assert "INSERT INTO audit_logs" in cursor.execute.call_args_list[-1].args[0]
