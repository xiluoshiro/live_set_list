from __future__ import annotations

import shutil
import socket
import subprocess
import textwrap
import uuid
from dataclasses import dataclass
from pathlib import Path

import pytest

from recovery import backup, docker_ops, restore
from recovery.common import ROOT


@dataclass
class SandboxContext:
    docker_cmd: str
    env_values: dict[str, str]
    runtime_dir: Path
    compose_file: Path
    flyway_config: Path
    container_name: str
    volume_name: str


CONSOLE_DELETABLE_TABLES = (
    "band_lineup_version_members",
    "live_band_lineup_contexts",
    "live_setlist",
    "live_setlist_band_performance_members",
    "live_setlist_band_performances",
    "performance_group_lives",
    "tour_bands",
    "tour_lives",
)


def _console_permission_violations_sql() -> str:
    deletable_values = ",\n                ".join(
        f"('{table_name}')" for table_name in CONSOLE_DELETABLE_TABLES
    )
    return f"""
WITH deletable_tables(table_name) AS (
    VALUES
        {deletable_values}
),
violations AS (
    SELECT 'schema:public:USAGE' AS violation
    WHERE NOT has_schema_privilege(current_user, 'public', 'USAGE')

    UNION ALL

    SELECT 'table:' || tables.tablename
    FROM pg_tables AS tables
    LEFT JOIN deletable_tables
      ON deletable_tables.table_name = tables.tablename
    WHERE tables.schemaname = 'public'
      AND tables.tablename <> 'flyway_schema_history'
      AND (
          NOT has_table_privilege(
              current_user,
              format('%I.%I', tables.schemaname, tables.tablename),
              'SELECT'
          )
          OR NOT has_table_privilege(
              current_user,
              format('%I.%I', tables.schemaname, tables.tablename),
              'INSERT'
          )
          OR NOT has_table_privilege(
              current_user,
              format('%I.%I', tables.schemaname, tables.tablename),
              'UPDATE'
          )
          OR has_table_privilege(
              current_user,
              format('%I.%I', tables.schemaname, tables.tablename),
              'DELETE'
          ) IS DISTINCT FROM (deletable_tables.table_name IS NOT NULL)
      )

    UNION ALL

    SELECT 'sequence:' || sequences.sequencename
    FROM pg_sequences AS sequences
    WHERE sequences.schemaname = 'public'
      AND (
          NOT has_sequence_privilege(
              current_user,
              format('%I.%I', sequences.schemaname, sequences.sequencename),
              'USAGE'
          )
          OR NOT has_sequence_privilege(
              current_user,
              format('%I.%I', sequences.schemaname, sequences.sequencename),
              'SELECT'
          )
          OR NOT has_sequence_privilege(
              current_user,
              format('%I.%I', sequences.schemaname, sequences.sequencename),
              'UPDATE'
          )
      )
)
SELECT COALESCE(string_agg(violation, ',' ORDER BY violation), '')
FROM violations;
"""


def _readonly_permission_violations_sql() -> str:
    return """
WITH violations AS (
    SELECT 'schema:public:USAGE' AS violation
    WHERE NOT has_schema_privilege(current_user, 'public', 'USAGE')

    UNION ALL

    SELECT 'table:' || tables.tablename
    FROM pg_tables AS tables
    WHERE tables.schemaname = 'public'
      AND tables.tablename <> 'flyway_schema_history'
      AND (
          NOT has_table_privilege(
              current_user,
              format('%I.%I', tables.schemaname, tables.tablename),
              'SELECT'
          )
          OR has_table_privilege(
              current_user,
              format('%I.%I', tables.schemaname, tables.tablename),
              'INSERT'
          )
          OR has_table_privilege(
              current_user,
              format('%I.%I', tables.schemaname, tables.tablename),
              'UPDATE'
          )
          OR has_table_privilege(
              current_user,
              format('%I.%I', tables.schemaname, tables.tablename),
              'DELETE'
          )
      )

    UNION ALL

    SELECT 'sequence:' || sequences.sequencename
    FROM pg_sequences AS sequences
    WHERE sequences.schemaname = 'public'
      AND (
          NOT has_sequence_privilege(
              current_user,
              format('%I.%I', sequences.schemaname, sequences.sequencename),
              'SELECT'
          )
          OR has_sequence_privilege(
              current_user,
              format('%I.%I', sequences.schemaname, sequences.sequencename),
              'USAGE'
          )
          OR has_sequence_privilege(
              current_user,
              format('%I.%I', sequences.schemaname, sequences.sequencename),
              'UPDATE'
          )
      )
)
SELECT COALESCE(string_agg(violation, ',' ORDER BY violation), '')
FROM violations;
"""


def _require_binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        pytest.fail(f"未找到命令：{name}")
    return path


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _write_compose_file(path: Path) -> None:
    init_dir = (ROOT / "backend" / "db" / "postgres" / "init").as_posix()
    compose = f"""
name: live-set-list-recovery-test

services:
  postgres:
    image: ${{POSTGRES_IMAGE}}
    container_name: ${{POSTGRES_CONTAINER_NAME}}
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${{POSTGRES_DB}}
      POSTGRES_USER: ${{POSTGRES_USER}}
      POSTGRES_PASSWORD: ${{POSTGRES_PASSWORD}}
      APP_DB: ${{APP_DB}}
      APP_OWNER: ${{APP_OWNER}}
      APP_OWNER_PASSWORD: ${{APP_OWNER_PASSWORD}}
      FLYWAY_USER: ${{FLYWAY_USER}}
      FLYWAY_PASSWORD: ${{FLYWAY_PASSWORD}}
      APP_RO_USER: ${{APP_RO_USER}}
      APP_RO_PASSWORD: ${{APP_RO_PASSWORD}}
      APP_SUPER_USER: ${{APP_SUPER_USER}}
      APP_SUPER_PASSWORD: ${{APP_SUPER_PASSWORD}}
      TEST_ADMIN_USER: ${{TEST_ADMIN_USER}}
      TEST_ADMIN_PASSWORD: ${{TEST_ADMIN_PASSWORD}}
      TEST_DB_NAME: ${{TEST_DB_NAME}}
    ports:
      - "${{POSTGRES_PORT}}:5432"
    volumes:
      - pgdata:/var/lib/postgresql
      - {init_dir}:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${{POSTGRES_USER}} -d ${{POSTGRES_DB}}"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
    name: ${{POSTGRES_VOLUME_NAME}}
    external: true
"""
    path.write_text(textwrap.dedent(compose).strip() + "\n", encoding="utf-8")


def _write_flyway_config(path: Path, port: int, password: str) -> None:
    config = f"""
name = "LiveSetList Recovery Sandbox"
databaseType = "postgresql"

[flyway]
environment = "test"
locations = ["filesystem:backend/db/flyway/sql"]
table = "flyway_schema_history"
baselineVersion = "1"
baselineDescription = "Existing database baseline"
createSchemas = false
defaultSchema = "public"

[environments.dev]
url = "jdbc:postgresql://localhost:{port}/live_statistic"
user = "live_project_flyway"
password = "{password}"
displayName = "Recovery sandbox app database"
schemas = ["public"]

[environments.test]
url = "jdbc:postgresql://localhost:{port}/live_statistic_test"
user = "live_project_flyway"
password = "{password}"
displayName = "Recovery sandbox test database"
schemas = ["public"]
"""
    path.write_text(textwrap.dedent(config).strip() + "\n", encoding="utf-8")


def _docker_capture(docker_cmd: str, args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run([docker_cmd, *args], cwd=ROOT, text=True, capture_output=True, check=False)


def _container_is_running(docker_cmd: str, container_name: str) -> bool:
    completed = _docker_capture(docker_cmd, ["inspect", "--format", "{{.State.Running}}", container_name])
    return completed.returncode == 0 and completed.stdout.strip() == "true"


def _volume_exists(docker_cmd: str, volume_name: str) -> bool:
    completed = _docker_capture(docker_cmd, ["volume", "inspect", volume_name])
    return completed.returncode == 0


def _psql(docker_cmd: str, container_name: str, database: str, sql: str, *, user: str = "postgres") -> str:
    completed = subprocess.run(
        [
            docker_cmd,
            "exec",
            container_name,
            "psql",
            "-U",
            user,
            "-d",
            database,
            "-tAc",
            sql,
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise AssertionError(f"psql 执行失败：{completed.stderr}")
    return completed.stdout.strip()


def _cleanup_sandbox(docker_cmd: str, container_name: str, volume_name: str) -> None:
    names = _docker_capture(docker_cmd, ["ps", "-a", "--format", "{{.Names}}"]).stdout.splitlines()
    for name in names:
        if name == container_name or name.startswith(f"{container_name}-backup-"):
            subprocess.run([docker_cmd, "rm", "-f", name], cwd=ROOT, capture_output=True, text=True, check=False)

    volumes = _docker_capture(docker_cmd, ["volume", "ls", "--format", "{{.Name}}"]).stdout.splitlines()
    prefixes = [volume_name, f"{volume_name}_candidate_", f"{volume_name}_snapshot_"]
    for name in volumes:
        if any(name == prefix or name.startswith(prefix) for prefix in prefixes):
            subprocess.run([docker_cmd, "volume", "rm", name], cwd=ROOT, capture_output=True, text=True, check=False)


@pytest.fixture()
def sandbox_context(monkeypatch: pytest.MonkeyPatch) -> SandboxContext:
    docker_cmd = _require_binary("docker")
    _require_binary("flyway.cmd")

    suffix = uuid.uuid4().hex[:8]
    runtime_dir = ROOT / "recovery" / ".runtime" / f"sandbox-{suffix}"
    runtime_dir.mkdir(parents=True, exist_ok=True)

    container_name = f"live-set-list-recovery-test-{suffix}"
    volume_name = f"live_set_list_recovery_test_data_{suffix}"
    port = _find_free_port()
    compose_file = runtime_dir / "docker-compose.recovery-test.yml"
    flyway_config = runtime_dir / "flyway.recovery-test.toml"
    backup_root = runtime_dir / "backups"

    env_values = {
        "POSTGRES_IMAGE": "postgres:18.3-trixie",
        "POSTGRES_CONTAINER_NAME": container_name,
        "POSTGRES_VOLUME_NAME": volume_name,
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": str(port),
        "POSTGRES_DB": "postgres",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "sandbox_postgres_password",
        "APP_DB": "live_statistic",
        "APP_OWNER": "live_project_owner",
        "APP_OWNER_PASSWORD": "sandbox_owner_password",
        "FLYWAY_USER": "live_project_flyway",
        "FLYWAY_PASSWORD": "sandbox_flyway_password",
        "APP_RO_USER": "live_project_ro",
        "APP_RO_PASSWORD": "sandbox_ro_password",
        "APP_SUPER_USER": "live_project_super_ro",
        "APP_SUPER_PASSWORD": "sandbox_super_password",
        "TEST_ADMIN_USER": "live_project_test_admin",
        "TEST_ADMIN_PASSWORD": "sandbox_test_admin_password",
        "TEST_DB_NAME": "live_statistic_test",
    }

    _write_compose_file(compose_file)
    _write_flyway_config(flyway_config, port, env_values["FLYWAY_PASSWORD"])

    monkeypatch.setattr(docker_ops, "COMPOSE_FILE", compose_file)
    monkeypatch.setattr(restore, "FLYWAY_CONFIG", flyway_config)
    monkeypatch.setattr(backup, "AUTO_BACKUP_DIR", backup_root / "app" / "auto")
    monkeypatch.setattr(backup, "MANUAL_BACKUP_DIR", backup_root / "app" / "manual")
    monkeypatch.setattr(backup, "RECOVERY_SNAPSHOT_DIR", backup_root / "app" / "recovery-snapshot")

    docker_ops.create_volume_if_missing(docker_cmd, volume_name)
    docker_ops.run_step(
        "docker",
        [docker_cmd, "compose", "-f", str(compose_file.relative_to(ROOT)), "up", "-d"],
        env_overrides=docker_ops.build_compose_env(env_values),
    )
    docker_ops.wait_for_container_ready(docker_cmd, container_name)
    restore.run_flyway_for_environment("migrate", "dev")
    restore.run_flyway_for_environment("migrate", "test")

    context = SandboxContext(
        docker_cmd=docker_cmd,
        env_values=env_values,
        runtime_dir=runtime_dir,
        compose_file=compose_file,
        flyway_config=flyway_config,
        container_name=container_name,
        volume_name=volume_name,
    )

    try:
        yield context
    finally:
        _cleanup_sandbox(docker_cmd, container_name, volume_name)
        shutil.rmtree(runtime_dir, ignore_errors=True)


def test_manual_backup_generates_real_dump_and_validates_with_pg_restore(sandbox_context: SandboxContext) -> None:
    # 测试点：backup-app-manual 在独立沙箱容器里应能真实生成 dump，并通过最小恢复行数校验。
    _psql(
        sandbox_context.docker_cmd,
        sandbox_context.container_name,
        "live_statistic",
        "INSERT INTO public.venue_list (id, venue) VALUES (101, 'Sandbox Hall');",
    )

    backup_path = backup.create_app_backup(
        sandbox_context.env_values,
        sandbox_context.docker_cmd,
        kind="manual",
        container_name=sandbox_context.container_name,
    )

    assert backup_path.exists()
    assert backup_path.parent == backup.MANUAL_BACKUP_DIR
    backup.validate_backup_file(sandbox_context.docker_cmd, sandbox_context.container_name, backup_path)
    assert backup.measure_backup_restore_line_count(
        sandbox_context.docker_cmd,
        sandbox_context.container_name,
        backup_path,
    ) > 0


def test_auto_backup_rejects_current_dump_when_restore_line_count_drops_too_much(
    sandbox_context: SandboxContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 测试点：自动备份在有历史基线时，当前最小恢复行数异常偏低应删除本次 dump 并直接失败。
    _psql(
        sandbox_context.docker_cmd,
        sandbox_context.container_name,
        "live_statistic",
        "INSERT INTO public.venue_list (id, venue) VALUES (201, 'Auto Backup Baseline Hall');",
    )

    baseline_backup = backup.create_app_backup(
        sandbox_context.env_values,
        sandbox_context.docker_cmd,
        kind="auto",
        container_name=sandbox_context.container_name,
    )
    assert baseline_backup.exists()

    current_backup = backup.AUTO_BACKUP_DIR / "live_statistic_auto_20990101_000001.dump"
    original_measure = backup.measure_backup_restore_line_count

    monkeypatch.setattr(backup, "build_backup_path", lambda _kind: current_backup)

    def fake_measure(docker_cmd: str, container_name: str, backup_path: Path) -> int:
        if backup_path == current_backup:
            return 1
        return original_measure(docker_cmd, container_name, backup_path)

    monkeypatch.setattr(backup, "measure_backup_restore_line_count", fake_measure)

    with pytest.raises(SystemExit, match="异常偏低"):
        backup.create_app_backup(
            sandbox_context.env_values,
            sandbox_context.docker_cmd,
            kind="auto",
            container_name=sandbox_context.container_name,
        )

    assert baseline_backup.exists()
    assert not current_backup.exists()


def test_candidate_container_can_boot_from_external_volume_and_rollback_to_formal(sandbox_context: SandboxContext) -> None:
    # 测试点：候选恢复在真实 Docker 中应先创建 external candidate volume，并能在回滚后重新拉起正式容器。
    container_name, candidate_volume_name, old_container_name, _old_volume_name = docker_ops.prepare_candidate_database(
        sandbox_context.env_values,
        sandbox_context.docker_cmd,
        suffix="20260406235500",
    )

    assert container_name == sandbox_context.container_name
    assert old_container_name is not None
    assert _container_is_running(sandbox_context.docker_cmd, sandbox_context.container_name)
    assert _volume_exists(sandbox_context.docker_cmd, candidate_volume_name)

    docker_ops.rollback_candidate(
        sandbox_context.env_values,
        sandbox_context.docker_cmd,
        container_name,
        candidate_volume_name,
        old_container_name,
    )
    docker_ops.wait_for_container_ready(sandbox_context.docker_cmd, sandbox_context.container_name)

    assert _container_is_running(sandbox_context.docker_cmd, sandbox_context.container_name)
    assert not docker_ops.container_exists(sandbox_context.docker_cmd, old_container_name)
    assert not _volume_exists(sandbox_context.docker_cmd, candidate_volume_name)


def test_restore_backup_on_candidate_container_runs_flyway_and_restores_data(sandbox_context: SandboxContext) -> None:
    # 测试点：真实恢复后运行时角色必须满足完整权限矩阵，并能原子替换阵容上下文。
    _psql(
        sandbox_context.docker_cmd,
        sandbox_context.container_name,
        "live_statistic",
        "INSERT INTO public.venue_list (id, venue) VALUES (101, 'Sandbox Hall');",
    )
    _psql(
        sandbox_context.docker_cmd,
        sandbox_context.container_name,
        "live_statistic",
        """
        INSERT INTO public.band_attrs (id, band_abbr, band_name, band_members)
        VALUES (101, 'sandbox', 'Sandbox Band', ARRAY['Before', 'After']);

        INSERT INTO public.live_attrs (
            id,
            live_date,
            live_title,
            is_internal,
            url,
            opening_time,
            start_time,
            venue_id,
            live_type
        )
        VALUES (
            101,
            DATE '2026-04-06',
            'Sandbox Live',
            true,
            'https://example.test/sandbox-live',
            TIME WITH TIME ZONE '18:00:00+09',
            TIME WITH TIME ZONE '19:00:00+09',
            101,
            'oneman'
        );

        INSERT INTO public.band_name_versions (
            id,
            band_id,
            band_name,
            band_abbr,
            valid_from
        )
        VALUES (101, 101, 'Sandbox Band', 'sandbox', DATE '2026-01-01');

        INSERT INTO public.band_lineup_versions (
            id,
            band_id,
            version_no,
            version_label,
            valid_from,
            change_type
        )
        VALUES (101, 101, 1, 'Sandbox V1', DATE '2026-01-01', 'initial');

        INSERT INTO public.live_band_lineup_contexts (
            live_id,
            band_id,
            band_name_version_id,
            base_lineup_version_id,
            note
        )
        VALUES (101, 101, 101, 101, 'before restore');
        """,
    )
    backup_path = backup.create_app_backup(
        sandbox_context.env_values,
        sandbox_context.docker_cmd,
        kind="manual",
        container_name=sandbox_context.container_name,
    )

    container_name, candidate_volume_name, old_container_name, _old_volume_name = docker_ops.prepare_candidate_database(
        sandbox_context.env_values,
        sandbox_context.docker_cmd,
        suffix="20260406235600",
    )

    try:
        restore.restore_app_database_from_backup(
            sandbox_context.env_values,
            sandbox_context.docker_cmd,
            container_name,
            backup_path,
        )
        info = restore.run_flyway_info_capture("dev")
        assert info.returncode == 0
        restore.run_flyway_for_environment("validate", "dev")
        assert _psql(
            sandbox_context.docker_cmd,
            container_name,
            "live_statistic",
            "SELECT venue FROM public.venue_list WHERE id = 101;",
        ) == "Sandbox Hall"
        assert _psql(
            sandbox_context.docker_cmd,
            container_name,
            "live_statistic",
            _readonly_permission_violations_sql(),
            user=sandbox_context.env_values["APP_RO_USER"],
        ) == ""
        assert _psql(
            sandbox_context.docker_cmd,
            container_name,
            "live_statistic",
            _console_permission_violations_sql(),
            user=sandbox_context.env_values["APP_SUPER_USER"],
        ) == ""
        assert _psql(
            sandbox_context.docker_cmd,
            container_name,
            "live_statistic",
            """
            WITH deleted_context AS (
                DELETE FROM public.live_band_lineup_contexts
                WHERE live_id = 101
                  AND band_id = 101
                RETURNING live_id, band_id
            ),
            inserted_context AS (
                INSERT INTO public.live_band_lineup_contexts (
                    live_id,
                    band_id,
                    band_name_version_id,
                    base_lineup_version_id,
                    note
                )
                SELECT live_id, band_id, 101, 101, 'after restore'
                FROM deleted_context
                RETURNING note
            )
            SELECT note
            FROM inserted_context;
            """,
            user=sandbox_context.env_values["APP_SUPER_USER"],
        ) == "after restore"
    finally:
        docker_ops.rollback_candidate(
            sandbox_context.env_values,
            sandbox_context.docker_cmd,
            container_name,
            candidate_volume_name,
            old_container_name,
        )
        docker_ops.wait_for_container_ready(sandbox_context.docker_cmd, sandbox_context.container_name)
