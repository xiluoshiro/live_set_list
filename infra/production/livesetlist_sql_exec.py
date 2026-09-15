#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess


OPERATOR_USER = "livesetlist-sql"
UPLOAD_ROOT = Path("/home/livesetlist-sql/uploads")
POSTGRES_ENV_PATH = Path("/etc/livesetlist/postgres.env")
AUDIT_LOG_PATH = Path("/var/log/livesetlist/sql-operator.log")
BACKUP_SERVICE = "livesetlist-backup.service"
MAX_SQL_BYTES = 64 * 1024 * 1024
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")


class SqlExecError(RuntimeError):
    pass


def load_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise SqlExecError(f"environment file not found: {path}")
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def database_command(*extra: str) -> list[str]:
    values = load_env_file(POSTGRES_ENV_PATH)
    return [
        "docker", "exec", "-i",
        values.get("POSTGRES_CONTAINER_NAME", "live-set-list-postgres"),
        "psql", "-X", "--no-psqlrc", "-v", "ON_ERROR_STOP=1",
        "-U", values.get("POSTGRES_USER", "postgres"),
        "-d", values.get("APP_DB", "live_statistic"),
        *extra,
    ]


def operator_uid() -> int:
    import pwd

    return pwd.getpwnam(OPERATOR_USER).pw_uid


def has_unsafe_write_permissions(mode: int) -> bool:
    return bool(mode & (stat.S_IWGRP | stat.S_IWOTH))


def reject_psql_meta_commands(payload: bytes) -> None:
    for line in payload.splitlines():
        if line.lstrip().startswith(b"\\"):
            raise SqlExecError("psql meta-commands are not allowed; submit SQL statements only")


def read_validated_sql(path_text: str, expected_sha256: str) -> bytes:
    if not SHA256_PATTERN.fullmatch(expected_sha256):
        raise SqlExecError("invalid SHA-256")
    requested = Path(path_text)
    try:
        resolved = requested.resolve(strict=True)
        resolved.relative_to(UPLOAD_ROOT.resolve(strict=True))
    except (OSError, ValueError) as exc:
        raise SqlExecError("SQL file must be inside the operator upload directory") from exc
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(resolved, flags)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise SqlExecError("SQL path is not a regular file")
        if metadata.st_uid != operator_uid():
            raise SqlExecError("SQL file is not owned by the operator account")
        if has_unsafe_write_permissions(metadata.st_mode):
            raise SqlExecError("SQL file must not be group/world writable")
        if metadata.st_size <= 0 or metadata.st_size > MAX_SQL_BYTES:
            raise SqlExecError("SQL file is empty or exceeds the 64 MiB limit")
        with os.fdopen(descriptor, "rb", closefd=False) as source:
            payload = source.read(MAX_SQL_BYTES + 1)
    finally:
        os.close(descriptor)
    if hashlib.sha256(payload).hexdigest() != expected_sha256:
        raise SqlExecError("SQL file SHA-256 does not match")
    reject_psql_meta_commands(payload)
    return payload


def audit(operation: str, result: str, sha256: str | None = None, detail: str | None = None) -> None:
    record = {
        "at": datetime.now(timezone.utc).isoformat(),
        "detail": detail,
        "operation": operation,
        "operator": os.environ.get("SUDO_USER", "unknown"),
        "result": result,
        "sha256": sha256,
    }
    AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(AUDIT_LOG_PATH, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
    try:
        os.write(descriptor, (json.dumps(record, ensure_ascii=True) + "\n").encode("utf-8"))
    finally:
        os.close(descriptor)


def check_environment() -> int:
    completed = subprocess.run(database_command("-Atqc", "SELECT 1"), check=False)
    if completed.returncode != 0:
        raise SqlExecError("production database check failed")
    audit("check", "success")
    print("SQL execution entrypoint check passed.", flush=True)
    return 0


def apply_sql(path_text: str, expected_sha256: str) -> int:
    payload = read_validated_sql(path_text, expected_sha256)
    backup = subprocess.run(["systemctl", "start", BACKUP_SERVICE], check=False)
    if backup.returncode != 0:
        raise SqlExecError("pre-execution production backup failed")
    completed = subprocess.run(database_command(), input=payload, check=False)
    if completed.returncode != 0:
        raise SqlExecError("psql execution failed")
    audit("apply", "success", expected_sha256)
    print(f"SQL executed successfully: sha256={expected_sha256}", flush=True)
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Restricted production SQL execution entrypoint.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("check")
    apply_parser = subparsers.add_parser("apply")
    apply_parser.add_argument("sql_file")
    apply_parser.add_argument("sha256")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.command == "check":
            return check_environment()
        return apply_sql(args.sql_file, args.sha256)
    except (OSError, SqlExecError) as exc:
        try:
            audit(args.command, "failure", getattr(args, "sha256", None), str(exc))
        except OSError:
            pass
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    raise SystemExit(main())
