import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.auth import hash_password, normalize_username  # noqa: E402
from app.db import get_write_db_connection  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create or update the initial admin user.")
    parser.add_argument("--username", required=True, help="Login username. It will be normalized to lowercase.")
    parser.add_argument("--password", required=True, help="Plain text password to hash and store.")
    parser.add_argument("--display-name", default="Administrator", help="Display name shown in the UI.")
    parser.add_argument("--role", default="admin", choices=["viewer", "editor", "admin"], help="User role.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    username = normalize_username(args.username)
    password_hash = hash_password(args.password)
    now = datetime.now(UTC)

    with get_write_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO app_users (
                    username,
                    password_hash,
                    display_name,
                    role,
                    is_active,
                    created_at,
                    updated_at
                )
                VALUES (%s, %s, %s, %s, true, %s, %s)
                ON CONFLICT (username) DO UPDATE
                SET
                    password_hash = EXCLUDED.password_hash,
                    display_name = EXCLUDED.display_name,
                    role = EXCLUDED.role,
                    is_active = true,
                    updated_at = EXCLUDED.updated_at
                RETURNING id
                """,
                (
                    username,
                    password_hash,
                    args.display_name,
                    args.role,
                    now,
                    now,
                ),
            )
            row = cur.fetchone()

    user_id = int(row[0]) if row else -1
    print(f"Bootstrap admin/user success: id={user_id} username={username} role={args.role}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
