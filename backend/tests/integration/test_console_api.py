import os

import pytest

from app.auth import hash_password, normalize_username

pytestmark = pytest.mark.integration
TEST_DEFAULT_ADMIN_USERNAME = os.getenv("AUTH_DEFAULT_ADMIN_USERNAME", "admin").strip().lower()
TEST_DEFAULT_ADMIN_PASSWORD = os.getenv("AUTH_DEFAULT_ADMIN_PASSWORD", "test-admin-pass")


def _base_performance(band_id: int, members: list[str]) -> dict[str, object]:
    return {
        "band_id": band_id,
        "lineup_usage": "base",
        "handover_baseline": None,
        "members": members,
    }


def _login_and_get_csrf_for(
    integration_test_client,
    *,
    username: str,
    password: str,
) -> str:
    """Log in through the auth API and return the CSRF token used by console write calls."""
    response = integration_test_client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return response.json()["csrf_token"]


def _get_user_id(conn, username: str) -> int:
    """Look up the pre-seeded user ID by username."""
    conn.autocommit = True
    with conn.cursor() as cursor:
        cursor.execute("SELECT id FROM app_users WHERE username = %s", (username,))
        row = cursor.fetchone()
    assert row is not None, f"User {username} not found"
    return int(row[0])


def _get_latest_audit_row(
    integration_admin_connection,
    *,
    user_id: int,
) -> tuple[str, str | None, dict[str, object] | None]:
    """Read the newest audit_logs row for one user so tests can assert console side effects."""
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
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
    return (
        str(row[0]),
        str(row[1]) if row[1] is not None else None,
        row[2] if isinstance(row[2], dict) else None,
    )


def _count_rows(
    integration_admin_connection,
    query: str,
    params: tuple[object, ...] = (),
) -> int:
    """Return one COUNT(*) value from the integration database."""
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(query, params)
        row = cursor.fetchone()

    assert row is not None
    return int(row[0])


# 测试点：`editor+` 只读查询接口应返回前端控制台下拉、搜索和歌曲分页所需的 seed 数据。
def test_console_lookup_endpoints_return_seeded_options(
    integration_test_client,
):
    """Verify console lookup endpoints expose songs, bands, and venues for editor users."""
    _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )

    songs_response = integration_test_client.get("/api/console/songs?q=Yes&limit=10&page=1")
    bands_response = integration_test_client.get("/api/console/bands?q=Roselia&limit=10")
    venues_response = integration_test_client.get("/api/console/venues?q=Shinjuku&limit=10")

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
        "items": [
            {
                "band_id": 2,
                "band_name": "Roselia",
                "band_abbr": "rsl",
                "band_members": ["Yukina", "Sayo", "Lisa", "Ako", "Rinko"],
            }
        ],
    }

    assert venues_response.status_code == 200
    assert venues_response.json() == {
        "items": [
            {
                "venue_id": 2,
                "venue_name": "Zepp Shinjuku",
            }
        ]
    }


# 测试点：歌曲查询结果应把精确命中的歌名排在右侧补全候选前面，保证短歌名能被 setlist 回填 sid。
def test_console_song_lookup_prioritizes_exact_title_match(
    integration_test_client,
    integration_admin_connection,
):
    """Verify short exact song names are not hidden behind broader prefix matches."""
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO song_list (song_name, band_id, is_cover) VALUES (%s, %s, %s) RETURNING id",
            ("R", 1, False),
        )
        song_id = cursor.fetchone()[0]

    _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )

    response = integration_test_client.get("/api/console/songs?q=R&limit=1")

    assert response.status_code == 200
    assert response.json()["items"] == [
        {"song_id": song_id, "song_name": "R", "band_id": 1, "cover": False, "band_name": "Poppin'Party"}
    ]


# 测试点：歌曲候选分页应在服务端按稳定歌名顺序切页，并返回总数与总页数。
def test_console_song_lookup_supports_server_side_pagination(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO song_list (song_name, band_id, is_cover)
            VALUES
                ('Pagination Probe A', 1, false),
                ('Pagination Probe B', 1, false)
            RETURNING id
            """
        )
        inserted_ids = [int(row[0]) for row in cursor.fetchall()]

    _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )

    response = integration_test_client.get("/api/console/songs?q=Pagination Probe&limit=1&page=2")

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "song_id": inserted_ids[1],
                "song_name": "Pagination Probe B",
                "band_id": 1,
                "cover": False,
                "band_name": "Poppin'Party",
            }
        ],
        "page": 2,
        "page_size": 1,
        "total": 2,
        "total_pages": 2,
    }


# 测试点：歌曲查询只允许从歌名开头向右补全，不能用输入命中歌名中段。
def test_console_song_lookup_only_matches_title_prefix(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO song_list (song_name, band_id, is_cover) VALUES (%s, %s, %s)",
            ("Sing Alive", 1, False),
        )
        cursor.execute(
            "INSERT INTO song_list (song_name, band_id, is_cover) VALUES (%s, %s, %s) RETURNING id",
            ("V.I.P MONSTER", 1, False),
        )
        prefix_song_id = cursor.fetchone()[0]

    _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )

    left_match_response = integration_test_client.get("/api/console/songs?q=ALIVE&limit=10")
    prefix_match_response = integration_test_client.get("/api/console/songs?q=V.I.P&limit=10")

    assert left_match_response.status_code == 200
    assert all(item["song_name"] != "Sing Alive" for item in left_match_response.json()["items"])
    assert prefix_match_response.status_code == 200
    assert prefix_match_response.json()["items"] == [
        {
            "song_id": prefix_song_id,
            "song_name": "V.I.P MONSTER",
            "band_id": 1,
            "cover": False,
            "band_name": "Poppin'Party",
        }
    ]


# 测试点：歌曲查询应把常见等价标点归一化，允许半角输入命中含弯引号和全角符号的歌名。
def test_console_song_lookup_matches_punctuation_equivalent_title(
    integration_test_client,
    integration_admin_connection,
):
    """Verify song lookup handles common punctuation variants without mutating stored titles."""
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO song_list (song_name, band_id, is_cover) VALUES (%s, %s, %s) RETURNING id",
            ("Song ‘A’，B；C〜D", 1, False),
        )
        song_id = cursor.fetchone()[0]

    _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )

    response = integration_test_client.get("/api/console/songs?q=Song 'A',B;C~D&limit=10")

    assert response.status_code == 200
    assert response.json()["items"] == [
        {
            "song_id": song_id,
            "song_name": "Song ‘A’，B；C〜D",
            "band_id": 1,
            "cover": False,
            "band_name": "Poppin'Party",
        }
    ]


# 测试点：U+02BB 左撇号应加入已有的 U+02BC 与半角撇号等价组，并兼容分解假名。
def test_console_song_lookup_matches_modifier_apostrophe_pair(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO song_list (song_name, band_id, is_cover) VALUES (%s, %s, %s) RETURNING id",
            ("ぽっぴん'しゃっふる", 1, False),
        )
        song_id = cursor.fetchone()[0]

    _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )

    expected_items = [
        {
            "song_id": song_id,
            "song_name": "ぽっぴん'しゃっふる",
            "band_id": 1,
            "cover": False,
            "band_name": "Poppin'Party",
        }
    ]
    left_response = integration_test_client.get("/api/console/songs?q=ぽっぴんʻしゃっふる&limit=10")

    assert left_response.status_code == 200
    assert left_response.json()["items"] == expected_items


# 测试点：歌曲查询应忽略相同或等价标点两侧的空白，但保留标题中的普通词间空格。
def test_console_song_lookup_ignores_only_whitespace_adjacent_to_punctuation(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO song_list (song_name, band_id, is_cover) VALUES (%s, %s, %s) RETURNING id",
            ("LET’S あちあちトレーニング！", 1, False),
        )
        song_id = cursor.fetchone()[0]
        cursor.execute(
            "INSERT INTO song_list (song_name, band_id, is_cover) VALUES (%s, %s, %s)",
            ("LET’S あち あちトレーニング！", 1, False),
        )

    _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )

    response = integration_test_client.get("/api/console/songs?q=LET'Sあちあちトレーニング！&limit=10")

    assert response.status_code == 200
    assert response.json()["items"] == [
        {
            "song_id": song_id,
            "song_name": "LET’S あちあちトレーニング！",
            "band_id": 1,
            "cover": False,
            "band_name": "Poppin'Party",
        }
    ]


# 测试点：只读查询接口也必须执行后端 `editor+` 权限校验，不能只依赖前端隐藏入口。
def test_console_lookup_endpoints_require_editor_role(
    integration_test_client,
    integration_admin_connection,
):
    """Verify viewer users cannot call console lookup endpoints directly."""
    _login_and_get_csrf_for(
        integration_test_client,
        username="viewer_tester",
        password="viewer-test-pass",
    )

    songs_response = integration_test_client.get("/api/console/songs")
    bands_response = integration_test_client.get("/api/console/bands")
    venues_response = integration_test_client.get("/api/console/venues")

    assert songs_response.status_code == 403
    assert songs_response.json()["detail"]["code"] == "AUTH_FORBIDDEN"
    assert bands_response.status_code == 403
    assert bands_response.json()["detail"]["code"] == "AUTH_FORBIDDEN"
    assert venues_response.status_code == 403
    assert venues_response.json()["detail"]["code"] == "AUTH_FORBIDDEN"


# 测试点：只读查询接口应限制返回数量，避免前端误传超大 limit 造成查询压力。
def test_console_lookup_endpoints_validate_limit(
    integration_test_client,
):
    """Verify console lookup endpoints reject oversized limit values."""
    _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )

    songs_response = integration_test_client.get("/api/console/songs?limit=101")
    bands_response = integration_test_client.get("/api/console/bands?limit=101")
    venues_response = integration_test_client.get("/api/console/venues?limit=101")

    assert songs_response.status_code == 422
    assert bands_response.status_code == 422
    assert venues_response.status_code == 422


# 测试点：只读查询接口连到测试库时不应产生审计日志，也不应改动候选数据。
def test_console_lookup_endpoints_do_not_mutate_database(
    integration_test_client,
    integration_admin_connection,
):
    """Verify console lookup endpoints have no DB side effects beyond the login setup."""
    editor_user_id = _get_user_id(integration_admin_connection, "editor_tester")
    _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )
    audit_count_before = _count_rows(
        integration_admin_connection,
        "SELECT COUNT(*) FROM audit_logs WHERE user_id = %s",
        (editor_user_id,),
    )
    song_count_before = _count_rows(integration_admin_connection, "SELECT COUNT(*) FROM song_list")
    band_count_before = _count_rows(integration_admin_connection, "SELECT COUNT(*) FROM band_attrs")
    venue_count_before = _count_rows(integration_admin_connection, "SELECT COUNT(*) FROM venue_list")

    songs_response = integration_test_client.get("/api/console/songs?q=STAR")
    bands_response = integration_test_client.get("/api/console/bands?q=mygo")
    venues_response = integration_test_client.get("/api/console/venues?q=WWW")

    assert songs_response.status_code == 200
    assert bands_response.status_code == 200
    assert venues_response.status_code == 200
    assert _count_rows(integration_admin_connection, "SELECT COUNT(*) FROM audit_logs WHERE user_id = %s", (editor_user_id,)) == audit_count_before
    assert _count_rows(integration_admin_connection, "SELECT COUNT(*) FROM song_list") == song_count_before
    assert _count_rows(integration_admin_connection, "SELECT COUNT(*) FROM band_attrs") == band_count_before
    assert _count_rows(integration_admin_connection, "SELECT COUNT(*) FROM venue_list") == venue_count_before


# 测试点：`editor+` 调用新增歌曲接口时，应写入 song_list 并追加 song_create 审计。
def test_console_create_song_persists_row_and_audit_log(
    integration_test_client,
    integration_admin_connection,
):
    """Verify the console song-create endpoint inserts one song and one matching audit log row."""
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )

    response = integration_test_client.post(
        "/api/console/songs",
        headers={"X-CSRF-Token": csrf_token},
        json={"song_name": "Console Created Song", "band_id": 2, "cover": False},
    )

    assert response.status_code == 201
    assert response.json() == {
        "ok": True,
        "item": {
            "song_id": 203,
            "song_name": "Console Created Song",
            "band_id": 2,
            "cover": False,
        },
    }

    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, song_name, band_id, is_cover FROM song_list WHERE id = %s",
            (203,),
        )
        row = cursor.fetchone()

    assert row == (203, "Console Created Song", 2, False)
    assert _get_latest_audit_row(integration_admin_connection, user_id=1) == (
        "song_create",
        "203",
        {"band_id": 2, "cover": False},
    )


# 测试点：歌曲可归属 Other bands，且不同乐队可复用同一歌曲名。
def test_console_create_song_accepts_other_bands_and_same_name_for_another_band(
    integration_test_client,
    integration_admin_connection,
):
    """Verify band id 0 and the song-name-plus-band unique constraint both allow valid new songs."""
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )

    other_bands_response = integration_test_client.post(
        "/api/console/songs",
        headers={"X-CSRF-Token": csrf_token},
        json={"song_name": "Shared Cover Title", "band_id": 0, "cover": True},
    )
    named_band_response = integration_test_client.post(
        "/api/console/songs",
        headers={"X-CSRF-Token": csrf_token},
        json={"song_name": "Shared Cover Title", "band_id": 2, "cover": False},
    )

    assert other_bands_response.status_code == 201
    assert named_band_response.status_code == 201
    assert other_bands_response.json()["item"]["band_id"] == 0
    assert named_band_response.json()["item"]["band_id"] == 2

    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "SELECT band_id, is_cover FROM song_list WHERE song_name = %s ORDER BY band_id",
            ("Shared Cover Title",),
        )
        rows = cursor.fetchall()

    assert rows == [(0, True), (2, False)]


# 测试点：新增歌曲接口应拒绝 viewer 和缺失 CSRF 的写请求，防止前端可见性绕过后直接落库。
def test_console_create_song_requires_editor_role_and_csrf(
    integration_test_client,
    integration_admin_connection,
):
    """Verify the console song-create endpoint blocks viewer writes and missing CSRF headers."""
    viewer_csrf = _login_and_get_csrf_for(
        integration_test_client,
        username="viewer_tester",
        password="viewer-test-pass",
    )
    viewer_response = integration_test_client.post(
        "/api/console/songs",
        headers={"X-CSRF-Token": viewer_csrf},
        json={"song_name": "Viewer Forbidden Song", "band_id": 1, "cover": False},
    )

    editor_user_id = _get_user_id(integration_admin_connection, "editor_tester")
    editor_login_response = integration_test_client.post(
        "/api/auth/login",
        json={"username": "editor_tester", "password": "editor-test-pass"},
    )
    assert editor_login_response.status_code == 200
    missing_csrf_response = integration_test_client.post(
        "/api/console/songs",
        json={"song_name": "Missing CSRF Song", "band_id": 1, "cover": False},
    )

    assert viewer_response.status_code == 403
    assert viewer_response.json()["detail"]["code"] == "AUTH_FORBIDDEN"
    assert missing_csrf_response.status_code == 403
    assert missing_csrf_response.json()["detail"]["code"] == "AUTH_CSRF_INVALID"
    assert _get_latest_audit_row(integration_admin_connection, user_id=editor_user_id)[0] == "login_success"


# 测试点：新增 venue 接口应写入 venue_list 的 NOT NULL 列 venue，并追加 venue_create 审计。
def test_console_create_venue_persists_row_and_audit_log(
    integration_test_client,
    integration_admin_connection,
):
    """Verify the console venue-create endpoint inserts one venue row and one matching audit log row."""
    editor_user_id = _get_user_id(integration_admin_connection, "editor_tester")
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )

    response = integration_test_client.post(
        "/api/console/venues",
        headers={"X-CSRF-Token": csrf_token},
        json={"venue_name": "Console Created Venue"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["ok"] is True
    assert payload["item"]["venue_name"] == "Console Created Venue"
    venue_id = int(payload["item"]["venue_id"])

    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, venue FROM venue_list WHERE id = %s",
            (venue_id,),
        )
        row = cursor.fetchone()

    assert row == (venue_id, "Console Created Venue")
    assert _get_latest_audit_row(integration_admin_connection, user_id=editor_user_id) == (
        "venue_create",
        str(venue_id),
        {"venue_name": "Console Created Venue"},
    )


# 测试点：新增 Live 和追加 setlist 连到测试库时缺少 CSRF 应被拒绝，并且不会落库。
def test_console_live_and_setlist_writes_require_csrf_without_side_effects(
    integration_test_client,
    integration_admin_connection,
):
    """Verify missing-CSRF write attempts do not insert live_attrs or live_setlist rows."""
    editor_user_id = _get_user_id(integration_admin_connection, "editor_tester")
    _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )
    live_count_before = _count_rows(integration_admin_connection, "SELECT COUNT(*) FROM live_attrs")
    setlist_count_before = _count_rows(
        integration_admin_connection,
        "SELECT COUNT(*) FROM live_setlist WHERE live_id = %s",
        (1,),
    )

    live_response = integration_test_client.post(
        "/api/console/lives",
        json={
            "live_date": "2026-05-02",
            "live_title": "Missing CSRF Live",
            "live_type": "oneman",
            "url": "https://example.com/lives/missing-csrf",
            "opening_time": "18:00",
            "start_time": "19:00",
            "timezone": "+09:00",
            "venue_id": 1,
        },
    )
    setlist_response = integration_test_client.post(
        "/api/console/lives/41/setlist",
        json={
            "setlist_rows": [
                {
                    "song_id": 4,
                    "absolute_order": 3,
                    "segment_type": "EN",
                    "sub_order": 1,
                    "is_short": False,
                    "band_performances": [_base_performance(1, ["Kasumi"])],
                    "other_member": {},
                    "comment": None,
                }
            ]
        },
    )

    assert live_response.status_code == 403
    assert live_response.json()["detail"]["code"] == "AUTH_CSRF_INVALID"
    assert setlist_response.status_code == 403
    assert setlist_response.json()["detail"]["code"] == "AUTH_CSRF_INVALID"
    assert _count_rows(integration_admin_connection, "SELECT COUNT(*) FROM live_attrs") == live_count_before
    assert _count_rows(integration_admin_connection, "SELECT COUNT(*) FROM live_setlist WHERE live_id = %s", (1,)) == setlist_count_before
    assert _get_latest_audit_row(integration_admin_connection, user_id=editor_user_id)[0] == "login_success"


# 测试点：新增 Live 接口应校验、去重并持久化 default_band_ids 与 live_type。
def test_console_create_live_persists_live_row(
    integration_test_client,
    integration_admin_connection,
):
    """Verify the console live-create endpoint inserts one live row with live_type and audits it."""
    editor_user_id = _get_user_id(integration_admin_connection, "editor_tester")
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT band_id, band_name_version_id, lineup_version_id
            FROM current_band_versions
            WHERE band_id = ANY(%s)
            ORDER BY band_id
            """,
            ([1, 3],),
        )
        expected_contexts = [
            {
                "band_id": int(row[0]),
                "band_name_version_id": int(row[1]),
                "base_lineup_version_id": int(row[2]),
                "next_lineup_version_id": None,
            }
            for row in cursor.fetchall()
        ]

    response = integration_test_client.post(
        "/api/console/lives",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "live_date": "2026-05-01",
            "live_title": "Console Created Live",
            "live_type": "oneman",
            "url": "https://example.com/lives/console-created",
            "opening_time": "18:00",
            "start_time": "19:00:30",
            "timezone": "+09:00",
            "venue_id": 2,
            "default_band_ids": [3, 1, 3],
        },
    )

    assert response.status_code == 201
    response_payload = response.json()
    live_id = response_payload["item"]["live_id"]
    assert response_payload == {
        "ok": True,
        "item": {
            "live_id": live_id,
            "live_date": "2026-05-01",
            "live_title": "Console Created Live",
            "live_type": "oneman",
            "url": "https://example.com/lives/console-created",
            "opening_time": "18:00:00+09:00",
            "start_time": "19:00:30+09:00",
            "venue_id": 2,
            "default_band_ids": [1, 3],
            "event_attendees": [],
            "band_lineup_contexts": expected_contexts,
            "event_status": "scheduled",
            "status_note": None,
            "date_phase": "past",
        },
    }

    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                id,
                live_date::text,
                live_title,
                live_type,
                is_internal,
                url,
                opening_time::text,
                start_time::text,
                venue_id,
                default_band_ids
            FROM live_attrs
            WHERE id = %s
            """,
            (live_id,),
        )
        row = cursor.fetchone()

    assert row == (
        live_id,
        "2026-05-01",
        "Console Created Live",
        "oneman",
        False,
        "https://example.com/lives/console-created",
        "18:00:00+09",
        "19:00:30+09",
        2,
        [1, 3],
    )
    assert _get_latest_audit_row(integration_admin_connection, user_id=editor_user_id) == (
        "live_create",
        str(live_id),
        {
            "venue_id": 2,
            "opening_time": "18:00:00+09:00",
            "start_time": "19:00:30+09:00",
            "live_type": "oneman",
            "default_band_ids": [1, 3],
            "event_attendees": [],
            "band_lineup_contexts": expected_contexts,
            "event_status": "scheduled",
            "status_note": None,
        },
    )


# 测试点：写请求拒绝客户端历史上下文，普通历史日期不带上下文时仍由服务端锁定当前开放版本。
def test_console_create_event_rejects_historical_default_band_context(
    integration_test_client,
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute("DELETE FROM live_setlist_band_performance_members WHERE band_id = 3")
        cursor.execute("DELETE FROM live_setlist_band_performances WHERE band_id = 3")
        cursor.execute("DELETE FROM live_band_lineup_contexts WHERE band_id = 3")
        cursor.execute(
            "DELETE FROM band_lineup_version_members WHERE lineup_version_id IN (SELECT id FROM band_lineup_versions WHERE band_id = 3)"
        )
        cursor.execute("DELETE FROM band_lineup_versions WHERE band_id = 3")
        cursor.execute("DELETE FROM band_name_versions WHERE band_id = 3")
        cursor.execute(
            """
            INSERT INTO band_name_versions (band_id, band_name, band_abbr, valid_from, valid_to, note)
            VALUES
                (3, 'MyGO old', 'old', '2020-01-01', '2021-01-01', 'test old'),
                (3, 'MyGO!!!!!', 'mygo', '2021-01-01', NULL, 'test current')
            RETURNING id
            """
        )
        old_name_version_id, _ = [int(row[0]) for row in cursor.fetchall()]
        cursor.execute(
            """
            INSERT INTO band_lineup_versions (
                band_id, version_no, version_label, valid_from, valid_to,
                predecessor_id, change_type, note
            )
            VALUES (3, 1, 'MyGO V1', '2020-01-01', '2021-01-01', NULL, 'initial', 'test old')
            RETURNING id
            """
        )
        old_lineup_version_id = int(cursor.fetchone()[0])
        cursor.execute(
            """
            INSERT INTO band_lineup_versions (
                band_id, version_no, version_label, valid_from, valid_to,
                predecessor_id, change_type, note
            )
            VALUES (3, 2, 'MyGO V2', '2021-01-01', NULL, %s, 'replacement', 'test current')
            RETURNING id
            """,
            (old_lineup_version_id,),
        )
        current_lineup_version_id = int(cursor.fetchone()[0])
        cursor.executemany(
            """
            INSERT INTO band_lineup_version_members (lineup_version_id, member_name, display_order)
            VALUES (%s, %s, %s)
            """,
            [
                (old_lineup_version_id, "Old Vocal", 1),
                (old_lineup_version_id, "Old Guitar", 2),
                (current_lineup_version_id, "Current Vocal", 1),
                (current_lineup_version_id, "Current Guitar", 2),
            ],
        )

    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )
    response = integration_test_client.post(
        "/api/console/lives",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "live_date": "2020-06-01",
            "live_title": "Historical default Band event",
            "live_type": "event",
            "url": "https://example.com/lives/historical-default",
            "opening_time": "18:00",
            "start_time": "19:00",
            "timezone": "+09:00",
            "venue_id": 2,
            "default_band_ids": [3],
            "event_attendees": [{"band_id": 3, "members": ["Old Guitar", "Old Vocal"]}],
            "band_lineup_contexts": [{
                "band_id": 3,
                "band_name_version_id": old_name_version_id,
                "base_lineup_version_id": old_lineup_version_id,
                "next_lineup_version_id": None,
            }],
        },
    )

    assert response.status_code == 422

    current_response = integration_test_client.post(
        "/api/console/lives",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "live_date": "2020-06-01",
            "live_title": "Historical date with current Band",
            "live_type": "event",
            "url": "https://example.com/lives/current-default",
            "opening_time": "18:00",
            "start_time": "19:00",
            "timezone": "+09:00",
            "venue_id": 2,
            "default_band_ids": [3],
            "event_attendees": [
                {"band_id": 3, "members": ["Current Vocal", "Current Guitar"]}
            ],
        },
    )
    assert current_response.status_code == 201
    assert current_response.json()["item"]["band_lineup_contexts"][0][
        "base_lineup_version_id"
    ] == current_lineup_version_id


# 测试点：更新活动为非活动时应原子清空出演成员，同时保留既有活动组关系和 Setlist 数据。
def test_console_update_live_persists_base_fields_without_touching_relations(
    integration_test_client,
    integration_admin_connection,
):
    live_id = 1
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE live_attrs
            SET live_type = 'event', event_attendees = %s::jsonb
            WHERE id = %s
            """,
            ('{"3": ["Tomori"]}', live_id),
        )
    editor_user_id = _get_user_id(integration_admin_connection, "editor_tester")
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )
    detail_response = integration_test_client.get(f"/api/console/lives/{live_id}")
    assert detail_response.status_code == 200
    item = detail_response.json()["item"]
    relation_count_before = _count_rows(
        integration_admin_connection,
        "SELECT COUNT(*) FROM performance_group_lives WHERE live_id = %s",
        (live_id,),
    )
    setlist_count_before = _count_rows(
        integration_admin_connection,
        "SELECT COUNT(*) FROM live_setlist WHERE live_id = %s",
        (live_id,),
    )

    response = integration_test_client.put(
        f"/api/console/lives/{live_id}",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "live_date": item["live_date"],
            "live_title": f"{item['live_title']} Updated",
            "live_type": "other",
            "url": item["url"],
            "opening_time": item["opening_time"][:5],
            "start_time": item["start_time"][:5],
            "timezone": item["timezone"],
            "venue_id": item["venue_id"],
            "default_band_ids": item["default_band_ids"],
            "event_attendees": [],
        },
    )

    assert response.status_code == 200
    assert response.json()["item"]["live_type"] == "other"
    assert response.json()["item"]["event_attendees"] == []
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute("SELECT live_type, event_attendees FROM live_attrs WHERE id = %s", (live_id,))
        persisted = cursor.fetchone()
    assert persisted == ("other", {})
    assert _count_rows(
        integration_admin_connection,
        "SELECT COUNT(*) FROM performance_group_lives WHERE live_id = %s",
        (live_id,),
    ) == relation_count_before
    assert _count_rows(
        integration_admin_connection,
        "SELECT COUNT(*) FROM live_setlist WHERE live_id = %s",
        (live_id,),
    ) == setlist_count_before
    assert _get_latest_audit_row(integration_admin_connection, user_id=editor_user_id)[0] == "live_update"


# 测试点：资料修正不得写正式改期历史；正式改期必须保存修改前的排期快照并公开返回。
def test_console_live_schedule_change_separates_correction_from_reschedule(
    integration_test_client,
    integration_admin_connection,
):
    live_id = 1
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )
    original = integration_test_client.get(f"/api/console/lives/{live_id}").json()["item"]

    correction_payload = {
        "live_date": original["live_date"],
        "live_title": original["live_title"],
        "live_type": original["live_type"],
        "url": original["url"],
        "opening_time": "18:01",
        "start_time": original["start_time"][:5],
        "timezone": original["timezone"],
        "venue_id": original["venue_id"],
        "default_band_ids": original["default_band_ids"],
        "event_attendees": original["event_attendees"],
        "event_status": original["event_status"],
        "status_note": original["status_note"],
        "schedule_change_kind": "correction",
        "schedule_change_note": "录入时分钟写错",
    }
    correction_response = integration_test_client.put(
        f"/api/console/lives/{live_id}",
        headers={"X-CSRF-Token": csrf_token},
        json=correction_payload,
    )
    assert correction_response.status_code == 200
    assert _count_rows(
        integration_admin_connection,
        "SELECT COUNT(*) FROM live_schedule_history WHERE live_id = %s",
        (live_id,),
    ) == 0

    reschedule_payload = {
        **correction_payload,
        "live_date": "2026-03-02",
        "live_title": "BanG Dream! Unit Live 改期公演",
        "opening_time": "18:30",
        "start_time": "19:30",
        "schedule_change_kind": "reschedule",
        "schedule_change_note": "主办方正式改期",
    }
    reschedule_response = integration_test_client.put(
        f"/api/console/lives/{live_id}",
        headers={"X-CSRF-Token": csrf_token},
        json=reschedule_payload,
    )
    assert reschedule_response.status_code == 200

    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT previous_live_title, previous_live_date::text, previous_opening_time::text,
                   previous_start_time::text, previous_venue_id, note
            FROM live_schedule_history
            WHERE live_id = %s
            """,
            (live_id,),
        )
        history = cursor.fetchone()
    assert history == (
        original["live_title"],
        original["live_date"],
        "18:01:00+09",
        original["start_time"].replace(":00+09:00", ":00+09"),
        original["venue_id"],
        "主办方正式改期",
    )

    public_detail = integration_test_client.get(f"/api/lives/{live_id}").json()
    assert public_detail["was_rescheduled"] is True
    assert len(public_detail["schedule_history"]) == 1
    assert public_detail["schedule_history"][0]["previous_live_title"] == original["live_title"]
    assert public_detail["schedule_history"][0]["note"] == "主办方正式改期"


# 测试点：追加 Setlist 时应保留具名空成员，并将完全为空的 other_member 写成 NULL。
def test_console_append_live_setlist_inserts_rows_to_clean_live(
    integration_test_client,
    integration_admin_connection,
):
    """Verify the console setlist endpoint inserts rows into a live without existing setlist data."""
    editor_user_id = _get_user_id(integration_admin_connection, "editor_tester")
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )

    response = integration_test_client.post(
        "/api/console/lives/41/setlist",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "setlist_rows": [
                {
                    "song_id": 4,
                    "absolute_order": 1,
                    "segment_type": "EN",
                    "sub_order": 1,
                    "is_short": False,
                    "band_performances": [_base_performance(1, ["Kasumi", "Tae", "Saaya", "Arisa"])],
                    "other_member": {"嘉宾": ["MASKING", "LOCK"]},
                    "comment": "appended encore",
                },
                {
                    "song_id": 2,
                    "absolute_order": 2,
                    "segment_type": "SP",
                    "sub_order": 1,
                    "is_short": True,
                    "band_performances": [_base_performance(2, ["Yukina", "Sayo", "Lisa"])],
                    "other_member": {"支援": []},
                    "comment": None,
                },
                {
                    "song_id": 1,
                    "absolute_order": 3,
                    "segment_type": "M",
                    "sub_order": 1,
                    "is_short": False,
                    "band_performances": [_base_performance(1, ["Kasumi"])],
                    "other_member": None,
                    "comment": None,
                },
            ]
        },
    )
    detail_response = integration_test_client.get("/api/lives/41")

    assert response.status_code == 201
    assert response.json() == {
        "ok": True,
        "item": {
            "live_id": 41,
            "inserted_row_count": 3,
            "total_setlist_row_count": 3,
        },
    }

    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT absolute_order, segment_type, sub_order, is_short, band_member, other_member, comment
            FROM live_setlist
            WHERE live_id = %s
            ORDER BY absolute_order
            """,
            (41,),
        )
        rows = cursor.fetchall()

    assert rows == [
        (
            1,
            "EN",
            1,
            False,
            None,
            {"嘉宾": ["MASKING", "LOCK"]},
            "appended encore",
        ),
        (
            2,
            "SP",
            1,
            True,
            None,
            {"支援": None},
            None,
        ),
        (
            3,
            "M",
            1,
            False,
            None,
            None,
            None,
        ),
    ]
    assert [row["row_id"] for row in detail_response.json()["detail_rows"]] == ["EN1", "SP1", "M1"]
    assert detail_response.json()["detail_rows"][0]["song_name"] == "STAR BEAT!〜ホシノコドウ〜"
    assert detail_response.json()["detail_rows"][0]["other_members"] == [{"key": "嘉宾", "value": ["MASKING", "LOCK"]}]
    assert detail_response.json()["detail_rows"][1]["comments"] == ["短版"]
    assert detail_response.json()["detail_rows"][1]["other_members"] == [{"key": "支援", "value": []}]
    assert detail_response.json()["detail_rows"][2]["other_members"] == []
    assert _get_latest_audit_row(integration_admin_connection, user_id=editor_user_id) == (
        "live_setlist_append",
        "41",
        {
            "inserted_row_count": 3,
            "lineup_context_count": 3,
            "total_setlist_row_count": 3,
            "versioned_performance_count": 3,
        },
    )


# 测试点：交接共演应保存新阵容基准，后续只改 Live 标题不得清空或审计删除该历史上下文。
def test_console_setlist_persists_handover_with_explicit_next_baseline(
    integration_test_client,
    integration_admin_connection,
):
    editor_user_id = _get_user_id(integration_admin_connection, "editor_tester")
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute("DELETE FROM live_setlist_band_performance_members WHERE band_id = 1")
        cursor.execute("DELETE FROM live_setlist_band_performances WHERE band_id = 1")
        cursor.execute("DELETE FROM live_band_lineup_contexts WHERE band_id = 1")
        cursor.execute(
            "DELETE FROM band_lineup_version_members WHERE lineup_version_id IN (SELECT id FROM band_lineup_versions WHERE band_id = 1)"
        )
        cursor.execute("DELETE FROM band_lineup_versions WHERE band_id = 1")
        cursor.execute("DELETE FROM band_name_versions WHERE band_id = 1")
        cursor.execute(
            """
            INSERT INTO band_name_versions (
                band_id, band_name, band_abbr, valid_from, valid_to
            )
            VALUES (1, 'Poppin''Party historical', 'ppp', DATE '2015-01-01', NULL)
            RETURNING id
            """
        )
        name_version_id = int(cursor.fetchone()[0])
        cursor.execute(
            """
            INSERT INTO band_lineup_versions (
                band_id, version_no, version_label, valid_from, valid_to,
                predecessor_id, change_type
            )
            VALUES (1, 1, 'PPP V1', DATE '2015-01-01', DATE '2018-01-01', NULL, 'initial')
            RETURNING id
            """
        )
        base_version_id = int(cursor.fetchone()[0])
        cursor.execute(
            """
            INSERT INTO band_lineup_versions (
                band_id, version_no, version_label, valid_from, valid_to,
                predecessor_id, change_type, transition_live_id
            )
            VALUES (1, 2, 'PPP V2', DATE '2018-01-01', NULL, %s, 'replacement', 41)
            RETURNING id
            """,
            (base_version_id,),
        )
        next_version_id = int(cursor.fetchone()[0])
        cursor.execute(
            """
            INSERT INTO band_lineup_version_members (
                lineup_version_id, member_name, display_order
            )
            VALUES
                (%s, 'Kasumi', 1),
                (%s, 'Rimi', 2),
                (%s, 'Kasumi', 1),
                (%s, 'Tae', 2)
            """,
            (base_version_id, base_version_id, next_version_id, next_version_id),
        )
        cursor.execute(
            """
            INSERT INTO live_band_lineup_contexts (
                live_id, band_id, band_name_version_id,
                base_lineup_version_id, next_lineup_version_id
            )
            VALUES (41, 1, %s, %s, %s)
            """,
            (name_version_id, base_version_id, next_version_id),
        )

    response = integration_test_client.post(
        "/api/console/lives/41/setlist",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "setlist_rows": [
                {
                    "song_id": 4,
                    "absolute_order": 1,
                    "segment_type": "M",
                    "sub_order": 1,
                    "is_short": False,
                    "band_performances": [
                        {
                            "band_id": 1,
                            "lineup_usage": "handover",
                            "handover_baseline": "next",
                            "members": ["Kasumi", "Tae", "Rimi"],
                        }
                    ],
                    "comment": "handover",
                }
            ],
        },
    )
    edit_response = integration_test_client.get("/api/console/lives/41/setlist")
    public_response = integration_test_client.get("/api/lives/41")

    assert response.status_code == 201
    assert edit_response.status_code == 200
    edit_contexts = {
        item["band_id"]: item for item in edit_response.json()["band_lineup_contexts"]
    }
    assert edit_contexts[1] == {
        "band_id": 1,
        "band_name_version_id": name_version_id,
        "base_lineup_version_id": base_version_id,
        "next_lineup_version_id": next_version_id,
    }
    assert 3 in edit_contexts
    assert edit_response.json()["rows"][0]["band_member"] == {
        "Poppin'Party historical": ["Kasumi", "Tae", "Rimi"]
    }
    assert edit_response.json()["rows"][0]["band_performances"] == [
        {
            "band_id": 1,
            "lineup_usage": "handover",
            "handover_baseline": "next",
            "members": ["Kasumi", "Tae", "Rimi"],
        }
    ]

    public_member = public_response.json()["detail_rows"][0]["band_members"][0]
    assert public_member["band_name"] == "Poppin'Party historical"
    assert public_member["lineup_usage"] == "handover"
    assert public_member["handover_baseline"] == "next"
    assert public_member["attendance_status"] == "full_plus"
    assert public_member["missing_members"] == []
    assert public_member["extra_members"] == [{"member_name": "Rimi", "category": "former"}]

    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT performance.lineup_usage, performance.handover_baseline, member.appearance_role
            FROM live_setlist_band_performances performance
            JOIN live_setlist_band_performance_members member
              ON member.setlist_id = performance.setlist_id
             AND member.band_id = performance.band_id
            WHERE performance.live_id = 41
              AND member.member_name = 'Rimi'
            """
        )
        assert cursor.fetchone() == ("handover", "next", "former")
        cursor.execute("SELECT band_member FROM live_setlist WHERE live_id = 41")
        assert cursor.fetchone() == (None,)
    assert _get_latest_audit_row(integration_admin_connection, user_id=editor_user_id) == (
        "live_setlist_append",
        "41",
        {
            "inserted_row_count": 1,
            "lineup_context_count": 2,
            "total_setlist_row_count": 1,
            "versioned_performance_count": 1,
        },
    )

    live_item = integration_test_client.get("/api/console/lives/41").json()["item"]
    metadata_response = integration_test_client.put(
        "/api/console/lives/41",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "live_date": live_item["live_date"],
            "live_title": f"{live_item['live_title']} renamed",
            "live_type": live_item["live_type"],
            "url": live_item["url"],
            "opening_time": live_item["opening_time"][:5],
            "start_time": live_item["start_time"][:5],
            "timezone": live_item["timezone"],
            "venue_id": live_item["venue_id"],
            "default_band_ids": live_item["default_band_ids"],
            "event_attendees": [],
        },
    )

    assert metadata_response.status_code == 200
    metadata_contexts = {
        item["band_id"]: item
        for item in metadata_response.json()["item"]["band_lineup_contexts"]
    }
    assert metadata_contexts[1] == {
        "band_id": 1,
        "band_name_version_id": name_version_id,
        "base_lineup_version_id": base_version_id,
        "next_lineup_version_id": next_version_id,
    }
    assert metadata_contexts[3] == edit_contexts[3]
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT band_name_version_id, base_lineup_version_id, next_lineup_version_id
            FROM live_band_lineup_contexts
            WHERE live_id = 41 AND band_id = 1
            """
        )
        assert cursor.fetchone() == (name_version_id, base_version_id, next_version_id)
    latest_action, _, latest_payload = _get_latest_audit_row(
        integration_admin_connection,
        user_id=editor_user_id,
    )
    assert latest_action == "live_update"
    assert latest_payload["changes"] == {
        "live_title": {
            "before": live_item["live_title"],
            "after": f"{live_item['live_title']} renamed",
        }
    }


# 测试点：新增歌曲唯一键冲突、缺失 song_id 和请求体内 absolute_order 重复都应返回明确错误。
def test_console_endpoints_surface_conflict_and_missing_song_errors(
    integration_test_client,
):
    """Verify console write endpoints surface explicit conflict and missing-resource errors."""
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )

    duplicate_song_response = integration_test_client.post(
        "/api/console/songs",
        headers={"X-CSRF-Token": csrf_token},
        json={"song_name": "Yes! BanG_Dream!", "band_id": 1, "cover": False},
    )
    missing_song_response = integration_test_client.post(
        "/api/console/lives/41/setlist",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "setlist_rows": [
                {
                    "song_id": 999,
                    "absolute_order": 1,
                    "segment_type": "M",
                    "sub_order": 1,
                    "is_short": False,
                    "band_performances": [_base_performance(1, ["Kasumi"])],
                    "other_member": {},
                    "comment": None,
                }
            ]
        },
    )
    conflicting_order_response = integration_test_client.post(
        "/api/console/lives/41/setlist",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "setlist_rows": [
                {
                    "song_id": 3,
                    "absolute_order": 1,
                    "segment_type": "M",
                    "sub_order": 1,
                    "is_short": False,
                    "band_performances": [_base_performance(3, ["Tomori"])],
                    "other_member": {},
                    "comment": None,
                },
                {
                    "song_id": 4,
                    "absolute_order": 1,
                    "segment_type": "M",
                    "sub_order": 2,
                    "is_short": False,
                    "band_performances": [_base_performance(1, ["Kasumi"])],
                    "other_member": {},
                    "comment": None,
                },
            ]
        },
    )

    assert duplicate_song_response.status_code == 409
    assert duplicate_song_response.json()["detail"] == "Song name already exists: Yes! BanG_Dream!"
    assert missing_song_response.status_code == 404
    assert missing_song_response.json()["detail"] == "Song ids not found: 999"
    assert conflicting_order_response.status_code == 400
    assert conflicting_order_response.json()["detail"] == "Duplicate absolute_order in setlist_rows: 1"


# 测试点：追加 setlist 连到测试库时若批次内存在缺失 song_id，应整批回滚且不插入有效行。
def test_console_append_live_setlist_rolls_back_when_one_row_is_invalid(
    integration_test_client,
    integration_admin_connection,
):
    """Verify a mixed valid/invalid setlist append does not partially persist rows."""
    editor_user_id = _get_user_id(integration_admin_connection, "editor_tester")
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )
    setlist_count_before = _count_rows(
        integration_admin_connection,
        "SELECT COUNT(*) FROM live_setlist WHERE live_id = %s",
        (41,),
    )

    response = integration_test_client.post(
        "/api/console/lives/41/setlist",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "setlist_rows": [
                {
                    "song_id": 4,
                    "absolute_order": 3,
                    "segment_type": "EN",
                    "sub_order": 1,
                    "is_short": False,
                    "band_performances": [_base_performance(1, ["Kasumi", "Tae"])],
                    "other_member": {},
                    "comment": "should rollback",
                },
                {
                    "song_id": 999,
                    "absolute_order": 4,
                    "segment_type": "SP",
                    "sub_order": 1,
                    "is_short": False,
                    "band_performances": [_base_performance(2, ["Yukina"])],
                    "other_member": {},
                    "comment": "missing song",
                },
            ]
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Song ids not found: 999"
    assert _count_rows(integration_admin_connection, "SELECT COUNT(*) FROM live_setlist WHERE live_id = %s", (41,)) == setlist_count_before
    assert _count_rows(
        integration_admin_connection,
        "SELECT COUNT(*) FROM live_setlist WHERE live_id = %s AND absolute_order IN (%s, %s)",
        (41, 3, 4),
    ) == 0
    assert _get_latest_audit_row(integration_admin_connection, user_id=editor_user_id)[0] == "login_success"


def test_console_append_live_setlist_stores_segment_type_raw(
    integration_test_client,
    integration_admin_connection,
):
    """Verify OP/WEN segment types are stored as-is without normalization."""
    editor_user_id = _get_user_id(integration_admin_connection, "editor_tester")
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )

    response = integration_test_client.post(
        "/api/console/lives/41/setlist",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "setlist_rows": [
                {
                    "song_id": 4,
                    "absolute_order": 5,
                    "segment_type": "OP",
                    "sub_order": 1,
                    "is_short": False,
                    "band_performances": [_base_performance(1, ["Kasumi"])],
                    "other_member": {},
                    "comment": "opening track",
                },
                {
                    "song_id": 29,
                    "absolute_order": 6,
                    "segment_type": "WEN",
                    "sub_order": 1,
                    "is_short": False,
                    "band_performances": [_base_performance(2, ["Yukina"])],
                    "other_member": {},
                    "comment": "w encore",
                },
            ]
        },
    )

    assert response.status_code == 201
    assert response.json()["item"]["inserted_row_count"] == 2

    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "SELECT absolute_order, segment_type, sub_order, comment FROM live_setlist WHERE live_id = %s AND absolute_order >= 5 ORDER BY absolute_order",
            (41,),
        )
        rows = cursor.fetchall()

    assert rows == [
        (5, "OP", 1, "opening track"),
        (6, "WEN", 1, "w encore"),
    ]


# 测试点：向已有 setlist 的 Live 追加应返回 409，禁止覆盖已有数据。
def test_console_append_live_setlist_rejects_when_live_has_existing_rows(
    integration_test_client,
):
    """Verify the console setlist endpoint rejects appends to a live that already has setlist rows."""
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username=TEST_DEFAULT_ADMIN_USERNAME,
        password=TEST_DEFAULT_ADMIN_PASSWORD,
    )

    response = integration_test_client.post(
        "/api/console/lives/1/setlist",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "setlist_rows": [
                {
                    "song_id": 4,
                    "absolute_order": 1,
                    "segment_type": "M",
                    "sub_order": 1,
                    "is_short": False,
                    "band_performances": [_base_performance(1, ["Kasumi"])],
                    "other_member": {},
                    "comment": None,
                }
            ]
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Live id 1 already has setlist data"


# 测试点：批量新增歌曲接口应一次写入多条歌曲，部分冲突时跳过冲突项继续写入其余项。
def test_console_create_songs_batch_persists_and_skips_conflicts(
    integration_test_client,
    integration_admin_connection,
):
    """Verify batch song creation writes multiple rows and skips duplicates."""
    editor_user_id = _get_user_id(integration_admin_connection, "editor_tester")
    csrf_token = _login_and_get_csrf_for(
        integration_test_client,
        username="editor_tester",
        password="editor-test-pass",
    )

    response = integration_test_client.post(
        "/api/console/songs:batch",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "songs": [
                {"song_name": "Batch Song A", "band_id": 2, "cover": False},
                {"song_name": "Batch Song B", "band_id": 1, "cover": True},
                {"song_name": "Yes! BanG_Dream!", "band_id": 1, "cover": False},
            ]
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["ok"] is False
    assert len(data["created"]) == 2
    assert data["created"][0]["song_name"] == "Batch Song A"
    assert data["created"][0]["band_id"] == 2
    assert data["created"][1]["song_name"] == "Batch Song B"
    assert data["created"][1]["cover"] is True

    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "SELECT id FROM song_list WHERE song_name = %s",
            ("Batch Song A",),
        )
        assert cursor.fetchone() is not None
        cursor.execute(
            "SELECT id FROM song_list WHERE song_name = %s",
            ("Batch Song B",),
        )
        assert cursor.fetchone() is not None

    assert _get_latest_audit_row(integration_admin_connection, user_id=editor_user_id)[0] == "song_create"
