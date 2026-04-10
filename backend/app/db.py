import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[2]
PG_MIGRATE_ENV_PATH = ROOT_DIR / "infra" / "postgres" / ".env.pg-migrate"

if PG_MIGRATE_ENV_PATH.exists():
    load_dotenv(PG_MIGRATE_ENV_PATH, override=False)


def _get_db_setting(name: str, fallback_name: str, default: str) -> str:
    return os.getenv(name) or os.getenv(fallback_name) or default


def _build_connection(*, user: str, password: str):
    connect_timeout_seconds = int(os.getenv("DB_CONNECT_TIMEOUT_SECONDS", "5"))
    statement_timeout_ms = int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "10000"))
    return psycopg2.connect(
        host=_get_db_setting("DB_HOST", "POSTGRES_HOST", "localhost"),
        port=int(_get_db_setting("DB_PORT", "POSTGRES_PORT", "5432")),
        dbname=_get_db_setting("DB_NAME", "APP_DB", "live_statistic"),
        user=user,
        password=password,
        connect_timeout=connect_timeout_seconds,
        options=f"-c statement_timeout={statement_timeout_ms}",
    )


def get_db_connection():
    return _build_connection(
        user=_get_db_setting("DB_USER", "APP_RO_USER", "live_project_ro"),
        password=_get_db_setting("DB_PASSWORD", "APP_RO_PASSWORD", ""),
    )


def get_write_db_connection():
    return _build_connection(
        user=_get_db_setting("DB_WRITE_USER", "APP_SUPER_USER", "live_project_super_ro"),
        password=_get_db_setting("DB_WRITE_PASSWORD", "APP_SUPER_PASSWORD", ""),
    )
