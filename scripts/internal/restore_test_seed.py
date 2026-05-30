import os
import sys
from pathlib import Path

import psycopg2
from dotenv import dotenv_values


ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
PG_MIGRATE_ENV_PATH = ROOT / "infra" / "postgres" / ".env.pg-migrate"
AUTH_ENV_PATH = ROOT / "infra" / "auth" / ".env.auth"
SEED_SQL_PATH = ROOT / "backend" / "db" / "postgres" / "seed" / "base_seed.sql"


def _env_value(values: dict[str, object], name: str, default: str = "") -> str:
    return str(values.get(name) or default)


def _restore_seed(pg_values: dict[str, object]) -> None:
    seed_sql = SEED_SQL_PATH.read_text(encoding="utf-8")
    conn = psycopg2.connect(
        host=_env_value(pg_values, "POSTGRES_HOST", "localhost"),
        port=int(_env_value(pg_values, "POSTGRES_PORT", "15432")),
        dbname=_env_value(pg_values, "TEST_DB_NAME", "live_statistic_test"),
        user=_env_value(pg_values, "TEST_DB_ADMIN_USER") or _env_value(pg_values, "TEST_ADMIN_USER", "live_project_test_admin"),
        password=(
            _env_value(pg_values, "TEST_DB_ADMIN_PASSWORD")
            or _env_value(pg_values, "TEST_ADMIN_PASSWORD")
            or _env_value(pg_values, "POSTGRES_PASSWORD")
        ),
        connect_timeout=5,
    )
    try:
        conn.autocommit = True
        with conn.cursor() as cursor:
            cursor.execute(seed_sql)
    finally:
        conn.close()


def _configure_backend_env(pg_values: dict[str, object], auth_values: dict[str, object]) -> None:
    os.environ["DB_HOST"] = _env_value(pg_values, "POSTGRES_HOST", "localhost")
    os.environ["DB_PORT"] = _env_value(pg_values, "POSTGRES_PORT", "15432")
    os.environ["DB_NAME"] = _env_value(pg_values, "TEST_DB_NAME", "live_statistic_test")
    os.environ["DB_WRITE_USER"] = _env_value(pg_values, "APP_SUPER_USER", "live_project_super_ro")
    os.environ["DB_WRITE_PASSWORD"] = _env_value(pg_values, "APP_SUPER_PASSWORD") or _env_value(pg_values, "POSTGRES_PASSWORD")
    os.environ["DB_CONNECT_TIMEOUT_SECONDS"] = "5"
    os.environ["DB_STATEMENT_TIMEOUT_MS"] = "10000"

    for key in (
        "AUTH_DEFAULT_ADMIN_ENABLED",
        "AUTH_DEFAULT_ADMIN_USERNAME",
        "AUTH_DEFAULT_ADMIN_PASSWORD",
        "AUTH_DEFAULT_ADMIN_DISPLAY_NAME",
    ):
        value = auth_values.get(key)
        if value is not None:
            os.environ[key] = str(value)


def _ensure_default_admin() -> None:
    sys.path.insert(0, str(BACKEND_DIR))
    from app.auth import ensure_default_admin_user

    ensure_default_admin_user()


def main() -> int:
    if not PG_MIGRATE_ENV_PATH.exists():
        print(f"未找到 PostgreSQL env 文件：{PG_MIGRATE_ENV_PATH}", flush=True)
        return 1
    if not SEED_SQL_PATH.exists():
        print(f"未找到 seed 文件：{SEED_SQL_PATH}", flush=True)
        return 1

    pg_values = dotenv_values(PG_MIGRATE_ENV_PATH)
    auth_values = dotenv_values(AUTH_ENV_PATH) if AUTH_ENV_PATH.exists() else {}

    _restore_seed(pg_values)
    _configure_backend_env(pg_values, auth_values)
    _ensure_default_admin()
    print("测试库 seed 已还原，并已按 infra/auth/.env.auth 确保默认 admin。", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
