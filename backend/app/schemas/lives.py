from datetime import date

from pydantic import BaseModel, Field

MAX_BATCH_LIVE_IDS = 100


class LiveItem(BaseModel):
    live_id: int = Field(..., description='Live primary key ID')
    live_date: date = Field(
        ...,
        description='Live date; rendered as a date-formatted string in OpenAPI and JSON responses',
    )
    live_title: str = Field(..., description='Live title')
    bands: list[int] = Field(..., description='Deduplicated band IDs sorted ascending')
    url: str | None = Field(default=None, description='Live URL from live_attrs.url')


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


class LiveDetailRow(BaseModel):
    row_id: str = Field(..., description='segment_type + sub_order composite row ID')
    song_name: str = Field(..., description='Song title')
    band_members: list[LiveDetailBandMember] = Field(..., description='Band member info for this row')
    other_members: list[LiveDetailOtherMember] = Field(..., description='Other member info for this row')
    comments: list[str] = Field(..., description='Comment tags such as short version markers')


class LiveDetailResponse(BaseModel):
    live_id: int = Field(..., description='Live primary key ID')
    live_date: date = Field(
        ...,
        description='Live date; rendered as a date-formatted string in OpenAPI and JSON responses',
    )
    live_title: str = Field(..., description='Live title')
    venue: str | None = Field(default=None, description='Venue name')
    opening_time: str | None = Field(default=None, description='Opening time')
    start_time: str | None = Field(default=None, description='Start time')
    bands: list[int] = Field(..., description='Deduplicated band IDs sorted ascending')
    band_names: list[str] = Field(..., description='Band names ordered by display rules')
    url: str | None = Field(default=None, description='Live URL from live_attrs.url')
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

