import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RELEASE_SCRIPT_PATH = ROOT / "scripts" / "build_release.py"
release_spec = importlib.util.spec_from_file_location("build_release", RELEASE_SCRIPT_PATH)
assert release_spec is not None and release_spec.loader is not None
build_release = importlib.util.module_from_spec(release_spec)
release_spec.loader.exec_module(build_release)

RELEASE_DIRS = build_release.RELEASE_DIRS
RELEASE_FILES = build_release.RELEASE_FILES
_has_excluded_part = build_release._has_excluded_part


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
    assert _has_excluded_part(Path("recovery/tests/test_recovery_unit.py"))
    assert not _has_excluded_part(Path("infra/production/env.production.example"))
