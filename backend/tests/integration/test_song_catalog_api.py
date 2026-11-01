import pytest

from tests.integration.conftest import _load_integration_auth_config

pytestmark = pytest.mark.integration


def auth(client):
    config = _load_integration_auth_config()
    response = client.post("/api/auth/login", json={"username": config["username"], "password": config["password"]})
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["csrf_token"]}


# 测试点：翻唱和原创可经新组或新版本插入，经两条更新路径双向修改，省略字段保留原值及归属。
@pytest.mark.parametrize("initial_cover", [False, True])
@pytest.mark.parametrize("new_version", [False, True])
def test_song_cover_create_update_and_read_roundtrip(integration_test_client, integration_admin_connection, initial_cover, new_version):
    client = integration_test_client
    headers = auth(client)
    result = client.post("/api/console/song-groups", headers=headers, json={
        "group_name": "翻唱状态验证曲", "is_cover": not initial_cover if new_version else initial_cover,
        "ownership": {"mode": "bands", "band_ids": [1]},
    })
    assert result.status_code == 201, result.text
    default = result.json()["item"]
    song = default
    if new_version:
        result = client.post("/api/console/songs", headers=headers, json={
            "group_id": default["group_id"], "expected_group_revision": 1, "version_label": "独立版本",
            "is_cover": initial_cover, "ownership": {"mode": "bands", "band_ids": [2]},
        })
        assert result.status_code == 201, result.text
        song = result.json()["item"]
    sid = song["song_id"]
    owner = song["ownership"]
    assert song["legacy_cover"] is initial_cover
    album = client.post("/api/console/albums", headers=headers, json={
        "album_name": "状态验证盘", "tracks": [{"song_id": sid}],
    }).json()

    def check_reads(expected):
        assert client.get(f"/api/songs/{sid}").json()["legacy_cover"] is expected
        assert client.get(f"/api/console/songs/{sid}").json()["legacy_cover"] is expected
        group = client.get(f"/api/song-groups/{song['group_id']}").json()
        assert next(v for v in group["versions"] if v["song_id"] == sid)["legacy_cover"] is expected
        candidate = next(v for v in client.get("/api/console/songs?q=翻唱状态验证曲").json()["items"] if v["song_id"] == sid)
        assert candidate["is_cover"] is expected
        for prefix in ("/api", "/api/console"):
            assert client.get(f"{prefix}/albums/{album['album_id']}").json()["tracks"][0]["is_cover"] is expected
        with integration_admin_connection.cursor() as cur:
            cur.execute("SELECT is_cover FROM song_list WHERE id = %s", (sid,))
            assert cur.fetchone()[0] is expected

    check_reads(initial_cover)
    for suffix, action in (("", "song_update"), ("/edit", "song_edit")):
        def update_payload():
            current = client.get(f"/api/songs/{sid}").json()
            payload = {"version_label": current["version_label"], "expected_revision": current["revision"]}
            if suffix:
                group = client.get(f"/api/song-groups/{song['group_id']}").json()
                payload.update(ownership={key: owner[key] for key in ("mode", "band_ids", "member_groups")}, group={
                    "group_id": group["group_id"], "expected_revision": group["revision"],
                    "group_name": group["group_name"], "song_ids": [v["song_id"] for v in group["versions"]],
                })
            return payload

        for value in (not initial_cover, initial_cover):
            payload = {**update_payload(), "is_cover": value}
            result = client.put(f"/api/console/songs/{sid}{suffix}", headers=headers, json=payload)
            assert result.status_code == 200, result.text
            saved = result.json()["item"]
            assert saved["revision"] == payload["expected_revision"] + 1
            assert saved["ownership"] == owner
            check_reads(value)
            assert client.put(f"/api/console/songs/{sid}{suffix}", headers=headers, json=payload).status_code == 409
            with integration_admin_connection.cursor() as cur:
                cur.execute("SELECT payload_json FROM audit_logs WHERE action = %s AND resource_id = %s ORDER BY id DESC LIMIT 1", (action, str(sid)))
                assert cur.fetchone()[0]["after"]["is_cover"] is value
        payload = update_payload()
        payload["cover_urls"] = [{"url": f"https://example.test/{action}.png", "name": "封面"}]
        result = client.put(f"/api/console/songs/{sid}{suffix}", headers=headers, json=payload)
        assert result.status_code == 200, result.text
        check_reads(initial_cover)
        with integration_admin_connection.cursor() as cur:
            cur.execute("SELECT payload_json FROM audit_logs WHERE action = %s AND resource_id = %s ORDER BY id DESC LIMIT 1", (action, str(sid)))
            assert cur.fetchone()[0]["after"]["is_cover"] is initial_cover
    if new_version:
        assert client.get(f"/api/songs/{default['song_id']}").json() == default


# 测试点：混合批量保存翻唱/原创，冲突不改已有歌曲，省略字段可复用旧记录，失败项可独立重试。
def test_batch_cover_conflicts_and_partial_retry(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = auth(client)
    songs = [{"group_name": name, "is_cover": flag, "ownership": {"mode": "bands", "band_ids": [band]}}
             for name, flag, band in (("批量翻唱", True, 1), ("批量原创", False, 2), ("待重试翻唱", True, 999999))]
    result = client.post("/api/console/songs:batch", headers=headers, json={"songs": songs})
    assert result.status_code == 201, result.text
    entries = result.json()["results"]
    assert result.json()["ok"] is False and entries[2]["error"]
    saved = [entry["item"] for entry in entries[:2]]
    assert [item["legacy_cover"] for item in saved] == [True, False]
    conflict = client.post("/api/console/songs:batch", headers=headers, json={"songs": [
        {**songs[0], "is_cover": False}, songs[1],
    ]}).json()
    assert conflict["ok"] is False and conflict["results"][0]["error"]
    assert conflict["results"][1]["created"] is False
    for item in saved:
        assert client.get(f"/api/songs/{item['song_id']}").json() == item
    omitted = {key: value for key, value in songs[0].items() if key != "is_cover"}
    reused = client.post("/api/console/songs:batch", headers=headers, json={"songs": [omitted]}).json()["results"][0]
    assert reused["created"] is False and reused["item"] == saved[0]
    songs[2]["ownership"]["band_ids"] = [1]
    retry = client.post("/api/console/songs:batch", headers=headers, json={"songs": songs}).json()
    assert retry["ok"] is True
    assert [entry["created"] for entry in retry["results"]] == [False, False, True]
    assert [entry["item"]["legacy_cover"] for entry in retry["results"]] == [True, False, True]
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT count(*) FROM audit_logs WHERE action = 'song_create' AND resource_id = ANY(%s)",
                    ([str(entry["item"]["song_id"]) for entry in retry["results"]],))
        assert cur.fetchone()[0] == 3


# 测试点：候选、详情、搜索与专辑曲目使用同一正式归属及顺序，旧乐队提示不冒充归属或污染乐队筛选。
@pytest.mark.parametrize("mode", ["pending", "bands", "members", "mixed"])
def test_song_ownership_is_consistent_across_catalog_surfaces(integration_test_client, integration_admin_connection, mode):
    client = integration_test_client
    headers = auth(client)
    member_ids = [client.post("/api/console/members", headers=headers, json={"display_name": name}).json()["member_id"]
                  for name in ("成员甲", "成员乙")]
    owner = {"mode": mode, "band_ids": [2, 1] if mode in {"bands", "mixed"} else [],
             "member_groups": [{"band_id": 1, "member_ids": member_ids[::-1]}] if mode in {"members", "mixed"} else []}
    created = client.post("/api/console/song-groups", headers=headers, json={
        "group_name": "统一归属曲", "ownership": owner,
    })
    assert created.status_code == 201, created.text
    song = created.json()["item"]
    sid = song["song_id"]
    expected = {"pending": "待回填", "bands": "Roselia / Poppin'Party", "members": "Poppin'Party：成员乙、成员甲",
                "mixed": "Roselia / Poppin'Party / Poppin'Party：成员乙、成员甲"}[mode]
    for query in ("q=统一归属", "q=统一归属&groups_only=true", "limit=100"):
        response = client.get("/api/console/songs?" + query)
        assert response.status_code == 200, response.text
        item = next(item for item in response.json()["items"] if item["song_id"] == sid)
        assert item["band_name"] == expected
    assert client.get(f"/api/songs/{sid}").json()["ownership"] == song["ownership"]
    assert client.get(f"/api/console/songs/{sid}").json()["ownership"] == song["ownership"]
    search = client.get("/api/catalog/search?q=统一归属曲")
    assert search.status_code == 200, search.text
    assert search.json()["songs"][0]["band_name"] == expected
    album = client.post("/api/console/albums", headers=headers, json={"album_name": "统一归属盘", "tracks": [{"song_id": sid}]}).json()
    assert album["tracks"][0]["band_name"] == expected
    assert client.get(f"/api/albums/{album['album_id']}").json()["tracks"][0]["band_name"] == expected
    for groups in (False, True):
        suffix = "&groups_only=true" if groups else ""
        assert client.get("/api/console/songs?q=统一归属&band_id=3" + suffix).json()["items"] == []
        if mode != "pending":
            actual_band = 1 if mode == "members" else 2
            filtered = client.get(f"/api/console/songs?q=统一归属&band_id={actual_band}" + suffix)
            assert [item["song_id"] for item in filtered.json()["items"]] == [sid]


# 测试点：新组和多乐队版本一起提交；空旧归属不会隐藏版本；过期 revision 不能覆盖资料。
def test_group_version_roundtrip_and_conflict(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    result = client.post("/api/console/song-groups", headers=headers, json={
        "group_name": "合唱曲", "version_label": "",
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
    assert any(item["song_id"] == sid for item in client.get("/api/console/songs?q=合唱曲").json()["items"])
    payload = {"cover_urls": ["https://example.test/song.png"], "expected_revision": song["revision"]}
    assert client.put(f"/api/console/songs/{sid}", headers=headers, json=payload).status_code == 200
    assert client.put(f"/api/console/songs/{sid}", headers=headers, json=payload).status_code == 409
    assert client.get(f"/api/songs/{sid}").json()["cover_urls"] == [{"url": "https://example.test/song.png", "name": ""}]


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
    payload = {"group_name": "成员曲", "ownership": {
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
        "expected_revision": 1, "ownership": {"mode": "bands", "band_ids": [2]},
    }).status_code == 200


# 测试点：公开读无需登录，写入校验角色、CSRF 和归属模式与内容的一致性。
def test_catalog_access_and_exclusive_modes(integration_test_client):
    client = integration_test_client
    assert client.get("/api/song-groups").status_code == 200
    assert client.post("/api/console/song-groups", json={}).status_code == 401
    headers = auth(client)
    payload = {"group_name": "非法", "ownership": {"mode": "bands", "band_ids": [1],
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
        cur.execute("SELECT count(*) FROM live_setlist WHERE live_id = 1 AND song_group_id = 1")
        initial = cur.fetchone()[0]
        cur.execute("""INSERT INTO live_setlist(live_id, song_group_id, absolute_order, segment_type, sub_order, is_short)
            SELECT live_id, song_group_id, 999, 'EN', 99, true
            FROM live_setlist WHERE live_id = 1 AND song_group_id = 1 LIMIT 1 RETURNING id""")
        added_id = cur.fetchone()[0]
    integration_admin_connection.commit()
    changed = client.put("/api/console/songs/1/ownership", headers=headers, json={
        "expected_revision": 1, "ownership": {"mode": "bands", "band_ids": [1, 2]},
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
    payload = {"setlist_rows": [{"song_group_id": 1, "absolute_order": 1, "segment_type": "M", "sub_order": 1,
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
    payload = {"group_id": 1, "expected_group_revision": group["revision"],
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


# 测试点：数据库延迟约束阻止删除最后归属或在整队模式下混入成员，提交失败后保留原关系。
def test_ownership_constraints_at_commit(integration_test_client, integration_admin_connection):
    import psycopg2
    client = integration_test_client
    headers = auth(client)
    result = client.put("/api/console/songs/1/ownership", headers=headers, json={
        "expected_revision": 1, "ownership": {"mode": "bands", "band_ids": [1]},
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


# 测试点：混合归属完整保存，两个版本共享历史次数，旧来源版本不改变组默认项的翻唱判定。
def test_mixed_version_uses_group_history_and_default(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = auth(client)
    member = client.post("/api/console/members", headers=headers, json={"display_name": "合作成员"}).json()
    response = client.put("/api/console/songs/1/ownership", headers=headers, json={
        "expected_revision": 1, "ownership": {"mode": "bands", "band_ids": [1]},
    })
    assert response.status_code == 200, response.text
    response = client.post("/api/console/songs", headers=headers, json={
        "group_id": 1, "expected_group_revision": 1, "version_label": "合作版",
        "ownership": {"mode": "mixed", "band_ids": [2], "member_groups": [{"band_id": 3, "member_ids": [member["member_id"]]}]},
    })
    assert response.status_code == 201, response.text
    version = response.json()["item"]
    assert version["ownership"]["band_ids"] == [2]
    assert version["ownership"]["groups"][0]["members"][0]["display_name"] == "合作成员"
    sid = version["song_id"]
    with integration_admin_connection.cursor() as cur:
        cur.execute("UPDATE live_attrs SET live_date='2020-01-01' WHERE id=1")
        cur.execute("UPDATE live_setlist SET song_id=%s WHERE song_group_id=1", (sid,))
    integration_admin_connection.commit()
    default_history = client.get("/api/songs/1/performances").json()
    other_history = client.get(f"/api/songs/{sid}/performances").json()
    assert default_history == other_history
    assert default_history["pagination"]["total"] > 0
    assert any(row["live_cover"] == "original" for row in default_history["items"])
    assert client.get("/api/songs/1").json()["performance_count"] == client.get(f"/api/songs/{sid}").json()["performance_count"]
    rows = client.get("/api/lives/1").json()["detail_rows"]
    assert any(row["song_id"] == 1 and row["live_cover"] == "original" for row in rows)
    options = client.get("/api/console/songs?groups_only=true&q=Yes").json()["items"]
    assert len([row for row in options if row["group_id"] == 1]) == 1
    editable = client.get("/api/console/lives/1/setlist").json()["rows"]
    assert any(row["song_group_id"] == 1 for row in editable)
    assert client.get("/api/catalog/statistics?band_id=1").status_code == 200


# 测试点：同专辑不同碟号或发行版各自从 1 排序，重排后保留收录 ID 与器乐标识。
def test_album_sections_roundtrip(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    response = client.post("/api/console/albums", headers=headers, json={"album_name": "多子项盘", "tracks": [
        {"song_id": 1, "section_name": "Disc1"},
        {"song_id": 1, "section_name": "Disc1", "edition_label": "Instrumental"},
        {"song_id": 2, "section_name": "限定版"},
    ]})
    assert response.status_code == 201, response.text
    album = response.json()
    assert [(t["section_name"], t["track_order"]) for t in album["tracks"]] == [("Disc1", 1), ("Disc1", 2), ("限定版", 1)]
    tracks = [{k: t[k] for k in ["album_track_id", "song_id", "section_name", "edition_label"]} for t in reversed(album["tracks"])]
    response = client.put(f"/api/console/albums/{album['album_id']}/tracks", headers=headers, json={
        "expected_revision": album["revision"], "tracks": tracks,
    })
    assert response.status_code == 200, response.text
    changed = response.json()
    assert [t["album_track_id"] for t in changed["tracks"]] == [t["album_track_id"] for t in tracks]
    assert [(t["section_name"], t["track_order"]) for t in changed["tracks"]] == [("限定版", 1), ("Disc1", 1), ("Disc1", 2)]
    assert changed["tracks"][1]["edition_label"] == "Instrumental"
    assert client.get(f"/api/albums/{album['album_id']}").json() == changed
