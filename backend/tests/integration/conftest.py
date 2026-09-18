import os
from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path

import psycopg2
import pytest
from dotenv import dotenv_values
from fastapi.testclient import TestClient
from psycopg2.extras import execute_values

os.environ.setdefault("APP_LOG_LEVEL", "CRITICAL")

from app.auth import hash_password, normalize_username
from app.main import app
from tests.integration_lock import acquire_integration_db_lock, release_integration_db_lock


ROOT_DIR = Path(__file__).resolve().parents[3]
SEED_SQL_PATH = ROOT_DIR / "backend" / "db" / "postgres" / "seed" / "base_seed.sql"
PG_MIGRATE_ENV_PATH = ROOT_DIR / "infra" / "postgres" / ".env.pg-migrate"
AUTH_ENV_PATH = ROOT_DIR / "infra" / "auth" / ".env.auth"


def _load_integration_db_config() -> dict[str, str] | None:
    if os.getenv("TEST_DB_PASSWORD"):
        user = os.getenv("TEST_DB_USER", "live_project_ro")
        password = os.getenv("TEST_DB_PASSWORD", "")
        return {
            "host": os.getenv("TEST_DB_HOST", "localhost"),
            "port": os.getenv("TEST_DB_PORT", "15432"),
            "dbname": os.getenv("TEST_DB_NAME", "live_statistic_test"),
            "user": user,
            "password": password,
            "write_user": os.getenv("TEST_DB_WRITE_USER", "live_project_super_ro"),
            "write_password": os.getenv("TEST_DB_WRITE_PASSWORD") or os.getenv("APP_SUPER_PASSWORD") or password,
            "user_rw_user": os.getenv("TEST_DB_USER_RW_USER", "live_project_user_rw"),
            "user_rw_password": os.getenv("TEST_DB_USER_RW_PASSWORD") or os.getenv("APP_USER_RW_PASSWORD") or password,
            "admin_user": os.getenv("TEST_DB_ADMIN_USER", "live_project_test_admin"),
            "admin_password": os.getenv("TEST_DB_ADMIN_PASSWORD") or password,
        }

    if not PG_MIGRATE_ENV_PATH.exists():
        return None

    values = dotenv_values(PG_MIGRATE_ENV_PATH)
    raw_password = values.get("APP_RO_PASSWORD") or values.get("POSTGRES_PASSWORD")
    raw_user = values.get("APP_RO_USER") or "live_project_ro"
    port = values.get("POSTGRES_PORT")
    if not raw_password or not raw_user:
        return None
    password = str(raw_password)
    user = str(raw_user)

    return {
        "host": str(values.get("POSTGRES_HOST", "localhost")),
        "port": str(port or "15432"),
        "dbname": str(values.get("TEST_DB_NAME", "live_statistic_test")),
        "user": user,
        "password": password,
        "write_user": str(values.get("APP_SUPER_USER", "live_project_super_ro")),
        "write_password": str(values.get("APP_SUPER_PASSWORD") or values.get("POSTGRES_PASSWORD") or password),
        "user_rw_user": str(values.get("APP_USER_RW_USER", "live_project_user_rw")),
        "user_rw_password": str(values.get("APP_USER_RW_PASSWORD") or values.get("POSTGRES_PASSWORD") or password),
        "admin_user": str(values.get("TEST_DB_ADMIN_USER") or values.get("TEST_ADMIN_USER") or "live_project_test_admin"),
        "admin_password": str(values.get("TEST_DB_ADMIN_PASSWORD") or values.get("TEST_ADMIN_PASSWORD") or values.get("POSTGRES_PASSWORD") or password),
    }


def _load_integration_auth_config() -> dict[str, str]:
    values = dotenv_values(AUTH_ENV_PATH) if AUTH_ENV_PATH.exists() else {}
    return {
        "username": str(os.getenv("AUTH_DEFAULT_ADMIN_USERNAME") or values.get("AUTH_DEFAULT_ADMIN_USERNAME") or "admin"),
        "password": str(os.getenv("AUTH_DEFAULT_ADMIN_PASSWORD") or values.get("AUTH_DEFAULT_ADMIN_PASSWORD") or "test-admin-pass"),
        "display_name": str(
            os.getenv("AUTH_DEFAULT_ADMIN_DISPLAY_NAME")
            or values.get("AUTH_DEFAULT_ADMIN_DISPLAY_NAME")
            or "Administrator"
        ),
    }


@pytest.fixture(scope="session")
def integration_db_config() -> dict[str, str]:
    config = _load_integration_db_config()
    if config is None:
        pytest.skip("未配置 integration 测试数据库。请提供 TEST_DB_* 环境变量或 infra/postgres/.env.pg-migrate。")
    return config


@pytest.fixture(scope="session")
def integration_admin_connection(integration_db_config: dict[str, str]):
    conn = psycopg2.connect(
        host=integration_db_config["host"],
        port=int(integration_db_config["port"]),
        dbname=integration_db_config["dbname"],
        user=integration_db_config["admin_user"],
        password=integration_db_config["admin_password"],
        connect_timeout=5,
    )
    conn.autocommit = True
    acquire_integration_db_lock(conn, on_wait=lambda message: print(message, flush=True))
    try:
        yield conn
    finally:
        try:
            release_integration_db_lock(conn)
        finally:
            conn.close()


@pytest.fixture(scope="session")
def integration_seed_sql() -> str:
    # 只复用不可变 SQL 文本；每个用例仍重新执行清表和插入。
    return SEED_SQL_PATH.read_text(encoding="utf-8")


@pytest.fixture(autouse=True)
def seed_test_database(integration_admin_connection, integration_seed_sql: str):
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(integration_seed_sql)


@pytest.fixture
def integration_app_client(
    monkeypatch: pytest.MonkeyPatch,
    integration_db_config: dict[str, str],
    seed_test_database,
) -> Generator[TestClient, None, None]:
    monkeypatch.setenv("DB_HOST", integration_db_config["host"])
    monkeypatch.setenv("DB_PORT", integration_db_config["port"])
    monkeypatch.setenv("DB_NAME", integration_db_config["dbname"])
    monkeypatch.setenv("DB_USER", integration_db_config["user"])
    monkeypatch.setenv("DB_PASSWORD", integration_db_config["password"])
    monkeypatch.setenv("DB_WRITE_USER", integration_db_config["write_user"])
    monkeypatch.setenv("DB_WRITE_PASSWORD", integration_db_config["write_password"])
    monkeypatch.setenv("DB_USER_RW_USER", integration_db_config["user_rw_user"])
    monkeypatch.setenv("DB_USER_RW_PASSWORD", integration_db_config["user_rw_password"])
    monkeypatch.setenv("DB_CONNECT_TIMEOUT_SECONDS", "5")
    monkeypatch.setenv("DB_STATEMENT_TIMEOUT_MS", "10000")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "false")
    auth_config = _load_integration_auth_config()
    monkeypatch.setenv("AUTH_DEFAULT_ADMIN_USERNAME", auth_config["username"])
    monkeypatch.setenv("AUTH_DEFAULT_ADMIN_PASSWORD", auth_config["password"])
    monkeypatch.setenv("AUTH_DEFAULT_ADMIN_DISPLAY_NAME", auth_config["display_name"])
    with TestClient(app) as client:
        yield client


@pytest.fixture(scope="session")
def integration_user_rows() -> tuple[tuple[str, str, str, str], ...]:
    # 固定 fixture 密码按进程计算一次，不替换应用的哈希或登录校验。
    return tuple(
        (normalize_username(username), hash_password(password), display_name, role)
        for username, password, display_name, role in (
            ("editor_tester", "editor-test-pass", "Editor Tester", "editor"),
            ("viewer_tester", "viewer-test-pass", "Viewer Tester", "viewer"),
            ("viewer_a_tester", "viewer-a-test-pass", "Viewer A Tester", "viewer"),
        )
    )


@pytest.fixture
def seed_test_users(integration_app_client, integration_admin_connection, integration_user_rows):
    """Reinsert users per API test, after lifespan creates the default admin."""
    now_utc = datetime.now(UTC)
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        execute_values(
            cursor,
            """
            INSERT INTO app_users (username, password_hash, display_name, role, is_active, created_at, updated_at)
            VALUES %s
            ON CONFLICT (username) DO NOTHING
            """,
            [(*row, True, now_utc, now_utc) for row in integration_user_rows],
        )


@pytest.fixture
def integration_test_client(integration_app_client: TestClient, seed_test_users) -> TestClient:
    # API 用例按需初始化用户；纯 SQL 用例不会创建客户端或用户。
    return integration_app_client
