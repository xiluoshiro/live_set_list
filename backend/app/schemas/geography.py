from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.geography import validate_map_url, validate_timezone

MapProvider = Literal["google", "apple", "amap"]


class LocalityCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    country_code: str = Field(pattern=r"^[A-Z]{2}$")
    admin_area: str | None = Field(default=None, max_length=120)
    locality_name: str = Field(min_length=1, max_length=120)
    timezone_id: str | None = Field(default=None, max_length=100)

    @field_validator("admin_area", "timezone_id", mode="before")
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        return (value.strip() or None) if isinstance(value, str) else value

    @field_validator("timezone_id")
    @classmethod
    def valid_timezone(cls, value: str | None) -> str | None:
        return validate_timezone(value) if value is not None else None


class Locality(LocalityCreate):
    id: int
    area_level: Literal["country", "admin_area", "locality"] = "locality"
    revision: int


class LocalityPage(BaseModel):
    items: list[Locality]
    total: int
    page: int
    page_size: int


class LocationWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_revision: int = Field(ge=1)
    locality_id: int | None = Field(default=None, ge=1)
    address: str | None = Field(default=None, max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    coordinate_system: Literal["WGS84"] = "WGS84"
    timezone_id: str | None = Field(default=None, max_length=100)

    @field_validator("address", "timezone_id", mode="before")
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        return (value.strip() or None) if isinstance(value, str) else value

    @field_validator("timezone_id")
    @classmethod
    def valid_timezone(cls, value: str | None) -> str | None:
        return validate_timezone(value) if value is not None else None

    @model_validator(mode="after")
    def paired_coordinates(self) -> Self:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("经纬度必须同时填写或同时清空")
        if self.timezone_id and self.latitude is None:
            raise ValueError("场馆精确时区需要坐标；仅公布城市时请使用城市时区")
        if self.latitude is not None and self.longitude is not None:
            self.latitude = round(self.latitude, 6)
            self.longitude = round(self.longitude, 6)
        return self


class MapLinkWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_revision: int = Field(ge=1)
    provider: MapProvider
    provider_place_id: str | None = Field(default=None, max_length=255)
    provider_url: str | None = Field(default=None, max_length=2048)

    @field_validator("provider_place_id", "provider_url", mode="before")
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        return (value.strip() or None) if isinstance(value, str) else value

    @model_validator(mode="after")
    def valid_target(self) -> Self:
        if not self.provider_place_id and not self.provider_url:
            raise ValueError("请提供场馆地点 ID 或详情链接")
        if self.provider == "apple" and not self.provider_url:
            raise ValueError("Apple Maps 请提供已核对的场馆详情链接")
        if self.provider_url:
            validate_map_url(self.provider, self.provider_url)
        return self


class MapLink(BaseModel):
    provider: MapProvider
    provider_place_id: str | None
    provider_url: str | None
    verified_at: datetime | None
    is_current: bool
    url: str | None
    coordinate_url: str | None


class VenueLocation(BaseModel):
    venue_id: int
    locality: Locality | None
    address: str | None
    latitude: float | None
    longitude: float | None
    coordinate_system: Literal["WGS84"] = "WGS84"
    timezone_id: str | None
    effective_timezone_id: str | None
    timezone_source: Literal["venue", "locality"] | None
    location_revision: int
    location_verified_at: datetime | None
    map_links: list[MapLink]


class LocationPreview(BaseModel):
    before: VenueLocation
    after: LocationWrite
    effective_timezone_id: str | None
    live_count: int
    invalidated_map_links: int
