import psycopg2
import pytest

from app.band_history_backfill import (
    apply_legacy_band_history_backfill,
    inspect_legacy_band_history_backfill,
)


pytestmark = pytest.mark.integration


def _insert_band_history(integration_admin_connection) -> tuple[int, int, int]:
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
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
                predecessor_id, change_type
            )
            VALUES (1, 2, 'Poppin''Party V2', DATE '2018-01-01', NULL, %s, 'addition')
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


# 测试点：控制台确认当前资料时应同步修正兼容投影、初始化名称与阵容版本并返回完整历史。
def test_console_initializes_current_band_history_and_audits(
    integration_test_client,
    integration_admin_connection,
):
    csrf_token = _login_editor(integration_test_client)
    response = integration_test_client.post(
        "/api/console/bands/1/initialize-current",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "band_name": "Poppin'Party",
            "band_abbr": "ppp",
            "members": ["Kasumi", "Tae", "Rimi", "Saaya", "Arisa"],
            "version_no": 3,
            "version_label": "Poppin'Party V3",
            "valid_from": "2018-01-01",
            "valid_to": None,
            "note": "confirmed current roster",
        },
    )

    assert response.status_code == 201
    history = response.json()["history"]
    assert history["initialized"] is True
    assert history["name_versions"][0]["band_name"] == "Poppin'Party"
    assert history["lineup_versions"][0]["version_no"] == 3
    assert history["lineup_versions"][0]["members"] == ["Kasumi", "Tae", "Rimi", "Saaya", "Arisa"]

    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT action, payload_json ->> 'version_label'
            FROM audit_logs
            WHERE action = 'band_history_initialize'
            ORDER BY id DESC
            LIMIT 1
            """
        )
        assert cursor.fetchone() == ("band_history_initialize", "Poppin'Party V3")


# 测试点：资料修正必须先确认精确受影响 Live 集合，并在成功后保留修正审计。
def test_console_lineup_correction_requires_exact_impact_confirmation(
    integration_test_client,
    integration_admin_connection,
):
    _, base_version_id, _ = _insert_band_history(integration_admin_connection)
    csrf_token = _login_editor(integration_test_client)

    mismatch = integration_test_client.put(
        f"/api/console/bands/1/lineup-versions/{base_version_id}",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "version_label": "Poppin'Party V1 corrected",
            "members": ["Kasumi", "Tae"],
            "valid_from": "2015-01-01",
            "valid_to": "2018-01-01",
            "note": "source correction",
            "confirmed_live_ids": [],
        },
    )
    assert mismatch.status_code == 409
    assert "expected [1]" in mismatch.json()["detail"]

    success = integration_test_client.put(
        f"/api/console/bands/1/lineup-versions/{base_version_id}",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "version_label": "Poppin'Party V1 corrected",
            "members": ["Kasumi", "Tae"],
            "valid_from": "2015-01-01",
            "valid_to": "2018-01-01",
            "note": "source correction",
            "confirmed_live_ids": [1],
        },
    )
    assert success.status_code == 200
    corrected = next(
        item
        for item in success.json()["history"]["lineup_versions"]
        if item["lineup_version_id"] == base_version_id
    )
    assert corrected["change_type"] == "correction"
    assert corrected["members"] == ["Kasumi", "Tae"]


# 测试点：只读预检通过后，自动回填应一次性建立上下文、逐曲出演与成员关系并写审计。
def test_legacy_band_history_backfill_preflight_and_apply(
    integration_admin_connection,
):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute("DELETE FROM live_setlist")
        cursor.execute(
            """
            INSERT INTO band_name_versions (band_id, band_name, band_abbr, valid_from)
            VALUES (1, 'Poppin''Party', 'ppp', DATE '2018-01-01')
            RETURNING id
            """
        )
        name_version_id = int(cursor.fetchone()[0])
        cursor.execute(
            """
            INSERT INTO band_lineup_versions (
                band_id, version_no, version_label, valid_from, change_type
            )
            VALUES (1, 3, 'Poppin''Party V3', DATE '2018-01-01', 'initial')
            RETURNING id
            """
        )
        lineup_version_id = int(cursor.fetchone()[0])
        cursor.executemany(
            """
            INSERT INTO band_lineup_version_members (
                lineup_version_id, member_name, display_order
            )
            VALUES (%s, %s, %s)
            """,
            [
                (lineup_version_id, "Kasumi", 1),
                (lineup_version_id, "Tae", 2),
            ],
        )
        cursor.execute(
            """
            INSERT INTO live_setlist (
                id, live_id, song_id, absolute_order, segment_type, sub_order,
                band_member
            )
            VALUES (
                '11111111-1111-4111-8111-111111111111',
                1, 1, 1, 'M', 1,
                '{"Poppin''Party":["Kasumi","Tae"]}'::jsonb
            )
            """
        )

        inspection = inspect_legacy_band_history_backfill(cursor)
        assert inspection.summary == {
            "ready": True,
            "setlist_row_count": 1,
            "performance_count": 1,
            "member_count": 2,
            "live_band_context_count": 1,
            "mapped_band_ids": [1],
            "issues": [],
        }
        integration_admin_connection.autocommit = False
        summary = apply_legacy_band_history_backfill(cursor, audit_user_id=None)
        assert summary["ready"] is True

        cursor.execute(
            """
            SELECT band_name_version_id, base_lineup_version_id, next_lineup_version_id
            FROM live_band_lineup_contexts
            WHERE live_id = 1 AND band_id = 1
            """
        )
        assert cursor.fetchone() == (name_version_id, lineup_version_id, None)
        cursor.execute(
            """
            SELECT lineup_usage
            FROM live_setlist_band_performances
            WHERE setlist_id = '11111111-1111-4111-8111-111111111111'
            """
        )
        assert cursor.fetchone() == ("base",)
        cursor.execute(
            """
            SELECT member_name
            FROM live_setlist_band_performance_members
            WHERE setlist_id = '11111111-1111-4111-8111-111111111111'
            ORDER BY display_order
            """
        )
        assert cursor.fetchall() == [("Kasumi",), ("Tae",)]
        cursor.execute(
            "SELECT COUNT(*) FROM audit_logs WHERE action = 'band_history_backfill'"
        )
        assert cursor.fetchone() == (1,)
        integration_admin_connection.commit()
