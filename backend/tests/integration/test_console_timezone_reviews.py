import pytest

pytestmark = pytest.mark.integration


def login(client):
    response = client.post("/api/auth/login", json={"username": "editor_tester", "password": "editor-test-pass"})
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["csrf_token"]}


def expected(item):
    return {
        "expected_snapshot_timezone_id": item["snapshot_timezone_id"],
        "expected_snapshot_source_revision": item["snapshot_source_revision"],
        "expected_current_timezone_id": item["current_timezone_id"],
        "expected_current_source_revision": item["current_source_revision"],
    }


# 测试点：全局队列区分真实时区差异、已保留决定、当前一致、explicit 与 legacy，并逐场持久化处置。
def test_timezone_review_classification_retain_and_apply(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    locality_response = client.post("/api/console/localities", headers=headers, json={
        "country_code": "JP", "admin_area": "東京都", "locality_name": "検証市",
        "timezone_id": "Asia/Tokyo", "area_level": "locality",
    })
    assert locality_response.status_code == 201, locality_response.text
    locality = locality_response.json()
    for venue_id in (1, 2):
        saved = client.put(f"/api/console/venues/{venue_id}/location", headers=headers, json={
            "expected_revision": 1, "locality_id": locality["id"],
            "verification_source": "official", "verification_note": "测试地区核验",
        })
        assert saved.status_code == 200, saved.text

    with integration_admin_connection.cursor() as cur:
        cur.execute(
            """UPDATE live_attrs
               SET timezone_id='Asia/Tokyo', timezone_source='venue', timezone_source_revision=2,
                   timezone_offset_minutes=540
               WHERE id IN (1, 2)"""
        )
        cur.execute(
            """UPDATE live_attrs
               SET timezone_id='Asia/Tokyo', timezone_source='explicit', timezone_source_revision=NULL
               WHERE id=41"""
        )
        cur.execute("SELECT COUNT(*) FROM live_schedule_history WHERE live_id=2")
        history_before = cur.fetchone()[0]

    changed = client.put(f"/api/console/localities/{locality['id']}", headers=headers, json={
        "expected_revision": 1, "country_code": "JP", "admin_area": "東京都",
        "locality_name": "検証市", "timezone_id": "America/New_York", "area_level": "locality",
    })
    assert changed.status_code == 200, changed.text

    queue = client.get("/api/console/timezone-reviews?status=needs_review")
    assert queue.status_code == 200, queue.text
    body = queue.json()
    assert body["total"] == 2
    assert body["counts"]["needs_review"] == 2
    assert body["counts"]["unaffected"] == 1
    assert body["counts"]["legacy_exception"] == 1
    items = {item["live_id"]: item for item in body["items"]}
    assert items[1]["snapshot_offset_minutes"] == 540
    assert items[1]["current_offset_minutes"] == -240
    assert items[1]["current_start_time"].startswith("17:30:00-04:00")

    retained = client.post(
        "/api/console/timezone-reviews/1/retain", headers=headers,
        json={**expected(items[1]), "reason": "历史公告使用东京时间，保留原始记录"},
    )
    assert retained.status_code == 200, retained.text
    assert retained.json()["item"]["status"] == "retained"
    assert retained.json()["item"]["retained_reason"] == "历史公告使用东京时间，保留原始记录"

    applied = client.post(
        "/api/console/timezone-reviews/2/apply-current", headers=headers, json=expected(items[2]),
    )
    assert applied.status_code == 200, applied.text
    applied_item = applied.json()["item"]
    assert applied_item["status"] == "current"
    assert applied_item["snapshot_timezone_id"] == "America/New_York"
    assert applied_item["start_time"].startswith("16:00:00-04:00")
    assert applied_item["snapshot_offset_minutes"] == -240

    assert client.get("/api/console/timezone-reviews?status=needs_review").json()["total"] == 0
    assert client.get("/api/console/timezone-reviews?status=retained").json()["items"][0]["live_id"] == 1
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM live_schedule_history WHERE live_id=2")
        assert cur.fetchone()[0] == history_before
        cur.execute(
            """SELECT action, payload_json FROM audit_logs
               WHERE action IN ('live_timezone_review_retain', 'live_timezone_review_apply')
               ORDER BY action"""
        )
        audits = cur.fetchall()
        assert [row[0] for row in audits] == ["live_timezone_review_apply", "live_timezone_review_retain"]
        assert audits[0][1]["change_kind"] == "timezone_data_correction"
        assert audits[0][1]["before"]["snapshot_timezone_id"] == "Asia/Tokyo"


# 测试点：处置提交绑定 Live 快照和当前来源修订，来源变化后旧确认请求返回 409。
def test_timezone_review_rejects_stale_decision(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = login(client)
    with integration_admin_connection.cursor() as cur:
        cur.execute(
            """UPDATE venue_list
               SET latitude=35.0, longitude=139.0, timezone_id='Asia/Tokyo', location_revision=2
               WHERE id=1"""
        )
        cur.execute(
            """UPDATE live_attrs
               SET timezone_id='America/New_York', timezone_source='venue', timezone_source_revision=1
               WHERE id=1"""
        )
    item = client.get("/api/console/timezone-reviews?status=needs_review").json()["items"][0]
    with integration_admin_connection.cursor() as cur:
        cur.execute("UPDATE venue_list SET location_revision=3 WHERE id=1")
    response = client.post(
        "/api/console/timezone-reviews/1/retain", headers=headers,
        json={**expected(item), "reason": "旧页面决定"},
    )
    assert response.status_code == 409
