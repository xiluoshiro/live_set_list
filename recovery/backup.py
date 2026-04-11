from __future__ import annotations

import statistics
import subprocess
from datetime import datetime
from pathlib import Path

from .common import (
    AUTO_BACKUP_DIR,
    AUTO_BACKUP_KEEP,
    MANUAL_BACKUP_DIR,
    MANUAL_BACKUP_KEEP,
    RECOVERY_SNAPSHOT_DIR,
    ROOT,
    run_binary_step,
)
from .docker_ops import ensure_container_ready

AUTO_BACKUP_COMPARE_WINDOW = 3
AUTO_BACKUP_MIN_LINE_RATIO = 0.6
AUTO_BACKUP_MIN_ABSOLUTE_DROP = 200


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


def measure_backup_restore_line_count(docker_cmd: str, container_name: str, backup_path: Path) -> int:
    if not backup_path.exists() or backup_path.stat().st_size == 0:
        raise SystemExit(f"备份文件无效或为空：{backup_path}")

    args = [docker_cmd, "exec", "-i", container_name, "pg_restore", "-f", "-"]
    print(f"[backup-restore-preview] {' '.join(args)}", flush=True)

    with backup_path.open("rb") as stdin_handle:
        process = subprocess.Popen(
            args,
            cwd=ROOT,
            stdin=stdin_handle,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        assert process.stdout is not None
        line_count = 0
        saw_output = False
        ends_with_newline = True
        for chunk in iter(lambda: process.stdout.read(65536), b""):
            saw_output = True
            line_count += chunk.count(b"\n")
            ends_with_newline = chunk.endswith(b"\n")
        stderr = process.stderr.read() if process.stderr else b""
        return_code = process.wait()

    if saw_output and not ends_with_newline:
        line_count += 1
    if return_code != 0:
        stderr_text = stderr.decode("utf-8", errors="ignore")
        raise SystemExit(f"备份最小恢复失败：{backup_path}\n{stderr_text}")
    if line_count <= 0:
        raise SystemExit(f"备份最小恢复结果为空：{backup_path}")
    return line_count


def collect_auto_backup_reference_line_counts(
    docker_cmd: str,
    container_name: str,
    current_backup_path: Path,
) -> list[int]:
    reference_counts: list[int] = []
    for path in list_backup_files("auto"):
        if path == current_backup_path:
            continue
        try:
            reference_counts.append(measure_backup_restore_line_count(docker_cmd, container_name, path))
        except SystemExit as exc:
            message = str(exc).strip() or "未知原因"
            print(f"跳过历史自动备份行数对比：{path.name}；原因：{message}", flush=True)
        if len(reference_counts) >= AUTO_BACKUP_COMPARE_WINDOW:
            break
    return reference_counts


def build_auto_backup_compare_message(current_line_count: int, reference_counts: list[int]) -> str:
    if not reference_counts:
        return "暂无历史自动备份可对比。"

    baseline = int(round(statistics.median(reference_counts)))
    threshold = max(1, int(baseline * AUTO_BACKUP_MIN_LINE_RATIO))
    absolute_drop = baseline - current_line_count
    if current_line_count < threshold and absolute_drop >= AUTO_BACKUP_MIN_ABSOLUTE_DROP:
        raise SystemExit(
            f"自动备份最小恢复 SQL 行数异常偏低：当前 {current_line_count} 行，"
            f"最近 {len(reference_counts)} 份自动备份基线 {baseline} 行，低于阈值 {threshold} 行。"
        )
    return f"对比最近 {len(reference_counts)} 份自动备份基线 {baseline} 行，未出现异常下跌。"


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

    try:
        validate_backup_file(docker_cmd, actual_container_name, backup_path)
        restore_line_count = measure_backup_restore_line_count(docker_cmd, actual_container_name, backup_path)
        compare_message = ""
        if kind == "auto":
            reference_counts = collect_auto_backup_reference_line_counts(docker_cmd, actual_container_name, backup_path)
            compare_message = build_auto_backup_compare_message(restore_line_count, reference_counts)
    except SystemExit:
        backup_path.unlink(missing_ok=True)
        raise

    prune_old_backups(kind)
    summary_parts = [f"主库备份完成：{backup_path}", f"最小恢复 SQL 行数：{restore_line_count}"]
    if compare_message:
        summary_parts.append(compare_message)
    print("；".join(summary_parts), flush=True)
    return backup_path


def remove_recovery_snapshot(snapshot_path: Path | None) -> None:
    if snapshot_path and snapshot_path.exists():
        snapshot_path.unlink(missing_ok=True)


def get_latest_app_backup() -> Path:
    backups = list_backup_files()
    if not backups:
        raise SystemExit("未找到可用于恢复的主库备份文件。")
    return backups[0]
