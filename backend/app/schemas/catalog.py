from datetime import date

from pydantic import BaseModel, Field

from app.schemas.lives import DatePhase, EventStatus, LiveItem, LivesPagination


class CatalogBandItem(BaseModel):
    band_id: int = Field(..., description="band_attrs.id")
    band_name: str = Field(..., description="Band display name")
    band_abbr: str = Field(..., description="Band abbreviation")
    band_members: list[str] = Field(default_factory=list, description="Default member roster")
    live_count: int = Field(..., description="Matched live count for this band")


class CatalogSongItem(BaseModel):
    song_id: int = Field(..., description="song_list.id")
    song_name: str = Field(..., description="Song title")
    band_id: int = Field(..., description="song_list.band_id")
    band_name: str | None = Field(default=None, description="Owning band display name")
    live_count: int = Field(..., description="Matched live count for this song")


class CatalogVenueItem(BaseModel):
    venue_id: int = Field(..., description="venue_list.id")
    venue_name: str = Field(..., description="Venue display name")
    live_count: int = Field(..., description="Matched live count for this venue")


class CatalogSearchResponse(BaseModel):
    query: str = Field(..., description="Normalized search query")
    lives: list[LiveItem] = Field(..., description="Matched live rows")
    bands: list[CatalogBandItem] = Field(..., description="Matched bands")
    songs: list[CatalogSongItem] = Field(..., description="Matched songs")
    venues: list[CatalogVenueItem] = Field(..., description="Matched venues")


class CatalogBandLivesResponse(BaseModel):
    band: CatalogBandItem = Field(..., description="Selected band")
    items: list[LiveItem] = Field(..., description="Lives that include the band")
    pagination: LivesPagination = Field(..., description="Pagination metadata")


class CatalogBandListResponse(BaseModel):
    items: list[CatalogBandItem] = Field(..., description="Public band browse candidates")


class CatalogStatsResponse(BaseModel):
    live_count: int = Field(..., description="Total number of lives")
    band_count: int = Field(..., description="Total number of bands")
    song_count: int = Field(..., description="Total number of songs")
    venue_count: int = Field(..., description="Total number of venues")
    latest_live_date: str | None = Field(default=None, description="Most recent live date in ISO format")
    years: list[int] = Field(default_factory=list, description="Distinct Live years ordered descending")


class CatalogCalendarLiveItem(BaseModel):
    live_id: int = Field(..., description="live_attrs.id")
    live_date: date = Field(..., description="Live date")
    live_title: str = Field(..., description="Live title")
    start_time: str | None = Field(default=None, description="Start time with UTC offset, e.g. 18:00:00+09:00")
    bands: list[int] = Field(..., description="Deduplicated band IDs sorted ascending")
    event_status: EventStatus = Field(..., description="Persisted event status")
    date_phase: DatePhase = Field(..., description="Date phase computed in the Live UTC offset")
    was_rescheduled: bool = Field(..., description="Whether the Live has schedule history")


class CatalogCalendarResponse(BaseModel):
    month: str = Field(..., description="Requested month key in YYYY-MM format")
    items: list[CatalogCalendarLiveItem] = Field(..., description="All lives in the requested month")


class StatisticsFilters(BaseModel):
    year: int | None = None
    live_type: str | None = None
    band_id: int | None = None


class StatisticsOverview(BaseModel):
    live_count: int
    setlist_live_count: int
    band_count: int
    song_count: int
    venue_count: int
    earliest_live_date: date | None = None
    latest_live_date: date | None = None


class StatisticsDimensionItem(BaseModel):
    key: str
    label: str
    live_count: int


class StatisticsSongItem(BaseModel):
    song_id: int
    song_name: str
    band_id: int
    band_name: str | None = None
    is_cover: bool
    live_count: int
    performance_count: int
    first_live_id: int
    first_live_date: date
    first_live_title: str
    latest_live_id: int
    latest_live_date: date
    latest_live_title: str


class StatisticsStaleSongItem(BaseModel):
    song_id: int
    song_name: str
    band_name: str | None = None
    is_cover: bool
    live_count: int
    latest_live_id: int
    latest_live_date: date
    latest_live_title: str
    reference_live_date: date
    stale_days: int
    missed_live_count: int


class StatisticsStaleSongsByKind(BaseModel):
    original: list[StatisticsStaleSongItem]
    cover: list[StatisticsStaleSongItem]


class CatalogStatisticsResponse(BaseModel):
    scope: str
    filters: StatisticsFilters
    overview: StatisticsOverview
    years: list[StatisticsDimensionItem]
    live_types: list[StatisticsDimensionItem]
    top_songs: list[StatisticsSongItem]
    stale_songs: list[StatisticsStaleSongItem]
    stale_songs_by_kind: StatisticsStaleSongsByKind
