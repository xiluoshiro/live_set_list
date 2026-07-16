from datetime import date

from pydantic import BaseModel, Field

from app.schemas.lives import LiveItem, LivesPagination


class CatalogBandItem(BaseModel):
    band_id: int = Field(..., description="band_attrs.id")
    band_name: str = Field(..., description="Band display name")
    band_abbr: str = Field(..., description="Band abbreviation")
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
    band_count: int = Field(..., description="Total number of bands")
    song_count: int = Field(..., description="Total number of songs")
    venue_count: int = Field(..., description="Total number of venues")
    latest_live_date: str | None = Field(default=None, description="Most recent live date in ISO format")
    years: list[int] = Field(default_factory=list, description="Distinct Live years ordered descending")
