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
    # 测试点：backup-app-manual 在独立沙箱容器里应能真实生成 dump，并通过 pg_restore -l 校验。
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
    # 测试点：候选容器中的真实 pg_restore 完成后，应能继续执行 Flyway info/validate，并恢复备份中的业务数据。
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
    finally:
        docker_ops.rollback_candidate(
            sandbox_context.env_values,
            sandbox_context.docker_cmd,
            container_name,
            candidate_volume_name,
            old_container_name,
        )
        docker_ops.wait_for_container_ready(sandbox_context.docker_cmd, sandbox_context.container_name)
