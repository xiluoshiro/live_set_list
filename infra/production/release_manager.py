#!/usr/bin/env python3
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from typing import Any, Iterator


RELEASE_ROOT = Path("/opt/livesetlist/releases")
STAGING_ROOT = Path("/opt/livesetlist/staging")
CURRENT_LINK = Path("/opt/livesetlist/current")
STATE_ROOT = Path("/var/lib/livesetlist/release-state")
ATTESTATION_ROOT = Path("/var/lib/livesetlist/deploy-attestations")
ARCHIVE_STORE = Path("/var/lib/livesetlist/release-archives")
LOCK_PATH = Path("/var/lock/livesetlist-release.lock")
UPLOAD_ROOT = Path("/tmp")
BACKEND_ENV_PATH = Path("/etc/livesetlist/backend.env")
POSTGRES_ENV_PATH = Path("/etc/livesetlist/postgres.env")
BACKUP_SERVICE = "livesetlist-backup.service"
FLYWAY_IMAGE = "redgate/flyway:12.11.0"
OWNERSHIP_CONTRACT_RELATIVE_PATH = Path("backend/db/postgres/checks/ownership_contract.sql")
MAX_ARCHIVE_MEMBER_COUNT = 10_000
MAX_ARCHIVE_EXPANDED_BYTES = 512 * 1024 * 1024
VERSION_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}$")
SHA256_PATTERN = re.compile(r"^[A-Fa-f0-9]{64}$")
BLOCKING_FLYWAY_STATES = {"Pending", "Failed", "Missing", "Future", "Outdated"}
FLYWAY_ENV_KEYS = (
    "FLYWAY_BASELINE_DESCRIPTION",
    "FLYWAY_BASELINE_VERSION",
    "FLYWAY_CREATE_SCHEMAS",
    "FLYWAY_DEFAULT_SCHEMA",
    "FLYWAY_LOCATIONS",
    "FLYWAY_PASSWORD",
    "FLYWAY_SCHEMAS",
    "FLYWAY_TABLE",
    "FLYWAY_URL",
    "FLYWAY_USER",
)


class ReleaseError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_inputs(version: str, expected_sha256: str) -> str:
    if not VERSION_PATTERN.fullmatch(version):
        raise ReleaseError(f"invalid version: {version}")
    if not SHA256_PATTERN.fullmatch(expected_sha256):
        raise ReleaseError("invalid SHA-256")
    return expected_sha256.lower()


def release_name(version: str) -> str:
    return f"livesetlist-{version}"


def archive_path(version: str) -> Path:
    return ARCHIVE_STORE / f"{release_name(version)}.tar.gz"


def uploaded_archive_path(version: str) -> Path:
    return UPLOAD_ROOT / f"{release_name(version)}.tar.gz"


def staged_release_path(version: str) -> Path:
    return STAGING_ROOT / release_name(version)


def state_path(version: str) -> Path:
    return STATE_ROOT / f"{version}.json"


def attestation_path(version: str) -> Path:
    return ATTESTATION_ROOT / f"{version}.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sql_tree_sha256(sql_dir: Path) -> str:
    if not sql_dir.is_dir():
        raise ReleaseError(f"Flyway SQL directory not found: {sql_dir}")
    digest = hashlib.sha256()
    files = sorted(path for path in sql_dir.rglob("*") if path.is_file())
    if not files:
        raise ReleaseError(f"Flyway SQL directory is empty: {sql_dir}")
    for path in files:
        relative = path.relative_to(sql_dir).as_posix().encode("utf-8")
        digest.update(relative)
        digest.update(b"\0")
        digest.update(bytes.fromhex(sha256_file(path)))
    return digest.hexdigest()


def validate_archive_members(members: list[tarfile.TarInfo], version: str) -> None:
    expected_root = release_name(version)
    if not members:
        raise ReleaseError("release archive is empty")
    if len(members) > MAX_ARCHIVE_MEMBER_COUNT:
        raise ReleaseError("release archive contains too many entries")
    expanded_size = 0
    for member in members:
        member_path = PurePosixPath(member.name)
        if member_path.is_absolute() or ".." in member_path.parts:
            raise ReleaseError(f"unsafe archive entry: {member.name}")
        if not member_path.parts or member_path.parts[0] != expected_root:
            raise ReleaseError(f"unexpected archive entry: {member.name}")
        if not (member.isfile() or member.isdir()):
            raise ReleaseError(f"archive contains unsupported entry: {member.name}")
        expanded_size += member.size
        if expanded_size > MAX_ARCHIVE_EXPANDED_BYTES:
            raise ReleaseError("release archive expands beyond the allowed size")


def validate_archive(path: Path, version: str, expected_sha256: str) -> None:
    if not path.is_file():
        raise ReleaseError(f"archive not found: {path}")
    actual_sha256 = sha256_file(path)
    if actual_sha256 != expected_sha256:
        raise ReleaseError("archive checksum mismatch")

    try:
        with tarfile.open(path, "r:gz") as archive:
            validate_archive_members(archive.getmembers(), version)
    except (tarfile.TarError, OSError) as exc:
        raise ReleaseError(f"invalid release archive: {exc}") from exc


def extract_archive(path: Path, version: str, destination: Path) -> None:
    try:
        with tarfile.open(path, "r:gz") as archive:
            members = archive.getmembers()
            validate_archive_members(members, version)
            for member in members:
                target = destination.joinpath(*PurePosixPath(member.name).parts)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                source = archive.extractfile(member)
                if source is None:
                    raise ReleaseError(f"cannot read archive entry: {member.name}")
                target.parent.mkdir(parents=True, exist_ok=True)
                with source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
    except (tarfile.TarError, OSError) as exc:
        raise ReleaseError(f"cannot extract release archive: {exc}") from exc
    extracted_root = destination / release_name(version)
    if not extracted_root.is_dir():
        raise ReleaseError("archive root directory missing after extraction")


def ensure_runtime_dirs() -> None:
    for path in (RELEASE_ROOT, STAGING_ROOT, STATE_ROOT, ATTESTATION_ROOT, ARCHIVE_STORE):
        path.mkdir(parents=True, exist_ok=True)
    STAGING_ROOT.chmod(0o700)
    STATE_ROOT.chmod(0o700)
    ATTESTATION_ROOT.chmod(0o700)
    ARCHIVE_STORE.chmod(0o700)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    temporary.chmod(0o600)
    os.replace(temporary, path)


def read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ReleaseError(f"cannot read release state: {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ReleaseError(f"invalid JSON object: {path}")
    return payload


@contextmanager
def release_lock() -> Iterator[None]:
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOCK_PATH.open("a+", encoding="utf-8") as handle:
        if os.name == "posix":
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield


def current_release_dir() -> Path:
    if not CURRENT_LINK.exists():
        raise ReleaseError(f"current release link not found: {CURRENT_LINK}")
    return CURRENT_LINK.resolve(strict=True)


def load_state(version: str, expected_sha256: str) -> dict[str, Any]:
    payload = read_json(state_path(version))
    if payload.get("version") != version or payload.get("archive_sha256") != expected_sha256:
        raise ReleaseError("release state does not match version and archive SHA-256")
    if payload.get("release_type") not in {"app-only", "migration-needed"}:
        raise ReleaseError("release state has an invalid release type")
    return payload


def harden_staged_tree(root: Path) -> None:
    paths = [root, *root.rglob("*")]
    for path in paths:
        mode = path.stat().st_mode & ~0o022
        path.chmod(mode)
        if os.name == "posix":
            os.chown(path, 0, 0, follow_symlinks=False)


def prepare_release(version: str, expected_sha256: str) -> str:
    expected_sha256 = validate_inputs(version, expected_sha256)
    ensure_runtime_dirs()
    archive = archive_path(version)
    uploaded_archive = uploaded_archive_path(version)
    if archive.exists():
        validate_archive(archive, version, expected_sha256)
    else:
        validate_archive(uploaded_archive, version, expected_sha256)
        temporary_archive = archive.with_name(f".{archive.name}.tmp")
        shutil.copyfile(uploaded_archive, temporary_archive)
        temporary_archive.chmod(0o600)
        os.replace(temporary_archive, archive)
        validate_archive(archive, version, expected_sha256)
    uploaded_archive.unlink(missing_ok=True)
    stage = staged_release_path(version)
    existing_state_path = state_path(version)

    if existing_state_path.exists():
        state = load_state(version, expected_sha256)
        if state.get("status") == "deployed":
            raise ReleaseError("release has already been deployed")
        if not stage.is_dir():
            raise ReleaseError("release state exists but staged release is missing")
        candidate_hash = sql_tree_sha256(stage / "backend" / "db" / "flyway" / "sql")
        if candidate_hash != state.get("candidate_sql_sha256"):
            raise ReleaseError("staged Flyway SQL does not match release state")
        return str(state["release_type"])

    if stage.exists():
        raise ReleaseError(f"staged release already exists without state: {stage}")

    current = current_release_dir()
    temporary_root = Path(tempfile.mkdtemp(prefix=".prepare.", dir=STAGING_ROOT))
    try:
        extract_archive(archive, version, temporary_root)
        extracted = temporary_root / release_name(version)
        harden_staged_tree(extracted)
        os.replace(extracted, stage)
    finally:
        shutil.rmtree(temporary_root, ignore_errors=True)

    current_hash = sql_tree_sha256(current / "backend" / "db" / "flyway" / "sql")
    candidate_hash = sql_tree_sha256(stage / "backend" / "db" / "flyway" / "sql")
    release_type = "app-only" if current_hash == candidate_hash else "migration-needed"
    write_json(
        existing_state_path,
        {
            "archive_sha256": expected_sha256,
            "candidate_sql_sha256": candidate_hash,
            "current_release": str(current),
            "current_sql_sha256": current_hash,
            "prepared_at": utc_now(),
            "release_type": release_type,
            "staged_release": str(stage),
            "status": "prepared",
            "version": version,
        },
    )
    return release_type


def load_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise ReleaseError(f"environment file not found: {path}")
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


def flyway_environment() -> dict[str, str]:
    values = load_env_file(POSTGRES_ENV_PATH)
    required = ("POSTGRES_HOST", "POSTGRES_PORT", "APP_DB", "FLYWAY_USER", "FLYWAY_PASSWORD")
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise ReleaseError(f"production Flyway environment is missing: {', '.join(missing)}")
    environment = os.environ.copy()
    environment.update(
        {
            "FLYWAY_BASELINE_DESCRIPTION": "Existing database baseline",
            "FLYWAY_BASELINE_VERSION": "1",
            "FLYWAY_CREATE_SCHEMAS": "false",
            "FLYWAY_DEFAULT_SCHEMA": "public",
            "FLYWAY_LOCATIONS": "filesystem:/workspace/backend/db/flyway/sql",
            "FLYWAY_PASSWORD": values["FLYWAY_PASSWORD"],
            "FLYWAY_SCHEMAS": "public",
            "FLYWAY_TABLE": "flyway_schema_history",
            "FLYWAY_URL": (
                f"jdbc:postgresql://{values['POSTGRES_HOST']}:{values['POSTGRES_PORT']}/{values['APP_DB']}"
            ),
            "FLYWAY_USER": values["FLYWAY_USER"],
        }
    )
    return environment


def run_flyway(command: str, staged_dir: Path) -> dict[str, Any]:
    environment = flyway_environment()
    args = ["docker", "run", "--rm", "--network", "host", "-i"]
    for key in FLYWAY_ENV_KEYS:
        args.extend(["-e", key])
    args.extend(
        [
            "-v",
            f"{staged_dir}:/workspace:ro",
            "-w",
            "/workspace",
            FLYWAY_IMAGE,
            "-outputType=json",
            command,
        ]
    )
    completed = subprocess.run(args, text=True, capture_output=True, env=environment)
    if completed.returncode != 0:
        output = completed.stdout.strip() or completed.stderr.strip() or "no Flyway output"
        output = output.replace(environment["FLYWAY_PASSWORD"], "***")
        raise ReleaseError(f"Flyway {command} failed: {output}")
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise ReleaseError(f"Flyway {command} did not return JSON") from exc
    if not isinstance(payload, dict):
        raise ReleaseError(f"Flyway {command} returned an invalid JSON object")
    return payload


def run_ownership_contract(staged_dir: Path) -> None:
    contract_path = staged_dir / OWNERSHIP_CONTRACT_RELATIVE_PATH
    if not contract_path.is_file():
        raise ReleaseError(f"database ownership contract is missing: {contract_path}")

    values = load_env_file(POSTGRES_ENV_PATH)
    app_db = values.get("APP_DB", "live_statistic")
    app_owner = values.get("APP_OWNER", "live_project_owner")
    flyway_user = values.get("FLYWAY_USER", "live_project_flyway")
    postgres_user = values.get("POSTGRES_USER", "postgres")
    container_name = values.get("POSTGRES_CONTAINER_NAME", "live-set-list-postgres")
    args = [
        "docker",
        "exec",
        "-i",
        container_name,
        "psql",
        "-X",
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "--field-separator=|",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        f"app_owner={app_owner}",
        "-v",
        f"flyway_user={flyway_user}",
        "-U",
        postgres_user,
        "-d",
        app_db,
    ]
    completed = subprocess.run(
        args,
        text=True,
        input=contract_path.read_text(encoding="utf-8"),
        capture_output=True,
    )
    if completed.returncode != 0:
        output = completed.stderr.strip() or completed.stdout.strip() or "no psql output"
        raise ReleaseError(f"database ownership contract check failed: {output}")
    violations = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    if violations:
        details = "\n".join(f"- {line}" for line in violations)
        raise ReleaseError(f"database ownership contract failed:\n{details}")


def assert_flyway_info_ready(payload: dict[str, Any]) -> str | None:
    migrations = payload.get("migrations", [])
    if not isinstance(migrations, list):
        raise ReleaseError("Flyway info migrations are invalid")
    blocking = sorted(
        {
            str(migration.get("state"))
            for migration in migrations
            if isinstance(migration, dict) and migration.get("state") in BLOCKING_FLYWAY_STATES
        }
    )
    if blocking:
        raise ReleaseError(f"Flyway info still contains blocking states: {', '.join(blocking)}")
    schema_version = payload.get("schemaVersion")
    return None if schema_version is None else str(schema_version)


def create_verified_backup() -> tuple[Path, str]:
    backend_env = load_env_file(BACKEND_ENV_PATH)
    backup_root = Path(backend_env.get("LIVESETLIST_BACKUP_ROOT", "/var/backups/livesetlist"))
    auto_dir = backup_root / "app" / "auto"
    before = {path: path.stat().st_mtime_ns for path in auto_dir.glob("live_statistic_auto_*.dump")}
    completed = subprocess.run(
        ["systemctl", "start", BACKUP_SERVICE],
        text=True,
        capture_output=True,
    )
    if completed.returncode != 0:
        output = completed.stderr.strip() or completed.stdout.strip() or "no systemctl output"
        raise ReleaseError(f"production backup failed: {output}")
    candidates = [
        path
        for path in auto_dir.glob("live_statistic_auto_*.dump")
        if path.stat().st_mtime_ns != before.get(path)
    ]
    if not candidates:
        raise ReleaseError("backup service succeeded but no new verified backup was found")
    backup = max(candidates, key=lambda path: path.stat().st_mtime_ns)
    return backup, sha256_file(backup)


def validate_state_files(state: dict[str, Any]) -> tuple[Path, Path]:
    current = current_release_dir()
    if str(current) != state.get("current_release"):
        raise ReleaseError("current release changed after release preparation")
    stage = Path(str(state["staged_release"]))
    if not stage.is_dir():
        raise ReleaseError("staged release is missing")
    current_hash = sql_tree_sha256(current / "backend" / "db" / "flyway" / "sql")
    candidate_hash = sql_tree_sha256(stage / "backend" / "db" / "flyway" / "sql")
    if current_hash != state.get("current_sql_sha256"):
        raise ReleaseError("current Flyway SQL changed after release preparation")
    if candidate_hash != state.get("candidate_sql_sha256"):
        raise ReleaseError("candidate Flyway SQL changed after release preparation")
    return current, stage


def migrate_release(version: str, expected_sha256: str) -> None:
    expected_sha256 = validate_inputs(version, expected_sha256)
    ensure_runtime_dirs()
    state = load_state(version, expected_sha256)
    if state.get("release_type") != "migration-needed":
        raise ReleaseError("release does not contain Flyway SQL changes")
    if state.get("status") == "deployed":
        raise ReleaseError("release has already been deployed")
    _, stage = validate_state_files(state)
    validate_archive(archive_path(version), version, expected_sha256)

    existing_attestation_path = attestation_path(version)
    if existing_attestation_path.exists():
        attestation = read_json(existing_attestation_path)
        expected_fields = {
            "archive_sha256": expected_sha256,
            "candidate_sql_sha256": state["candidate_sql_sha256"],
            "current_sql_sha256": state["current_sql_sha256"],
            "version": version,
        }
        if any(attestation.get(key) != value for key, value in expected_fields.items()):
            raise ReleaseError("existing migration attestation does not match release state")
        final_info = run_flyway("info", stage)
        final_version = assert_flyway_info_ready(final_info)
        if final_version != attestation.get("flyway_version_after"):
            raise ReleaseError("database version does not match existing migration attestation")
        run_ownership_contract(stage)
        state["status"] = "migrated"
        state["attestation"] = str(existing_attestation_path)
        write_json(state_path(version), state)
        return

    info_before = run_flyway("info", stage)
    version_before = None if info_before.get("schemaVersion") is None else str(info_before["schemaVersion"])
    run_ownership_contract(stage)
    backup, backup_sha256 = create_verified_backup()
    migrate_result = run_flyway("migrate", stage)
    run_ownership_contract(stage)
    run_flyway("validate", stage)
    info_after = run_flyway("info", stage)
    version_after = assert_flyway_info_ready(info_after)
    target_version = migrate_result.get("targetSchemaVersion")
    if target_version is not None and str(target_version) != version_after:
        raise ReleaseError("Flyway migrate target does not match final schema version")

    attestation = {
        "applied_migrations": migrate_result.get("migrations", []),
        "archive_sha256": expected_sha256,
        "backup_path": str(backup),
        "backup_sha256": backup_sha256,
        "candidate_sql_sha256": state["candidate_sql_sha256"],
        "current_sql_sha256": state["current_sql_sha256"],
        "flyway_image": FLYWAY_IMAGE,
        "flyway_version_after": version_after,
        "flyway_version_before": version_before,
        "migrated_at": utc_now(),
        "status": "migrated",
        "version": version,
    }
    write_json(existing_attestation_path, attestation)
    state["status"] = "migrated"
    state["attestation"] = str(existing_attestation_path)
    state["migrated_at"] = attestation["migrated_at"]
    write_json(state_path(version), state)


def verify_deploy(version: str, expected_sha256: str) -> str:
    expected_sha256 = validate_inputs(version, expected_sha256)
    state = load_state(version, expected_sha256)
    validate_archive(archive_path(version), version, expected_sha256)
    _, stage = validate_state_files(state)
    release_type = str(state["release_type"])
    if release_type == "app-only":
        if state.get("status") != "prepared":
            raise ReleaseError("app-only release is not in prepared state")
        run_ownership_contract(stage)
        return release_type

    if state.get("status") != "migrated":
        raise ReleaseError("migration release has no completed migration state")
    attestation = read_json(attestation_path(version))
    expected_fields = {
        "archive_sha256": expected_sha256,
        "candidate_sql_sha256": state["candidate_sql_sha256"],
        "current_sql_sha256": state["current_sql_sha256"],
        "status": "migrated",
        "version": version,
    }
    if any(attestation.get(key) != value for key, value in expected_fields.items()):
        raise ReleaseError("migration attestation does not authorize this deployment")
    info = run_flyway("info", stage)
    current_db_version = assert_flyway_info_ready(info)
    if current_db_version != attestation.get("flyway_version_after"):
        raise ReleaseError("database version does not match migration attestation")
    run_ownership_contract(stage)
    return release_type


def mark_deployed(version: str, expected_sha256: str) -> None:
    expected_sha256 = validate_inputs(version, expected_sha256)
    state = load_state(version, expected_sha256)
    active_release = current_release_dir()
    expected_release = (RELEASE_ROOT / release_name(version)).resolve(strict=True)
    if active_release != expected_release:
        raise ReleaseError("current link does not point to the release being finalized")
    active_hash = sql_tree_sha256(active_release / "backend" / "db" / "flyway" / "sql")
    if active_hash != state.get("candidate_sql_sha256"):
        raise ReleaseError("active Flyway SQL does not match prepared candidate")
    deployed_at = utc_now()
    if state.get("release_type") == "migration-needed":
        attestation = read_json(attestation_path(version))
        if attestation.get("status") != "migrated":
            raise ReleaseError("migration attestation is not ready to finalize")
    state["status"] = "deployed"
    state["deployed_at"] = deployed_at
    state["active_release"] = str(active_release)
    write_json(state_path(version), state)
    shutil.rmtree(staged_release_path(version), ignore_errors=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare, migrate, and attest LiveSetList production releases.")
    parser.add_argument("action", choices=["prepare", "migrate", "verify-deploy", "mark-deployed"])
    parser.add_argument("version")
    parser.add_argument("sha256")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        with release_lock():
            if args.action == "prepare":
                release_type = prepare_release(args.version, args.sha256)
                print(f"release_type={release_type}")
            elif args.action == "migrate":
                migrate_release(args.version, args.sha256)
                print(f"migrated livesetlist-{args.version}")
            elif args.action == "verify-deploy":
                release_type = verify_deploy(args.version, args.sha256)
                print(f"release_type={release_type}")
            else:
                mark_deployed(args.version, args.sha256)
                print(f"finalized livesetlist-{args.version}")
    except ReleaseError as exc:
        print(f"livesetlist-release-manager: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
