import pytest

pytestmark = pytest.mark.integration

# 测试点：实际时间跨月时按访问者归月，无时间仍保留公布日期，并使用开场作为开演缺失时的基准。
def test_calendar_uses_visitor_day_before_month_filter(integration_test_client, integration_admin_connection):
    with integration_admin_connection.cursor() as cur:
        cur.execute("""INSERT INTO live_attrs(live_date,live_title,live_type,url,venue_id,venue_name_version_id,opening_time,start_time)
                       VALUES ('2026-09-01','Visitor boundary','oneman','https://example.com',1,1,'00:30+09',NULL),
                              ('2026-09-01','Date only','oneman','https://example.com',NULL,NULL,NULL,NULL)
                       RETURNING id""")
        timed, unknown = [row[0] for row in cur.fetchall()]
    client=integration_test_client
    west={"X-Visitor-Timezone":"America/Los_Angeles"}
    august=client.get("/api/catalog/calendar?month=2026-08",headers=west)
    assert august.status_code==200,august.text
    item=next(row for row in august.json()["items"] if row["live_id"]==timed)
    assert item["live_date"]=="2026-09-01" and item["calendar_date"]=="2026-08-31"
    september=client.get("/api/catalog/calendar?month=2026-09",headers=west)
    assert timed not in [row["live_id"] for row in september.json()["items"]]
    assert unknown in [row["live_id"] for row in september.json()["items"]]
    tokyo=client.get("/api/catalog/calendar?month=2026-09",headers={"X-Visitor-Timezone":"Asia/Tokyo"})
    assert timed in [row["live_id"] for row in tokyo.json()["items"]]
    assert "X-Visitor-Timezone" in tokyo.headers["vary"]

# 测试点：非法访问者时区不能进入 SQL，缺失请求头时使用确定的 UTC。
def test_invalid_visitor_zone_is_rejected(integration_test_client):
    response=integration_test_client.get("/api/catalog/calendar?month=2026-09",headers={"X-Visitor-Timezone":"bad'zone"})
    assert response.status_code==422
    assert integration_test_client.get("/api/catalog/calendar?month=2026-09").status_code==200

# 测试点：未知时间不需要独立时区字段；演出与历史只保留各时间携带的偏移。
def test_removed_timezone_columns(integration_admin_connection):
    with integration_admin_connection.cursor() as cur:
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='live_attrs'")
        columns={row[0] for row in cur.fetchall()}
    assert not columns.intersection({"timezone_id","timezone_source","timezone_offset_minutes","timezone_source_revision","opening_time_fold","start_time_fold"})


# 测试点：单条与批量详情都使用当前/历史各自的场地和时刻，未公布时间不生成标签。
@pytest.mark.parametrize("batch", [False, True])
def test_detail_timezone_labels_use_each_venue_and_instant(integration_test_client, integration_admin_connection, batch):
    with integration_admin_connection.cursor() as cur:
        cur.execute("UPDATE venue_list SET timezone_id='Asia/Seoul' WHERE id=1")
        cur.execute("UPDATE venue_list SET timezone_id='America/New_York' WHERE id=2")
        cur.execute("UPDATE live_attrs SET live_date='2026-01-15', opening_time=NULL, start_time='19:00+09' WHERE id=1")
        cur.execute("""INSERT INTO live_schedule_history
            (live_id, previous_live_date, previous_opening_time, previous_start_time,
             previous_venue_id, previous_venue_name_version_id)
            VALUES (1, '2026-07-15', '18:00-04', '19:00-04', 2, 2)""")
    client = integration_test_client
    response = client.post("/api/lives/details:batch", json={"live_ids": [1]}) if batch else client.get("/api/lives/1")
    assert response.status_code == 200, response.text
    item = response.json()["items"][0] if batch else response.json()
    assert item["opening_timezone_label"] is None
    assert item["start_timezone_label"] == "KST"
    history = item["schedule_history"][0]
    assert history["previous_opening_timezone_label"] == "EDT"
    assert history["previous_start_timezone_label"] == "EDT"
    assert "_venue_timezone_id" not in history


# 测试点：ONLINE 只有带偏移时间时，接口不伪造 IANA 缩写，保留原时间供旧映射显示。
def test_online_detail_keeps_fixed_offset_fallback(integration_test_client, integration_admin_connection):
    with integration_admin_connection.cursor() as cur:
        cur.execute("UPDATE venue_list SET venue_kind='online', timezone_id=NULL WHERE id=1")
        cur.execute("UPDATE live_attrs SET opening_time='18:00+09', start_time='19:00+09' WHERE id=1")
    response = integration_test_client.get("/api/lives/1")
    assert response.status_code == 200, response.text
    item = response.json()
    assert item["opening_timezone_label"] is None
    assert item["start_timezone_label"] is None
    assert item["start_time"] in ("19:00:00+09", "19:00:00+09:00")
