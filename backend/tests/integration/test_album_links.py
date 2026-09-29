import pytest

from tests.integration.test_song_catalog_api import auth

pytestmark = pytest.mark.integration


# 测试点：命名封面贯穿管理及公开响应，改名和排序可保存，省略或更新曲目保留名称。
def test_album_links_roundtrip_and_partial_updates(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    covers = [{"url": "https://img.example.test/b?size=800", "name": "初回限定盤"},
              {"url": "https://img.example.test/a", "name": "通常盤"}]
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
    renamed = [{"url": covers[1]["url"], "name": "裏面"}, covers[0]]
    response = client.put(f"/api/console/albums/{aid}", headers=headers, json={
        "album_name": "改名", "expected_revision": response.json()["revision"], "cover_urls": renamed,
    })
    assert response.status_code == 200, response.text
    assert client.get(f"/api/albums/{aid}").json()["cover_urls"] == renamed
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
    assert invalid.json()["detail"][0]["loc"] == ["body", "cover_urls", 1, "url"]
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
