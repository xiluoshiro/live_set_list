import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.band_history_backfill import (  # noqa: E402
    apply_legacy_band_history_backfill,
    inspect_legacy_band_history_backfill,
)
from app.db import get_db_connection, get_write_db_connection  # noqa: E402


APPLY_CONFIRMATION = "APPLY_LEGACY_BAND_HISTORY_BACKFILL"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="预检或回填旧 live_setlist.band_member 到历史 Band 关系表。"
    )
    parser.add_argument("action", choices=["preflight", "apply"])
    parser.add_argument("--confirm", default="", help=f"apply 必须输入 {APPLY_CONFIRMATION}")
    parser.add_argument("--audit-user-id", type=int, default=None)
    return parser.parse_args(argv)


def _target_label() -> dict[str, Any]:
    return {
        "host": os.getenv("DB_HOST") or os.getenv("POSTGRES_HOST") or "localhost",
        "port": int(os.getenv("DB_PORT") or os.getenv("POSTGRES_PORT") or "5432"),
        "database": os.getenv("DB_NAME") or os.getenv("APP_DB") or "live_statistic",
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    print(json.dumps({"target": _target_label(), "action": args.action}, ensure_ascii=False))
    if args.action == "preflight":
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                summary = inspect_legacy_band_history_backfill(cur).summary
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0 if bool(summary["ready"]) else 2

    if args.confirm != APPLY_CONFIRMATION:
        print(f"拒绝执行：apply 必须提供 --confirm {APPLY_CONFIRMATION}")
        return 2
    with get_write_db_connection() as conn:
        with conn.cursor() as cur:
            summary = apply_legacy_band_history_backfill(
                cur,
                audit_user_id=args.audit_user_id,
            )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
