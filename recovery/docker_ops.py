from __future__ import annotations

import subprocess
import time

from .common import COMPOSE_FILE, ROOT, run_step, run_step_capture


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


def build_compose_env(env_values: dict[str, str], **overrides: str) -> dict[str, str]:
    compose_env = dict(env_values)
    compose_env.update(overrides)
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
