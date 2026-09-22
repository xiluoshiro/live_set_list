import pytest

from tests.integration.conftest import _load_integration_auth_config

pytestmark = pytest.mark.integration


def auth(client):
    config = _load_integration_auth_config()
    response = client.post("/api/auth/login", json={"username": config["username"], "password": config["password"]})
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["csrf_token"]}


# 测试点：新组和多乐队版本一起提交；空旧归属不会隐藏版本；过期 revision 不能覆盖资料。
def test_group_version_roundtrip_and_conflict(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    result = client.post("/api/console/song-groups", headers=headers, json={
        "group_name": "合唱曲", "song_name": "合唱曲", "version_label": "三乐队版",
        "ownership": {"mode": "bands", "band_ids": [1, 2, 3]},
    })
    assert result.status_code == 201, result.text
    song = result.json()["item"]
    assert song["ownership"]["band_ids"] == [1, 2, 3]
    sid = song["song_id"]
    assert client.get(f"/api/songs/{sid}").json() == song
    assert client.get(f"/api/song-groups/{song['group_id']}").json()["versions"][0]["song_id"] == sid
    search_item = client.get("/api/catalog/search?q=合唱曲").json()["songs"][0]
    assert search_item["ownership"]["band_ids"] == [1, 2, 3]
    assert search_item["band_id"] is None
    assert any(item["song_id"] == sid for item in client.get("/api/console/songs?q=合唱曲").json()["items"])
    payload = {"song_name": "新曲名", "expected_revision": song["revision"]}
    assert client.put(f"/api/console/songs/{sid}", headers=headers, json=payload).status_code == 200
    assert client.put(f"/api/console/songs/{sid}", headers=headers, json=payload).status_code == 409
    assert client.get(f"/api/songs/{sid}").json()["song_name"] == "新曲名"


# 测试点：Instrumental 和通常版使用同一 song_id，曲序仅专辑内唯一，日期允许未知。
def test_album_instrumental_reuses_song_and_track_order(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    payload = {"album_name": "収録盤", "release_label": "special disc", "release_date": None,
               "tracks": [{"song_id": 1, "track_order": 2, "edition_label": "Instrumental"},
                          {"song_id": 1, "track_order": 1, "edition_label": ""}]}
    response = client.post("/api/console/albums", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    album = response.json()
    assert [track["track_order"] for track in album["tracks"]] == [1, 2]
    assert [track["song_id"] for track in album["tracks"]] == [1, 1]
    assert album["release_date"] is None
    assert client.get(f"/api/albums/{album['album_id']}").json() == album
    assert len(client.get("/api/songs/1").json()["albums"]) == 1
    # 仅改专辑元数据保留所有收录；重复收录 ID 由请求校验拒绝而不是内部 500。
    changed = client.put(f"/api/console/albums/{album['album_id']}", headers=headers, json={
        "album_name": "新版名称", "expected_revision": album["revision"],
    })
    assert changed.status_code == 200, changed.text
    assert changed.json()["tracks"] == album["tracks"]
    track = {"album_track_id": album["tracks"][0]["album_track_id"], "song_id": 1}
    duplicate = client.put(f"/api/console/albums/{album['album_id']}/tracks", headers=headers, json={
        "expected_revision": changed.json()["revision"], "tracks": [track, track],
    })
    assert duplicate.status_code == 422
    payload["release_date"] = "2026-01"
    assert client.post("/api/console/albums", headers=headers, json=payload).status_code == 422


# 测试点：成员模式固定成员 ID 与乐队上下文；失败写入不留下空歌曲组或半套归属。
def test_member_ownership_and_atomic_failure(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    member = client.post("/api/console/members", headers=headers, json={"display_name": "新成员"}).json()
    assert member["member_id"] >= 68
    payload = {"group_name": "成员曲", "song_name": "成员曲", "ownership": {
        "mode": "members", "member_groups": [{"band_id": 1, "member_ids": [member["member_id"]]}]}}
    response = client.post("/api/console/song-groups", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    song = response.json()["item"]
    assert song["ownership"]["groups"][0]["members"][0]["display_name"] == "新成员"
    before = client.get("/api/song-groups").json()["pagination"]["total"]
    payload["ownership"]["member_groups"][0]["member_ids"] = [99999]
    assert client.post("/api/console/song-groups", headers=headers, json=payload).status_code == 422
    assert client.get("/api/song-groups").json()["pagination"]["total"] == before
    assert client.put(f"/api/console/songs/{song['song_id']}/ownership", headers=headers, json={
        "expected_revision": 1, "reason": "更正记录", "ownership": {"mode": "bands", "band_ids": [2]},
    }).status_code == 200


# 测试点：公开读无需登录，写入必须同时具备角色与 CSRF；拒绝混合归属模式。
def test_catalog_access_and_exclusive_modes(integration_test_client):
    client = integration_test_client
    assert client.get("/api/song-groups").status_code == 200
    assert client.post("/api/console/song-groups", json={}).status_code == 401
    headers = auth(client)
    payload = {"group_name": "非法", "song_name": "非法", "ownership": {"mode": "bands", "band_ids": [1],
               "member_groups": [{"band_id": 2, "member_ids": [1]}]}}
    assert client.post("/api/console/song-groups", headers=headers, json=payload).status_code == 422
    payload["ownership"] = {"mode": "pending"}
    assert client.post("/api/console/song-groups", json=payload).status_code == 403


# 测试点：同一场的两条 setlist 分别计数，短版不拆统计；成员 ID 未回填也按实际乐队交集判定。
def test_performance_count_and_actual_band_cover(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = auth(client)
    with integration_admin_connection.cursor() as cur:
        cur.execute("UPDATE live_attrs SET live_date = '2020-01-01' WHERE id = 1")
        cur.execute("SELECT count(*) FROM live_setlist WHERE live_id = 1 AND song_id = 1")
        initial = cur.fetchone()[0]
        cur.execute("""INSERT INTO live_setlist(live_id, song_id, absolute_order, segment_type, sub_order, is_short)
            SELECT live_id, song_id, 999, 'EN', 99, true
            FROM live_setlist WHERE live_id = 1 AND song_id = 1 LIMIT 1 RETURNING id""")
        added_id = cur.fetchone()[0]
    integration_admin_connection.commit()
    changed = client.put("/api/console/songs/1/ownership", headers=headers, json={
        "expected_revision": 1, "reason": "核对基准", "ownership": {"mode": "bands", "band_ids": [1, 2]},
    })
    assert changed.status_code == 200, changed.text
    performances = client.get("/api/songs/1/performances").json()
    live_rows = [row for row in performances["items"] if row["live_id"] == 1]
    assert len(live_rows) == initial + 1
    added = next(row for row in live_rows if row["setlist_id"] == str(added_id))
    assert added["is_short"] and added["live_cover"] == "unknown"
    assert any(row["live_cover"] == "original" for row in live_rows)
    counts = [client.get("/api/songs/1", headers={"X-Visitor-Timezone": zone}).json()["performance_count"]
              for zone in ["Pacific/Kiritimati", "Pacific/Honolulu"]]
    assert counts[0] == counts[1] == performances["pagination"]["total"]
    detail = client.get("/api/lives/1").json()
    assert all(row["live_cover"] in {"original", "unknown"} for row in detail["detail_rows"] if row["song_id"] == 1)


# 测试点：已有歌单后无论改为过去还是未来都拒绝改日期，取消也拒绝；原资料保留。
def test_live_date_and_cancel_lock(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    original = client.get("/api/console/lives/1").json()["item"]
    fields = ["live_date", "live_title", "live_type", "url", "venue_id", "venue_name_version_id",
              "default_band_ids", "event_attendees", "event_status", "status_note"]
    payload = {key: original[key] for key in fields}
    payload.update(opening_time=None, start_time=None, schedule_change_kind="correction")
    for changed in [{"live_date": "2000-01-01"}, {"live_date": "2099-01-01"}, {"event_status": "cancelled"}]:
        response = client.put("/api/console/lives/1", headers=headers, json={**payload, **changed})
        assert response.status_code == 409, response.text
    assert client.get("/api/console/lives/1").json()["item"]["live_date"] == original["live_date"]


# 测试点：未来及取消的演出无论新增或替换歌单都被同一日期策略拒绝，不产生曲目。
@pytest.mark.parametrize("event_status,live_date", [("scheduled", "2099-01-01"), ("cancelled", "2000-01-01")])
def test_invalid_live_cannot_accept_setlist(integration_test_client, integration_admin_connection, event_status, live_date):
    client = integration_test_client
    headers = auth(client)
    with integration_admin_connection.cursor() as cur:
        cur.execute("DELETE FROM live_setlist WHERE live_id = 1")
        cur.execute("UPDATE live_attrs SET event_status = %s, live_date = %s WHERE id = 1", (event_status, live_date))
    integration_admin_connection.commit()
    payload = {"setlist_rows": [{"song_id": 1, "absolute_order": 1, "segment_type": "M", "sub_order": 1,
                                 "is_short": False, "band_performances": [{"band_id": 1, "lineup_usage": "base", "members": ["Kasumi"]}], "other_member": {}}]}
    for method in [client.post, client.put]:
        response = method("/api/console/lives/1/setlist", headers=headers, json=payload)
        assert response.status_code == 409, response.text
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT count(*) FROM live_setlist WHERE live_id = 1")
        assert cur.fetchone()[0] == 0


# 测试点：组 revision 保护追加和排序；改组保留 song_id，清理空组；曲目重排保留收录 ID。
def test_version_order_move_and_album_track_identity(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    group = client.get("/api/song-groups/1").json()
    payload = {"group_id": 1, "expected_group_revision": group["revision"], "song_name": "限定版",
               "version_label": "限定版", "ownership": {"mode": "pending"}}
    created = client.post("/api/console/songs", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    song = created.json()["item"]
    assert song["version_order"] == 2
    assert client.post("/api/console/songs", headers=headers, json=payload).status_code == 409
    assert client.put("/api/console/song-groups/1", headers=headers, json={
        "group_name": "歌曲组", "expected_revision": group["revision"] + 1, "song_ids": [song["song_id"], 1],
    }).status_code == 200
    assert client.get("/api/song-groups/1").json()["versions"][0]["song_id"] == song["song_id"]
    album = client.post("/api/console/albums", headers=headers, json={"album_name": "曲序盘", "tracks": [
        {"song_id": 1}, {"song_id": 1, "edition_label": "Instrumental"}]}).json()
    tracks = album["tracks"]
    reordered = client.put(f"/api/console/albums/{album['album_id']}", headers=headers, json={
        "album_name": "曲序盘", "expected_revision": 1, "tracks": [
            {"album_track_id": t["album_track_id"], "song_id": t["song_id"], "edition_label": t["edition_label"]}
            for t in reversed(tracks)]})
    assert reordered.status_code == 200, reordered.text
    assert [t["album_track_id"] for t in reordered.json()["tracks"]] == [t["album_track_id"] for t in reversed(tracks)]


# 测试点：数据库延迟约束阻止删除最后归属、混合两种模式，提交失败后保留原关系。
def test_ownership_constraints_at_commit(integration_test_client, integration_admin_connection):
    import psycopg2
    client = integration_test_client
    headers = auth(client)
    result = client.put("/api/console/songs/1/ownership", headers=headers, json={
        "expected_revision": 1, "reason": "回填", "ownership": {"mode": "bands", "band_ids": [1]},
    })
    assert result.status_code == 200
    conn = integration_admin_connection
    for statement in ["DELETE FROM song_bands WHERE song_id = 1",
                      "INSERT INTO song_member_groups(song_id, band_id, display_order) VALUES (1, 2, 1)"]:
        with pytest.raises(psycopg2.errors.CheckViolation):
            with conn.cursor() as cur:
                cur.execute(statement)
            conn.commit()
        conn.rollback()
    assert client.get("/api/songs/1").json()["ownership"]["band_ids"] == [1]
