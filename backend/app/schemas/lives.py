from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.performance_groups import PerformanceGroupRef
from app.schemas.tours import TourRef

MAX_BATCH_LIVE_IDS = 100


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


class LivesPagination(BaseModel):
    page: int = Field(..., description='Current page number')
    page_size: int = Field(..., description='Page size, currently 15 or 20')
    total: int = Field(..., description='Total record count')
    total_pages: int = Field(..., description='Total page count')


class LivesResponse(BaseModel):
    items: list[LiveItem] = Field(..., description='Live items for the current page')
    pagination: LivesPagination = Field(..., description='Pagination metadata')


class LiveDetailBandMember(BaseModel):
    band_id: int | None = Field(default=None, description='band_attrs.id; null when unmapped')
    band_name: str = Field(..., description='Band name')
    present_members: list[str] = Field(..., description='Members present in this song row')
    present_count: int = Field(..., description='Count of present members')
    total_count: int = Field(..., description='Total member count for the band')
    is_full: bool = Field(..., description='Whether present_count reaches total_count')


class LiveDetailOtherMember(BaseModel):
    key: str = Field(..., description='Other member category')
    value: list[str] = Field(..., description='Normalized other member values')


class LiveDetailEventAttendee(BaseModel):
    band_id: int = Field(..., description='band_attrs.id')
    band_name: str = Field(..., description='Band display name')
    mode: Literal['partial', 'full'] = Field(..., description='Computed attendance coverage')
    members: list[str] = Field(..., description='Complete recorded attendee list')


class LiveDetailRow(BaseModel):
    row_id: str = Field(..., description='segment_type + sub_order composite row ID')
    song_name: str = Field(..., description='Song title')
    band_members: list[LiveDetailBandMember] = Field(..., description='Band member info for this row')
    other_members: list[LiveDetailOtherMember] = Field(..., description='Other member info for this row')
    comments: list[str] = Field(..., description='Comment tags such as short version and cover markers')


class LiveDetailResponse(BaseModel):
    live_id: int = Field(..., description='Live primary key ID')
    live_date: date = Field(
        ...,
        description='Live date; rendered as a date-formatted string in OpenAPI and JSON responses',
    )
    live_title: str = Field(..., description='Live title')
    live_type: str = Field(..., description='Stable live type code')
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

