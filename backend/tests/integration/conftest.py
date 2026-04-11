import os
from collections.abc import Generator
from pathlib import Path

import psycopg2
import pytest
from dotenv import dotenv_values
from fastapi.testclient import TestClient

os.environ.setdefault("APP_LOG_LEVEL", "CRITICAL")

from app.main import app


ROOT_DIR = Path(__file__).resolve().parents[3]
SEED_SQL_PATH = ROOT_DIR / "backend" / "db" / "postgres" / "seed" / "base_seed.sql"
PG_MIGRATE_ENV_PATH = ROOT_DIR / "infra" / "postgres" / ".env.pg-migrate"


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
    try:
        yield conn
    finally:
        conn.close()


@pytest.fixture(autouse=True)
def seed_test_database(integration_admin_connection):
    sql_text = SEED_SQL_PATH.read_text(encoding="utf-8")
    integration_admin_connection.autocommit = True
    with integration_admin_connection.cursor() as cursor:
        cursor.execute(sql_text)


@pytest.fixture
def integration_test_client(
    monkeypatch: pytest.MonkeyPatch,
    integration_db_config: dict[str, str],
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
    monkeypatch.setenv("AUTH_DEFAULT_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("AUTH_DEFAULT_ADMIN_PASSWORD", "test-admin-pass")
    monkeypatch.setenv("AUTH_DEFAULT_ADMIN_DISPLAY_NAME", "Administrator")
    with TestClient(app) as client:
        yield client
