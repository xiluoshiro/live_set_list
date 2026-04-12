from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal
from typing import Any


FavoriteBatchAction = Literal["favorite", "unfavorite"]


@dataclass(frozen=True)
class FavoriteBatchResult:
    action: FavoriteBatchAction
    requested_count: int
    applied_live_ids: list[int]
    noop_live_ids: list[int]
    not_found_live_ids: list[int]


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


def get_existing_live_id_set(cur: Any, live_ids: Sequence[int]) -> set[int]:
    if not live_ids:
        return set()

    cur.execute(
        """
        SELECT id
        FROM live_attrs
        WHERE id = ANY(%s)
        """,
        (list(live_ids),),
    )
    return {int(row[0]) for row in cur.fetchall() if row and isinstance(row[0], int)}


def apply_favorites_batch(
    cur: Any,
    *,
    user_id: int,
    action: FavoriteBatchAction,
    live_ids: Sequence[int],
) -> FavoriteBatchResult:
    deduped_live_ids = list(dict.fromkeys(int(live_id) for live_id in live_ids))
    if not deduped_live_ids:
        return FavoriteBatchResult(
            action=action,
            requested_count=0,
            applied_live_ids=[],
            noop_live_ids=[],
            not_found_live_ids=[],
        )

    existing_live_id_set = get_existing_live_id_set(cur, deduped_live_ids)
    existing_live_ids = [live_id for live_id in deduped_live_ids if live_id in existing_live_id_set]
    not_found_live_ids = [live_id for live_id in deduped_live_ids if live_id not in existing_live_id_set]
    if not existing_live_ids:
        return FavoriteBatchResult(
            action=action,
            requested_count=len(deduped_live_ids),
            applied_live_ids=[],
            noop_live_ids=[],
            not_found_live_ids=not_found_live_ids,
        )

    favorite_live_id_set = get_favorite_live_id_set(cur, user_id, existing_live_ids)
    if action == "favorite":
        target_live_ids = [live_id for live_id in existing_live_ids if live_id not in favorite_live_id_set]
        if target_live_ids:
            cur.execute(
                """
                INSERT INTO user_live_favorites (user_id, live_id, source)
                SELECT %s, x.live_id, 'manual'
                FROM unnest(%s::int[]) AS x(live_id)
                ON CONFLICT (user_id, live_id) DO NOTHING
                RETURNING live_id
                """,
                (user_id, target_live_ids),
            )
            applied_set = {int(row[0]) for row in cur.fetchall() if row and isinstance(row[0], int)}
        else:
            applied_set = set()
    else:
        cur.execute(
            """
            DELETE FROM user_live_favorites
            WHERE user_id = %s
                AND live_id = ANY(%s)
            RETURNING live_id
            """,
            (user_id, existing_live_ids),
        )
        applied_set = {int(row[0]) for row in cur.fetchall() if row and isinstance(row[0], int)}

    applied_live_ids = [live_id for live_id in existing_live_ids if live_id in applied_set]
    noop_live_ids = [live_id for live_id in existing_live_ids if live_id not in applied_set]

    return FavoriteBatchResult(
        action=action,
        requested_count=len(deduped_live_ids),
        applied_live_ids=applied_live_ids,
        noop_live_ids=noop_live_ids,
        not_found_live_ids=not_found_live_ids,
    )
