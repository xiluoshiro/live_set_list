import os

import psycopg2
from dotenv import load_dotenv

load_dotenv()


def get_db_connection():
    connect_timeout_seconds = int(os.getenv("DB_CONNECT_TIMEOUT_SECONDS", "5"))
    statement_timeout_ms = int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "10000"))
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.getenv("DB_NAME", "live_statistic"),
        user=os.getenv("DB_USER", "live_project_ro"),
        password=os.getenv("DB_PASSWORD", ""),
        connect_timeout=connect_timeout_seconds,
        options=f"-c statement_timeout={statement_timeout_ms}",
    )
