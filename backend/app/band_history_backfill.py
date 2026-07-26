from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from psycopg2.extras import Json


@dataclass(frozen=True)
class LegacyBandPerformancePlan:
    setlist_id: str
    live_id: int
    band_id: int
    name_version_id: int
    lineup_version_id: int
    members: tuple[str, ...]


@dataclass(frozen=True)
class LegacyBandHistoryBackfillInspection:
    summary: dict[str, Any]
    performances: tuple[LegacyBandPerformancePlan, ...]


def _normalize_legacy_members(raw: Any) -> tuple[str, ...] | None:
    if isinstance(raw, str):
        values: Sequence[Any] = [raw]
    elif isinstance(raw, Sequence):
        values = raw
    else:
        return None
    members: list[str] = []
    seen: set[str] = set()
    for value in values:
        member = str(value).strip()
        if not member or member in seen:
            continue
        members.append(member)
        seen.add(member)
    return tuple(members) or None


def inspect_legacy_band_history_backfill(cur: Any) -> LegacyBandHistoryBackfillInspection:
    """Build a read-only, evidence-bounded plan for converting legacy JSON relations."""
    issues: list[dict[str, Any]] = []
    cur.execute(
        """
        SELECT
            (SELECT COUNT(*) FROM live_band_lineup_contexts),
            (SELECT COUNT(*) FROM live_setlist_band_performances),
            (SELECT COUNT(*) FROM live_setlist_band_performance_members)
        """
    )
    target_counts_row = cur.fetchone()
    assert target_counts_row is not None
    if any(int(value) > 0 for value in target_counts_row):
        issues.append(
            {
                "code": "target_relations_not_empty",
                "message": (
                    "History relation tables already contain rows; automatic backfill only runs from an empty target"
                ),
            }
        )

    cur.execute(
        """
        SELECT id, band_id, band_name
        FROM band_name_versions
        ORDER BY band_name, band_id, id
        """
    )
    name_versions: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for version_id, band_id, band_name in cur.fetchall():
        name_versions[str(band_name).strip()].append((int(version_id), int(band_id)))

    cur.execute(
        """
        SELECT
            version.id,
            version.band_id,
            COALESCE(array_agg(member.member_name ORDER BY member.display_order)
                FILTER (WHERE member.member_name IS NOT NULL), ARRAY[]::text[])
        FROM band_lineup_versions version
        LEFT JOIN band_lineup_version_members member
          ON member.lineup_version_id = version.id
        WHERE version.valid_to IS NULL
        GROUP BY version.id
        ORDER BY version.band_id, version.version_no DESC, version.id DESC
        """
    )
    current_lineups: dict[int, list[tuple[int, tuple[str, ...]]]] = defaultdict(list)
    for version_id, band_id, members in cur.fetchall():
        current_lineups[int(band_id)].append(
            (int(version_id), tuple(str(member) for member in (members or [])))
        )

    cur.execute(
        """
        SELECT id::text, live_id, band_member
        FROM live_setlist
        ORDER BY live_id, absolute_order, id
        """
    )
    setlist_rows = cur.fetchall()
    performances: list[LegacyBandPerformancePlan] = []
    mapped_band_ids: set[int] = set()
    live_band_contexts: dict[tuple[int, int], tuple[int, int]] = {}
    for setlist_id_raw, live_id_raw, band_member_raw in setlist_rows:
        setlist_id = str(setlist_id_raw)
        live_id = int(live_id_raw)
        if not isinstance(band_member_raw, Mapping):
            issues.append(
                {
                    "code": "invalid_band_member_object",
                    "message": "band_member is not a JSON object",
                    "live_id": live_id,
                    "setlist_id": setlist_id,
                }
            )
            continue
        normalized_entry_count = 0
        for band_name_raw, members_raw in band_member_raw.items():
            band_name = str(band_name_raw).strip()
            members = _normalize_legacy_members(members_raw)
            if not band_name or members is None:
                issues.append(
                    {
                        "code": "invalid_band_members",
                        "message": "Band name or member list cannot be normalized",
                        "live_id": live_id,
                        "setlist_id": setlist_id,
                        "band_name": band_name or None,
                    }
                )
                continue
            normalized_entry_count += 1
            candidates = name_versions.get(band_name, [])
            if len(candidates) != 1:
                issues.append(
                    {
                        "code": "band_name_not_unique",
                        "message": f"Band name maps to {len(candidates)} history versions",
                        "live_id": live_id,
                        "setlist_id": setlist_id,
                        "band_name": band_name,
                    }
                )
                continue
            name_version_id, band_id = candidates[0]
            if band_id <= 0:
                issues.append(
                    {
                        "code": "not_real_band",
                        "message": "Legacy relation maps to band_id <= 0",
                        "live_id": live_id,
                        "setlist_id": setlist_id,
                        "band_name": band_name,
                    }
                )
                continue
            lineup_candidates = current_lineups.get(band_id, [])
            if len(lineup_candidates) != 1:
                issues.append(
                    {
                        "code": "current_lineup_not_unique",
                        "message": f"Band has {len(lineup_candidates)} open lineup versions",
                        "live_id": live_id,
                        "setlist_id": setlist_id,
                        "band_name": band_name,
                    }
                )
                continue
            lineup_version_id, expected_members = lineup_candidates[0]
            unexpected_members = [member for member in members if member not in set(expected_members)]
            if unexpected_members:
                issues.append(
                    {
                        "code": "member_not_in_current_lineup",
                        "message": f"Members are not explained by the open lineup: {unexpected_members}",
                        "live_id": live_id,
                        "setlist_id": setlist_id,
                        "band_name": band_name,
                    }
                )
                continue
            context_key = (live_id, band_id)
            context_value = (name_version_id, lineup_version_id)
            previous_context = live_band_contexts.get(context_key)
            if previous_context is not None and previous_context != context_value:
                issues.append(
                    {
                        "code": "live_band_context_ambiguous",
                        "message": "One Live/Band resolves to different name or lineup versions",
                        "live_id": live_id,
                        "setlist_id": setlist_id,
                        "band_name": band_name,
                    }
                )
                continue
            live_band_contexts[context_key] = context_value
            mapped_band_ids.add(band_id)
            performances.append(
                LegacyBandPerformancePlan(
                    setlist_id=setlist_id,
                    live_id=live_id,
                    band_id=band_id,
                    name_version_id=name_version_id,
                    lineup_version_id=lineup_version_id,
                    members=members,
                )
            )
        if normalized_entry_count == 0:
            issues.append(
                {
                    "code": "setlist_without_band",
                    "message": "Setlist row has no normalizable Band relation",
                    "live_id": live_id,
                    "setlist_id": setlist_id,
                }
            )

    summary = {
        "ready": not issues,
        "setlist_row_count": len(setlist_rows),
        "performance_count": len(performances),
        "member_count": sum(len(item.members) for item in performances),
        "live_band_context_count": len(live_band_contexts),
        "mapped_band_ids": sorted(mapped_band_ids),
        "issues": issues,
    }
    return LegacyBandHistoryBackfillInspection(
        summary=summary,
        performances=tuple(performances),
    )


def apply_legacy_band_history_backfill(
    cur: Any,
    *,
    audit_user_id: int | None,
) -> dict[str, Any]:
    """Atomically materialize a successful preflight plan and record its counts."""
    cur.execute("LOCK TABLE live_setlist IN SHARE MODE")
    inspection = inspect_legacy_band_history_backfill(cur)
    if not bool(inspection.summary["ready"]):
        raise ValueError("Band history backfill preflight failed")

    contexts: dict[tuple[int, int], LegacyBandPerformancePlan] = {}
    for performance in inspection.performances:
        contexts[(performance.live_id, performance.band_id)] = performance
    cur.executemany(
        """
        INSERT INTO live_band_lineup_contexts (
            live_id,
            band_id,
            band_name_version_id,
            base_lineup_version_id,
            next_lineup_version_id
        )
        VALUES (%s, %s, %s, %s, NULL)
        """,
        [
            (
                item.live_id,
                item.band_id,
                item.name_version_id,
                item.lineup_version_id,
            )
            for item in contexts.values()
        ],
    )
    cur.executemany(
        """
        INSERT INTO live_setlist_band_performances (
            setlist_id, live_id, band_id, lineup_usage
        )
        VALUES (%s::uuid, %s, %s, 'base')
        """,
        [
            (item.setlist_id, item.live_id, item.band_id)
            for item in inspection.performances
        ],
    )
    member_rows = [
        (item.setlist_id, item.band_id, member, display_order)
        for item in inspection.performances
        for display_order, member in enumerate(item.members, start=1)
    ]
    cur.executemany(
        """
        INSERT INTO live_setlist_band_performance_members (
            setlist_id, band_id, member_name, display_order, appearance_role
        )
        VALUES (%s::uuid, %s, %s, %s, NULL)
        """,
        member_rows,
    )
    cur.execute(
        """
        INSERT INTO audit_logs (
            user_id, action, resource_type, resource_id, payload_json
        )
        VALUES (%s, 'band_history_backfill', 'database', NULL, %s)
        """,
        (
            audit_user_id,
            Json(
                {
                    key: value
                    for key, value in inspection.summary.items()
                    if key != "issues"
                }
            ),
        ),
    )
    return inspection.summary
