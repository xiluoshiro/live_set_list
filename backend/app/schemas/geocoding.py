from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from app.schemas.geography import Locality

AddressLanguageCode = Literal["ja", "zh-CN", "zh-HK", "zh-TW", "en"]


class SearchInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    query: str = Field(min_length=2, max_length=200)
    country_code: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    language_code: AddressLanguageCode


class ResolveInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    coordinate_system: Literal["WGS84"] = "WGS84"
    request_id: str = Field(min_length=1, max_length=80)
    parts: Literal["timezone", "address"]
    country_code: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    language_code: AddressLanguageCode


class PlaceInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    place_id: str = Field(min_length=1, max_length=255)
    request_id: str = Field(min_length=1, max_length=80)
    country_code: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    language_code: AddressLanguageCode


class GeocodingCandidate(BaseModel):
    name: str
    address: str
    latitude: float
    longitude: float
    country_code: str | None
    admin_area: str | None
    locality_name: str | None
    provider_place_id: str | None = None
    provider_url: str | None = None


class SearchResult(BaseModel):
    status: Literal["ready", "not_found", "unavailable"]
    items: list[GeocodingCandidate]
    message: str | None
    attribution: str
    attribution_url: str


class TimezoneResult(BaseModel):
    status: Literal["ready", "not_found", "unavailable", "not_requested"]
    timezone_id: str | None = None
    message: str | None = None


class ResolveResult(BaseModel):
    request_id: str
    latitude: float
    longitude: float
    timezone: TimezoneResult
    address: SearchResult | None = None
    localities: list[Locality] = []
