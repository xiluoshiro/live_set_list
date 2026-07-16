import importlib.util
from pathlib import Path
import tarfile

import pytest

ROOT = Path(__file__).resolve().parents[3]
RELEASE_SCRIPT_PATH = ROOT / "scripts" / "build_release.py"
release_spec = importlib.util.spec_from_file_location("build_release", RELEASE_SCRIPT_PATH)
assert release_spec is not None and release_spec.loader is not None
build_release = importlib.util.module_from_spec(release_spec)
release_spec.loader.exec_module(build_release)

RELEASE_DIRS = build_release.RELEASE_DIRS
RELEASE_FILES = build_release.RELEASE_FILES
_has_excluded_part = build_release._has_excluded_part

RELEASE_MANAGER_PATH = ROOT / "infra" / "production" / "release_manager.py"
manager_spec = importlib.util.spec_from_file_location("release_manager", RELEASE_MANAGER_PATH)
assert manager_spec is not None and manager_spec.loader is not None
release_manager = importlib.util.module_from_spec(manager_spec)
manager_spec.loader.exec_module(release_manager)


# 测试点：生产 PostgreSQL 模板只能绑定本机回环地址，避免数据库端口公网暴露。
def test_production_postgres_compose_binds_localhost_only():
    compose_text = (ROOT / "infra" / "production" / "docker-compose.postgres.yml").read_text(encoding="utf-8")

    assert "127.0.0.1:${POSTGRES_PORT:-15432}:5432" in compose_text
    assert "0.0.0.0" not in compose_text


# 测试点：Nginx 模板必须同时包含登录限流和 OpenAPI 文档拦截。
def test_production_nginx_template_guards_login_and_openapi():
    nginx_text = (ROOT / "infra" / "production" / "nginx.livesetlist.conf.template").read_text(encoding="utf-8")

    assert "limit_req_zone" in nginx_text
    assert "zone=livesetlist_api" in nginx_text
    assert "location = /api/auth/login" in nginx_text
    assert "limit_req zone=livesetlist_login" in nginx_text
    assert "limit_req zone=livesetlist_api" in nginx_text
    assert "listen 80 default_server" in nginx_text
    assert "return 444" in nginx_text
    assert "client_max_body_size 1m" in nginx_text
    assert "location = /openapi.json" in nginx_text
    assert "location = /docs" in nginx_text
    assert "location = /redoc" in nginx_text


# 测试点：备份任务需要 Docker socket，且发布目录只读时才可安全地以 root 运行。
def test_production_backup_service_uses_root_for_docker_access():
    service_text = (ROOT / "infra" / "production" / "livesetlist-backup.service").read_text(encoding="utf-8")

    assert "User=root" in service_text
    assert "Group=root" in service_text
    assert "ReadWritePaths=/var/backups/livesetlist" in service_text


# 测试点：自动部署脚本必须消费准备状态和 migration attestation，并保留失败后的应用回滚路径。
def test_production_deploy_script_has_release_safety_guards():
    deploy_script = (ROOT / "infra" / "production" / "livesetlist-deploy").read_text(encoding="utf-8")

    assert "archive checksum mismatch" in deploy_script
    assert '"$RELEASE_MANAGER" verify-deploy' in deploy_script
    assert '"$RELEASE_MANAGER" mark-deployed' in deploy_script
    assert "systemctl start \"$BACKUP_SERVICE\"" in deploy_script
    assert "trap rollback ERR" in deploy_script
    assert "wait_for_backend" in deploy_script


# 测试点：tag 发布工作流必须先让服务器分类候选包，且只自动部署 app-only release。
def test_release_workflow_prepares_candidate_before_app_only_deploy():
    workflow = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")

    assert "tags:" in workflow
    assert '"v*"' in workflow
    assert "python scripts/run_checks.py functional" in workflow
    assert "environment:" in workflow
    assert "name: production" in workflow
    assert "actions/download-artifact@v4" in workflow
    assert "livesetlist-release-manager prepare" in workflow
    assert "release_type == 'app-only'" in workflow
    assert "migration-needed" in workflow
    assert "livesetlist-deploy" in workflow
    assert "cp backend/db/flyway/flyway.toml.example backend/db/flyway/flyway.toml" in workflow
    assert "(cd dist-release && sha256sum" in workflow
    assert "redgate/flyway:12.11.0" in workflow
    assert "redgate/flyway:latest" not in workflow


# 测试点：migration release 必须通过两次显式 workflow_dispatch 分别执行 migrate 和 deploy。
def test_migration_workflow_separates_migrate_and_deploy_phases():
    workflow = (ROOT / ".github" / "workflows" / "migration-release.yml").read_text(encoding="utf-8")

    assert "workflow_dispatch:" in workflow
    assert "confirmation:" in workflow
    assert 'test "$CONFIRMATION" = "MIGRATE"' in workflow
    assert 'test "$CONFIRMATION" = "DEPLOY"' in workflow
    assert "livesetlist-release-manager migrate" in workflow
    assert "livesetlist-deploy" in workflow
    assert "name: production-migration" in workflow
    assert "name: production" in workflow


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


# 测试点：生产发布包白名单不能包含本地状态、依赖缓存或敏感工作区目录。
def test_release_path_whitelist_excludes_local_state_and_sensitive_directories():
    assert "backend/app" in RELEASE_DIRS
    assert "config" in RELEASE_DIRS
    assert "frontend/dist" in RELEASE_DIRS
    assert "infra/production" in RELEASE_DIRS
    assert "backend/requirements.txt" in RELEASE_FILES
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
    }
    for relative_path, content in release_files.items():
        file_path = test_root / relative_path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")

    frontend_dist = test_root / "frontend" / "dist"
    frontend_dist.mkdir(parents=True)

    monkeypatch.setattr(build_release, "ROOT", test_root)
    monkeypatch.setattr(build_release, "FRONTEND_DIR", test_root / "frontend")
    monkeypatch.setattr(
        build_release,
        "RELEASE_DIRS",
        ["backend/db/flyway", "frontend/dist", "infra/production", "recovery"],
    )
    monkeypatch.setattr(build_release, "RELEASE_FILES", [])

    def fake_build_frontend():
        (frontend_dist / "index.html").write_text("fresh asset", encoding="utf-8")

    monkeypatch.setattr(build_release, "build_frontend", fake_build_frontend)

    archive_path = build_release.build_release_archive("test-release", tmp_path / "output")

    with tarfile.open(archive_path, "r:gz") as archive:
        names = set(archive.getnames())

    archive_root = "livesetlist-test-release"
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


def _prepare_migration_candidate(tmp_path, monkeypatch):
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
    (candidate_sql / "V2__new.sql").write_text("select 2;", encoding="utf-8")

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
        "release_root": release_root,
        "release_type": release_type,
        "staging_root": staging_root,
        "state_root": state_root,
        "version": version,
    }


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


# 测试点：migration 阶段必须按固定顺序执行 Flyway，并在成功后写入备份绑定的 root-only attestation。
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
        calls.append((command, staged_dir))
        return next(responses)

    backup = tmp_path / "backups" / "live_statistic_auto.dump"
    backup.parent.mkdir()
    backup.write_bytes(b"verified backup")
    monkeypatch.setattr(release_manager, "run_flyway", fake_run_flyway)
    monkeypatch.setattr(
        release_manager,
        "create_verified_backup",
        lambda: (backup, release_manager.sha256_file(backup)),
    )

    release_manager.migrate_release(prepared["version"], prepared["archive_sha256"])

    assert [command for command, _ in calls] == ["info", "migrate", "validate", "info"]
    attestation = release_manager.read_json(
        prepared["attestation_root"] / f"{prepared['version']}.json"
    )
    assert attestation["status"] == "migrated"
    assert attestation["flyway_version_before"] == "1"
    assert attestation["flyway_version_after"] == "2"
    assert attestation["backup_path"] == str(backup)
    assert attestation["backup_sha256"] == release_manager.sha256_file(backup)


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


# 测试点：生产 env 解析必须原样保留密码中的美元符号和感叹号，不执行 shell 或 Compose 插值。
def test_release_manager_loads_shell_significant_env_values_without_interpolation(tmp_path):
    env_file = tmp_path / "postgres.env"
    env_file.write_text('FLYWAY_PASSWORD="a$B!c#d"\nPOSTGRES_PORT=15432\n', encoding="utf-8")

    values = release_manager.load_env_file(env_file)

    assert values["FLYWAY_PASSWORD"] == "a$B!c#d"
    assert values["POSTGRES_PORT"] == "15432"
