from __future__ import annotations

import os
import subprocess
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
