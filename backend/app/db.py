import os

import psycopg2
from dotenv import load_dotenv

load_dotenv()


def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.getenv("DB_NAME", "live_statistic"),
        user=os.getenv("DB_USER", "live_project_ro"),
        password=os.getenv("DB_PASSWORD", ""),
    )
