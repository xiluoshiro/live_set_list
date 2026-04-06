import argparse
import os
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / "infra" / "postgres" / ".env.pg-migrate"
COMPOSE_FILE = ROOT / "infra" / "postgres" / "docker-compose.pg-migrate.yml"
FLYWAY_CONFIG = ROOT / "backend" / "db" / "flyway" / "flyway.toml"
SEED_SQL = ROOT / "backend" / "db" / "postgres" / "seed" / "base_seed.sql"
BACKUP_ROOT = Path(r"C:\Users\xiluo\OneDrive - stu.jiangnan.edu.cn\Backup\live-set-list-docker")
AUTO_BACKUP_DIR = BACKUP_ROOT / "app" / "auto"
MANUAL_BACKUP_DIR = BACKUP_ROOT / "app" / "manual"
RECOVERY_SNAPSHOT_DIR = BACKUP_ROOT / "app" / "recovery-snapshot"
AUTO_BACKUP_KEEP = 5
MANUAL_BACKUP_KEEP = 3


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"')
    return values


def run_step(
    label: str,
    args: list[str],
    *,
    input_text: str | None = None,
    env_overrides: dict[str, str] | None = None,
) -> None:
    print(f"[{label}] {' '.join(args)}", flush=True)
    env = os.environ.copy()
    if env_overrides:
        env.update(env_overrides)
    completed = subprocess.run(
        args,
        cwd=ROOT,
        text=True,
        input=input_text,
        env=env,
    )
    if completed.returncode != 0:
        raise SystemExit(f"{label} 失败，退出码: {completed.returncode}")


def run_step_capture(
    label: str,
    args: list[str],
    *,
    env_overrides: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    print(f"[{label}] {' '.join(args)}", flush=True)
    env = os.environ.copy()
    if env_overrides:
        env.update(env_overrides)
    return subprocess.run(
        args,
        cwd=ROOT,
        text=True,
        capture_output=True,
        env=env,
    )


def run_binary_step(
    label: str,
    args: list[str],
    *,
    stdin_path: Path | None = None,
    stdout_path: Path | None = None,
) -> subprocess.CompletedProcess[bytes]:
    print(f"[{label}] {' '.join(args)}", flush=True)
    stdin_handle = stdin_path.open("rb") if stdin_path else None
    stdout_handle = stdout_path.open("wb") if stdout_path else None
    try:
        return subprocess.run(
            args,
            cwd=ROOT,
            stdin=stdin_handle,
            stdout=stdout_handle if stdout_handle else subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
        )
    finally:
        if stdin_handle:
            stdin_handle.close()
        if stdout_handle:
            stdout_handle.close()


def wait_for_container_ready(
    docker_cmd: str,
    container_name: str,
    max_attempts: int = 30,
    delay_seconds: int = 2,
) -> None:
    check_command = [
        docker_cmd,
        "inspect",
        "--format",
        "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
        container_name,
    ]
    for attempt in range(1, max_attempts + 1):
        completed = subprocess.run(
            check_command,
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        status = completed.stdout.strip()
        if completed.returncode == 0 and status == "healthy":
            print(f"[docker] 容器已就绪：{container_name}", flush=True)
            return
        if completed.returncode == 0 and status == "running":
            print(f"[docker] 容器已运行：{container_name}", flush=True)
            return
        print(f"[docker] 等待容器就绪 ({attempt}/{max_attempts})，当前状态：{status or 'unknown'}", flush=True)
        time.sleep(delay_seconds)
    raise SystemExit(f"等待容器就绪超时：{container_name}")


def container_exists(docker_cmd: str, container_name: str) -> bool:
    completed = run_step_capture(
        "docker",
        [docker_cmd, "container", "inspect", container_name],
    )
    return completed.returncode == 0


def stop_container_if_running(docker_cmd: str, container_name: str) -> None:
    inspect = run_step_capture(
        "docker",
        [docker_cmd, "inspect", "--format", "{{.State.Running}}", container_name],
    )
    if inspect.returncode == 0 and inspect.stdout.strip() == "true":
        run_step("docker", [docker_cmd, "stop", container_name])


def start_container_if_stopped(docker_cmd: str, container_name: str) -> None:
    inspect = run_step_capture(
        "docker",
        [docker_cmd, "inspect", "--format", "{{.State.Running}}", container_name],
    )
    if inspect.returncode != 0:
        raise SystemExit(f"未找到 PostgreSQL 容器：{container_name}")
    if inspect.stdout.strip() != "true":
        run_step("docker", [docker_cmd, "start", container_name])
        wait_for_container_ready(docker_cmd, container_name)


def ensure_container_ready(docker_cmd: str, container_name: str) -> None:
    if not container_exists(docker_cmd, container_name):
        raise SystemExit(f"未找到 PostgreSQL 容器：{container_name}")
    start_container_if_stopped(docker_cmd, container_name)


def remove_container_if_exists(docker_cmd: str, container_name: str) -> None:
    if container_exists(docker_cmd, container_name):
        run_step("docker", [docker_cmd, "rm", "-f", container_name])


def cleanup_stale_backup_containers(
    env_values: dict[str, str],
    docker_cmd: str,
    *,
    exclude_names: set[str] | None = None,
) -> None:
    # 清理历史遗留的 backup 容器，避免多次恢复后留下无用的旧容器。
    container_name = env_values.get("POSTGRES_CONTAINER_NAME", "live-set-list-docker")
    backup_prefix = f"{container_name}-backup-"
    excluded = exclude_names or set()
    completed = run_step_capture(
        "docker",
        [docker_cmd, "ps", "-a", "--format", "{{.Names}}"],
    )
    if completed.returncode != 0:
        return
    for name in completed.stdout.splitlines():
        if name.startswith(backup_prefix) and name not in excluded:
            remove_container_if_exists(docker_cmd, name)


def remove_volume_if_exists(docker_cmd: str, volume_name: str) -> None:
    inspect = run_step_capture("docker", [docker_cmd, "volume", "inspect", volume_name])
    if inspect.returncode == 0:
        run_step("docker", [docker_cmd, "volume", "rm", volume_name])


def create_volume_if_missing(docker_cmd: str, volume_name: str) -> None:
    inspect = run_step_capture("docker", [docker_cmd, "volume", "inspect", volume_name])
    if inspect.returncode != 0:
        run_step("docker", [docker_cmd, "volume", "create", volume_name])


def copy_volume_data(
    docker_cmd: str,
    source_volume_name: str,
    target_volume_name: str,
    *,
    image: str,
) -> None:
    run_step(
        "docker",
        [
            docker_cmd,
            "run",
            "--rm",
            "-v",
            f"{source_volume_name}:/from",
            "-v",
            f"{target_volume_name}:/to",
            image,
            "sh",
            "-c",
            "cp -a /from/. /to/",
        ],
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Recover or back up Docker PostgreSQL databases.")
    parser.add_argument(
        "target",
        choices=["test", "recovery", "backup-app-auto", "backup-app-manual"],
        help="Action target.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Actually perform destructive recovery steps.",
    )
    return parser.parse_args()


def ensure_backup_dirs() -> None:
    AUTO_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    MANUAL_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    RECOVERY_SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)


def build_backup_path(kind: str) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if kind == "auto":
        directory = AUTO_BACKUP_DIR
    elif kind == "manual":
        directory = MANUAL_BACKUP_DIR
    else:
        directory = RECOVERY_SNAPSHOT_DIR
    return directory / f"live_statistic_{kind}_{timestamp}.dump"


def get_backup_timestamp(path: Path) -> datetime:
    stem = path.stem
    prefix = "live_statistic_"
    if not stem.startswith(prefix):
        return datetime.min
    _, _, timestamp = stem[len(prefix) :].partition("_")
    try:
        return datetime.strptime(timestamp, "%Y%m%d_%H%M%S")
    except ValueError:
        return datetime.min


def list_backup_files(kind: str | None = None) -> list[Path]:
    ensure_backup_dirs()
    directories = [AUTO_BACKUP_DIR, MANUAL_BACKUP_DIR] if kind is None else [AUTO_BACKUP_DIR if kind == "auto" else MANUAL_BACKUP_DIR]
    backups: list[Path] = []
    for directory in directories:
        backups.extend(directory.glob("live_statistic_*.dump"))
    return sorted(backups, key=get_backup_timestamp, reverse=True)


def prune_old_backups(kind: str) -> None:
    if kind not in {"auto", "manual"}:
        return
    keep = AUTO_BACKUP_KEEP if kind == "auto" else MANUAL_BACKUP_KEEP
    backups = list_backup_files(kind)
    for path in backups[keep:]:
        path.unlink(missing_ok=True)


def validate_backup_file(docker_cmd: str, container_name: str, backup_path: Path) -> None:
    if not backup_path.exists() or backup_path.stat().st_size == 0:
        raise SystemExit(f"备份文件无效或为空：{backup_path}")

    completed = run_binary_step(
        "backup-validate",
        [docker_cmd, "exec", "-i", container_name, "pg_restore", "-l"],
        stdin_path=backup_path,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="ignore")
        raise SystemExit(f"备份文件校验失败：{backup_path}\n{stderr}")


def create_app_backup(
    env_values: dict[str, str],
    docker_cmd: str,
    *,
    kind: str,
    container_name: str | None = None,
) -> Path:
    ensure_backup_dirs()
    actual_container_name = container_name or env_values.get("POSTGRES_CONTAINER_NAME", "live-set-list-docker")
    ensure_container_ready(docker_cmd, actual_container_name)

    postgres_user = env_values.get("POSTGRES_USER", "postgres")
    app_db_name = env_values.get("APP_DB", "live_statistic")
    backup_path = build_backup_path(kind)
    completed = run_binary_step(
        "pg_dump",
        [docker_cmd, "exec", actual_container_name, "pg_dump", "-U", postgres_user, "-d", app_db_name, "-Fc"],
        stdout_path=backup_path,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="ignore")
        backup_path.unlink(missing_ok=True)
        raise SystemExit(f"主库备份失败：{backup_path}\n{stderr}")

    validate_backup_file(docker_cmd, actual_container_name, backup_path)
    prune_old_backups(kind)
    print(f"主库备份完成：{backup_path}", flush=True)
    return backup_path


def remove_recovery_snapshot(snapshot_path: Path | None) -> None:
    if snapshot_path and snapshot_path.exists():
        snapshot_path.unlink(missing_ok=True)


def get_latest_app_backup() -> Path:
    backups = list_backup_files()
    if not backups:
        raise SystemExit("未找到可用于恢复的主库备份文件。")
    return backups[0]


def confirm_restore(backup_path: Path) -> None:
    print(f"即将使用最近备份恢复主库：{backup_path}", flush=True)
    answer = input("确认继续恢复主库吗？输入 yes 继续：").strip().lower()
    if answer != "yes":
        raise SystemExit("已取消主库恢复。")


def confirm_finalize() -> None:
    print("候选恢复已完成，且 run_checks all 已通过。", flush=True)
    answer = input("请人工检查当前候选容器；确认转正请输入 yes：").strip().lower()
    if answer != "yes":
        raise SystemExit("已取消主库转正。")


def run_flyway_for_environment(command: str, environment: str) -> None:
    flyway_cmd = shutil.which("flyway.cmd") or shutil.which("flyway") or "flyway"
    run_step(
        "flyway",
        [
            flyway_cmd,
            f"-configFiles={FLYWAY_CONFIG.relative_to(ROOT)}",
            f"-environment={environment}",
            command,
        ],
    )


def run_flyway_info_capture(environment: str) -> subprocess.CompletedProcess[str]:
    flyway_cmd = shutil.which("flyway.cmd") or shutil.which("flyway") or "flyway"
    return run_step_capture(
        "flyway",
        [
            flyway_cmd,
            f"-configFiles={FLYWAY_CONFIG.relative_to(ROOT)}",
            f"-environment={environment}",
            "info",
        ],
    )


def build_compose_env(env_values: dict[str, str], **overrides: str) -> dict[str, str]:
    compose_env: dict[str, str] = {}
    for key, value in env_values.items():
        compose_env[key] = value
    for key, value in overrides.items():
        compose_env[key] = value
    return compose_env


def prepare_candidate_database(
    env_values: dict[str, str],
    docker_cmd: str,
    *,
    suffix: str,
) -> tuple[str, str, str | None, str | None]:
    # 将现有正式容器切到备份名，再用临时候选 volume 拉起新容器。
    container_name = env_values.get("POSTGRES_CONTAINER_NAME", "live-set-list-docker")
    volume_name = env_values.get("POSTGRES_VOLUME_NAME", "live_set_list_docker_data")
    backup_container_name = f"{container_name}-backup-{suffix}"
    candidate_volume_name = f"{volume_name}_candidate_{suffix}"
    old_container_name: str | None = None
    old_volume_name: str | None = None

    if container_exists(docker_cmd, container_name):
        old_container_name = backup_container_name
        old_volume_name = volume_name
        stop_container_if_running(docker_cmd, container_name)
        run_step("docker", [docker_cmd, "rename", container_name, backup_container_name])

    compose_env = build_compose_env(
        env_values,
        POSTGRES_CONTAINER_NAME=container_name,
        POSTGRES_VOLUME_NAME=candidate_volume_name,
    )
    # Compose 里的 pgdata 现在是 external volume，候选 volume 需要先显式创建。
    create_volume_if_missing(docker_cmd, candidate_volume_name)
    run_step(
        "docker",
        [
            docker_cmd,
            "compose",
            "-f",
            str(COMPOSE_FILE.relative_to(ROOT)),
            "up",
            "-d",
        ],
        env_overrides=compose_env,
    )
    wait_for_container_ready(docker_cmd, container_name)
    return container_name, candidate_volume_name, old_container_name, old_volume_name


def recover_test_database(env_values: dict[str, str], docker_cmd: str, container_name: str) -> int:
    run_flyway_for_environment("migrate", "test")
    test_db_name = env_values.get("TEST_DB_NAME", "live_statistic_test")
    test_admin_user = env_values.get("TEST_ADMIN_USER", "live_project_test_admin")
    seed_sql = SEED_SQL.read_text(encoding="utf-8")
    run_step(
        "seed",
        [
            docker_cmd,
            "exec",
            "-i",
            container_name,
            "psql",
            "-U",
            test_admin_user,
            "-d",
            test_db_name,
            "-v",
            "ON_ERROR_STOP=1",
        ],
        input_text=seed_sql,
    )

    print("测试库恢复完成。", flush=True)
    return 0


def recover_test_database_in_place(env_values: dict[str, str], docker_cmd: str) -> int:
    container_name = env_values.get("POSTGRES_CONTAINER_NAME", "live-set-list-docker")
    ensure_container_ready(docker_cmd, container_name)
    return recover_test_database(env_values, docker_cmd, container_name)


def reset_database_for_restore(env_values: dict[str, str], docker_cmd: str, container_name: str) -> None:
    postgres_user = env_values.get("POSTGRES_USER", "postgres")
    app_db_name = env_values.get("APP_DB", "live_statistic")
    app_owner = env_values.get("APP_OWNER", "live_project_owner")

    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{app_db_name}' AND pid <> pg_backend_pid();",
        ],
    )
    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            f"DROP DATABASE IF EXISTS {app_db_name};",
        ],
    )
    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            f"CREATE DATABASE {app_db_name} OWNER {app_owner};",
        ],
    )


def apply_app_database_permissions(env_values: dict[str, str], docker_cmd: str, container_name: str) -> None:
    # 恢复后重新把主库对象 owner 和读/写/Flyway 权限收口回项目约定的角色体系。
    postgres_user = env_values.get("POSTGRES_USER", "postgres")
    app_db_name = env_values.get("APP_DB", "live_statistic")
    app_owner = env_values.get("APP_OWNER", "live_project_owner")
    flyway_user = env_values.get("FLYWAY_USER", "live_project_flyway")
    readonly_user = env_values.get("APP_RO_USER", "live_project_ro")
    super_user = env_values.get("APP_SUPER_USER", "live_project_super_ro")

    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            f"GRANT CONNECT ON DATABASE {app_db_name} TO {flyway_user}, {readonly_user}, {super_user};",
        ],
    )

    permission_sql = f"""
-- 将恢复出来的 public schema、表和序列 owner 统一到业务 owner，
-- 再补齐 Flyway / 只读 / 读写角色需要的 schema、表、序列权限。
ALTER SCHEMA public OWNER TO {app_owner};

DO $$
DECLARE
    table_record record;
    sequence_record record;
BEGIN
    FOR table_record IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I OWNER TO {app_owner}', table_record.tablename);
    END LOOP;

    FOR sequence_record IN
        SELECT sequencename
        FROM pg_sequences
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER SEQUENCE public.%I OWNER TO {app_owner}', sequence_record.sequencename);
    END LOOP;
END
$$;

GRANT USAGE ON SCHEMA public TO {readonly_user}, {super_user};
GRANT USAGE, CREATE ON SCHEMA public TO {flyway_user};

GRANT SELECT ON ALL TABLES IN SCHEMA public TO {readonly_user};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO {super_user};
GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO {super_user};
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.flyway_schema_history TO {flyway_user};

GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO {readonly_user};
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO {super_user};

ALTER DEFAULT PRIVILEGES FOR ROLE {app_owner} IN SCHEMA public
GRANT SELECT ON TABLES TO {readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {app_owner} IN SCHEMA public
GRANT SELECT, INSERT, UPDATE ON TABLES TO {super_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {app_owner} IN SCHEMA public
GRANT SELECT ON SEQUENCES TO {readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {app_owner} IN SCHEMA public
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {super_user};

ALTER DEFAULT PRIVILEGES FOR ROLE {flyway_user} IN SCHEMA public
GRANT SELECT ON TABLES TO {readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {flyway_user} IN SCHEMA public
GRANT SELECT, INSERT, UPDATE ON TABLES TO {super_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {flyway_user} IN SCHEMA public
GRANT SELECT ON SEQUENCES TO {readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {flyway_user} IN SCHEMA public
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {super_user};
"""
    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            "-i",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            app_db_name,
            "-v",
            "ON_ERROR_STOP=1",
        ],
        input_text=permission_sql,
    )


def restore_app_database_from_backup(
    env_values: dict[str, str],
    docker_cmd: str,
    container_name: str,
    backup_path: Path,
) -> int:
    # 先重建空主库，再导入 dump，并在导入后用 Flyway 校验版本状态。
    reset_database_for_restore(env_values, docker_cmd, container_name)
    postgres_user = env_values.get("POSTGRES_USER", "postgres")
    app_db_name = env_values.get("APP_DB", "live_statistic")
    completed = run_binary_step(
        "pg_restore",
        [
            docker_cmd,
            "exec",
            "-i",
            container_name,
            "pg_restore",
            "-U",
            postgres_user,
            "-d",
            app_db_name,
            "--no-owner",
            "--no-privileges",
        ],
        stdin_path=backup_path,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="ignore")
        raise SystemExit(f"主库恢复失败：{backup_path}\n{stderr}")

    apply_app_database_permissions(env_values, docker_cmd, container_name)

    info = run_flyway_info_capture("dev")
    output = info.stdout or ""
    if info.returncode != 0:
        raise SystemExit(
            "主库恢复后 Flyway info 失败。\n"
            f"stdout:\n{info.stdout}\n"
            f"stderr:\n{info.stderr}"
        )
    run_flyway_for_environment("validate", "dev")
    if "Pending" in output:
        run_flyway_for_environment("migrate", "dev")

    print(f"主库已从备份恢复：{backup_path}", flush=True)
    return 0


def run_full_checks() -> int:
    run_step("checks", ["python", "scripts/run_checks.py", "all"])
    return 0


def rollback_candidate(
    env_values: dict[str, str],
    docker_cmd: str,
    container_name: str,
    candidate_volume_name: str,
    old_container_name: str | None,
    *,
    restore_old_container: bool = True,
) -> None:
    # 候选恢复或转正失败时，移除候选容器/volume，并尽量恢复旧正式容器。
    if container_exists(docker_cmd, container_name):
        remove_container_if_exists(docker_cmd, container_name)
    remove_volume_if_exists(docker_cmd, candidate_volume_name)
    if restore_old_container and old_container_name and container_exists(docker_cmd, old_container_name):
        run_step("docker", [docker_cmd, "rename", old_container_name, container_name])
        run_step("docker", [docker_cmd, "start", container_name])
        return
    if restore_old_container:
        run_step(
            "docker",
            [
                docker_cmd,
                "compose",
                "-f",
                str(COMPOSE_FILE.relative_to(ROOT)),
                "up",
                "-d",
            ],
            env_overrides=build_compose_env(env_values),
        )
        wait_for_container_ready(docker_cmd, container_name)


def finalize_candidate_as_formal(
    env_values: dict[str, str],
    docker_cmd: str,
    *,
    container_name: str,
    candidate_volume_name: str,
    old_container_name: str | None,
    old_volume_name: str | None,
    backup_snapshot_volume_name: str | None,
) -> None:
    # 候选容器验证通过后，把候选 volume 的数据复制回固定正式 volume 名，并重新拉起正式容器。
    postgres_image = env_values.get("POSTGRES_IMAGE", "postgres:18.3-trixie")
    formal_volume_name = env_values.get("POSTGRES_VOLUME_NAME", "live_set_list_pg_migrate_data")

    stop_container_if_running(docker_cmd, container_name)
    remove_container_if_exists(docker_cmd, container_name)

    if old_volume_name and backup_snapshot_volume_name:
        create_volume_if_missing(docker_cmd, backup_snapshot_volume_name)
        copy_volume_data(
            docker_cmd,
            old_volume_name,
            backup_snapshot_volume_name,
            image=postgres_image,
        )

    if old_container_name:
        remove_container_if_exists(docker_cmd, old_container_name)
    if old_volume_name:
        remove_volume_if_exists(docker_cmd, old_volume_name)

    create_volume_if_missing(docker_cmd, formal_volume_name)
    copy_volume_data(
        docker_cmd,
        candidate_volume_name,
        formal_volume_name,
        image=postgres_image,
    )
    remove_volume_if_exists(docker_cmd, candidate_volume_name)

    run_step(
        "docker",
        [
            docker_cmd,
            "compose",
            "-f",
            str(COMPOSE_FILE.relative_to(ROOT)),
            "up",
            "-d",
        ],
        env_overrides=build_compose_env(env_values),
    )
    wait_for_container_ready(docker_cmd, container_name)
    cleanup_stale_backup_containers(
        env_values,
        docker_cmd,
        exclude_names={container_name},
    )


def restore_formal_from_snapshot(
    env_values: dict[str, str],
    docker_cmd: str,
    *,
    container_name: str,
    backup_snapshot_volume_name: str | None,
) -> None:
    # 如果“候选转正”阶段失败，就用转正前做的正式 volume 快照恢复固定正式 volume。
    if not backup_snapshot_volume_name:
        return

    postgres_image = env_values.get("POSTGRES_IMAGE", "postgres:18.3-trixie")
    formal_volume_name = env_values.get("POSTGRES_VOLUME_NAME", "live_set_list_pg_migrate_data")
    remove_container_if_exists(docker_cmd, container_name)
    remove_volume_if_exists(docker_cmd, formal_volume_name)
    create_volume_if_missing(docker_cmd, formal_volume_name)
    copy_volume_data(
        docker_cmd,
        backup_snapshot_volume_name,
        formal_volume_name,
        image=postgres_image,
    )
    run_step(
        "docker",
        [
            docker_cmd,
            "compose",
            "-f",
            str(COMPOSE_FILE.relative_to(ROOT)),
            "up",
            "-d",
        ],
        env_overrides=build_compose_env(env_values),
    )
    wait_for_container_ready(docker_cmd, container_name)


def recover_main_database(env_values: dict[str, str], docker_cmd: str) -> int:
    # 主库恢复主流程：选备份、保底再备份、候选恢复、跑全量检查、人工确认后转正。
    container_name = env_values.get("POSTGRES_CONTAINER_NAME", "live-set-list-docker")
    current_volume_name = env_values.get("POSTGRES_VOLUME_NAME", "live_set_list_docker_data")
    backup_to_restore = get_latest_app_backup()
    confirm_restore(backup_to_restore)
    pre_restore_snapshot = create_app_backup(env_values, docker_cmd, kind="snapshot", container_name=container_name)
    print(f"已生成恢复流程专用快照：{pre_restore_snapshot}", flush=True)

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    candidate_volume_name = f"{current_volume_name}_candidate_{suffix}"
    backup_snapshot_volume_name = f"{current_volume_name}_snapshot_{suffix}" if container_exists(docker_cmd, container_name) else None
    old_container_name = f"{container_name}-backup-{suffix}" if container_exists(docker_cmd, container_name) else None
    old_volume_name = current_volume_name if old_container_name else None

    try:
        container_name, candidate_volume_name, old_container_name, old_volume_name = prepare_candidate_database(
            env_values,
            docker_cmd,
            suffix=suffix,
        )
        restore_app_database_from_backup(env_values, docker_cmd, container_name, backup_to_restore)
        recover_test_database(env_values, docker_cmd, container_name)
        run_full_checks()
        confirm_finalize()
    except (SystemExit, Exception) as exc:
        print("候选容器验证未通过，正在回滚到旧容器。", flush=True)
        rollback_candidate(env_values, docker_cmd, container_name, candidate_volume_name, old_container_name)
        if isinstance(exc, SystemExit):
            message = str(exc)
            if message and not message.isdigit():
                print(f"回滚原因：{message}", flush=True)
            return int(message) if message.isdigit() else 1
        print(f"回滚原因：{exc}", flush=True)
        remove_recovery_snapshot(pre_restore_snapshot)
        return 1

    try:
        finalize_candidate_as_formal(
            env_values,
            docker_cmd,
            container_name=container_name,
            candidate_volume_name=candidate_volume_name,
            old_container_name=old_container_name,
            old_volume_name=old_volume_name,
            backup_snapshot_volume_name=backup_snapshot_volume_name,
        )
    except (SystemExit, Exception) as exc:
        print("候选数据转正失败，正在尝试回滚到旧容器。", flush=True)
        if backup_snapshot_volume_name:
            restore_formal_from_snapshot(
                env_values,
                docker_cmd,
                container_name=container_name,
                backup_snapshot_volume_name=backup_snapshot_volume_name,
            )
        else:
            rollback_candidate(
                env_values,
                docker_cmd,
                container_name,
                candidate_volume_name,
                old_container_name,
                restore_old_container=bool(old_container_name),
            )
        if isinstance(exc, SystemExit):
            message = str(exc)
            if message and not message.isdigit():
                print(f"回滚原因：{message}", flush=True)
            return int(message) if message.isdigit() else 1
        print(f"回滚原因：{exc}", flush=True)
        remove_recovery_snapshot(pre_restore_snapshot)
        return 1

    if backup_snapshot_volume_name:
        remove_volume_if_exists(docker_cmd, backup_snapshot_volume_name)
    remove_recovery_snapshot(pre_restore_snapshot)
    print("主库恢复、测试库重建与校验完成，正式 volume 名保持不变。", flush=True)
    return 0


def main() -> int:
    # 主流程分成三段：普通备份、测试库就地恢复、主库候选恢复与回滚。
    args = parse_args()
    if not ENV_FILE.exists():
        raise SystemExit(f"未找到环境文件：{ENV_FILE}")
    if not COMPOSE_FILE.exists():
        raise SystemExit(f"未找到 compose 文件：{COMPOSE_FILE}")
    if not FLYWAY_CONFIG.exists():
        raise SystemExit(f"未找到 Flyway 配置：{FLYWAY_CONFIG}")
    if not SEED_SQL.exists():
        raise SystemExit(f"未找到 seed 文件：{SEED_SQL}")

    env_values = load_env_file(ENV_FILE)
    docker_cmd = "docker"

    if args.target == "backup-app-auto":
        create_app_backup(env_values, docker_cmd, kind="auto")
        return 0
    if args.target == "backup-app-manual":
        create_app_backup(env_values, docker_cmd, kind="manual")
        return 0

    if not args.force:
        print("此脚本会执行数据库恢复或重建操作。")
        print("确认执行请加上参数：--force")
        return 1

    if args.target == "test":
        return recover_test_database_in_place(env_values, docker_cmd)
    if args.target == "recovery":
        return recover_main_database(env_values, docker_cmd)

    raise SystemExit(f"不支持的目标：{args.target}")


if __name__ == "__main__":
    raise SystemExit(main())
