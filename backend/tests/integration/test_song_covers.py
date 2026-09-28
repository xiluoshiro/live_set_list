import psycopg2
import pytest

from tests.integration.test_song_catalog_api import auth
from tests.integration.test_song_directory import add_version, create_album, create_group

pytestmark = pytest.mark.integration


# 测试点：各版本独立选图，组封面跟随默认版本而非排序或筛选结果，编辑保留和清空有明确语义。
def test_song_covers_roundtrip_and_default_group(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    covers = ["https://example.test/song-b.png", "https://example.test/song-a.png"]
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
    album = create_album(client, headers, "默认版有图专辑", [sid], "2020-01-01", ["https://example.test/album.png"])
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

    song = check({"source": "song", "url": covers[0]})
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
        expected = {"source": "song", "url": expected_urls[0]} if expected_urls else {
            "source": "album", "url": "https://example.test/album.png", "album_id": album["album_id"], "album_name": album["album_name"],
        }
        check(expected)
    # Removing all default-version tracks must not borrow a different version's cover.
    for entry in song["albums"]:
        response = client.put(f"/api/console/albums/{entry['album_id']}/tracks", headers=headers,
                              json={"expected_revision": entry["revision"], "tracks": []})
        assert response.status_code == 200, response.text
    check(None)


# 测试点：新增非默认版本也保存有序封面，非法地址及重复项返回定位错误且不改变原值。
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
    assert song["cover_urls"] == ["https://example.test/own.png"]
    assert song["display_cover"] == {"source": "song", "url": "https://example.test/own.png"}
    for invalid in (["http://example.test/a"], ["https://example.test/a", " https://example.test/a "], [None], [""]):
        response = client.put(f"/api/console/songs/{song['song_id']}", headers=headers, json={
            "song_name": song["song_name"], "version_label": song["version_label"],
            "expected_revision": song["revision"], "cover_urls": invalid,
        })
        assert response.status_code == 422, response.text
        assert "cover_urls" in response.json()["detail"][0]["loc"]
    assert client.get(f"/api/songs/{song['song_id']}").json() == song
    assert client.get(f"/api/song-groups/{default['group_id']}").json()["display_cover"] is None


# 测试点：数据库允许空数组与最多二十张封面，拒绝空元素、超限和非一维数组。
def test_song_cover_database_constraints(integration_admin_connection):
    conn = integration_admin_connection
    with conn.cursor() as cur:
        for values in ([], [f"https://example.test/{i}" for i in range(20)]):
            cur.execute("UPDATE song_list SET cover_urls = %s WHERE id = 1", (values,))
            cur.execute("SELECT cover_urls FROM song_list WHERE id = 1")
            assert cur.fetchone()[0] == values
        for values, error in (([None], psycopg2.errors.CheckViolation), (["x"] * 21, psycopg2.errors.CheckViolation),
                              ([["x", "y"]], psycopg2.errors.FeatureNotSupported)):
            with pytest.raises(error):
                cur.execute("UPDATE song_list SET cover_urls = %s WHERE id = 1", (values,))
