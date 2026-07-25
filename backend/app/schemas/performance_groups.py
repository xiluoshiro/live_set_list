from datetime import date
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field

from app.schemas.tours import TourRef

EventStatus = Literal["scheduled", "postponed", "cancelled"]
DatePhase = Literal["upcoming", "today", "past"]


class PerformanceGroupRef(BaseModel):
    group_id: int = Field(..., description="Performance group primary key ID")
    group_title: str = Field(..., description="Performance group display title")


class PerformanceGroupBandItem(BaseModel):
    band_id: int = Field(..., description="band_attrs.id")
    band_name: str = Field(..., description="Band display name")
    band_abbr: str = Field(..., description="Band abbreviation")


class PerformanceGroupLiveItem(BaseModel):
    live_id: int = Field(..., description="Live primary key ID")
    live_date: date = Field(..., description="Live date")
    live_title: str = Field(..., description="Live title")
    live_type: str = Field(..., description="Stable live type code")
    start_time: str = Field(..., description="Start time")
    venue: str | None = Field(default=None, description="Venue display name")
    bands: list[int] = Field(..., description="Deduplicated band IDs sorted ascending")
    url: str | None = Field(default=None, description="Live source URL")
    is_favorite: bool = Field(..., description="Whether the current user has favorited this live")
    has_setlist: bool = Field(..., description="Whether at least one setlist row exists")
    event_status: EventStatus = Field(..., description="Persisted event status")
    date_phase: DatePhase = Field(..., description="Date phase computed in the Live UTC offset")
    was_rescheduled: bool = Field(..., description="Whether a formal schedule history row exists")


class PerformanceGroupDetailResponse(BaseModel):
    group_id: int = Field(..., description="Performance group primary key ID")
    group_title: str = Field(..., description="Performance group display title")
    start_date: date = Field(..., description="Earliest live date within the group")
    end_date: date = Field(..., description="Latest live date within the group")
    day_count: int = Field(..., ge=1, description="Number of distinct dates across group lives")
    live_count: int = Field(..., ge=1, description="Number of lives in the group")
    cancelled_live_count: int = Field(..., ge=0, description="Number of cancelled Lives in the group")
    display_type: Literal["single_day_multi_show", "multi_day"] = Field(
        ..., description="Dynamically computed display category"
    )
    bands: list[PerformanceGroupBandItem] = Field(..., description="Dynamic band aggregation from group lives")
    venues: list[str] = Field(..., description="Distinct venue display names")
    lives: list[PerformanceGroupLiveItem] = Field(..., min_length=1, description="Group lives in date/start_time/id order")


class CatalogPerformanceGroupSummary(BaseModel):
    group_id: int = Field(..., description="Performance group primary key ID")
    group_title: str = Field(..., description="Performance group display title")
    start_date: date = Field(..., description="Earliest live date within the group")
    end_date: date = Field(..., description="Latest live date within the group")
    day_count: int = Field(..., ge=1, description="Number of distinct dates across group lives")
    live_count: int = Field(..., ge=2, description="Number of lives in the group")
    cancelled_live_count: int = Field(..., ge=0, description="Number of cancelled Lives in the group")
    display_type: Literal["single_day_multi_show", "multi_day"] = Field(
        ..., description="Dynamically computed display category"
    )
    bands: list[PerformanceGroupBandItem] = Field(..., description="Dynamic band aggregation from group lives")
    venues: list[str] = Field(..., description="Distinct venue display names")


class CatalogPerformanceLiveItem(BaseModel):
    live_id: int = Field(..., description="Live primary key ID")
    live_date: date = Field(..., description="Live date")
    live_title: str = Field(..., description="Live title")
    live_type: str = Field(..., description="Stable live type code")
    bands: list[int] = Field(..., description="Deduplicated band IDs sorted ascending")
    url: str | None = Field(default=None, description="Live URL from live_attrs.url")
    is_favorite: bool = Field(..., description="Whether the current user has favorited this live")
    tour: TourRef | None = Field(default=None, description="Tour reference when this live belongs to a tour")
    performance_group: PerformanceGroupRef | None = Field(
        default=None, description="Performance group reference when this live belongs to an activity group"
    )
    event_status: EventStatus = Field(..., description="Persisted event status")
    date_phase: DatePhase = Field(..., description="Date phase computed in the Live UTC offset")
    was_rescheduled: bool = Field(..., description="Whether a formal schedule history row exists")


class CatalogLiveResult(BaseModel):
    kind: Literal["live"] = Field(default="live", description="Discriminator: standalone live row")
    live: CatalogPerformanceLiveItem = Field(..., description="Live item with tour and optional performance group ref")


class CatalogPerformanceGroupResult(BaseModel):
    kind: Literal["performance_group"] = Field(
        default="performance_group", description="Discriminator: aggregated performance group"
    )
    performance_group: CatalogPerformanceGroupSummary = Field(..., description="Performance group summary")


CatalogPerformanceItem = Annotated[
    Union[CatalogLiveResult, CatalogPerformanceGroupResult],
    Field(discriminator="kind"),
]


class CatalogPerformancesPagination(BaseModel):
    page: int = Field(..., description="Current page number")
    page_size: int = Field(..., description="Page size (15 or 20)")
    total: int = Field(..., description="Total record count")
    total_pages: int = Field(..., description="Total page count")


class CatalogPerformancesResponse(BaseModel):
    items: list[CatalogPerformanceItem] = Field(..., description="Mixed live and performance group items")
    pagination: CatalogPerformancesPagination = Field(..., description="Pagination metadata")
