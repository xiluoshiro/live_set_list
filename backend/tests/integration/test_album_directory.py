import pytest

from tests.integration.test_song_catalog_api import auth
from tests.integration.test_song_directory import add_version, create_album, create_group

pytestmark = pytest.mark.integration


# 测试点：专辑按收录版本归属筛选并去重，无乐队归属和空专辑进入其他乐队，含明确归属的混合专辑不进入其他。
def test_album_directory_band_facets_and_track_counts(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    song = create_group(client, headers, "专辑目录曲", {"mode": "bands", "band_ids": [1]})
    other = add_version(client, headers, song["group_id"], "其他乐队版", 2)
    member = client.post("/api/console/members", headers=headers, json={"display_name": "专辑成员"}).json()
    solo = create_group(client, headers, "专辑成员曲", {"mode": "members", "member_groups": [
        {"band_id": 3, "member_ids": [member["member_id"]]},
    ]})
    first = create_album(client, headers, "目录专辑 A", [song["song_id"], song["song_id"], solo["song_id"]])
    second = create_album(client, headers, "目录专辑 B", [other["song_id"]])
    empty = create_album(client, headers, "目录专辑 C", [])
    pending = create_group(client, headers, "未归属目录曲")
    unowned = create_album(client, headers, "目录专辑 D", [pending["song_id"], pending["song_id"]])
    mixed = create_album(client, headers, "目录专辑 E", [song["song_id"], pending["song_id"]])
    response = client.get("/api/albums", params={"q": "目录专辑", "sort": "name"})
    assert response.status_code == 200, response.text
    result = response.json()
    assert [(item["album_id"], item["track_count"]) for item in result["items"]] == [
        (first["album_id"], 3), (second["album_id"], 1), (empty["album_id"], 0),
        (unowned["album_id"], 2), (mixed["album_id"], 2),
    ]
    assert result["pagination"]["total"] == result["facets"]["total"] == 5
    assert {b["band_id"]: b["album_count"] for b in result["facets"]["bands"]} == {1: 2, 2: 1, 3: 1, 0: 2}
    for band_id, albums in ((1, [first, mixed]), (2, [second]), (3, [first]), (0, [empty, unowned])):
        selected = client.get("/api/albums", params={"q": "目录专辑", "band_id": band_id, "sort": "name"}).json()
        assert selected["facets"] == result["facets"]
        assert [item["album_id"] for item in selected["items"]] == [album["album_id"] for album in albums]
    second_page = client.get("/api/albums", params={"q": "目录专辑", "band_id": 0,
                                                   "sort": "name", "page_size": 1, "page": 2}).json()
    assert second_page["pagination"]["total"] == 2 and second_page["facets"] == result["facets"]
    assert [item["album_id"] for item in second_page["items"]] == [unowned["album_id"]]
    # Another version in the same group does not associate this album with its band.
    assert client.get("/api/albums", params={"q": "目录专辑 A", "band_id": 2}).json()["items"] == []
    band_name = song["ownership"]["bands"][0]["band_name"]
    found = client.get("/api/albums", params={"q": band_name}).json()
    assert first["album_id"] in [item["album_id"] for item in found["items"]]
    missing = client.get("/api/albums", params={"q": "绝不命中的专辑名"}).json()
    assert missing["items"] == [] and missing["facets"] == {
        "total": 0, "bands": [{"band_id": 0, "band_name": "其他乐队", "album_count": 0}],
    }


# 测试点：公开专辑目录在分页前稳定排序，未知日期置后，规范化搜索且通配字符按字面匹配。
def test_album_directory_search_sort_and_pagination(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    for name, date in (("A", "2020-01-01"), ("B", None), ("C", "2018-01-01"), ("D", "2020-01-01")):
        create_album(client, headers, f"排序专辑 {name}", [], date)
    for sort, expected in (("name", "ABCD"), ("recent", "ADCB"), ("release", "CADB")):
        actual = []
        for page in (1, 2):
            result = client.get("/api/albums", params={"q": "排序专辑", "sort": sort, "page": page, "page_size": 2})
            assert result.status_code == 200, result.text
            body = result.json()
            assert body["pagination"] == {"page": page, "page_size": 2, "total": 4, "total_pages": 2}
            actual.extend(item["album_name"][-1] for item in body["items"])
        assert "".join(actual) == expected
    assert client.get("/api/albums", params={"q": "排序专辑", "page": 99, "page_size": 2}).json()["pagination"]["page"] == 2
    normalized = create_album(client, headers, "目录 Ｗｈａｔ’s the POPIPA！？", [])
    assert [a["album_id"] for a in client.get("/api/albums", params={"q": "目录 What's the POPIPA!?"}).json()["items"]] == [normalized["album_id"]]
    literal = create_album(client, headers, "目录 100%_", [])
    create_album(client, headers, "目录 1000a", [])
    assert [a["album_id"] for a in client.get("/api/albums", params={"q": "100%_"}).json()["items"]] == [literal["album_id"]]
    for query in ("sort=plays", "page=0", "page_size=101", "band_id=-1"):
        assert client.get(f"/api/albums?{query}").status_code == 422
