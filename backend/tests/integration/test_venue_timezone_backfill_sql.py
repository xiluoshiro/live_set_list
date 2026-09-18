import csv
from pathlib import Path

import psycopg2
from psycopg2.extensions import TRANSACTION_STATUS_IDLE
import pytest

pytestmark = pytest.mark.integration
ROOT = Path(__file__).resolve().parents[3]
SQL_DIR = ROOT / "backend/db/postgres/backfill"
SQL_01 = (SQL_DIR / "2026-09-18-01__backfill_venue_own_timezones.sql").read_text(encoding="utf-8")
SQL_02 = (SQL_DIR / "2026-09-18-02__correct_initial_geography_revisions.sql").read_text(encoding="utf-8")


def prepare_targets(conn):
    with (ROOT / "docs/design/venue-timezone-candidates-2026-09-18.csv").open(encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO venue_list(id,venue,latitude,longitude,location_revision,location_verified_at)
               VALUES (%s,%s,%s,%s,2,'2026-01-01T00:00:00Z')
               ON CONFLICT(id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,
                   location_revision=2,location_verified_at=excluded.location_verified_at""",
            [(r["venue_id"],r["venue"],r["latitude"],r["longitude"]) for r in rows],
        )
        cur.execute("INSERT INTO venue_list(id,venue,venue_kind,location_revision) VALUES (32,'Undisclosed','undisclosed',2)")
        cur.execute("UPDATE live_attrs SET timezone_source='venue',timezone_id='Asia/Tokyo',timezone_source_revision=2 WHERE venue_id=1")


def snapshot(conn):
    with conn.cursor() as cur:
        return {table: read_rows(cur, table) for table in (
            "venue_list", "live_attrs", "audit_logs", "venue_name_versions", "venue_map_links",
            "geo_localities", "live_schedule_history",
        )}


def read_rows(cur, table):
    cur.execute(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.{table} t")
    return cur.fetchone()[0]


# 测试点：原 SQL 直接提交，时区补录不改修订或核验时间，02 纠正元数据且重复执行无新增审计。
def test_sql_commits_without_local_fingerprints_and_is_repeatable(integration_admin_connection):
    conn = integration_admin_connection
    prepare_targets(conn)
    before = snapshot(conn)
    with conn.cursor() as cur:
        cur.execute(SQL_01)
    assert conn.get_transaction_status() == TRANSACTION_STATUS_IDLE
    filled = snapshot(conn)
    assert len([v for v in filled["venue_list"] if v["timezone_id"]]) == 153
    assert [{k:v for k,v in row.items() if k != "timezone_id"} for row in sorted(filled["venue_list"],key=lambda x:x["id"])] == [
        {k:v for k,v in row.items() if k != "timezone_id"} for row in sorted(before["venue_list"],key=lambda x:x["id"])]
    assert filled["live_attrs"] == before["live_attrs"]
    with conn.cursor() as cur:
        cur.execute(SQL_02)
    assert conn.get_transaction_status() == TRANSACTION_STATUS_IDLE
    after = snapshot(conn)
    assert all(v["location_revision"] == 1 for v in after["venue_list"])
    assert all(l["timezone_source_revision"] is None for l in after["live_attrs"])
    for table in ("venue_name_versions", "venue_map_links", "geo_localities", "live_schedule_history"):
        assert after[table] == before[table]
    with conn.cursor() as cur:
        cur.execute(SQL_01)
        cur.execute(SQL_02)
    assert snapshot(conn) == after


# 测试点：冲突时区或坐标拒绝整个事务，不能部分回填并提交。
@pytest.mark.parametrize("conflict", ["timezone_id='America/New_York'", "latitude=0"])
def test_conflicting_target_leaves_no_partial_writes(integration_admin_connection, conflict):
    conn = integration_admin_connection
    prepare_targets(conn)
    with conn.cursor() as cur:
        cur.execute(f"UPDATE venue_list SET {conflict} WHERE id=1")
    before = snapshot(conn)
    with pytest.raises(psycopg2.Error):
        with conn.cursor() as cur:
            cur.execute(SQL_01)
    with conn.cursor() as cur:
        cur.execute("ROLLBACK")
    assert snapshot(conn) == before


# 测试点：旧错误回填的修订 3 必须有本库匹配审计，才能恢复核验时间；缺证据不能先改其他记录。
@pytest.mark.parametrize("has_audit", [True, False])
def test_revision_three_uses_target_database_audit(integration_admin_connection, has_audit):
    conn = integration_admin_connection
    prepare_targets(conn)
    with conn.cursor() as cur:
        cur.execute(SQL_01)
        cur.execute("CREATE TEMP TABLE bad_before AS SELECT * FROM venue_list WHERE id=1")
        cur.execute("UPDATE venue_list SET location_revision=3,location_verified_at='2026-09-18T00:00:00Z' WHERE id=1")
        if has_audit:
            cur.execute("""INSERT INTO audit_logs(user_id,action,resource_type,resource_id,payload_json)
                SELECT NULL,'venue_location_update','venue','1',
                    jsonb_build_object('source','venue_own_timezone_backfill_20260918','before',to_jsonb(b),'after',to_jsonb(v))
                FROM venue_list v JOIN bad_before b USING(id)""")
        cur.execute("DROP TABLE bad_before")
    before = snapshot(conn)
    if has_audit:
        with conn.cursor() as cur:
            cur.execute(SQL_02)
            cur.execute("SELECT location_revision,location_verified_at='2026-01-01T00:00:00Z'::timestamptz FROM venue_list WHERE id=1")
            assert cur.fetchone() == (1, True)
    else:
        with pytest.raises(psycopg2.Error, match="unique matching bad-backfill audit"):
            with conn.cursor() as cur:
                cur.execute(SQL_02)
        with conn.cursor() as cur:
            cur.execute("ROLLBACK")
        assert snapshot(conn) == before
