import psycopg2
import pytest
from psycopg2.extras import Json

from tests.integration.test_song_catalog_api import auth
from tests.integration.test_song_directory import add_version, create_album, create_group

pytestmark = pytest.mark.integration


# 测试点：命名封面跟随默认版本并保留名称，排序、删图、留空及专辑回退均读回对应名称。
def test_song_covers_roundtrip_and_default_group(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    covers = [{"url": "https://example.test/song-b.png", "name": "正面"},
              {"url": "https://example.test/song-a.png", "name": "背面"}]
    response = client.post("/api/console/song-groups", headers=headers, json={
        "group_name": "歌曲封面验收", "song_name": "歌曲封面验收", "ownership": {"mode": "pending"},
        "cover_urls": covers,
    })
    assert response.status_code == 201, response.text
    song = response.json()["item"]
    sid, gid = song["song_id"], song["group_id"]
    other = add_version(client, headers, gid, "其他版本", 1)
    create_album(client, headers, "其他版本早期专辑", [other["song_id"]], "2000-01-01", ["https://example.test/other.png"])
    create_album(client, headers, "默认版无图首发", [sid], "2010-01-01")
    create_album(client, headers, "默认版日期未知", [sid], covers=["https://example.test/undated.png"])
    album = create_album(client, headers, "默认版有图专辑", [sid], "2020-01-01", [{"url": "https://example.test/album.png", "name": "专辑封面"}])
    create_album(client, headers, "同日较大 ID", [sid], "2020-01-01", ["https://example.test/tie.png"])
    group = client.get(f"/api/song-groups/{gid}").json()
    response = client.put(f"/api/console/song-groups/{gid}", headers=headers, json={
        "group_name": group["group_name"], "expected_revision": group["revision"],
        "song_ids": [other["song_id"], sid],
    })
    assert response.status_code == 200, response.text

    def check(expected):
        detail = client.get(f"/api/songs/{sid}").json()
        assert detail["display_cover"] == expected
        assert client.get(f"/api/console/songs/{sid}").json() == detail
        assert client.get(f"/api/song-groups/{gid}").json()["display_cover"] == expected
        for params in ({"q": "歌曲封面验收"}, {"q": "歌曲封面验收", "band_id": 1}):
            assert client.get("/api/song-groups", params=params).json()["items"][0]["display_cover"] == expected
        return detail

    song = check({"source": "song", **covers[0]})
    assert song["cover_urls"] == covers
    assert client.get(f"/api/songs/{other['song_id']}").json()["display_cover"]["url"] == "https://example.test/other.png"
    for fields, expected_urls in (({}, covers), ({"cover_urls": list(reversed(covers))}, list(reversed(covers))),
                                  ({"cover_urls": [covers[0]]}, [covers[0]]), ({"cover_urls": []}, [])):
        payload = {"song_name": song["song_name"], "expected_revision": song["revision"], **fields}
        response = client.put(f"/api/console/songs/{sid}", headers=headers, json=payload)
        assert response.status_code == 200, response.text
        song = response.json()["item"]
        assert song["cover_urls"] == expected_urls
        assert client.put(f"/api/console/songs/{sid}", headers=headers, json=payload).status_code == 409
        expected = {"source": "song", **expected_urls[0]} if expected_urls else {
            "source": "album", "url": "https://example.test/album.png", "name": "专辑封面", "album_id": album["album_id"], "album_name": album["album_name"],
        }
        check(expected)
    # Removing all default-version tracks must not borrow a different version's cover.
    for entry in song["albums"]:
        response = client.put(f"/api/console/albums/{entry['album_id']}/tracks", headers=headers,
                              json={"expected_revision": entry["revision"], "tracks": []})
        assert response.status_code == 200, response.text
    check(None)


# 测试点：旧版字符串可创建未命名封面，非法地址、名称或重复项不能改变原值。
def test_version_cover_creation_and_validation(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    default = create_group(client, headers, "版本封面")
    response = client.post("/api/console/songs", headers=headers, json={
        "group_id": default["group_id"], "expected_group_revision": 1, "song_name": "特别版",
        "version_label": "特别版", "ownership": {"mode": "pending"},
        "cover_urls": [" https://example.test/own.png "],
    })
    assert response.status_code == 201, response.text
    song = response.json()["item"]
    assert song["cover_urls"] == [{"url": "https://example.test/own.png", "name": ""}]
    assert song["display_cover"] == {"source": "song", "url": "https://example.test/own.png", "name": ""}
    for invalid in (["http://example.test/a"], ["https://example.test/a", " https://example.test/a "], [None], [""],
                    [{"url": "https://example.test/a", "name": "名" * 256}]):
        response = client.put(f"/api/console/songs/{song['song_id']}", headers=headers, json={
            "song_name": song["song_name"], "version_label": song["version_label"],
            "expected_revision": song["revision"], "cover_urls": invalid,
        })
        assert response.status_code == 422, response.text
        assert "cover_urls" in response.json()["detail"][0]["loc"]
    assert client.get(f"/api/songs/{song['song_id']}").json() == song
    assert client.get(f"/api/song-groups/{default['group_id']}").json()["display_cover"] is None


# 测试点：歌曲与专辑的数据库约束允许空数组和二十个命名封面，拒绝错误结构与超长名称。
@pytest.mark.parametrize("table", ["song_list", "albums"])
def test_cover_database_constraints(integration_admin_connection, table):
    conn = integration_admin_connection
    with conn.cursor() as cur:
        if table == "albums":
            cur.execute("INSERT INTO albums(id, album_name) VALUES (1, '约束盘') ON CONFLICT DO NOTHING")
        for values in ([], [{"url": f"https://example.test/{i}", "name": "名" * 255} for i in range(20)]):
            cur.execute(f"UPDATE {table} SET cover_urls = %s WHERE id = 1", (Json(values),))
            cur.execute(f"SELECT cover_urls FROM {table} WHERE id = 1")
            assert cur.fetchone()[0] == values
        for values in ([None], [{"url": "x", "name": ""}] * 21, [["x", "y"]], ["x"], {}, None,
                       [{"url": "x"}], [{"url": None, "name": ""}], [{"url": "x", "name": None}],
                       [{"url": "x", "name": "名" * 256}]):
            with pytest.raises(psycopg2.errors.CheckViolation):
                cur.execute(f"UPDATE {table} SET cover_urls = %s WHERE id = 1", (Json(values),))
        with pytest.raises(psycopg2.errors.NotNullViolation):
            cur.execute(f"UPDATE {table} SET cover_urls = NULL WHERE id = 1")
