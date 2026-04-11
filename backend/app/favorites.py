from collections.abc import Sequence
from typing import Any


def get_favorite_live_ids(cur: Any, user_id: int) -> list[int]:
    cur.execute(
        """
        SELECT live_id
        FROM user_live_favorites
        WHERE user_id = %s
        ORDER BY live_id
        """,
        (user_id,),
    )
    return [int(row[0]) for row in cur.fetchall() if row and isinstance(row[0], int)]


def get_favorite_live_id_set(cur: Any, user_id: int, live_ids: Sequence[int]) -> set[int]:
    if not live_ids:
        return set()

    cur.execute(
        """
        SELECT live_id
        FROM user_live_favorites
        WHERE user_id = %s
            AND live_id = ANY(%s)
        """,
        (user_id, list(live_ids)),
    )
    return {int(row[0]) for row in cur.fetchall() if row and isinstance(row[0], int)}


def is_live_favorite(cur: Any, user_id: int, live_id: int) -> bool:
    cur.execute(
        """
        SELECT EXISTS(
            SELECT 1
            FROM user_live_favorites
            WHERE user_id = %s
                AND live_id = %s
        )
        """,
        (user_id, live_id),
    )
    row = cur.fetchone()
    return bool(row[0]) if row else False


def live_exists(cur: Any, live_id: int) -> bool:
    cur.execute("SELECT EXISTS(SELECT 1 FROM live_attrs WHERE id = %s)", (live_id,))
    row = cur.fetchone()
    return bool(row[0]) if row else False
