from typing import Any


def build_performance_group_ref(group_id: Any, group_title: Any) -> dict[str, Any] | None:
    """Normalize the nullable performance group relation shared by all Live response paths."""
    if group_id is None:
        return None
    return {
        "group_id": int(group_id),
        "group_title": str(group_title),
    }


def build_performance_group_ref_from_row(
    row: tuple[Any, ...],
    *,
    group_id_index: int,
    group_title_index: int,
) -> dict[str, Any] | None:
    """Read a nullable performance group reference from a query row with the declared projection."""
    return build_performance_group_ref(row[group_id_index], row[group_title_index])
