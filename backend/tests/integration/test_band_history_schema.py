from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import psycopg2
import pytest

pytestmark = pytest.mark.integration


def _insert_band_history(integration_admin_connection) -> tuple[int, int, int]:
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute("DELETE FROM live_setlist_band_performance_members WHERE band_id = 1")
        cursor.execute("DELETE FROM live_setlist_band_performances WHERE band_id = 1")
        cursor.execute("DELETE FROM live_band_lineup_contexts WHERE band_id = 1")
        cursor.execute(
            """
            DELETE FROM band_lineup_version_members
            WHERE lineup_version_id IN (SELECT id FROM band_lineup_versions WHERE band_id = 1)
            """
        )
        cursor.execute("DELETE FROM band_lineup_versions WHERE band_id = 1")
        cursor.execute("DELETE FROM band_name_versions WHERE band_id = 1")
        cursor.execute(
            """
            INSERT INTO band_name_versions (
                band_id, band_name, band_abbr, valid_from, valid_to
            )
            VALUES (1, 'Poppin''Party', 'ppp', DATE '2015-01-01', NULL)
            RETURNING id
            """
        )
        name_version_id = int(cursor.fetchone()[0])
        cursor.execute(
            """
            INSERT INTO band_lineup_versions (
                band_id, version_no, version_label, valid_from, valid_to,
                predecessor_id, change_type
            )
            VALUES (1, 1, 'Poppin''Party V1', DATE '2015-01-01', DATE '2018-01-01', NULL, 'initial')
            RETURNING id
            """
        )
        base_version_id = int(cursor.fetchone()[0])
        cursor.execute(
            """
            INSERT INTO band_lineup_versions (
                band_id, version_no, version_label, valid_from, valid_to,
                predecessor_id, change_type, transition_live_id
            )
            VALUES (1, 2, 'Poppin''Party V2', DATE '2018-01-01', NULL, %s, 'addition', 1)
            RETURNING id
            """,
            (base_version_id,),
        )
        next_version_id = int(cursor.fetchone()[0])
        cursor.execute(
            """
            INSERT INTO band_lineup_version_members (
                lineup_version_id, member_name, display_order
            )
            VALUES
                (%s, 'Kasumi', 1),
                (%s, 'Kasumi', 1),
                (%s, 'Tae', 2)
            """,
            (base_version_id, next_version_id, next_version_id),
        )
        cursor.execute(
            """
            INSERT INTO live_band_lineup_contexts (
                live_id, band_id, band_name_version_id,
                base_lineup_version_id, next_lineup_version_id
            )
            VALUES (1, 1, %s, %s, %s)
            """,
            (name_version_id, base_version_id, next_version_id),
        )
    return name_version_id, base_version_id, next_version_id


def _login_editor(integration_test_client) -> str:
    response = integration_test_client.post(
        "/api/auth/login",
        json={"username": "editor_tester", "password": "editor-test-pass"},
    )
    assert response.status_code == 200
    return str(response.json()["csrf_token"])


# 测试点：历史名称、连续阵容、Live 上下文和逐曲出演关系应能按稳定 ID 完整落库并随 Setlist 清理。
def test_band_history_relations_preserve_lineup_usage_and_cascade_setlist_children(
    integration_admin_connection,
):
    _insert_band_history(integration_admin_connection)

    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id
            FROM live_setlist
            WHERE live_id = 1 AND absolute_order = 1
            """
        )
        setlist_id = cursor.fetchone()[0]
        cursor.execute(
            """
            INSERT INTO live_setlist_band_performances (
                setlist_id, live_id, band_id, lineup_usage, handover_baseline
            )
            VALUES (%s, 1, 1, 'handover', 'next')
            """,
            (setlist_id,),
        )
        cursor.execute(
            """
            INSERT INTO live_setlist_band_performance_members (
                setlist_id, band_id, member_name, display_order, appearance_role
            )
            VALUES
                (%s, 1, 'Kasumi', 1, NULL),
                (%s, 1, 'Tae', 2, 'incoming')
            """,
            (setlist_id, setlist_id),
        )
        cursor.execute(
            """
            SELECT lineup_usage, handover_baseline
            FROM live_setlist_band_performances
            WHERE setlist_id = %s AND band_id = 1
            """,
            (setlist_id,),
        )
        assert cursor.fetchone() == ("handover", "next")

        cursor.execute("DELETE FROM live_setlist WHERE id = %s", (setlist_id,))
        cursor.execute(
            "SELECT COUNT(*) FROM live_setlist_band_performances WHERE setlist_id = %s",
            (setlist_id,),
        )
        assert cursor.fetchone() == (0,)
        cursor.execute(
            "SELECT COUNT(*) FROM live_setlist_band_performance_members WHERE setlist_id = %s",
            (setlist_id,),
        )
        assert cursor.fetchone() == (0,)
        cursor.execute(
            "SELECT COUNT(*) FROM live_band_lineup_contexts WHERE live_id = 1 AND band_id = 1"
        )
        assert cursor.fetchone() == (1,)


# 测试点：只有 handover 必须提供旧/新基准，base/next 则必须保持该字段为空。
def test_handover_baseline_constraint_matches_lineup_usage(
    integration_admin_connection,
):
    _insert_band_history(integration_admin_connection)

    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id
            FROM live_setlist
            WHERE live_id = 1 AND absolute_order = 1
            """
        )
        setlist_id = cursor.fetchone()[0]
        with pytest.raises(psycopg2.errors.CheckViolation):
            cursor.execute(
                """
                INSERT INTO live_setlist_band_performances (
                    setlist_id, live_id, band_id, lineup_usage
                )
                VALUES (%s, 1, 1, 'handover')
                """,
                (setlist_id,),
            )
        with pytest.raises(psycopg2.errors.CheckViolation):
            cursor.execute(
                """
                INSERT INTO live_setlist_band_performances (
                    setlist_id, live_id, band_id, lineup_usage, handover_baseline
                )
                VALUES (%s, 1, 1, 'base', 'base')
                """,
                (setlist_id,),
            )


# 测试点：逐曲出演关系必须同时匹配 Setlist 所属 Live，不能仅凭 setlist_id 跨场挂接。
def test_band_performance_rejects_mismatched_setlist_live(
    integration_admin_connection,
):
    name_version_id, base_version_id, _ = _insert_band_history(integration_admin_connection)

    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO live_band_lineup_contexts (
                live_id, band_id, band_name_version_id, base_lineup_version_id
            )
            VALUES (2, 1, %s, %s)
            """,
            (name_version_id, base_version_id),
        )
        cursor.execute(
            """
            SELECT id
            FROM live_setlist
            WHERE live_id = 1 AND absolute_order = 1
            """
        )
        setlist_id = cursor.fetchone()[0]

        with pytest.raises(psycopg2.errors.ForeignKeyViolation):
            cursor.execute(
                """
                INSERT INTO live_setlist_band_performances (
                    setlist_id, live_id, band_id, lineup_usage
                )
                VALUES (%s, 2, 1, 'base')
                """,
                (setlist_id,),
            )


# 测试点：公开角色只能读取历史结构，控制台角色可维护关系但不能删除顶层名称或阵容版本。
def test_band_history_role_permission_contract(
    integration_admin_connection,
):
    readable_tables = [
        "band_name_versions",
        "band_lineup_versions",
        "band_lineup_version_members",
        "live_band_lineup_contexts",
        "live_setlist_band_performances",
        "live_setlist_band_performance_members",
    ]
    deletable_tables = {
        "band_lineup_version_members",
        "live_band_lineup_contexts",
        "live_setlist_band_performances",
        "live_setlist_band_performance_members",
    }

    with integration_admin_connection.cursor() as cursor:
        for table_name in readable_tables:
            qualified_name = f"public.{table_name}"
            cursor.execute(
                """
                SELECT
                    has_table_privilege('live_project_ro', %s, 'SELECT'),
                    has_table_privilege('live_project_ro', %s, 'INSERT'),
                    has_table_privilege('live_project_super_ro', %s, 'SELECT,INSERT,UPDATE'),
                    has_table_privilege('live_project_super_ro', %s, 'DELETE')
                """,
                (qualified_name, qualified_name, qualified_name, qualified_name),
            )
            ro_select, ro_insert, super_write, super_delete = cursor.fetchone()
            assert ro_select is True
            assert ro_insert is False
            assert super_write is True
            assert super_delete == (table_name in deletable_tables)

        for sequence_name in (
            "public.band_name_versions_id_seq",
            "public.band_lineup_versions_id_seq",
        ):
            cursor.execute(
                """
                SELECT
                    has_sequence_privilege('live_project_ro', %s, 'SELECT'),
                    has_sequence_privilege('live_project_super_ro', %s, 'USAGE,SELECT,UPDATE')
                """,
                (sequence_name, sequence_name),
            )
            assert cursor.fetchone() == (True, True)


# 测试点：新增 Band 会独立继承常规与特殊编号段，并原子建立当前名称、V1 阵容、成员和审计记录。
def test_console_creates_band_in_selected_id_range_with_v1_history(
    integration_test_client,
    integration_admin_connection,
):
    csrf_token = _login_editor(integration_test_client)
    regular = integration_test_client.post(
        "/api/console/bands",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "id_range": "regular",
            "band_name": "Regular New Band",
            "band_abbr": "rnb",
            "members": ["Member A", "Member B"],
            "valid_from": "2026-07-27",
        },
    )
    special = integration_test_client.post(
        "/api/console/bands",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "id_range": "special",
            "band_name": "Special New Band",
            "band_abbr": "snb",
            "members": ["Special A"],
            "valid_from": None,
        },
    )

    assert regular.status_code == 201
    assert special.status_code == 201
    assert regular.json()["item"]["band_id"] == 4
    assert special.json()["item"]["band_id"] == 101
    assert regular.json()["history"]["lineup_versions"][0]["version_label"] == "Regular New Band V1"
    assert special.json()["history"]["lineup_versions"][0]["members"] == ["Special A"]

    with integration_admin_connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM band_attrs WHERE id = 100")
        assert cursor.fetchone()[0] == 0
        cursor.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM band_attrs WHERE id IN (4, 101)),
                (SELECT COUNT(*) FROM band_name_versions WHERE band_id IN (4, 101)),
                (SELECT COUNT(*) FROM band_lineup_versions WHERE band_id IN (4, 101)),
                (
                    SELECT COUNT(*)
                    FROM band_lineup_version_members member
                    JOIN band_lineup_versions version ON version.id = member.lineup_version_id
                    WHERE version.band_id IN (4, 101)
                ),
                (SELECT COUNT(*) FROM audit_logs WHERE action = 'band_create')
            """
        )
        assert cursor.fetchone() == (2, 2, 2, 3, 2)
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND (
                  (table_name = 'band_attrs' AND column_name = 'band_members')
                  OR (table_name = 'live_setlist' AND column_name = 'band_member')
              )
            """
        )
        assert cursor.fetchone() == (0,)


# 测试点：与当前或历史名称冲突时应返回 409，且不得留下 Band 或历史版本的部分数据。
def test_console_create_band_rejects_duplicate_name_without_partial_rows(
    integration_test_client,
    integration_admin_connection,
):
    csrf_token = _login_editor(integration_test_client)
    with integration_admin_connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM band_attrs")
        band_count_before = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM band_name_versions")
        name_version_count_before = cursor.fetchone()[0]

    response = integration_test_client.post(
        "/api/console/bands",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "id_range": "special",
            "band_name": "  Poppin'Party  ",
            "band_abbr": "duplicate",
            "members": ["Duplicate Member"],
            "valid_from": None,
        },
    )

    assert response.status_code == 409
    with integration_admin_connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM band_attrs")
        assert cursor.fetchone()[0] == band_count_before
        cursor.execute("SELECT COUNT(*) FROM band_name_versions")
        assert cursor.fetchone()[0] == name_version_count_before


# 测试点：新增 Band 在 V1 已插入但审计失败时，四张 band% 表必须随事务整体回滚。
def test_console_create_band_rolls_back_all_version_tables_when_audit_fails(
    integration_test_client,
    integration_admin_connection,
):
    csrf_token = _login_editor(integration_test_client)
    with patch(
        "app.routers.console_bands._write_audit",
        side_effect=RuntimeError("forced audit failure"),
    ):
        with pytest.raises(RuntimeError, match="forced audit failure"):
            integration_test_client.post(
                "/api/console/bands",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "id_range": "regular",
                    "band_name": "Rollback Probe Band",
                    "band_abbr": "rollback",
                    "members": ["Member A", "Member B"],
                    "valid_from": "2026-07-29",
                },
            )

    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM band_attrs WHERE band_name = 'Rollback Probe Band'),
                (
                    SELECT COUNT(*)
                    FROM band_name_versions
                    WHERE band_name = 'Rollback Probe Band'
                ),
                (
                    SELECT COUNT(*)
                    FROM band_lineup_versions
                    WHERE version_label = 'Rollback Probe Band V1'
                ),
                (
                    SELECT COUNT(*)
                    FROM band_lineup_version_members member
                    JOIN band_lineup_versions version
                      ON version.id = member.lineup_version_id
                    WHERE version.version_label = 'Rollback Probe Band V1'
                )
            """
        )
        assert cursor.fetchone() == (0, 0, 0, 0)


# 测试点：常规编号达到 99 后必须明确报满，不得越界占用保留 ID 100 或自动切换特殊段。
def test_console_create_band_rejects_exhausted_regular_range(
    integration_test_client,
    integration_admin_connection,
):
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO band_attrs (id, band_abbr, band_name)
            VALUES (99, 'last', 'Last Regular Band')
            """
        )
    integration_admin_connection.commit()
    csrf_token = _login_editor(integration_test_client)

    response = integration_test_client.post(
        "/api/console/bands",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "id_range": "regular",
            "band_name": "Overflow Band",
            "band_abbr": "overflow",
            "members": ["Overflow Member"],
            "valid_from": None,
        },
    )

    assert response.status_code == 409
    assert "1-99 is exhausted" in response.json()["detail"]
    with integration_admin_connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM band_attrs WHERE id = 100")
        assert cursor.fetchone()[0] == 0


# 测试点：旧资料初始化和原地修正入口退场后，不得再提供可变更历史版本的路由。
def test_console_rejects_retired_band_history_mutation_routes(
    integration_test_client,
):
    csrf_token = _login_editor(integration_test_client)
    initialize_response = integration_test_client.post(
        "/api/console/bands/1/initialize-current",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "band_name": "Poppin'Party",
            "band_abbr": "ppp",
            "members": ["Kasumi"],
        },
    )
    correction_response = integration_test_client.put(
        "/api/console/bands/1/lineup-versions/1",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "version_label": "mutated",
            "members": ["Kasumi"],
        },
    )

    assert initialize_response.status_code == 404
    assert correction_response.status_code == 404


# 测试点：追加阵容必须自动闭合唯一开放版本、建立直接后继并一次性固化可空交接 Live。
def test_console_appends_lineup_and_binds_transition_atomically(
    integration_test_client,
    integration_admin_connection,
):
    csrf_token = _login_editor(integration_test_client)
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "SELECT id FROM band_lineup_versions WHERE band_id = 1 AND valid_to IS NULL"
        )
        old_version_id = int(cursor.fetchone()[0])

    response = integration_test_client.post(
        "/api/console/bands/1/lineup-versions",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "version_label": "Poppin'Party V2",
            "change_type": "addition",
            "members": ["Kasumi", "Tae", "Rimi", "Saaya", "Arisa", "New Member"],
            "valid_from": "2026-07-29",
            "note": "member joined",
            "transition_live_id": 1,
        },
    )

    assert response.status_code == 201
    history = response.json()["history"]
    new_version = next(item for item in history["lineup_versions"] if item["valid_to"] is None)
    assert new_version["predecessor_id"] == old_version_id
    assert new_version["transition_live_id"] == 1
    assert history["current_lineup_version_id"] == new_version["lineup_version_id"]
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "SELECT valid_to FROM band_lineup_versions WHERE id = %s",
            (old_version_id,),
        )
        assert cursor.fetchone()[0].isoformat() == "2026-07-29"
        cursor.execute(
            """
            SELECT base_lineup_version_id, next_lineup_version_id
            FROM live_band_lineup_contexts
            WHERE live_id = 1 AND band_id = 1
            """
        )
        assert cursor.fetchone() == (old_version_id, new_version["lineup_version_id"])

        cursor.execute(
            """
            SELECT id
            FROM band_name_versions
            WHERE band_id = 1 AND valid_to IS NULL
            """
        )
        name_version_id = int(cursor.fetchone()[0])
        cursor.execute(
            """
            INSERT INTO live_band_lineup_contexts (
                live_id, band_id, band_name_version_id,
                base_lineup_version_id, next_lineup_version_id
            )
            VALUES (41, 1, %s, %s, %s)
            ON CONFLICT (live_id, band_id) DO UPDATE
            SET band_name_version_id = EXCLUDED.band_name_version_id,
                base_lineup_version_id = EXCLUDED.base_lineup_version_id,
                next_lineup_version_id = EXCLUDED.next_lineup_version_id
            """,
            (name_version_id, old_version_id, new_version["lineup_version_id"]),
        )

    unbound_response = integration_test_client.post(
        "/api/console/lives/41/setlist",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "setlist_rows": [
                {
                    "song_id": 4,
                    "absolute_order": 1,
                    "segment_type": "M",
                    "sub_order": 1,
                    "is_short": False,
                    "band_performances": [
                        {
                            "band_id": 1,
                            "lineup_usage": "next",
                            "handover_baseline": None,
                            "members": ["Kasumi", "Tae", "Rimi", "Saaya", "Arisa", "New Member"],
                        }
                    ],
                    "other_member": None,
                    "comment": None,
                }
            ]
        },
    )
    assert unbound_response.status_code == 400
    assert "only on its bound transition Live" in unbound_response.json()["detail"]


# 测试点：两个并发追加请求必须由 Band 行锁串行化，只能产生一个 V2 和一个开放版本。
def test_console_concurrent_lineup_append_allows_only_one_successor(
    integration_test_client,
    integration_admin_connection,
):
    csrf_token = _login_editor(integration_test_client)
    payload = {
        "version_label": "Concurrent V2",
        "change_type": "addition",
        "members": ["Kasumi", "Tae", "Rimi", "Saaya", "Arisa", "Concurrent Member"],
        "valid_from": "2026-07-29",
        "note": "concurrent append probe",
        "transition_live_id": None,
    }

    def append_version() -> int:
        return integration_test_client.post(
            "/api/console/bands/1/lineup-versions",
            headers={"X-CSRF-Token": csrf_token},
            json=payload,
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = sorted(executor.map(lambda _: append_version(), range(2)))

    assert statuses == [201, 409]
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                COUNT(*) FILTER (WHERE valid_to IS NULL),
                COUNT(*) FILTER (WHERE predecessor_id IS NOT NULL),
                COUNT(*)
            FROM band_lineup_versions
            WHERE band_id = 1
            """
        )
        assert cursor.fetchone() == (1, 1, 2)


# 测试点：交接 Live 不属于目标 Band 时，整个追加事务必须回滚且旧开放版本仍保持开放。
def test_console_lineup_append_failure_rolls_back_old_valid_to(
    integration_test_client,
    integration_admin_connection,
):
    csrf_token = _login_editor(integration_test_client)
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "SELECT id FROM band_lineup_versions WHERE band_id = 1 AND valid_to IS NULL"
        )
        old_version_id = int(cursor.fetchone()[0])

    response = integration_test_client.post(
        "/api/console/bands/1/lineup-versions",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "version_label": "Invalid V2",
            "change_type": "replacement",
            "members": ["Kasumi"],
            "valid_from": "2026-07-29",
            "note": None,
            "transition_live_id": 999999,
        },
    )

    assert response.status_code == 400
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            "SELECT valid_to FROM band_lineup_versions WHERE id = %s",
            (old_version_id,),
        )
        assert cursor.fetchone() == (None,)
        cursor.execute("SELECT COUNT(*) FROM band_lineup_versions WHERE band_id = 1")
        assert cursor.fetchone() == (1,)
