from pathlib import Path

import psycopg2
import pytest

from tests.integration.test_song_catalog_api import auth

pytestmark = pytest.mark.integration


# 测试点：页面和有序封面贯穿管理及公开响应，省略保留、显式清空，曲目更新不覆盖链接。
def test_album_links_roundtrip_and_partial_updates(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    covers = ["https://img.example.test/b?size=800", "https://img.example.test/a"]
    response = client.post("/api/console/albums", headers=headers, json={
        "album_name": "封面盘", "album_url": " https://example.test/disc/1 ",
        "cover_urls": covers, "tracks": [{"song_id": 1}],
    })
    assert response.status_code == 201, response.text
    album = response.json()
    aid = album["album_id"]
    assert album["album_url"] == "https://example.test/disc/1"
    assert album["cover_urls"] == covers
    assert client.get(f"/api/albums/{aid}").json() == album
    assert client.get(f"/api/console/albums/{aid}").json() == album
    summary = {key: value for key, value in album.items() if key != "tracks"}
    assert summary in client.get("/api/console/albums").json()["items"]
    song = client.get("/api/songs/1").json()
    assert summary in song["albums"]
    group = client.get(f"/api/song-groups/{song['group_id']}").json()
    assert summary in next(v for v in group["versions"] if v["song_id"] == 1)["albums"]
    response = client.put(f"/api/console/albums/{aid}", headers=headers, json={
        "album_name": "改名", "expected_revision": album["revision"],
    })
    assert response.status_code == 200, response.text
    changed = response.json()
    assert changed["album_url"] == album["album_url"] and changed["cover_urls"] == covers
    assert changed["tracks"] == album["tracks"]
    response = client.put(f"/api/console/albums/{aid}/tracks", headers=headers, json={
        "expected_revision": changed["revision"], "tracks": [{"song_id": 2}],
    })
    assert response.status_code == 200, response.text
    changed = response.json()
    assert changed["album_url"] == album["album_url"] and changed["cover_urls"] == covers
    assert changed["tracks"][0]["song_id"] == 2
    response = client.put(f"/api/console/albums/{aid}", headers=headers, json={
        "album_name": "改名", "expected_revision": changed["revision"], "cover_urls": list(reversed(covers)),
    })
    assert response.status_code == 200, response.text
    assert response.json()["cover_urls"] == list(reversed(covers))
    response = client.put(f"/api/console/albums/{aid}", headers=headers, json={
        "album_name": "改名", "expected_revision": response.json()["revision"], "album_url": None, "cover_urls": [],
    })
    assert response.status_code == 200, response.text
    assert response.json()["album_url"] is None and response.json()["cover_urls"] == []


# 测试点：校验错误、缺少 CSRF 及过期 revision 均不能覆盖已保存的链接和顺序。
def test_failed_cover_update_preserves_album(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    album = client.post("/api/console/albums", headers=headers, json={
        "album_name": "受保护盘", "cover_urls": ["https://example.test/a"],
    }).json()
    endpoint = f"/api/console/albums/{album['album_id']}"
    payload = {"album_name": "受保护盘", "expected_revision": album["revision"], "cover_urls": []}
    assert client.put(endpoint, json=payload).status_code == 403
    invalid = client.put(endpoint, headers=headers, json={**payload, "cover_urls": ["https://example.test/a", "bad"]})
    assert invalid.status_code == 422
    assert invalid.json()["detail"][0]["loc"] == ["body", "cover_urls", 1]
    assert client.get(endpoint).json() == album
    saved = client.put(endpoint, headers=headers, json=payload)
    assert saved.status_code == 200
    assert client.put(endpoint, headers=headers, json={**payload, "cover_urls": ["https://example.test/b"]}).status_code == 409
    assert client.get(endpoint).json() == saved.json()


# 测试点：无封面新建采用空默认值，普通浏览者不能修改专辑链接。
def test_album_link_defaults_and_viewer_permissions(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    response = client.post("/api/console/albums", headers=headers, json={"album_name": "无封面盘"})
    assert response.status_code == 201, response.text
    album = response.json()
    assert album["album_url"] is None and album["cover_urls"] == []
    client.cookies.clear()
    login = client.post("/api/auth/login", json={"username": "viewer_tester", "password": "viewer-test-pass"})
    assert login.status_code == 200
    response = client.put(f"/api/console/albums/{album['album_id']}",
                          headers={"X-CSRF-Token": login.json()["csrf_token"]}, json={
                              "album_name": "无封面盘", "expected_revision": 1,
                              "album_url": "https://example.test/album", "cover_urls": ["https://example.test/a"],
                          })
    assert response.status_code == 403
    assert client.get(f"/api/albums/{album['album_id']}").json() == album


# 测试点：V40 增量迁移保留已有专辑和收录；数组维度、下标、null 和数量由数据库约束阻止。
def test_album_link_migration_and_constraints(integration_admin_connection):
    conn = integration_admin_connection
    migration = Path(__file__).resolve().parents[2] / "db/flyway/sql/V41__add_album_links_and_cover_urls.sql"
    with conn.cursor() as cur:
        cur.execute("BEGIN")
        try:
            cur.execute("ALTER TABLE albums DROP COLUMN album_url, DROP COLUMN cover_urls")
            cur.execute("INSERT INTO albums(album_name, revision) VALUES ('迁移盘', 7) RETURNING id")
            aid = cur.fetchone()[0]
            cur.execute("INSERT INTO album_sections(album_id, section_name, display_order) VALUES (%s, 'Disc1', 1) RETURNING id", (aid,))
            section_id = cur.fetchone()[0]
            cur.execute("INSERT INTO album_tracks(album_id, section_id, song_id, track_order) VALUES (%s, %s, 1, 1)", (aid, section_id))
            cur.execute("SELECT id, album_id, section_id, song_id, track_order FROM album_tracks ORDER BY id")
            tracks = cur.fetchall()
            cur.execute(migration.read_text(encoding="utf-8"))
            cur.execute("SELECT album_name, album_url, cover_urls, revision FROM albums WHERE id = %s", (aid,))
            assert cur.fetchone() == ("迁移盘", None, [], 7)
            cur.execute("SELECT id, album_id, section_id, song_id, track_order FROM album_tracks ORDER BY id")
            assert cur.fetchall() == tracks
            cur.execute("SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'albums'")
            assert cur.fetchone()[0] == "live_project_owner"
            for expression in ["ARRAY[NULL]::text[]", "array_fill('https://example.test/a'::text, ARRAY[21])",
                               "'[0:0]={https://example.test/a}'::text[]", "ARRAY[['a','b'],['c','d']]", "NULL"]:
                cur.execute("SAVEPOINT invalid_cover")
                with pytest.raises(psycopg2.Error):
                    cur.execute(f"UPDATE albums SET cover_urls = {expression} WHERE id = %s", (aid,))
                cur.execute("ROLLBACK TO SAVEPOINT invalid_cover")
            cur.execute("UPDATE albums SET cover_urls = ARRAY['https://example.test/b','https://example.test/a'] WHERE id = %s", (aid,))
            cur.execute("SELECT cover_urls FROM albums WHERE id = %s", (aid,))
            assert cur.fetchone()[0] == ["https://example.test/b", "https://example.test/a"]
        finally:
            cur.execute("ROLLBACK")


# 测试点：发现旧封面数据时迁移明确失败并保留旧值，不静默切换到空封面。
def test_album_link_migration_blocks_legacy_covers(integration_admin_connection):
    conn = integration_admin_connection
    migration = Path(__file__).resolve().parents[2] / "db/flyway/sql/V41__add_album_links_and_cover_urls.sql"
    with conn.cursor() as cur:
        cur.execute("BEGIN")
        try:
            cur.execute("ALTER TABLE albums DROP COLUMN album_url, DROP COLUMN cover_urls")
            cur.execute("INSERT INTO albums(album_name, cover_path) VALUES ('旧封面', '/album-covers/a.webp') RETURNING id")
            aid = cur.fetchone()[0]
            cur.execute("SAVEPOINT migration_guard")
            with pytest.raises(psycopg2.errors.RaiseException, match="cover_path"):
                cur.execute(migration.read_text(encoding="utf-8"))
            cur.execute("ROLLBACK TO SAVEPOINT migration_guard")
            cur.execute("SELECT cover_path FROM albums WHERE id = %s", (aid,))
            assert cur.fetchone()[0] == "/album-covers/a.webp"
        finally:
            cur.execute("ROLLBACK")
