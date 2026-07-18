from typing import Any


def build_tour_ref(tour_id: Any, tour_title: Any) -> dict[str, Any] | None:
    """Normalize the nullable tour relation shared by all Live response paths."""
    if tour_id is None:
        return None
    return {
        "tour_id": int(tour_id),
        "tour_title": str(tour_title),
    }


def build_tour_ref_from_row(
    row: tuple[Any, ...],
    *,
    tour_id_index: int,
    tour_title_index: int,
) -> dict[str, Any] | None:
    """Read a nullable tour reference while remaining compatible with legacy mocked row fixtures."""
    if len(row) <= max(tour_id_index, tour_title_index):
        return None
    return build_tour_ref(row[tour_id_index], row[tour_title_index])
