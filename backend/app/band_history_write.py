from dataclasses import dataclass
from typing import Any, Literal, Sequence

from fastapi import HTTPException

from app.schemas.console import (
    ConsoleLiveBandLineupContextRequest,
    ConsoleLiveBandPerformanceRequest,
)


@dataclass(frozen=True)
class PersistedLineupContext:
    band_id: int
    band_name_version_id: int
    band_name: str
    base_lineup_version_id: int
    base_members: tuple[str, ...]
    next_lineup_version_id: int | None
    next_members: tuple[str, ...]


@dataclass(frozen=True)
class PersistedBandPerformance:
    band_id: int
    lineup_usage: Literal["base", "next", "handover"]
    handover_baseline: Literal["base", "next"] | None
    members: tuple[str, ...]
    appearance_roles: dict[str, str]


def _version_members(cur: Any, lineup_version_id: int) -> tuple[str, ...]:
    cur.execute(
        """
        SELECT member_name
        FROM band_lineup_version_members
        WHERE lineup_version_id = %s
        ORDER BY display_order
        """,
        (lineup_version_id,),
    )
    return tuple(str(row[0]) for row in cur.fetchall())


def validate_lineup_contexts(
    cur: Any,
    contexts: Sequence[ConsoleLiveBandLineupContextRequest],
    *,
    live_id: int | None = None,
) -> dict[int, PersistedLineupContext]:
    validated: dict[int, PersistedLineupContext] = {}
    for context in contexts:
        cur.execute(
            """
            SELECT band_id, band_name
            FROM band_name_versions
            WHERE id = %s
            """,
            (context.band_name_version_id,),
        )
        name_row = cur.fetchone()
        if name_row is None:
            raise HTTPException(status_code=404, detail="Band name version not found")
        if int(name_row[0]) != context.band_id:
            raise HTTPException(status_code=400, detail="Band name version belongs to another Band")

        cur.execute(
            """
            SELECT band_id
            FROM band_lineup_versions
            WHERE id = %s
            """,
            (context.base_lineup_version_id,),
        )
        base_row = cur.fetchone()
        if base_row is None:
            raise HTTPException(status_code=404, detail="Base lineup version not found")
        if int(base_row[0]) != context.band_id:
            raise HTTPException(status_code=400, detail="Base lineup version belongs to another Band")

        next_members: tuple[str, ...] = ()
        if context.next_lineup_version_id is not None:
            cur.execute(
                """
                SELECT band_id, predecessor_id
                FROM band_lineup_versions
                WHERE id = %s
                """,
                (context.next_lineup_version_id,),
            )
            next_row = cur.fetchone()
            if next_row is None:
                raise HTTPException(status_code=404, detail="Next lineup version not found")
            if int(next_row[0]) != context.band_id:
                raise HTTPException(status_code=400, detail="Next lineup version belongs to another Band")
            if next_row[1] is None or int(next_row[1]) != context.base_lineup_version_id:
                raise HTTPException(status_code=400, detail="Next lineup version must directly follow base")
            next_members = _version_members(cur, context.next_lineup_version_id)

        validated[context.band_id] = PersistedLineupContext(
            band_id=context.band_id,
            band_name_version_id=context.band_name_version_id,
            band_name=str(name_row[1]),
            base_lineup_version_id=context.base_lineup_version_id,
            base_members=_version_members(cur, context.base_lineup_version_id),
            next_lineup_version_id=context.next_lineup_version_id,
            next_members=next_members,
        )
        if live_id is None:
            continue

        cur.execute(
            """
            SELECT 1
            FROM live_band_lineup_contexts persisted
            WHERE persisted.live_id = %s
              AND persisted.band_id = %s
              AND persisted.band_name_version_id = %s
              AND persisted.base_lineup_version_id = %s
              AND persisted.next_lineup_version_id IS NOT DISTINCT FROM %s
            """,
            (
                live_id,
                context.band_id,
                context.band_name_version_id,
                context.base_lineup_version_id,
                context.next_lineup_version_id,
            ),
        )
        if cur.fetchone() is not None:
            continue

        if context.next_lineup_version_id is not None:
            cur.execute(
                """
                SELECT 1
                FROM band_lineup_versions next_version
                JOIN current_band_versions current
                  ON current.band_id = next_version.band_id
                WHERE next_version.id = %s
                  AND next_version.band_id = %s
                  AND next_version.predecessor_id = %s
                  AND next_version.transition_live_id = %s
                  AND current.band_name_version_id = %s
                """,
                (
                    context.next_lineup_version_id,
                    context.band_id,
                    context.base_lineup_version_id,
                    live_id,
                    context.band_name_version_id,
                ),
            )
            if cur.fetchone() is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Band {context.band_id} can use next/handover only on its bound transition Live",
                )
            continue

        cur.execute(
            """
            SELECT 1
            FROM current_band_versions current
            WHERE current.band_id = %s
              AND current.band_name_version_id = %s
              AND current.lineup_version_id = %s
            """,
            (
                context.band_id,
                context.band_name_version_id,
                context.base_lineup_version_id,
            ),
        )
        if cur.fetchone() is None:
            raise HTTPException(
                status_code=400,
                detail=f"New Setlist rows must use the current lineup for Band {context.band_id}",
            )
    return validated


def load_lineup_contexts(cur: Any, live_id: int) -> dict[int, PersistedLineupContext]:
    cur.execute(
        """
        SELECT
            context.band_id,
            context.band_name_version_id,
            name_version.band_name,
            context.base_lineup_version_id,
            context.next_lineup_version_id
        FROM live_band_lineup_contexts context
        JOIN band_name_versions name_version ON name_version.id = context.band_name_version_id
        WHERE context.live_id = %s
        ORDER BY context.band_id
        """,
        (live_id,),
    )
    contexts: dict[int, PersistedLineupContext] = {}
    for band_id, name_version_id, band_name, base_version_id, next_version_id in cur.fetchall():
        contexts[int(band_id)] = PersistedLineupContext(
            band_id=int(band_id),
            band_name_version_id=int(name_version_id),
            band_name=str(band_name),
            base_lineup_version_id=int(base_version_id),
            base_members=_version_members(cur, int(base_version_id)),
            next_lineup_version_id=int(next_version_id) if next_version_id is not None else None,
            next_members=_version_members(cur, int(next_version_id)) if next_version_id is not None else (),
        )
    return contexts


def replace_lineup_contexts(
    cur: Any,
    live_id: int,
    contexts: dict[int, PersistedLineupContext],
) -> None:
    cur.execute("DELETE FROM live_band_lineup_contexts WHERE live_id = %s", (live_id,))
    for context in contexts.values():
        cur.execute(
            """
            INSERT INTO live_band_lineup_contexts (
                live_id,
                band_id,
                band_name_version_id,
                base_lineup_version_id,
                next_lineup_version_id
            )
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                live_id,
                context.band_id,
                context.band_name_version_id,
                context.base_lineup_version_id,
                context.next_lineup_version_id,
            ),
        )


def build_band_performances(
    performances: Sequence[ConsoleLiveBandPerformanceRequest],
    contexts: dict[int, PersistedLineupContext],
) -> list[PersistedBandPerformance]:
    persisted: list[PersistedBandPerformance] = []
    for performance in performances:
        context = contexts.get(performance.band_id)
        if context is None:
            raise HTTPException(
                status_code=400,
                detail=f"Band {performance.band_id} is missing from band_lineup_contexts",
            )
        if performance.lineup_usage in {"next", "handover"} and context.next_lineup_version_id is None:
            raise HTTPException(
                status_code=400,
                detail=f"Band {performance.band_id} has no next lineup version",
            )

        baseline = performance.handover_baseline
        if performance.lineup_usage == "base":
            expected_members = context.base_members
        elif performance.lineup_usage == "next":
            expected_members = context.next_members
        else:
            expected_members = context.next_members if baseline == "next" else context.base_members

        expected_set = set(expected_members)
        base_set = set(context.base_members)
        next_set = set(context.next_members)
        incoming = next_set - base_set
        outgoing = base_set - next_set
        appearance_roles: dict[str, str] = {}
        for member in performance.members:
            if member in expected_set:
                continue
            if member in incoming:
                appearance_roles[member] = "incoming"
            elif member in outgoing:
                appearance_roles[member] = "former"
            else:
                appearance_roles[member] = "guest"

        persisted.append(
            PersistedBandPerformance(
                band_id=performance.band_id,
                lineup_usage=performance.lineup_usage,
                handover_baseline=baseline,
                members=tuple(performance.members),
                appearance_roles=appearance_roles,
            )
        )
    return persisted


def persist_band_performances(
    cur: Any,
    *,
    setlist_id: str,
    live_id: int,
    performances: Sequence[PersistedBandPerformance],
) -> None:
    for performance in performances:
        cur.execute(
            """
            INSERT INTO live_setlist_band_performances (
                setlist_id, live_id, band_id, lineup_usage, handover_baseline
            )
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                setlist_id,
                live_id,
                performance.band_id,
                performance.lineup_usage,
                performance.handover_baseline,
            ),
        )
        cur.executemany(
            """
            INSERT INTO live_setlist_band_performance_members (
                setlist_id, band_id, member_name, display_order, appearance_role
            )
            VALUES (%s, %s, %s, %s, %s)
            """,
            [
                (
                    setlist_id,
                    performance.band_id,
                    member,
                    display_order,
                    performance.appearance_roles.get(member),
                )
                for display_order, member in enumerate(performance.members, start=1)
            ],
        )
