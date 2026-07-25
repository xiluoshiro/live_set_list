from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

EventStatus = Literal["scheduled", "postponed", "cancelled"]
DatePhase = Literal["upcoming", "today", "past"]


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
    cancelled_live_count: int = Field(..., ge=0, description="Number of cancelled Live rows in the tour")
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
    event_status: EventStatus = Field(..., description="Persisted event status")
    date_phase: DatePhase = Field(..., description="Date phase computed in the Live UTC offset")
    was_rescheduled: bool = Field(..., description="Whether a formal schedule history row exists")


class TourDetailResponse(TourSummary):
    stops: list[TourStopItem] = Field(..., min_length=1, description="Collected tour stops in display order")


class TourStatisticsCoverage(BaseModel):
    stop_count: int = Field(..., ge=1)
    setlist_stop_count: int = Field(..., ge=0)
    comparable_transition_count: int = Field(..., ge=0)


class TourStatisticsOverview(BaseModel):
    distinct_song_count: int = Field(..., ge=0)
    common_song_count: int = Field(..., ge=0)


class TourStatisticsSongRef(BaseModel):
    song_id: int
    song_name: str


class TourStatisticsSong(BaseModel):
    song_id: int
    song_name: str
    appearance_count: int = Field(..., ge=1)
    first_live_id: int
    last_live_id: int
    status: Literal["common", "single", "added", "removed", "intermittent"]


class TourStatisticsReplacement(BaseModel):
    segment_type: str
    sub_order: int
    from_song: TourStatisticsSongRef
    to_song: TourStatisticsSongRef


class TourStatisticsMovedSong(TourStatisticsSongRef):
    from_order: int
    to_order: int


class TourStatisticsTransition(BaseModel):
    from_live_id: int
    from_live_date: date
    from_live_title: str
    to_live_id: int
    to_live_date: date
    to_live_title: str
    replacements: list[TourStatisticsReplacement]
    added_songs: list[TourStatisticsSongRef]
    removed_songs: list[TourStatisticsSongRef]
    moved_songs: list[TourStatisticsMovedSong]


class TourStatisticsResponse(BaseModel):
    tour_id: int
    coverage: TourStatisticsCoverage
    overview: TourStatisticsOverview
    songs: list[TourStatisticsSong]
    transitions: list[TourStatisticsTransition]
