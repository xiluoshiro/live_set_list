import importlib.util
from pathlib import Path
import shutil
import subprocess
import tarfile

import pytest

ROOT = Path(__file__).resolve().parents[2]
RELEASE_SCRIPT_PATH = ROOT / "scripts" / "build_release.py"
release_spec = importlib.util.spec_from_file_location("build_release", RELEASE_SCRIPT_PATH)
assert release_spec is not None and release_spec.loader is not None
build_release = importlib.util.module_from_spec(release_spec)
release_spec.loader.exec_module(build_release)

_has_excluded_part = build_release._has_excluded_part

RELEASE_MANAGER_PATH = ROOT / "infra" / "production" / "release_manager.py"
manager_spec = importlib.util.spec_from_file_location("release_manager", RELEASE_MANAGER_PATH)
assert manager_spec is not None and manager_spec.loader is not None
release_manager = importlib.util.module_from_spec(manager_spec)
manager_spec.loader.exec_module(release_manager)


# 测试点：发布归档前必须先构建前端，归档中应包含该次构建生成的静态产物。
def test_release_archive_builds_frontend_before_collecting_release_paths(tmp_path, monkeypatch):
    test_root = tmp_path / "repo"
    frontend_dist = test_root / "frontend" / "dist"
    frontend_dist.mkdir(parents=True)

    monkeypatch.setattr(build_release, "ROOT", test_root)
    monkeypatch.setattr(build_release, "FRONTEND_DIR", test_root / "frontend")
    monkeypatch.setattr(build_release, "RELEASE_DIRS", ["frontend/dist"])
    monkeypatch.setattr(build_release, "RELEASE_FILES", [])

    def fake_build_frontend():
        (frontend_dist / "rebuilt.js").write_text("fresh asset", encoding="utf-8")

    monkeypatch.setattr(build_release, "build_frontend", fake_build_frontend)

    archive_path = build_release.build_release_archive("test-release", tmp_path / "output")

    with tarfile.open(archive_path, "r:gz") as archive:
        assert "livesetlist-test-release/frontend/dist/rebuilt.js" in archive.getnames()


# 测试点：发布路径过滤拒绝本地状态、依赖缓存和凭据文件，允许公开配置模板。
def test_release_path_filter_excludes_local_state_and_sensitive_directories():
    assert _has_excluded_part(Path(".git/config"))
    assert _has_excluded_part(Path(".codex/state.json"))
    assert _has_excluded_part(Path(".agents/context.md"))
    assert _has_excluded_part(Path("frontend/node_modules/react/index.js"))
    assert _has_excluded_part(Path("backend/.venv/pyvenv.cfg"))
    assert _has_excluded_part(Path("backend/db/flyway/flyway.toml"))
    assert _has_excluded_part(Path("infra/production/backend.env"))
    assert _has_excluded_part(Path("infra/production/backend.env.local"))
    assert _has_excluded_part(Path("infra/production/.env.production"))
    assert _has_excluded_part(Path("infra/production/env.production"))
    assert _has_excluded_part(Path("recovery/.runtime/sandbox/flyway.toml"))
    assert _has_excluded_part(Path("recovery/tests/test_recovery_unit.py"))
    assert not _has_excluded_part(Path("backend/db/flyway/flyway.toml.example"))
    assert not _has_excluded_part(Path("infra/production/env.production.example"))


# 测试点：最终发布归档必须排除 Flyway 凭据、运行时 env 和恢复沙箱，同时保留公开模板与运行文件。
def test_release_archive_excludes_sensitive_runtime_files(tmp_path, monkeypatch):
    test_root = tmp_path / "repo"
    release_files = {
        "backend/app/main.py": "APP = True",
        "backend/db/postgres/checks/ownership.sql": "select 1;",
        "backend/db/postgres/init/roles.sql": "select 1;",
        "backend/requirements.txt": "fastapi",
        "config/application.json": "{}",
        "backend/db/flyway/sql/V1__baseline.sql": "select 1;",
        "backend/db/flyway/flyway.toml": "password = 'secret'",
        "backend/db/flyway/flyway.toml.example": "password = 'replace_me'",
        "infra/production/backend.env": "DB_PASSWORD=secret",
        "infra/production/backend.env.local": "DB_PASSWORD=secret",
        "infra/production/.env.production": "DB_PASSWORD=secret",
        "infra/production/env.production": "DB_PASSWORD=secret",
        "infra/production/env.production.example": "DB_PASSWORD=replace_me",
        "recovery/core.py": "SAFE = True",
        "recovery/.runtime/sandbox/flyway.toml": "password = 'secret'",
        "scripts/recovery_db.py": "RECOVERY = True",
        "README.md": "Release instructions",
    }
    for relative_path, content in release_files.items():
        file_path = test_root / relative_path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")

    frontend_dist = test_root / "frontend" / "dist"
    frontend_dist.mkdir(parents=True)

    monkeypatch.setattr(build_release, "ROOT", test_root)
    monkeypatch.setattr(build_release, "FRONTEND_DIR", test_root / "frontend")

    def fake_build_frontend():
        (frontend_dist / "index.html").write_text("fresh asset", encoding="utf-8")

    monkeypatch.setattr(build_release, "build_frontend", fake_build_frontend)

    archive_path = build_release.build_release_archive("test-release", tmp_path / "output")

    with tarfile.open(archive_path, "r:gz") as archive:
        names = set(archive.getnames())

    archive_root = "livesetlist-test-release"
    for runtime_file in (
        "backend/app/main.py", "backend/db/postgres/checks/ownership.sql",
        "backend/db/postgres/init/roles.sql", "backend/requirements.txt",
        "config/application.json", "scripts/recovery_db.py", "README.md",
    ):
        assert f"{archive_root}/{runtime_file}" in names
    assert f"{archive_root}/backend/db/flyway/flyway.toml" not in names
    assert f"{archive_root}/infra/production/backend.env" not in names
    assert f"{archive_root}/infra/production/backend.env.local" not in names
    assert f"{archive_root}/infra/production/.env.production" not in names
    assert f"{archive_root}/infra/production/env.production" not in names
    assert f"{archive_root}/recovery/.runtime/sandbox/flyway.toml" not in names
    assert f"{archive_root}/backend/db/flyway/flyway.toml.example" in names
    assert f"{archive_root}/infra/production/env.production.example" in names
    assert f"{archive_root}/recovery/core.py" in names
    assert f"{archive_root}/frontend/dist/index.html" in names


def _prepare_migration_candidate(tmp_path, monkeypatch, *, app_only=False):
    version = "2026-07-17-001"
    upload_root = tmp_path / "uploads"
    archive_store = tmp_path / "archives"
    release_root = tmp_path / "releases"
    staging_root = tmp_path / "staging"
    state_root = tmp_path / "state"
    attestation_root = tmp_path / "attestations"
    current = release_root / "livesetlist-current"
    current_sql = current / "backend" / "db" / "flyway" / "sql"
    current_sql.mkdir(parents=True)
    (current_sql / "V1__baseline.sql").write_text("select 1;", encoding="utf-8")

    candidate_source = tmp_path / "candidate" / f"livesetlist-{version}"
    candidate_sql = candidate_source / "backend" / "db" / "flyway" / "sql"
    candidate_sql.mkdir(parents=True)
    (candidate_sql / "V1__baseline.sql").write_text("select 1;", encoding="utf-8")
    if not app_only:
        (candidate_sql / "V2__new.sql").write_text("select 2;", encoding="utf-8")
    candidate_app = candidate_source / "backend" / "app" / "main.py"
    candidate_app.parent.mkdir(parents=True)
    candidate_app.write_text("APP = True", encoding="utf-8")

    upload_root.mkdir()
    archive = upload_root / f"livesetlist-{version}.tar.gz"
    with tarfile.open(archive, "w:gz") as handle:
        for path in sorted(candidate_source.rglob("*")):
            if path.is_file():
                handle.add(path, arcname=path.relative_to(candidate_source.parent))

    monkeypatch.setattr(release_manager, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(release_manager, "ARCHIVE_STORE", archive_store)
    monkeypatch.setattr(release_manager, "RELEASE_ROOT", release_root)
    monkeypatch.setattr(release_manager, "STAGING_ROOT", staging_root)
    monkeypatch.setattr(release_manager, "STATE_ROOT", state_root)
    monkeypatch.setattr(release_manager, "ATTESTATION_ROOT", attestation_root)
    monkeypatch.setattr(release_manager, "CURRENT_LINK", current)
    monkeypatch.setattr(release_manager.os, "chown", lambda *args, **kwargs: None, raising=False)

    archive_sha256 = release_manager.sha256_file(archive)
    release_type = release_manager.prepare_release(version, archive_sha256)

    return {
        "archive": archive,
        "archive_sha256": archive_sha256,
        "archive_store": archive_store,
        "attestation_root": attestation_root,
        "current": current,
        "release_root": release_root,
        "release_type": release_type,
        "staging_root": staging_root,
        "state_root": state_root,
        "version": version,
    }


def _prepare_app_candidate(tmp_path, monkeypatch, *, active=False):
    prepared = _prepare_migration_candidate(tmp_path, monkeypatch, app_only=True)
    monkeypatch.setattr(release_manager, "run_ownership_contract", lambda path: None)
    monkeypatch.setattr(release_manager, "run_flyway", lambda *args: pytest.fail("unexpected Flyway execution"))
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: pytest.fail("unexpected external command"))
    candidate = prepared["release_root"] / f"livesetlist-{prepared['version']}"
    if active:
        shutil.copytree(prepared["staging_root"] / candidate.name, candidate)
        monkeypatch.setattr(release_manager, "CURRENT_LINK", candidate)
    prepared["candidate"] = candidate
    return prepared


# 测试点：回滚后再次部署同版本仍获授权，校验阶段保留未激活候选中的文件。
def test_release_manager_allows_app_retry_after_rollback(tmp_path, monkeypatch):
    prepared = _prepare_app_candidate(tmp_path, monkeypatch)
    candidate = prepared["candidate"]
    candidate.mkdir()
    evidence = candidate / "previous-attempt.log"
    evidence.write_text("failed attempt", encoding="utf-8")

    result = release_manager.verify_deploy(prepared["version"], prepared["archive_sha256"])

    assert result == {
        "release_type": "app-only",
        "deployment_mode": "fresh",
        "previous_release": str(prepared["current"].resolve()),
    }
    assert evidence.read_text(encoding="utf-8") == "failed attempt"


# 测试点：已切换但尚未登记成功的同版本可继续收尾，并保留应用文件和生成的运行环境。
def test_release_manager_resumes_active_app_candidate(tmp_path, monkeypatch):
    prepared = _prepare_app_candidate(tmp_path, monkeypatch, active=True)
    runtime_file = prepared["candidate"] / "backend" / ".venv" / "pyvenv.cfg"
    runtime_file.parent.mkdir()
    runtime_file.write_text("existing runtime", encoding="utf-8")
    state_file = prepared["state_root"] / f"{prepared['version']}.json"
    original_state = state_file.read_bytes()

    result = release_manager.verify_deploy(prepared["version"], prepared["archive_sha256"])

    assert result == {
        "release_type": "app-only",
        "deployment_mode": "resume",
        "previous_release": str(prepared["current"].resolve()),
    }
    assert state_file.read_bytes() == original_state
    assert runtime_file.read_text(encoding="utf-8") == "existing runtime"
    assert (prepared["candidate"] / "backend" / "app" / "main.py").read_text(encoding="utf-8") == "APP = True"


# 测试点：已成功部署的同版本可重复准备与确认，旧版本已清理也不改写首次部署记录。
def test_release_manager_repeats_completed_app_deployment_without_stage(tmp_path, monkeypatch):
    prepared = _prepare_app_candidate(tmp_path, monkeypatch, active=True)
    version, checksum = prepared["version"], prepared["archive_sha256"]
    monkeypatch.setattr(release_manager, "utc_now", lambda: "2026-09-30T00:00:00+00:00")
    release_manager.mark_deployed(version, checksum)
    state_file = prepared["state_root"] / f"{version}.json"
    completed_state = state_file.read_bytes()
    assert not (prepared["staging_root"] / prepared["candidate"].name).exists()
    shutil.rmtree(prepared["current"])
    monkeypatch.setattr(release_manager, "utc_now", lambda: "2026-10-01T00:00:00+00:00")

    result = release_manager.verify_deploy(version, checksum)
    assert result["deployment_mode"] == "complete"
    assert release_manager.prepare_release(version, checksum) == "app-only"
    release_manager.mark_deployed(version, checksum)

    assert state_file.read_bytes() == completed_state
    assert (prepared["candidate"] / "backend" / "app" / "main.py").read_text(encoding="utf-8") == "APP = True"


# 测试点：继续部署前须拒绝归档内应用文件被替换或丢失，且不能覆盖现场文件。
@pytest.mark.parametrize("file_change", ["modified", "missing"])
def test_release_manager_rejects_active_app_file_changes(tmp_path, monkeypatch, file_change):
    prepared = _prepare_app_candidate(tmp_path, monkeypatch, active=True)
    app_file = prepared["candidate"] / "backend" / "app" / "main.py"
    if file_change == "modified":
        app_file.write_text("APP = None", encoding="utf-8")
    else:
        app_file.unlink()
    state_file = prepared["state_root"] / f"{prepared['version']}.json"
    original_state = state_file.read_bytes()

    with pytest.raises(release_manager.ReleaseError, match="does not match archive"):
        release_manager.verify_deploy(prepared["version"], prepared["archive_sha256"])

    assert state_file.read_bytes() == original_state
    if file_change == "modified":
        assert app_file.read_text(encoding="utf-8") == "APP = None"
    else:
        assert not app_file.exists()


# 测试点：重试授权仍拒绝错误归档、未知状态、无关活动版本及无效回滚目标，且保留当前应用。
@pytest.mark.parametrize("invalid_state", ["checksum", "status", "active", "previous-outside", "previous-missing"])
def test_release_manager_rejects_invalid_app_retry(tmp_path, monkeypatch, invalid_state):
    prepared = _prepare_app_candidate(tmp_path, monkeypatch, active=True)
    version, checksum = prepared["version"], prepared["archive_sha256"]
    state_file = prepared["state_root"] / f"{version}.json"
    state = release_manager.read_json(state_file)
    if invalid_state == "checksum":
        checksum = "0" * 64
    elif invalid_state == "status":
        state["status"] = "unknown"
    elif invalid_state == "active":
        unrelated = prepared["release_root"] / "unrelated"
        unrelated.mkdir()
        monkeypatch.setattr(release_manager, "CURRENT_LINK", unrelated)
    elif invalid_state == "previous-outside":
        state["current_release"] = str(tmp_path)
    else:
        shutil.rmtree(prepared["current"])
    release_manager.write_json(state_file, state)
    original_state = state_file.read_bytes()

    with pytest.raises(release_manager.ReleaseError):
        release_manager.verify_deploy(version, checksum)

    assert state_file.read_bytes() == original_state
    assert (prepared["candidate"] / "backend" / "app" / "main.py").read_text(encoding="utf-8") == "APP = True"


# 测试点：服务器应以 current 的 SQL 文件树为事实来源，将新增 migration 的候选包分类并持久化为待迁移状态。
def test_release_manager_prepares_migration_candidate(tmp_path, monkeypatch):
    prepared = _prepare_migration_candidate(tmp_path, monkeypatch)
    version = prepared["version"]

    assert prepared["release_type"] == "migration-needed"
    state = release_manager.read_json(prepared["state_root"] / f"{version}.json")
    assert state["status"] == "prepared"
    assert state["current_sql_sha256"] != state["candidate_sql_sha256"]
    assert (prepared["archive_store"] / prepared["archive"].name).is_file()
    assert not prepared["archive"].exists()
    assert (
        prepared["staging_root"]
        / f"livesetlist-{version}"
        / "backend"
        / "db"
        / "flyway"
        / "sql"
        / "V2__new.sql"
    ).is_file()


# 测试点：migration 候选包在 attestation 生成前必须被 deploy 校验拒绝。
def test_release_manager_blocks_migration_deploy_before_attestation(tmp_path, monkeypatch):
    prepared = _prepare_migration_candidate(tmp_path, monkeypatch)

    with pytest.raises(release_manager.ReleaseError, match="no completed migration state"):
        release_manager.verify_deploy(prepared["version"], prepared["archive_sha256"])


# 测试点：prepare 后即使另一 release 的 SQL 相同，只要 current 版本发生变化也必须拒绝继续迁移或部署。
def test_release_manager_rejects_current_release_drift(tmp_path, monkeypatch):
    prepared = _prepare_migration_candidate(tmp_path, monkeypatch)
    replacement = prepared["release_root"] / "livesetlist-replacement"
    replacement_sql = replacement / "backend" / "db" / "flyway" / "sql"
    replacement_sql.mkdir(parents=True)
    (replacement_sql / "V1__baseline.sql").write_text("select 1;", encoding="utf-8")
    monkeypatch.setattr(release_manager, "CURRENT_LINK", replacement)

    with pytest.raises(release_manager.ReleaseError, match="current release changed"):
        release_manager.verify_deploy(prepared["version"], prepared["archive_sha256"])


# 测试点：migration 必须在备份前和迁移后校验 owner 契约，再按固定 Flyway 顺序写入 attestation。
def test_release_manager_migrates_then_writes_attestation(tmp_path, monkeypatch):
    prepared = _prepare_migration_candidate(tmp_path, monkeypatch)
    calls = []
    responses = iter(
        [
            {"schemaVersion": "1", "migrations": [{"version": "2", "state": "Pending"}]},
            {
                "targetSchemaVersion": "2",
                "migrations": [{"version": "2", "description": "new"}],
            },
            {"operation": "validate"},
            {"schemaVersion": "2", "migrations": [{"version": "2", "state": "Success"}]},
        ]
    )

    def fake_run_flyway(command, staged_dir):
        calls.append(command)
        return next(responses)

    backup = tmp_path / "backups" / "live_statistic_auto.dump"
    backup.parent.mkdir()
    backup.write_bytes(b"verified backup")
    backup_sha256 = "033ea45728f0ba7ce7552bfc6ce49fff338e1269f45c72eded39cb3dc0371087"
    monkeypatch.setattr(release_manager, "run_flyway", fake_run_flyway)
    monkeypatch.setattr(
        release_manager,
        "run_ownership_contract",
        lambda _staged_dir: calls.append("ownership-contract"),
    )

    def fake_create_verified_backup():
        calls.append("backup")
        return backup, backup_sha256

    monkeypatch.setattr(
        release_manager,
        "create_verified_backup",
        fake_create_verified_backup,
    )

    release_manager.migrate_release(prepared["version"], prepared["archive_sha256"])

    assert calls == [
        "info",
        "ownership-contract",
        "backup",
        "migrate",
        "ownership-contract",
        "validate",
        "info",
    ]
    attestation = release_manager.read_json(
        prepared["attestation_root"] / f"{prepared['version']}.json"
    )
    assert attestation["status"] == "migrated"
    assert attestation["flyway_version_before"] == "1"
    assert attestation["flyway_version_after"] == "2"
    assert attestation["backup_path"] == str(backup)
    assert attestation["backup_sha256"] == backup_sha256


# 测试点：生产 owner 契约发现漂移时应列出对象并拒绝继续发布。
def test_release_manager_reports_database_ownership_drift(tmp_path, monkeypatch):
    staged_dir = tmp_path / "staged"
    contract_path = staged_dir / release_manager.OWNERSHIP_CONTRACT_RELATIVE_PATH
    contract_path.parent.mkdir(parents=True)
    contract_path.write_text("select 1;", encoding="utf-8")
    env_file = tmp_path / "postgres.env"
    env_file.write_text(
        "\n".join(
            [
                "POSTGRES_CONTAINER_NAME=production-postgres",
                "POSTGRES_USER=postgres",
                "APP_DB=live_statistic",
                "APP_OWNER=live_project_owner",
                "FLYWAY_USER=live_project_flyway",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(release_manager, "POSTGRES_ENV_PATH", env_file)

    def fake_run(args, **kwargs):
        assert args[:4] == ["docker", "exec", "-i", "production-postgres"]
        assert kwargs["input"] == "select 1;"
        return subprocess.CompletedProcess(
            args=args,
            returncode=0,
            stdout="table|public.band_attrs|live_project_owner|live_project_flyway\n",
            stderr="",
        )

    monkeypatch.setattr(release_manager.subprocess, "run", fake_run)

    with pytest.raises(release_manager.ReleaseError, match="public.band_attrs"):
        release_manager.run_ownership_contract(staged_dir)


# 测试点：release manager 必须拒绝归档中的链接，避免 prepare 阶段把候选包解压到预期目录之外。
def test_release_manager_rejects_archive_links(tmp_path):
    version = "2026-07-17-002"
    archive = tmp_path / f"livesetlist-{version}.tar.gz"
    link = tarfile.TarInfo(f"livesetlist-{version}/unsafe-link")
    link.type = tarfile.SYMTYPE
    link.linkname = "/etc/passwd"
    with tarfile.open(archive, "w:gz") as handle:
        handle.addfile(link)

    with pytest.raises(release_manager.ReleaseError, match="unsupported entry"):
        release_manager.validate_archive(archive, version, release_manager.sha256_file(archive))


# 测试点：候选包解压不应依赖旧版 Python 尚未提供的 tarfile extraction filter。
def test_release_manager_extracts_archive_without_extractall_filter(tmp_path, monkeypatch):
    version = "2026-07-17-003"
    source_root = tmp_path / "source" / f"livesetlist-{version}"
    sql_file = source_root / "backend" / "db" / "flyway" / "sql" / "V12__example.sql"
    sql_file.parent.mkdir(parents=True)
    sql_file.write_text("select 12;", encoding="utf-8")
    archive_path = tmp_path / f"livesetlist-{version}.tar.gz"
    with tarfile.open(archive_path, "w:gz") as archive:
        archive.add(source_root, arcname=source_root.name)

    monkeypatch.setattr(
        tarfile.TarFile,
        "extractall",
        lambda *args, **kwargs: (_ for _ in ()).throw(TypeError("filter is unsupported")),
    )
    destination = tmp_path / "extracted"
    destination.mkdir()

    release_manager.extract_archive(archive_path, version, destination)

    assert (
        destination
        / f"livesetlist-{version}"
        / "backend"
        / "db"
        / "flyway"
        / "sql"
        / "V12__example.sql"
    ).read_text(encoding="utf-8") == "select 12;"


# 测试点：生产 env 解析必须原样保留密码中的美元符号和感叹号，不执行 shell 或 Compose 插值。
def test_release_manager_loads_shell_significant_env_values_without_interpolation(tmp_path):
    env_file = tmp_path / "postgres.env"
    env_file.write_text('FLYWAY_PASSWORD="a$B!c#d"\nPOSTGRES_PORT=15432\n', encoding="utf-8")

    values = release_manager.load_env_file(env_file)

    assert values["FLYWAY_PASSWORD"] == "a$B!c#d"
    assert values["POSTGRES_PORT"] == "15432"
