from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any


INTEGRATION_DB_ADVISORY_LOCK_KEY = (2026, 81001)
INTEGRATION_DB_LOCK_TIMEOUT_SECONDS = 300.0
INTEGRATION_DB_LOCK_POLL_SECONDS = 0.25


def acquire_integration_db_lock(
    conn: Any,
    *,
    timeout_seconds: float = INTEGRATION_DB_LOCK_TIMEOUT_SECONDS,
    poll_seconds: float = INTEGRATION_DB_LOCK_POLL_SECONDS,
    on_wait: Callable[[str], None] | None = None,
) -> None:
    """Serialize destructive integration-test seed work on the shared test database."""
    deadline = time.monotonic() + timeout_seconds
    wait_reported = False

    while True:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT pg_try_advisory_lock(%s, %s)",
                INTEGRATION_DB_ADVISORY_LOCK_KEY,
            )
            row = cursor.fetchone()
        if row is not None and bool(row[0]):
            return

        if not wait_reported and on_wait is not None:
            on_wait("检测到另一轮 integration/seed 正在使用测试库，等待独占锁释放……")
            wait_reported = True

        if time.monotonic() >= deadline:
            raise TimeoutError(
                f"等待测试数据库独占锁超时（{timeout_seconds:g} 秒）；"
                "可能仍有另一轮 pytest/run_checks 在运行。"
            )
        time.sleep(poll_seconds)


def release_integration_db_lock(conn: Any) -> bool:
    with conn.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_unlock(%s, %s)",
            INTEGRATION_DB_ADVISORY_LOCK_KEY,
        )
        row = cursor.fetchone()
    return row is not None and bool(row[0])
