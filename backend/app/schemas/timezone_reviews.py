from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


TimezoneReviewStatus = Literal[
    "needs_review",
    "retained",
    "revision_only",
    "current",
    "unaffected",
    "legacy_exception",
]


class TimezoneReviewItem(BaseModel):
    live_id: int
    live_date: date
    live_title: str
    venue_id: int | None
    venue_name: str | None
    timezone_source: Literal["venue", "locality", "explicit", "legacy_offset"]
    snapshot_timezone_id: str | None
    snapshot_source_revision: int | None
    current_timezone_id: str | None
    current_source_revision: int | None
    status: TimezoneReviewStatus
    opening_time: str | None
    start_time: str | None
    current_opening_time: str | None
    current_start_time: str | None
    snapshot_offset_minutes: int
    current_offset_minutes: int | None
    preview_error: str | None = None
    retained_reason: str | None = None
    retained_at: datetime | None = None


class TimezoneReviewPage(BaseModel):
    items: list[TimezoneReviewItem]
    page: int
    page_size: int
    total: int
    total_pages: int
    counts: dict[str, int]


class TimezoneReviewDecisionBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_snapshot_timezone_id: str
    expected_snapshot_source_revision: int | None = Field(default=None, ge=1)
    expected_current_timezone_id: str
    expected_current_source_revision: int = Field(..., ge=1)


class TimezoneReviewRetainRequest(TimezoneReviewDecisionBase):
    reason: str = Field(..., min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("reason must not be blank")
        return normalized


class TimezoneReviewApplyRequest(TimezoneReviewDecisionBase):
    opening_time_fold: Literal[0, 1] | None = None
    start_time_fold: Literal[0, 1] | None = None


class TimezoneReviewMutationResponse(BaseModel):
    item: TimezoneReviewItem
