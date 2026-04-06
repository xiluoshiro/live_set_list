from __future__ import annotations

from datetime import datetime
from pathlib import Path

from .common import (
    AUTO_BACKUP_DIR,
    AUTO_BACKUP_KEEP,
    MANUAL_BACKUP_DIR,
    MANUAL_BACKUP_KEEP,
    RECOVERY_SNAPSHOT_DIR,
    run_binary_step,
)
from .docker_ops import ensure_container_ready


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
