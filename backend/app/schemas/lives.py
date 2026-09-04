from datetime import date
from typing import Literal
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.performance_groups import PerformanceGroupRef
from app.schemas.tours import TourRef

MAX_BATCH_LIVE_IDS = 100
EventStatus = Literal["scheduled", "postponed", "cancelled"]
DatePhase = Literal["upcoming", "today", "past"]
AttendanceStatus = Literal["full", "full_plus", "partial", "unknown"]
LineupUsage = Literal["base", "next", "handover"]
AppearanceCategory = Literal["former", "incoming", "guest", "support"]


class LiveItem(BaseModel):
    live_id: int = Field(..., description='Live primary key ID')
    live_date: date = Field(
        ...,
        description='Live date; rendered as a date-formatted string in OpenAPI and JSON responses',
    )
    live_title: str = Field(..., description='Live title')
    live_type: str = Field(..., description='Stable live type code')
    bands: list[int] = Field(..., description='Deduplicated band IDs sorted ascending')
    url: str | None = Field(default=None, description='Live URL from live_attrs.url')
    is_favorite: bool = Field(..., description='Whether the current user has favorited this live')
    tour: TourRef | None = Field(default=None, description='Tour reference when this live belongs to a tour')
    performance_group: PerformanceGroupRef | None = Field(
        default=None, description='Performance group reference when this live belongs to an activity group'
    )
    event_status: EventStatus = Field(..., description="Persisted event status")
    date_phase: DatePhase = Field(..., description="Date phase computed in the Live UTC offset")
    was_rescheduled: bool = Field(..., description="Whether a formal schedule history row exists")


class LiveScheduleHistoryItem(BaseModel):
    previous_live_title: str | None
    previous_live_date: date
    previous_opening_time: str | None
    previous_start_time: str | None
    previous_venue_id: int | None
    previous_venue_name_version_id: int | None = None
    previous_venue: str | None = None
    changed_at: datetime
    note: str | None = None


class LivesPagination(BaseModel):
    page: int = Field(..., description='Current page number')
    page_size: int = Field(..., description='Page size, currently 15 or 20')
    total: int = Field(..., description='Total record count')
    total_pages: int = Field(..., description='Total page count')


class LivesResponse(BaseModel):
    items: list[LiveItem] = Field(..., description='Live items for the current page')
    pagination: LivesPagination = Field(..., description='Pagination metadata')


class LiveDetailLineupVersionRef(BaseModel):
    lineup_version_id: int
    version_label: str


class LiveDetailExtraMember(BaseModel):
    member_name: str
    category: AppearanceCategory


class LiveDetailBandMember(BaseModel):
    band_id: int | None = Field(default=None, description='band_attrs.id; null when unmapped')
    band_name: str = Field(..., description='Band name')
    lineup_usage: LineupUsage | None = Field(default=None, description='Persisted per-song lineup mode')
    handover_baseline: Literal['base', 'next'] | None = Field(
        default=None,
        description='Official lineup baseline selected for a handover performance',
    )
    lineup_version: LiveDetailLineupVersionRef | None = None
    next_lineup_version: LiveDetailLineupVersionRef | None = None
    attendance_status: AttendanceStatus = Field(..., description='Lineup-aware attendance status')
    expected_count: int = Field(..., ge=0, description='Expected member count from the selected lineup')
    present_members: list[str] = Field(..., description='Members present in this song row')
    present_count: int = Field(..., description='Count of present members')
    missing_members: list[str] = Field(default_factory=list)
    extra_members: list[LiveDetailExtraMember] = Field(default_factory=list)
    total_count: int = Field(..., ge=0, description='Compatibility alias of expected_count')
    is_full: bool = Field(..., description='Compatibility flag for full and full_plus')


class LiveDetailOtherMember(BaseModel):
    key: str = Field(..., description='Other member category')
    value: list[str] = Field(..., description='Normalized other member values')


class LiveDetailCoverBand(BaseModel):
    band_id: int = Field(..., ge=1, description='Owning band ID for an inferred cross-band cover')
    band_name: str = Field(..., description='Owning band display name for the cover icon')


class LiveDetailEventAttendee(BaseModel):
    band_id: int = Field(..., description='band_attrs.id')
    band_name: str = Field(..., description='Band display name')
    mode: Literal['partial', 'full'] = Field(..., description='Computed attendance coverage')
    members: list[str] = Field(..., description='Complete recorded attendee list')


class LiveDetailRow(BaseModel):
    setlist_id: str = Field(..., description='Stable live_setlist UUID for row identity')
    row_id: str = Field(..., description='segment_type + sub_order composite row ID')
    absolute_order: int = Field(..., ge=1, description='Stable setlist order from live_setlist.absolute_order')
    segment_type: str = Field(..., description='Raw setlist segment code; unknown values are preserved')
    sub_order: int = Field(..., ge=1, description='Order within the raw segment')
    song_id: int = Field(..., ge=1, description='Song primary key')
    song_name: str = Field(..., description='Song title')
    band_members: list[LiveDetailBandMember] = Field(..., description='Band member info for this row')
    other_members: list[LiveDetailOtherMember] = Field(..., description='Other member info for this row')
    comments: list[str] = Field(..., description='Comment tags such as short version and cover markers')
    cover_band: LiveDetailCoverBand | None = Field(
        default=None,
        description='Owning band when the song is inferred as a cross-band cover; null for song_list.is_cover tags',
    )


class LiveDetailResponse(BaseModel):
    live_id: int = Field(..., description='Live primary key ID')
    live_date: date = Field(
        ...,
        description='Live date; rendered as a date-formatted string in OpenAPI and JSON responses',
    )
    live_title: str = Field(..., description='Live title')
    live_type: str = Field(..., description='Stable live type code')
    venue_id: int | None = Field(default=None, description='Stable venue entity ID when available')
    venue: str | None = Field(default=None, description='Venue name')
    opening_time: str | None = Field(default=None, description='Opening time')
    start_time: str | None = Field(default=None, description='Start time')
    bands: list[int] = Field(..., description='Deduplicated band IDs sorted ascending')
    band_names: list[str] = Field(..., description='Band names ordered by display rules')
    url: str | None = Field(default=None, description='Live URL from live_attrs.url')
    is_favorite: bool = Field(..., description='Whether the current user has favorited this live')
    tour: TourRef | None = Field(default=None, description='Tour reference when this live belongs to a tour')
    performance_group: PerformanceGroupRef | None = Field(
        default=None, description='Performance group reference when this live belongs to an activity group'
    )
    event_attendees: list[LiveDetailEventAttendee] = Field(
        default_factory=list,
        description='Event-only attendance grouped by Band; empty for non-event Lives',
    )
    event_status: EventStatus = Field(..., description="Persisted event status")
    date_phase: DatePhase = Field(..., description="Date phase computed in the Live UTC offset")
    status_note: str | None = Field(default=None, description="Explanation for postponed or cancelled Lives")
    was_rescheduled: bool = Field(..., description="Whether a formal schedule history row exists")
    schedule_history: list[LiveScheduleHistoryItem] = Field(
        default_factory=list,
        description="Formal schedule changes only; console data corrections are excluded",
    )
    detail_rows: list[LiveDetailRow] = Field(..., description='Detailed song rows for the live')


class LiveDetailBatchRequest(BaseModel):
    live_ids: list[int] = Field(
        ...,
        min_length=1,
        max_length=MAX_BATCH_LIVE_IDS,
        description='Live IDs to fetch in batch; deduplicated while preserving request order',
    )


class LiveDetailsBatchResponse(BaseModel):
    items: list[LiveDetailResponse] = Field(..., description='Matched live details')
    missing_live_ids: list[int] = Field(..., description='Requested live IDs that were not found')

