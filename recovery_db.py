import argparse
import os
import subprocess
import time
from pathlib import Path
from datetime import datetime


ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / "infra" / "postgres" / ".env.pg-migrate"
COMPOSE_FILE = ROOT / "infra" / "postgres" / "docker-compose.pg-migrate.yml"
FLYWAY_CONFIG = ROOT / "backend" / "db" / "flyway" / "flyway.toml"
SEED_SQL = ROOT / "backend" / "db" / "postgres" / "seed" / "base_seed.sql"


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


def remove_container_if_exists(docker_cmd: str, container_name: str) -> None:
    if container_exists(docker_cmd, container_name):
        run_step("docker", [docker_cmd, "rm", "-f", container_name])


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
    parser = argparse.ArgumentParser(description="Recover Docker PostgreSQL databases.")
    parser.add_argument(
        "target",
        choices=["test", "app", "all"],
        help="Recovery target: test / app / all.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Actually perform the recovery steps that may replace the current Docker PostgreSQL container.",
    )
    return parser.parse_args()


def prepare_candidate_database(
    env_values: dict[str, str],
    docker_cmd: str,
    flyway_cmd: str,
    *,
    suffix: str,
) -> tuple[str, str, str | None, str | None]:
    # 将现有正式容器切到备份名，再用临时候选 volume 拉起新容器并完成基础迁移。
    container_name = env_values.get("POSTGRES_CONTAINER_NAME", "live-set-list-docker")
    volume_name = env_values.get("POSTGRES_VOLUME_NAME", "live_set_list_pg_migrate_data")
    backup_container_name = f"{container_name}-backup-{suffix}"
    candidate_volume_name = f"{volume_name}_candidate_{suffix}"
    old_container_name: str | None = None
    old_volume_name: str | None = None

    if container_exists(docker_cmd, container_name):
        old_container_name = backup_container_name
        old_volume_name = volume_name
        stop_container_if_running(docker_cmd, container_name)
        run_step("docker", [docker_cmd, "rename", container_name, backup_container_name])

    compose_env = {
        "POSTGRES_CONTAINER_NAME": container_name,
        "POSTGRES_VOLUME_NAME": candidate_volume_name,
    }
    run_step(
        "docker",
        [
            docker_cmd,
            "compose",
            "--env-file",
            str(ENV_FILE.relative_to(ROOT)),
            "-f",
            str(COMPOSE_FILE.relative_to(ROOT)),
            "up",
            "-d",
        ],
        env_overrides=compose_env,
    )
    wait_for_container_ready(docker_cmd, container_name)
    run_step(
        "flyway",
        [
            flyway_cmd,
            f"-configFiles={FLYWAY_CONFIG.relative_to(ROOT)}",
            "migrate",
        ],
    )
    return container_name, candidate_volume_name, old_container_name, old_volume_name


def recover_test_database(env_values: dict[str, str], docker_cmd: str, container_name: str) -> int:
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


def recover_app_database() -> int:
    print("业务库恢复流程已预留参数入口，但当前尚未实现。", flush=True)
    print("后续会在这里补充主业务库的数据恢复逻辑。", flush=True)
    return 1


def recover_all_databases() -> int:
    print("all 模式已预留给“恢复所有内容”，但当前依赖的业务库恢复尚未实现。", flush=True)
    print("请先使用 test 模式恢复测试库。", flush=True)
    return 1


def run_full_checks() -> int:
    run_step("checks", ["python", "run_checks.py", "all"])
    return 0


def rollback_candidate(
    docker_cmd: str,
    container_name: str,
    candidate_volume_name: str,
    old_container_name: str | None,
    *,
    restore_old_container: bool = True,
) -> None:
    if container_exists(docker_cmd, container_name):
        remove_container_if_exists(docker_cmd, container_name)
    remove_volume_if_exists(docker_cmd, candidate_volume_name)
    if restore_old_container and old_container_name and container_exists(docker_cmd, old_container_name):
        run_step("docker", [docker_cmd, "rename", old_container_name, container_name])
        run_step("docker", [docker_cmd, "start", container_name])


def cleanup_backup(
    docker_cmd: str,
    old_container_name: str | None,
    old_volume_name: str | None,
) -> None:
    if old_container_name:
        remove_container_if_exists(docker_cmd, old_container_name)
    if old_volume_name:
        remove_volume_if_exists(docker_cmd, old_volume_name)


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
            "--env-file",
            str(ENV_FILE.relative_to(ROOT)),
            "-f",
            str(COMPOSE_FILE.relative_to(ROOT)),
            "up",
            "-d",
        ],
    )
    wait_for_container_ready(docker_cmd, container_name)


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
            "--env-file",
            str(ENV_FILE.relative_to(ROOT)),
            "-f",
            str(COMPOSE_FILE.relative_to(ROOT)),
            "up",
            "-d",
        ],
    )
    wait_for_container_ready(docker_cmd, container_name)


def main() -> int:
    # 主流程分成三段：准备候选容器、验证候选容器、验证通过后将候选数据收口回固定正式 volume。
    args = parse_args()
    if not args.force:
        print("此脚本会重命名现有 PostgreSQL 容器，创建新的候选容器并运行完整恢复流程。")
        print("确认执行请加上参数：--force")
        return 1
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
    flyway_cmd = "flyway"

    if args.target == "app":
        return recover_app_database()
    if args.target == "all":
        return recover_all_databases()

    container_name = env_values.get("POSTGRES_CONTAINER_NAME", "live-set-list-docker")
    current_volume_name = env_values.get("POSTGRES_VOLUME_NAME", "live_set_list_pg_migrate_data")
    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    candidate_volume_name = f"{current_volume_name}_candidate_{suffix}"
    backup_snapshot_volume_name = f"{current_volume_name}_snapshot_{suffix}" if container_exists(docker_cmd, container_name) else None
    old_container_name = f"{container_name}-backup-{suffix}" if container_exists(docker_cmd, container_name) else None
    old_volume_name = current_volume_name if old_container_name else None

    try:
        container_name, candidate_volume_name, old_container_name, old_volume_name = prepare_candidate_database(
            env_values,
            docker_cmd,
            flyway_cmd,
            suffix=suffix,
        )
        test_result = recover_test_database(env_values, docker_cmd, container_name)
        if test_result != 0:
            raise SystemExit(test_result)

        run_full_checks()
    except SystemExit as exc:
        print("候选容器验证未通过，正在回滚到旧容器。", flush=True)
        rollback_candidate(docker_cmd, container_name, candidate_volume_name, old_container_name)
        return int(str(exc)) if str(exc).isdigit() else 1

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
    except SystemExit as exc:
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
                docker_cmd,
                container_name,
                candidate_volume_name,
                old_container_name,
                restore_old_container=bool(old_container_name),
            )
        return int(str(exc)) if str(exc).isdigit() else 1

    if backup_snapshot_volume_name:
        remove_volume_if_exists(docker_cmd, backup_snapshot_volume_name)
    print("数据库恢复与校验完成，正式 volume 名保持不变。", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
