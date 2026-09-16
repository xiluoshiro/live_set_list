from datetime import date
from typing import Literal

from pydantic import BaseModel


GeographyQualityCategory = Literal[
    "missing_locality",
    "missing_address",
    "missing_coordinates",
    "missing_timezone",
    "missing_coordinate_basis",
    "zero_coordinates",
    "stale_map_link",
    "timezone_review",
]


class GeographyQualityItem(BaseModel):
    category: GeographyQualityCategory
    subject_type: Literal["venue", "live"]
    subject_id: int
    venue_id: int | None
    venue_name: str | None
    venue_kind: str | None
    locality_label: str | None
    live_date: date | None
    live_title: str | None
    detail: str


class GeographyQualityPage(BaseModel):
    items: list[GeographyQualityItem]
    counts: dict[str, int]
    total: int
    page: int
    page_size: int
    total_pages: int

