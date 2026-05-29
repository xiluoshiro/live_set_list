from datetime import date

from pydantic import BaseModel, Field, field_validator


def _strip_required_text(value: str) -> str:
    """Trim console form input and reject values that become blank after stripping."""
    normalized = value.strip()
    if normalized == "":
        raise ValueError("must not be blank")
    return normalized


class ConsoleSongCreateRequest(BaseModel):
    song_name: str = Field(..., min_length=1, max_length=255, description="Song title")
    band_id: int = Field(..., ge=1, description="band_attrs.id")
    cover: bool = Field(default=False, description="Whether the song is a cover")

    @field_validator("song_name")
    @classmethod
    def validate_song_name(cls, value: str) -> str:
        """Normalize song_name before the console song-create endpoint consumes it."""
        return _strip_required_text(value)


class ConsoleSongItem(BaseModel):
    song_id: int = Field(..., description="Created song ID")
    song_name: str = Field(..., description="Song title")
    band_id: int = Field(..., description="band_attrs.id")
    cover: bool = Field(..., description="Whether the song is a cover")


class ConsoleSongMutationResponse(BaseModel):
    ok: bool = Field(..., description="Whether the write succeeded")
    item: ConsoleSongItem = Field(..., description="Created song payload")


class ConsoleLiveCreateRequest(BaseModel):
    live_date: date = Field(..., description="Live date")
    live_title: str = Field(..., min_length=1, max_length=255, description="Live title")
    url: str = Field(..., min_length=1, max_length=2048, description="Live URL")
    opening_time: str = Field(..., min_length=5, max_length=8, description="Opening time, e.g. 18:00 or 18:00:00")
    start_time: str = Field(..., min_length=5, max_length=8, description="Start time, e.g. 19:00 or 19:00:00")
    timezone: str = Field(..., min_length=6, max_length=6, description="UTC offset, e.g. +09:00")
    venue_id: int = Field(..., ge=1, description="venue_list.id")
    type: str | None = Field(
        default=None,
        max_length=64,
        description="Reserved field from the current console UI; accepted for compatibility but not persisted yet.",
    )

    @field_validator("live_title", "url")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        """Normalize required text fields before the console live-create endpoint uses them."""
        return _strip_required_text(value)

    @field_validator("type")
    @classmethod
    def validate_optional_type(cls, value: str | None) -> str | None:
        """Trim the optional UI-only type field while preserving omitted values as None."""
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class ConsoleLiveItem(BaseModel):
    live_id: int = Field(..., description="Created live ID")
    live_date: date = Field(..., description="Live date")
    live_title: str = Field(..., description="Live title")
    url: str = Field(..., description="Live URL")
    opening_time: str = Field(..., description="Opening time with timezone")
    start_time: str = Field(..., description="Start time with timezone")
    venue_id: int = Field(..., description="venue_list.id")


class ConsoleLiveMutationResponse(BaseModel):
    ok: bool = Field(..., description="Whether the write succeeded")
    item: ConsoleLiveItem = Field(..., description="Created live payload")


class ConsoleLiveSetlistRowRequest(BaseModel):
    song_id: int = Field(..., ge=1, description="song_list.id")
    absolute_order: int = Field(..., ge=1, description="Absolute order in the setlist")
    segment_type: str = Field(..., min_length=1, max_length=32, description="Segment code or canonical segment type")
    sub_order: int = Field(..., ge=1, description="Sub-order within the segment")
    is_short: bool = Field(default=False, description="Whether the row is a short version")
    band_member: dict[str, list[str] | str] = Field(..., description="Band member payload")
    other_member: dict[str, list[str] | str] | None = Field(default=None, description="Other member payload")
    comment: str | None = Field(default=None, max_length=1024, description="Optional row comment")

    @field_validator("segment_type")
    @classmethod
    def validate_segment_type(cls, value: str) -> str:
        """Normalize segment_type before the console setlist endpoint maps it into DB values."""
        return _strip_required_text(value)

    @field_validator("comment")
    @classmethod
    def validate_comment(cls, value: str | None) -> str | None:
        """Trim optional row comments while keeping omitted comments as None."""
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("band_member")
    @classmethod
    def validate_band_member(cls, value: dict[str, list[str] | str]) -> dict[str, list[str] | str]:
        """Require band_member to contain at least one band before JSON normalization runs."""
        if len(value) == 0:
            raise ValueError("band_member must not be empty")
        return value


class ConsoleLiveSetlistAppendRequest(BaseModel):
    setlist_rows: list[ConsoleLiveSetlistRowRequest] = Field(
        ...,
        min_length=1,
        description="New setlist rows to append to the target live",
    )


class ConsoleLiveSetlistAppendItem(BaseModel):
    live_id: int = Field(..., description="Target live ID")
    inserted_row_count: int = Field(..., ge=1, description="Inserted setlist row count")
    total_setlist_row_count: int = Field(..., ge=1, description="Current persisted setlist row count")


class ConsoleLiveSetlistAppendResponse(BaseModel):
    ok: bool = Field(..., description="Whether the write succeeded")
    item: ConsoleLiveSetlistAppendItem = Field(..., description="Append result payload")
