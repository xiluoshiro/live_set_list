READONLY_ROLE = "live_project_ro"
CONSOLE_WRITE_ROLE = "live_project_super_ro"

CONSOLE_DELETABLE_TABLES = {
    "band_lineup_version_members",
    "live_band_lineup_contexts",
    "live_setlist",
    "live_setlist_band_performance_members",
    "live_setlist_band_performances",
    "performance_group_lives",
    "tour_bands",
    "tour_lives",
}


# 测试点：所有业务表与序列都必须满足运行时角色矩阵，DELETE 只能开放给完整集合替换关系表。
def test_all_business_objects_follow_runtime_permission_matrix(
    integration_admin_connection,
):
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public'
              AND tablename <> 'flyway_schema_history'
            ORDER BY tablename
            """
        )
        table_names = [str(row[0]) for row in cursor.fetchall()]
        assert table_names

        for table_name in table_names:
            qualified_name = f"public.{table_name}"
            cursor.execute(
                """
                SELECT
                    has_table_privilege(%s, %s, 'SELECT'),
                    has_table_privilege(%s, %s, 'INSERT,UPDATE,DELETE'),
                    has_table_privilege(%s, %s, 'SELECT,INSERT,UPDATE'),
                    has_table_privilege(%s, %s, 'DELETE')
                """,
                (
                    READONLY_ROLE,
                    qualified_name,
                    READONLY_ROLE,
                    qualified_name,
                    CONSOLE_WRITE_ROLE,
                    qualified_name,
                    CONSOLE_WRITE_ROLE,
                    qualified_name,
                ),
            )
            ro_select, ro_write, console_write, console_delete = cursor.fetchone()
            assert ro_select is True, f"{READONLY_ROLE} cannot SELECT {qualified_name}"
            assert ro_write is False, f"{READONLY_ROLE} can write {qualified_name}"
            assert console_write is True, f"{CONSOLE_WRITE_ROLE} cannot maintain {qualified_name}"
            assert console_delete == (table_name in CONSOLE_DELETABLE_TABLES), (
                f"{CONSOLE_WRITE_ROLE} DELETE mismatch for {qualified_name}"
            )

        cursor.execute(
            """
            SELECT sequencename
            FROM pg_sequences
            WHERE schemaname = 'public'
            ORDER BY sequencename
            """
        )
        sequence_names = [str(row[0]) for row in cursor.fetchall()]
        assert sequence_names

        for sequence_name in sequence_names:
            qualified_name = f"public.{sequence_name}"
            cursor.execute(
                """
                SELECT
                    has_sequence_privilege(%s, %s, 'SELECT'),
                    has_sequence_privilege(%s, %s, 'USAGE,UPDATE'),
                    has_sequence_privilege(%s, %s, 'USAGE,SELECT,UPDATE')
                """,
                (
                    READONLY_ROLE,
                    qualified_name,
                    READONLY_ROLE,
                    qualified_name,
                    CONSOLE_WRITE_ROLE,
                    qualified_name,
                ),
            )
            ro_select, ro_write, console_write = cursor.fetchone()
            assert ro_select is True, f"{READONLY_ROLE} cannot SELECT {qualified_name}"
            assert ro_write is False, f"{READONLY_ROLE} can advance {qualified_name}"
            assert console_write is True, f"{CONSOLE_WRITE_ROLE} cannot use {qualified_name}"
