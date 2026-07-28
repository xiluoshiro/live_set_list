from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


BandLineupChangeType = Literal["initial", "addition", "removal", "replacement", "correction"]
BandIdRange = Literal["regular", "special"]


def _required_text(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("must not be blank")
    return normalized


def _optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _member_list(value: list[str]) -> list[str]:
    normalized = [member.strip() for member in value]
    if any(not member for member in normalized):
        raise ValueError("members must not contain blank names")
    if len(set(normalized)) != len(normalized):
        raise ValueError("members must not contain duplicates")
    return normalized


class ConsoleBandCreateRequest(BaseModel):
    id_range: BandIdRange
    band_name: str = Field(..., min_length=1, max_length=255)
    band_abbr: str = Field(default="", max_length=255)
    members: list[str] = Field(..., min_length=1, max_length=100)
    valid_from: date | None = None

    @field_validator("band_name")
    @classmethod
    def normalize_band_name(cls, value: str) -> str:
        return _required_text(value)

    @field_validator("band_abbr")
    @classmethod
    def normalize_band_abbr(cls, value: str) -> str:
        return value.strip()

    @field_validator("members")
    @classmethod
    def normalize_members(cls, value: list[str]) -> list[str]:
        return _member_list(value)


class ConsoleBandNameVersionCreateRequest(BaseModel):
    band_name: str = Field(..., min_length=1, max_length=255)
    band_abbr: str | None = Field(default=None, max_length=255)
    valid_from: date
    note: str | None = Field(default=None, max_length=2000)

    @field_validator("band_name")
    @classmethod
    def normalize_band_name(cls, value: str) -> str:
        return _required_text(value)

    @field_validator("band_abbr")
    @classmethod
    def normalize_band_abbr(cls, value: str | None) -> str | None:
        return _optional_text(value)

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: str | None) -> str | None:
        return _optional_text(value)


class ConsoleBandLineupVersionCreateRequest(BaseModel):
    version_label: str = Field(..., min_length=1, max_length=255)
    change_type: Literal["addition", "removal", "replacement", "correction"]
    members: list[str] = Field(..., min_length=1, max_length=100)
    valid_from: date
    note: str | None = Field(default=None, max_length=2000)
    transition_live_id: int | None = Field(default=None, ge=1)

    @field_validator("version_label")
    @classmethod
    def normalize_version_label(cls, value: str) -> str:
        return _required_text(value)

    @field_validator("members")
    @classmethod
    def normalize_members(cls, value: list[str]) -> list[str]:
        return _member_list(value)

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: str | None) -> str | None:
        return _optional_text(value)

    @model_validator(mode="after")
    def validate_transition(self) -> "ConsoleBandLineupVersionCreateRequest":
        if self.change_type == "correction" and self.transition_live_id is not None:
            raise ValueError("correction versions cannot bind a transition Live")
        return self


class ConsoleBandNameVersionItem(BaseModel):
    name_version_id: int
    band_name: str
    band_abbr: str | None
    valid_from: date | None
    valid_to: date | None
    note: str | None
    live_ids: list[int]


class ConsoleBandLineupVersionItem(BaseModel):
    lineup_version_id: int
    version_no: int
    version_label: str
    valid_from: date | None
    valid_to: date | None
    predecessor_id: int | None
    change_type: BandLineupChangeType
    transition_live_id: int | None
    note: str | None
    members: list[str]
    added_members: list[str]
    removed_members: list[str]
    live_ids: list[int]


class ConsoleBandHistoryResponse(BaseModel):
    band_id: int
    current_name: str
    current_abbr: str
    current_members: list[str]
    current_name_version_id: int
    current_lineup_version_id: int
    initialized: bool
    name_versions: list[ConsoleBandNameVersionItem]
    lineup_versions: list[ConsoleBandLineupVersionItem]


class ConsoleBandHistoryMutationResponse(BaseModel):
    ok: bool
    history: ConsoleBandHistoryResponse


class ConsoleBandCreateItem(BaseModel):
    band_id: int
    band_name: str
    band_abbr: str
    band_members: list[str]


class ConsoleBandCreateResponse(BaseModel):
    ok: bool
    item: ConsoleBandCreateItem
    history: ConsoleBandHistoryResponse


class ConsoleBandTransitionLiveCandidate(BaseModel):
    live_id: int
    live_name: str
    live_date: date
