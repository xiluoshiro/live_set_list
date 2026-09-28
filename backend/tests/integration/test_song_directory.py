from typing import Any

import pytest

from tests.integration.test_song_catalog_api import auth

pytestmark = pytest.mark.integration


def create_group(client: Any, headers: dict[str, str], name: str, ownership: dict[str, Any] | None = None) -> dict[str, Any]:
    response = client.post("/api/console/song-groups", headers=headers, json={
        "group_name": name, "song_name": name, "ownership": ownership or {"mode": "pending"},
    })
    assert response.status_code == 201, response.text
    return response.json()["item"]


def add_version(client: Any, headers: dict[str, str], group_id: int, name: str, band_id: int) -> dict[str, Any]:
    group = client.get(f"/api/song-groups/{group_id}").json()
    response = client.post("/api/console/songs", headers=headers, json={
        "group_id": group_id, "expected_group_revision": group["revision"], "song_name": name,
        "version_label": name, "ownership": {"mode": "bands", "band_ids": [band_id]},
    })
    assert response.status_code == 201, response.text
    return response.json()["item"]


def create_album(client: Any, headers: dict[str, str], name: str, song_ids: list[int],
                 date: str | None = None, covers: list[str] | None = None) -> dict[str, Any]:
    response = client.post("/api/console/albums", headers=headers, json={
        "album_name": name, "release_date": date, "cover_urls": covers or [],
        "tracks": [{"song_id": song_id} for song_id in song_ids],
    })
    assert response.status_code == 201, response.text
    return response.json()


# 测试点：目录按组去重，首发跨全部版本聚合并保留同日唱片，封面仅取默认版本的收录且与组详情一致。
def test_directory_release_and_cover_across_versions(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    song = create_group(client, headers, "目录验收曲", {"mode": "bands", "band_ids": [1]})
    gid, sid = song["group_id"], song["song_id"]
    other = add_version(client, headers, gid, "合作版", 2)
    third = add_version(client, headers, gid, "现场编曲", 1)
    create_album(client, headers, "未知日期图", [sid], covers=["https://example.test/undated.png"])
    earliest = create_album(client, headers, "首发 A", [sid, sid], "2018-12-12")
    tied = create_album(client, headers, "首发 B", [other["song_id"]], "2018-12-12")
    create_album(client, headers, "后续封面", [other["song_id"]], "2020-01-01",
                         ["https://example.test/default.png", "https://example.test/second.png"])
    cover = create_album(client, headers, "后续同日", [sid], "2020-01-01", ["https://example.test/tied.png"])
    for band in (None, 1, 2):
        params = {"q": "目录验收曲", **({"band_id": band} if band else {})}
        result = client.get("/api/song-groups", params=params)
        assert result.status_code == 200, result.text
        page = result.json()
        assert page["pagination"]["total"] == 1
        item = page["items"][0]
        assert item["version_count"] == 3
        expected_ids = [sid, other["song_id"], third["song_id"]] if band is None else (
            [sid, third["song_id"]] if band == 1 else [other["song_id"]])
        assert item["matched_song_ids"] == expected_ids
        assert item["first_release_date"] == "2018-12-12"
        assert [a["album_id"] for a in item["first_release_albums"]] == [earliest["album_id"], tied["album_id"]]
        assert item["display_cover"] == {"source": "album", "url": "https://example.test/tied.png",
                                          "album_id": cover["album_id"], "album_name": "后续同日"}
        assert item["display_cover"] == client.get(f"/api/song-groups/{gid}").json()["display_cover"]
        assert item["performance_count"] == 0 and item["latest_performance_date"] is None
    # A version must satisfy both filters; group membership alone cannot join unrelated matches.
    assert client.get("/api/song-groups", params={"q": "目录验收曲", "band_id": 2,
                                                 "album_id": earliest["album_id"]}).json()["items"] == []


# 测试点：成员与混合归属进入乐队目录，pending 留在全部歌曲，数量不随翻页或选中乐队变化。
def test_directory_facets_band_search_and_pending(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    member_response = client.post("/api/console/members", headers=headers, json={"display_name": "目录成员"})
    assert member_response.status_code == 201
    member_id = member_response.json()["member_id"]
    joint = create_group(client, headers, "分面 A", {"mode": "bands", "band_ids": [1, 2]})
    create_group(client, headers, "分面 B", {"mode": "members", "member_groups": [{"band_id": 2, "member_ids": [member_id]}]})
    create_group(client, headers, "分面 C", {"mode": "mixed", "band_ids": [1],
                 "member_groups": [{"band_id": 3, "member_ids": [member_id]}]})
    create_group(client, headers, "分面 D")
    all_page = client.get("/api/song-groups", params={"q": "分面", "page_size": 1}).json()
    assert all_page["pagination"]["total"] == all_page["facets"]["total"] == 4
    counts = {b["band_id"]: b["song_count"] for b in all_page["facets"]["bands"]}
    assert counts == {1: 2, 2: 2, 3: 1}
    for band_id, expected in counts.items():
        page = client.get("/api/song-groups", params={"q": "分面", "band_id": band_id,
                                                     "page_size": 1, "page": 2}).json()
        assert page["facets"] == all_page["facets"]
        assert page["pagination"]["total"] == expected
    band_name = joint["ownership"]["bands"][0]["band_name"]
    found = client.get("/api/song-groups", params={"q": band_name, "page_size": 100}).json()
    assert joint["group_id"] in [g["group_id"] for g in found["items"]]
    missing = client.get("/api/song-groups", params={"q": "绝不会命中的歌曲目录测试"}).json()
    assert missing["items"] == [] and missing["facets"] == {"total": 0, "bands": []}


# 测试点：四种排序先作用于整个命中集合再分页，空日期最后，相同值有稳定次序。
def test_directory_sort_and_pagination(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = auth(client)
    songs = [create_group(client, headers, f"排序 {name}") for name in "ABCDEFG"]
    for index, date in ((0, "2018-01-01"), (1, "2018-01-01"), (2, "2017-01-01"), (3, "2020-01-01")):
        create_album(client, headers, f"排序唱片 {index}", [songs[index]["song_id"]], date)
    create_album(client, headers, "日期未知的唱片", [songs[4]["song_id"]])
    with integration_admin_connection.cursor() as cur:
        cur.execute("UPDATE live_attrs SET live_date = '2020-01-01' WHERE id = 1")
        cur.execute("UPDATE live_attrs SET live_date = '2021-01-01' WHERE id = 2")
        for index, live_ids in ((0, [1, 1]), (1, [2]), (2, [2, 2])):
            for occurrence, live_id in enumerate(live_ids):
                order = 900 + index * 10 + occurrence
                cur.execute("""INSERT INTO live_setlist(live_id, song_group_id, absolute_order, segment_type, sub_order)
                    VALUES (%s, %s, %s, 'M', %s)""", (live_id, songs[index]["group_id"], order, order))
    expected_orders = {"name": "ABCDEFG", "plays": "ACBDEFG", "recent": "BCADEFG", "release": "CABDEFG"}
    for sort, expected in expected_orders.items():
        ids = []
        for page in range(1, 5):
            result = client.get("/api/song-groups", params={"q": "排序 ", "sort": sort, "page_size": 2, "page": page})
            assert result.status_code == 200, result.text
            body = result.json()
            assert client.get("/api/song-groups", params={"q": "排序 ", "sort": sort, "page_size": 2, "page": page}).json()["items"] == body["items"]
            assert body["pagination"]["total"] == 7 and body["pagination"]["total_pages"] == 4
            ids.extend(row["group_name"].split()[-1] for row in body["items"])
        assert "".join(ids) == expected
    for name in ("排序 E", "排序 F"):
        unknown = client.get("/api/song-groups", params={"q": name}).json()["items"][0]
        assert unknown["first_release_date"] is None and unknown["first_release_albums"] == []
        assert unknown["display_cover"] is None
    assert client.get("/api/song-groups?sort=invalid").status_code == 422


# 测试点：公共目录维持等价标点、全角字符规范化，同时将搜索中的百分号作为字面量。
def test_directory_normalized_name_search(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    song = create_group(client, headers, "Ｗｈａｔ’s the POPIPA！？")
    for query in ("What's the POPIPA!?", "Ｗｈａｔ’s the POPIPA！？"):
        result = client.get("/api/song-groups", params={"q": query}).json()
        assert song["group_id"] in [item["group_id"] for item in result["items"]]
    literal = create_group(client, headers, "百分比 100%")
    create_group(client, headers, "百分比 1000")
    result = client.get("/api/song-groups", params={"q": "百分比 100%"}).json()
    assert [item["group_id"] for item in result["items"]] == [literal["group_id"]]


# 测试点：真实资料写入后首发、默认封面、收录、目录归属与歌单统计立即反映到公共摘要和详情。
def test_directory_refreshes_after_catalog_and_setlist_writes(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = auth(client)
    song = create_group(client, headers, "变更验收", {"mode": "bands", "band_ids": [1]})
    sid, gid = song["song_id"], song["group_id"]
    album = create_album(client, headers, "变更唱片", [sid], "2020-01-01",
                         ["https://example.test/a.png", "https://example.test/b.png"])

    def summary():
        response = client.get("/api/song-groups", params={"q": "变更验收"})
        assert response.status_code == 200, response.text
        return response.json()

    initial = summary()["items"][0]
    assert initial["first_release_date"] == "2020-01-01"
    assert initial["display_cover"]["url"] == "https://example.test/a.png"
    updated = client.put(f"/api/console/albums/{album['album_id']}", headers=headers, json={
        "expected_revision": album["revision"], "album_name": album["album_name"],
        "release_date": "2018-12-12", "cover_urls": list(reversed(album["cover_urls"])),
    })
    assert updated.status_code == 200, updated.text
    changed = summary()["items"][0]
    assert changed["first_release_date"] == "2018-12-12"
    assert changed["display_cover"]["url"] == "https://example.test/b.png"
    assert changed["display_cover"] == client.get(f"/api/song-groups/{gid}").json()["display_cover"]
    assert client.get(f"/api/songs/{sid}").json()["albums"][0]["release_date"] == "2018-12-12"
    removed = client.put(f"/api/console/albums/{album['album_id']}/tracks", headers=headers, json={
        "expected_revision": updated.json()["revision"], "tracks": [],
    })
    assert removed.status_code == 200, removed.text
    changed = summary()["items"][0]
    assert changed["first_release_date"] is None and changed["first_release_albums"] == []
    assert changed["display_cover"] is None
    assert client.get(f"/api/songs/{sid}").json()["albums"] == []
    assert [b["band_id"] for b in summary()["facets"]["bands"]] == [1]
    owner = client.put(f"/api/console/songs/{sid}/ownership", headers=headers, json={
        "expected_revision": song["revision"], "reason": "验收归属修订", "ownership": {"mode": "bands", "band_ids": [2]},
    })
    assert owner.status_code == 200, owner.text
    assert [b["band_id"] for b in summary()["facets"]["bands"]] == [2]
    assert client.get("/api/song-groups", params={"q": "变更验收", "band_id": 1}).json()["pagination"]["total"] == 0
    assert client.get(f"/api/songs/{sid}").json()["ownership"]["band_ids"] == [2]
    with integration_admin_connection.cursor() as cur:
        cur.execute("UPDATE live_attrs SET live_date = '2024-01-02' WHERE id = 1")
    written = client.put("/api/console/lives/1/setlist", headers=headers, json={"setlist_rows": [{
        "song_group_id": gid, "absolute_order": 900, "segment_type": "M", "sub_order": 900,
        "is_short": True, "band_performances": [{"band_id": 1, "lineup_usage": "base", "members": ["Kasumi"]}],
        "other_member": {},
    }]})
    assert written.status_code in (200, 201), written.text
    changed = summary()["items"][0]
    assert changed["performance_count"] == 1 and changed["latest_performance_date"] == "2024-01-02"
    assert client.get(f"/api/songs/{sid}").json()["performance_count"] == 1
    history = client.get(f"/api/songs/{sid}/performances").json()
    assert history["pagination"]["total"] == 1 and history["available_years"] == [2024]


# 测试点：同场重复演奏逐条计数，年份过滤先于分页，可选年份和组总次数不随过滤变化。
def test_directory_performance_years_and_validity(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = auth(client)
    song = create_group(client, headers, "年份验收")
    version = add_version(client, headers, song["group_id"], "第二版本", 1)
    with integration_admin_connection.cursor() as cur:
        cur.execute("UPDATE live_attrs SET live_date = '2024-04-01' WHERE id = 1")
        cur.execute("UPDATE live_attrs SET live_date = '2025-05-02' WHERE id = 2")
        for live_id in (1, 2):
            for index in range(3):
                cur.execute("""INSERT INTO live_setlist(live_id, song_group_id, absolute_order, segment_type, sub_order, is_short)
                    VALUES (%s, %s, %s, 'M', %s, %s)""", (live_id, song["group_id"], 900 + index, 900 + index, index == 0))
    sid = song["song_id"]
    for selected in (sid, version["song_id"]):
        assert client.get(f"/api/songs/{selected}").json()["performance_count"] == 6
        first = client.get(f"/api/songs/{selected}/performances?year=2024&page_size=2").json()
        second = client.get(f"/api/songs/{selected}/performances?year=2024&page_size=2&page=2").json()
        assert first["available_years"] == second["available_years"] == [2025, 2024]
        assert first["pagination"]["total"] == second["pagination"]["total"] == 3
        records = first["items"] + second["items"]
        assert len(records) == len({item["setlist_id"] for item in records}) == 3
        assert {item["live_date"] for item in records} == {"2024-04-01"}
        assert sum(item["is_short"] for item in records) == 1
        empty = client.get(f"/api/songs/{selected}/performances?year=2000").json()
        assert empty["items"] == [] and empty["pagination"]["total"] == 0
        assert empty["available_years"] == [2025, 2024]
    for zone in ("Pacific/Kiritimati", "Pacific/Honolulu"):
        item = client.get("/api/song-groups?q=年份验收", headers={"X-Visitor-Timezone": zone}).json()["items"][0]
        assert item["performance_count"] == 6 and item["latest_performance_date"] == "2025-05-02"
    # Legacy facts can exist even though current write APIs reject future/cancelled setlists.
    for assignment in ("live_date = '9999-01-01'", "event_status = 'cancelled'",
                       "venue_id = NULL, venue_name_version_id = NULL, start_time = NULL, opening_time = NULL"):
        with integration_admin_connection.cursor() as cur:
            cur.execute("SELECT live_date, event_status, venue_id, venue_name_version_id, start_time, opening_time FROM live_attrs WHERE id = 2")
            original = cur.fetchone()
            cur.execute(f"UPDATE live_attrs SET {assignment} WHERE id = 2")
        item = client.get("/api/song-groups?q=年份验收").json()["items"][0]
        history = client.get(f"/api/songs/{sid}/performances").json()
        assert item["performance_count"] == history["pagination"]["total"] == 3
        assert item["latest_performance_date"] == "2024-04-01" and history["available_years"] == [2024]
        with integration_admin_connection.cursor() as cur:
            cur.execute("""UPDATE live_attrs SET live_date=%s, event_status=%s, venue_id=%s, venue_name_version_id=%s,
                start_time=%s, opening_time=%s WHERE id=2""", original)
