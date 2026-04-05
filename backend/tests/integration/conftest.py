import os
from pathlib import Path

import psycopg2
import pytest
from dotenv import dotenv_values
from fastapi.testclient import TestClient

from app.main import app


ROOT_DIR = Path(__file__).resolve().parents[3]
SEED_SQL_PATH = ROOT_DIR / "backend" / "db" / "postgres" / "seed" / "base_seed.sql"
PG_MIGRATE_ENV_PATH = ROOT_DIR / ".env.pg-migrate"


def _load_integration_db_config() -> dict[str, str] | None:
    if os.getenv("TEST_DB_PASSWORD"):
        user = os.getenv("TEST_DB_USER", "live_project_flyway")
        password = os.getenv("TEST_DB_PASSWORD", "")
        return {
            "host": os.getenv("TEST_DB_HOST", "localhost"),
            "port": os.getenv("TEST_DB_PORT", "15432"),
            "dbname": os.getenv("TEST_DB_NAME", "live_statistic_test"),
            "user": user,
            "password": password,
            "admin_user": os.getenv("TEST_DB_ADMIN_USER", user),
            "admin_password": os.getenv("TEST_DB_ADMIN_PASSWORD", password),
        }

    if not PG_MIGRATE_ENV_PATH.exists():
        return None

    values = dotenv_values(PG_MIGRATE_ENV_PATH)
    raw_password = values.get("FLYWAY_PASSWORD")
    raw_user = values.get("FLYWAY_USER")
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
        "admin_user": str(values.get("TEST_DB_ADMIN_USER", user)),
        "admin_password": str(values.get("TEST_DB_ADMIN_PASSWORD", password)),
    }


@pytest.fixture(scope="session")
def integration_db_config() -> dict[str, str]:
    config = _load_integration_db_config()
    if config is None:
        pytest.skip("未配置 integration 测试数据库。请提供 TEST_DB_* 环境变量或 .env.pg-migrate。")
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
) -> TestClient:
    monkeypatch.setenv("DB_HOST", integration_db_config["host"])
    monkeypatch.setenv("DB_PORT", integration_db_config["port"])
    monkeypatch.setenv("DB_NAME", integration_db_config["dbname"])
    monkeypatch.setenv("DB_USER", integration_db_config["user"])
    monkeypatch.setenv("DB_PASSWORD", integration_db_config["password"])
    monkeypatch.setenv("DB_CONNECT_TIMEOUT_SECONDS", "5")
    monkeypatch.setenv("DB_STATEMENT_TIMEOUT_MS", "10000")
    return TestClient(app)
