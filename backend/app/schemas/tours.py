from datetime import date

from pydantic import BaseModel, Field


class TourRef(BaseModel):
    tour_id: int = Field(..., description="Tour primary key ID")
    tour_title: str = Field(..., description="Tour display title")


class TourBandItem(BaseModel):
    band_id: int = Field(..., description="band_attrs.id")
    band_name: str = Field(..., description="Band display name")
    band_abbr: str = Field(..., description="Band abbreviation")


class TourSummary(BaseModel):
    tour_id: int = Field(..., description="Tour primary key ID")
    tour_title: str = Field(..., description="Tour display title")
    url: str | None = Field(default=None, description="Official tour source URL")
    description: str | None = Field(default=None, description="Optional tour description")
    bands: list[TourBandItem] = Field(..., description="Explicit tour bands in display order")
    start_date: date = Field(..., description="Earliest live date currently collected for the tour")
    end_date: date = Field(..., description="Latest live date currently collected for the tour")
    collected_live_count: int = Field(..., ge=1, description="Number of live rows currently collected")
    stop_labels: list[str] = Field(..., description="Non-empty stop labels in stop order")


class ToursPagination(BaseModel):
    page: int = Field(..., description="Current page number")
    page_size: int = Field(..., description="Page size, currently 15 or 20")
    total: int = Field(..., description="Total matched tour count")
    total_pages: int = Field(..., description="Total page count")


class ToursResponse(BaseModel):
    items: list[TourSummary] = Field(..., description="Tour summaries for the current page")
    pagination: ToursPagination = Field(..., description="Pagination metadata")


class TourStopItem(BaseModel):
    stop_order: int = Field(..., ge=1, description="Explicit display order within the tour")
    stop_label: str | None = Field(default=None, description="Optional editor-maintained stop label")
    live_id: int = Field(..., description="Live primary key ID")
    live_date: date = Field(..., description="Live date")
    live_title: str = Field(..., description="Live title")
    live_type: str = Field(..., description="Stable live type code")
    venue: str | None = Field(default=None, description="Venue display name")
    bands: list[int] = Field(..., description="Effective live band IDs sorted ascending")
    url: str | None = Field(default=None, description="Live source URL")
    is_favorite: bool = Field(..., description="Whether the current user has favorited this live")
    has_setlist: bool = Field(..., description="Whether at least one setlist row exists")


class TourDetailResponse(TourSummary):
    stops: list[TourStopItem] = Field(..., min_length=1, description="Collected tour stops in display order")
