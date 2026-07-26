from dataclasses import dataclass
from typing import Literal, Mapping, Sequence, cast


AttendanceStatus = Literal["full", "full_plus", "partial", "unknown"]
LineupUsage = Literal["base", "next", "handover"]
AppearanceCategory = Literal["former", "incoming", "guest", "support"]


@dataclass(frozen=True)
class ExtraAppearance:
    member_name: str
    category: AppearanceCategory


@dataclass(frozen=True)
class AttendanceResult:
    attendance_status: AttendanceStatus
    expected_count: int
    present_count: int
    present_members: tuple[str, ...]
    missing_members: tuple[str, ...]
    extra_members: tuple[ExtraAppearance, ...]


@dataclass(frozen=True)
class LineupSuggestion:
    lineup_usage: LineupUsage | None
    requires_confirmation: bool


def _unique_members(members: Sequence[str]) -> tuple[str, ...]:
    """Preserve display order while removing duplicate member names."""
    return tuple(dict.fromkeys(member.strip() for member in members if member.strip()))


def calculate_attendance(
    *,
    expected_members: Sequence[str] | None,
    present_members: Sequence[str],
    incoming_members: Sequence[str] = (),
    outgoing_members: Sequence[str] = (),
    appearance_roles: Mapping[str, AppearanceCategory] | None = None,
) -> AttendanceResult:
    """Compare immutable expected and actual member sets without count-based shortcuts."""
    present = _unique_members(present_members)
    if expected_members is None:
        return AttendanceResult(
            attendance_status="unknown",
            expected_count=0,
            present_count=len(present),
            present_members=present,
            missing_members=(),
            extra_members=(),
        )

    expected = _unique_members(expected_members)
    expected_set = set(expected)
    present_set = set(present)
    incoming_set = set(_unique_members(incoming_members))
    outgoing_set = set(_unique_members(outgoing_members))
    missing = tuple(member for member in expected if member not in present_set)
    roles = appearance_roles or {}
    extras: list[ExtraAppearance] = []
    for member in present:
        if member in expected_set:
            continue
        if member in incoming_set:
            category: AppearanceCategory = "incoming"
        elif member in outgoing_set:
            category = "former"
        else:
            category = roles.get(member, "guest")
        extras.append(ExtraAppearance(member_name=member, category=category))

    if missing:
        status: AttendanceStatus = "partial"
    elif extras:
        status = "full_plus"
    else:
        status = "full"
    return AttendanceResult(
        attendance_status=status,
        expected_count=len(expected),
        present_count=len(present),
        present_members=present,
        missing_members=missing,
        extra_members=tuple(extras),
    )


def suggest_lineup_usage(
    *,
    base_members: Sequence[str],
    next_members: Sequence[str] | None,
    present_members: Sequence[str],
) -> LineupSuggestion:
    """Suggest, but never silently persist, a per-song lineup mode."""
    present = set(_unique_members(present_members))
    base = set(_unique_members(base_members))
    if next_members is None:
        return LineupSuggestion(lineup_usage="base", requires_confirmation=present != base)

    next_lineup = set(_unique_members(next_members))
    incoming = next_lineup - base
    if present == base:
        return LineupSuggestion(lineup_usage="base", requires_confirmation=False)
    if present == next_lineup:
        return LineupSuggestion(lineup_usage="next", requires_confirmation=False)
    if base.issubset(present) and bool(present & incoming):
        return LineupSuggestion(lineup_usage="handover", requires_confirmation=False)

    candidates: dict[LineupUsage, tuple[int, bool]] = {
        "base": (len(base.symmetric_difference(present)), bool(base - present)),
        "next": (len(next_lineup.symmetric_difference(present)), bool(next_lineup - present)),
    }
    best_distance = min(distance for distance, _ in candidates.values())
    best = [usage for usage, (distance, _) in candidates.items() if distance == best_distance]
    if len(best) != 1:
        return LineupSuggestion(lineup_usage=None, requires_confirmation=True)
    usage = cast(LineupUsage, best[0])
    return LineupSuggestion(
        lineup_usage=usage,
        requires_confirmation=candidates[usage][1],
    )
