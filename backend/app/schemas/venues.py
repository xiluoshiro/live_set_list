from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.lives import DatePhase, EventStatus


MapProvider = Literal["google", "apple", "amap"]


class PublicVenueLocality(BaseModel):
    country_code: str = Field(..., description="ISO 3166-1 alpha-2 country or region code")
    admin_area: str | None = Field(default=None, description="First-level administrative area")
    locality_name: str | None = Field(..., description="Locality name, absent for country or administrative-area records")


class PublicVenueNameVersion(BaseModel):
    venue_name: str = Field(..., description="Historical official venue name")
    valid_from: date | None = None
    valid_to: date | None = None
    is_current: bool


class PublicVenueMapLink(BaseModel):
    provider: MapProvider
    url: str
    source: Literal["place", "coordinates"]


class PublicVenueLiveItem(BaseModel):
    live_id: int
    live_date: date
    live_title: str
    live_type: str
    bands: list[int]
    url: str | None = None
    event_status: EventStatus
    date_phase: DatePhase
    was_rescheduled: bool


class PublicVenuePagination(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int


class PublicVenueMapsResponse(BaseModel):
    venue_id: int
    venue_name: str
    map_links: list[PublicVenueMapLink]


class PublicVenueDetailResponse(PublicVenueMapsResponse):
    venue_kind: Literal["physical", "online", "undisclosed"]
    locality: PublicVenueLocality | None = None
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    timezone_id: str | None = None
    timezone_source: Literal["venue", "locality"] | None = None
    name_versions: list[PublicVenueNameVersion]
    lives: list[PublicVenueLiveItem]
    pagination: PublicVenuePagination
