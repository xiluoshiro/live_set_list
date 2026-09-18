from datetime import date, datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.geography import validate_map_url, validate_timezone

MapProvider = Literal["google", "apple", "amap"]
AreaLevel = Literal["country", "admin_area", "locality"]
MapProviderStatus = Literal["ready", "not_configured", "unavailable"]
ProviderCoordinateSystem = Literal["WGS84", "GCJ02"]


class LocalityFields(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    country_code: str = Field(pattern=r"^[A-Z]{2}$")
    admin_area: str | None = Field(default=None, max_length=120)
    locality_name: str | None = Field(default=None, max_length=120)
    timezone_id: str | None = Field(default=None, max_length=100)
    area_level: AreaLevel = "locality"

    @field_validator("admin_area", "locality_name", "timezone_id", mode="before")
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        return (value.strip() or None) if isinstance(value, str) else value

    @field_validator("timezone_id")
    @classmethod
    def valid_timezone(cls, value: str | None) -> str | None:
        return validate_timezone(value) if value is not None else None

    @model_validator(mode="after")
    def valid_area_shape(self) -> Self:
        if self.area_level == "country" and (self.admin_area is not None or self.locality_name is not None):
            raise ValueError("国家／地区层级不能填写行政区或城市")
        if self.area_level == "admin_area" and (self.admin_area is None or self.locality_name is not None):
            raise ValueError("一级行政区必须填写行政区且不能填写城市")
        if self.area_level == "locality" and self.locality_name is None:
            raise ValueError("城市层级必须填写城市名称")
        return self


class LocalityCreate(LocalityFields):
    pass


class LocalityUpdate(LocalityFields):
    expected_state_token: str = Field(pattern=r"^[0-9a-f]{64}$")


class Locality(BaseModel):
    id: int
    country_code: str
    admin_area: str | None
    locality_name: str | None
    timezone_id: str | None
    area_level: AreaLevel
    state_token: str


class LocalityPage(BaseModel):
    items: list[Locality]
    total: int
    page: int
    page_size: int


class LocationWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_state_token: str = Field(pattern=r"^[0-9a-f]{64}$")
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


class MapCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    provider_place_id: str = Field(min_length=1, max_length=255)
    provider_url: str = Field(min_length=1, max_length=2048)
    name: str = Field(min_length=1, max_length=500)
    address: str = Field(max_length=1000)
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    source_coordinate_system: ProviderCoordinateSystem
    distance_m: int = Field(ge=0)


class MapLinkWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_state_token: str = Field(pattern=r"^[0-9a-f]{64}$")
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


class MapCandidateSearch(BaseModel):
    provider: MapProvider
    status: MapProviderStatus
    message: str | None
    candidates: list[MapCandidate]


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
    state_token: str
    location_verified_at: datetime | None
    map_links: list[MapLink]


class LocalityPreview(BaseModel):
    before: Locality
    after: LocalityUpdate
    venue_count: int
    live_count: int


class LocationPreview(BaseModel):
    before: VenueLocation
    after: LocationWrite
    effective_timezone_id: str | None
    live_count: int
    changed_fields: list[str]
