from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


BandLineupChangeType = Literal["initial", "addition", "removal", "replacement", "correction"]


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


class BandHistoryDateRange(BaseModel):
    valid_from: date | None = None
    valid_to: date | None = None
    note: str | None = Field(default=None, max_length=2000)

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: str | None) -> str | None:
        return _optional_text(value)

    @model_validator(mode="after")
    def validate_date_range(self) -> "BandHistoryDateRange":
        if self.valid_from is not None and self.valid_to is not None and self.valid_to <= self.valid_from:
            raise ValueError("valid_to must be later than valid_from")
        return self


class ConsoleBandInitializeRequest(BandHistoryDateRange):
    band_name: str = Field(..., min_length=1, max_length=255)
    band_abbr: str = Field(default="", max_length=255)
    members: list[str] = Field(..., min_length=1, max_length=100)
    version_no: int = Field(default=1, ge=1)
    version_label: str = Field(..., min_length=1, max_length=255)

    @field_validator("band_name", "version_label")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        return _required_text(value)

    @field_validator("band_abbr")
    @classmethod
    def normalize_abbr(cls, value: str) -> str:
        return value.strip()

    @field_validator("members")
    @classmethod
    def normalize_members(cls, value: list[str]) -> list[str]:
        return _member_list(value)


class ConsoleBandNameVersionCreateRequest(BandHistoryDateRange):
    band_name: str = Field(..., min_length=1, max_length=255)
    band_abbr: str | None = Field(default=None, max_length=255)
    make_current: bool = False

    @field_validator("band_name")
    @classmethod
    def normalize_band_name(cls, value: str) -> str:
        return _required_text(value)

    @field_validator("band_abbr")
    @classmethod
    def normalize_band_abbr(cls, value: str | None) -> str | None:
        return _optional_text(value)

    @model_validator(mode="after")
    def validate_current_date(self) -> "ConsoleBandNameVersionCreateRequest":
        if self.make_current and self.valid_from is None:
            raise ValueError("valid_from is required when make_current is true")
        if self.make_current and self.valid_to is not None:
            raise ValueError("valid_to must be null when make_current is true")
        return self


class ConsoleBandLineupVersionCreateRequest(BandHistoryDateRange):
    version_no: int | None = Field(default=None, ge=1)
    version_label: str = Field(..., min_length=1, max_length=255)
    predecessor_id: int | None = Field(default=None, ge=1)
    change_type: BandLineupChangeType
    members: list[str] = Field(..., min_length=1, max_length=100)
    make_current: bool = False

    @field_validator("version_label")
    @classmethod
    def normalize_version_label(cls, value: str) -> str:
        return _required_text(value)

    @field_validator("members")
    @classmethod
    def normalize_members(cls, value: list[str]) -> list[str]:
        return _member_list(value)

    @model_validator(mode="after")
    def validate_current_date(self) -> "ConsoleBandLineupVersionCreateRequest":
        if self.make_current and self.valid_from is None:
            raise ValueError("valid_from is required when make_current is true")
        if self.make_current and self.valid_to is not None:
            raise ValueError("valid_to must be null when make_current is true")
        return self


class ConsoleBandLineupCorrectionRequest(BandHistoryDateRange):
    version_label: str = Field(..., min_length=1, max_length=255)
    members: list[str] = Field(..., min_length=1, max_length=100)
    confirmed_live_ids: list[int] = Field(default_factory=list, max_length=10000)

    @field_validator("version_label")
    @classmethod
    def normalize_version_label(cls, value: str) -> str:
        return _required_text(value)

    @field_validator("members")
    @classmethod
    def normalize_members(cls, value: list[str]) -> list[str]:
        return _member_list(value)

    @field_validator("confirmed_live_ids")
    @classmethod
    def normalize_confirmed_live_ids(cls, value: list[int]) -> list[int]:
        if any(live_id <= 0 for live_id in value):
            raise ValueError("confirmed_live_ids must contain only positive IDs")
        return sorted(set(value))


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
    initialized: bool
    name_versions: list[ConsoleBandNameVersionItem]
    lineup_versions: list[ConsoleBandLineupVersionItem]


class ConsoleBandHistoryMutationResponse(BaseModel):
    ok: bool
    history: ConsoleBandHistoryResponse


class ConsoleBandLineupImpactResponse(BaseModel):
    band_id: int
    lineup_version_id: int
    live_ids: list[int]
    setlist_row_count: int


class BandHistoryBackfillIssue(BaseModel):
    code: str
    message: str
    live_id: int | None = None
    setlist_id: str | None = None
    band_name: str | None = None


class BandHistoryBackfillPreflightResponse(BaseModel):
    ready: bool
    setlist_row_count: int
    performance_count: int
    member_count: int
    live_band_context_count: int
    mapped_band_ids: list[int]
    issues: list[BandHistoryBackfillIssue]
