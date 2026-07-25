from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

LIVE_TYPE_VALUES = ("oneman", "taiban", "multi_act", "festival", "event", "other")


def _validate_live_type(value: str) -> str:
    """Trim and reject non-empty live_type that is not a known code."""
    normalized = value.strip()
    if normalized == "":
        raise ValueError("live_type must not be blank")
    if normalized not in LIVE_TYPE_VALUES:
        raise ValueError(f"live_type must be one of {LIVE_TYPE_VALUES}, got '{normalized}'")
    return normalized


def _strip_required_text(value: str) -> str:
    """Trim console form input and reject values that become blank after stripping."""
    normalized = value.strip()
    if normalized == "":
        raise ValueError("must not be blank")
    return normalized


class ConsoleSongCreateRequest(BaseModel):
    song_name: str = Field(..., min_length=1, max_length=255, description="Song title")
    band_id: int = Field(..., ge=0, description="band_attrs.id; 0 represents Other bands")
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


class ConsoleSongLookupItem(ConsoleSongItem):
    band_name: str = Field(..., description="Owning band display name")


class ConsoleSongMutationResponse(BaseModel):
    ok: bool = Field(..., description="Whether the write succeeded")
    item: ConsoleSongItem = Field(..., description="Created song payload")


ConsoleSongUpdateRequest = ConsoleSongCreateRequest


class ConsoleSongBatchCreateRequest(BaseModel):
    songs: list[ConsoleSongCreateRequest] = Field(
        ..., min_length=1, max_length=100, description="Songs to create in batch"
    )


class ConsoleSongBatchCreateResponse(BaseModel):
    ok: bool = Field(..., description="Whether all creates succeeded")
    created: list[ConsoleSongItem] = Field(default_factory=list, description="Successfully created songs")


class ConsoleSongListResponse(BaseModel):
    items: list[ConsoleSongLookupItem] = Field(..., description="Songs available for console lookup")
    page: int = Field(..., ge=1, description="Current page")
    page_size: int = Field(..., ge=1, description="Requested page size")
    total: int = Field(..., ge=0, description="Total matching songs")
    total_pages: int = Field(..., ge=1, description="Total pages")


class ConsoleBandItem(BaseModel):
    band_id: int = Field(..., description="band_attrs.id")
    band_name: str = Field(..., description="Band display name")
    band_abbr: str = Field(..., description="Band abbreviation")
    band_members: list[str] = Field(..., description="Members used by the console member selector")


class ConsoleBandListResponse(BaseModel):
    items: list[ConsoleBandItem] = Field(..., description="Bands available for console lookup")


class ConsoleVenueItem(BaseModel):
    venue_id: int = Field(..., description="venue_list.id")
    venue_name: str = Field(..., description="Venue display name")


class ConsoleVenueListResponse(BaseModel):
    items: list[ConsoleVenueItem] = Field(..., description="Venues available for console lookup")


class ConsoleVenueCreateRequest(BaseModel):
    venue_name: str = Field(..., min_length=1, max_length=255, description="Venue display name")

    @field_validator("venue_name")
    @classmethod
    def validate_venue_name(cls, value: str) -> str:
        """Normalize venue_name before the console venue-create endpoint stores it."""
        return _strip_required_text(value)


class ConsoleVenueMutationResponse(BaseModel):
    ok: bool = Field(..., description="Whether the write succeeded")
    item: ConsoleVenueItem = Field(..., description="Created venue payload")


class ConsoleEventAttendeeRequest(BaseModel):
    band_id: int = Field(..., ge=1, description="Band whose members attend this event")
    members: list[str] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Complete recorded attendee list for this band",
    )

    @field_validator("members")
    @classmethod
    def validate_members(cls, value: list[str]) -> list[str]:
        """Trim attendee names and reject blanks or duplicates before DB-backed validation."""
        normalized = [member.strip() for member in value]
        if any(member == "" for member in normalized):
            raise ValueError("members must not contain blank names")
        if len(set(normalized)) != len(normalized):
            raise ValueError("members must not contain duplicates")
        return normalized


class ConsoleEventAttendee(BaseModel):
    band_id: int = Field(..., description="band_attrs.id")
    mode: Literal["partial", "full"] = Field(..., description="Computed attendance coverage")
    members: list[str] = Field(..., description="Complete recorded attendee list")


class ConsoleLiveUpsertRequest(BaseModel):
    live_date: date = Field(..., description="Live date")
    live_title: str = Field(..., min_length=1, max_length=255, description="Live title")
    url: str = Field(..., min_length=1, max_length=2048, description="Live URL")
    opening_time: str = Field(..., min_length=5, max_length=8, description="Opening time, e.g. 18:00 or 18:00:00")
    start_time: str = Field(..., min_length=5, max_length=8, description="Start time, e.g. 19:00 or 19:00:00")
    timezone: str = Field(..., min_length=6, max_length=6, description="UTC offset, e.g. +09:00")
    venue_id: int = Field(..., ge=1, description="venue_list.id")
    live_type: str = Field(
        ...,
        min_length=1,
        max_length=32,
        description="Live type code: oneman, taiban, multi_act, festival, event, other.",
    )
    default_band_ids: list[int] = Field(
        default_factory=list,
        max_length=100,
        description="Fallback band_attrs IDs used only while the live has no setlist rows.",
    )
    event_attendees: list[ConsoleEventAttendeeRequest] = Field(
        default_factory=list,
        max_length=100,
        description="Event-only Band member attendance; mode is computed and is not accepted as input.",
    )

    @field_validator("live_title", "url")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        """Normalize required text fields before the console live-create endpoint uses them."""
        return _strip_required_text(value)

    @field_validator("live_type")
    @classmethod
    def validate_live_type(cls, value: str) -> str:
        """Reject blank or unknown live_type values."""
        return _validate_live_type(value)

    @field_validator("default_band_ids")
    @classmethod
    def validate_default_band_ids(cls, value: list[int]) -> list[int]:
        """Require positive IDs and normalize the optional fallback list for stable output."""
        if any(band_id <= 0 for band_id in value):
            raise ValueError("default_band_ids must contain only positive band IDs")
        return sorted(set(value))

    @model_validator(mode="after")
    def validate_event_attendees(self) -> "ConsoleLiveUpsertRequest":
        """Keep event attendance scoped to event Lives and selected default Bands."""
        if self.live_type != "event" and self.event_attendees:
            raise ValueError("event_attendees are only allowed when live_type is event")
        attendee_band_ids = [attendee.band_id for attendee in self.event_attendees]
        if len(set(attendee_band_ids)) != len(attendee_band_ids):
            raise ValueError("event_attendees must not contain duplicate band_id values")
        missing_default_ids = sorted(set(attendee_band_ids) - set(self.default_band_ids))
        if missing_default_ids:
            missing_text = ", ".join(str(band_id) for band_id in missing_default_ids)
            raise ValueError(f"event attendee band_ids must be included in default_band_ids: {missing_text}")
        return self


ConsoleLiveCreateRequest = ConsoleLiveUpsertRequest


class ConsoleLiveItem(BaseModel):
    live_id: int = Field(..., description="Created live ID")
    live_date: date = Field(..., description="Live date")
    live_title: str = Field(..., description="Live title")
    live_type: str = Field(..., description="Stable live type code")
    url: str = Field(..., description="Live URL")
    opening_time: str = Field(..., description="Opening time with timezone")
    start_time: str = Field(..., description="Start time with timezone")
    venue_id: int = Field(..., description="venue_list.id")
    default_band_ids: list[int] = Field(..., description="Normalized fallback band_attrs IDs")
    event_attendees: list[ConsoleEventAttendee] = Field(
        default_factory=list,
        description="Event attendance with mode computed from the complete persisted member list",
    )


class ConsoleLiveCandidate(BaseModel):
    live_id: int = Field(..., description="live_attrs.id")
    live_date: date = Field(..., description="Live date")
    live_title: str = Field(..., description="Live title")
    live_type: str = Field(..., description="Stable live type code")
    venue_name: str = Field(..., description="Venue display name")


class ConsoleLiveCandidatesResponse(BaseModel):
    items: list[ConsoleLiveCandidate] = Field(..., description="Lives available for console editing")
    page: int = Field(..., ge=1, description="Current page")
    page_size: int = Field(..., ge=1, description="Requested page size")
    total: int = Field(..., ge=0, description="Total matching Lives")
    total_pages: int = Field(..., ge=1, description="Total pages")


class ConsoleLiveEditItem(ConsoleLiveItem):
    timezone: str = Field(..., min_length=6, max_length=6, description="UTC offset used by both times")
    venue_name: str = Field(..., description="Venue display name")


class ConsoleLiveEditResponse(BaseModel):
    item: ConsoleLiveEditItem = Field(..., description="Complete editable Live payload")


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
    other_member: dict[str, list[str] | str | None] | None = Field(default=None, description="Other member payload")
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


class ConsoleLiveSetlistEditRow(ConsoleLiveSetlistRowRequest):
    row_id: str = Field(..., description="Persisted live_setlist UUID")
    song_name: str = Field(..., description="Persisted song title")


class ConsoleLiveSetlistEditResponse(BaseModel):
    live_id: int = Field(..., description="Target live ID")
    rows: list[ConsoleLiveSetlistEditRow] = Field(..., description="Complete editable Setlist rows")


class ConsoleLiveSetlistReplaceResponse(BaseModel):
    ok: bool = Field(..., description="Whether the write succeeded")
    item: ConsoleLiveSetlistAppendItem = Field(..., description="Replacement result payload")


class ConsoleTourStopRequest(BaseModel):
    live_id: int = Field(..., ge=1, description="Associated live_attrs.id")
    stop_label: str | None = Field(default=None, max_length=255, description="Optional stop label")

    @field_validator("stop_label")
    @classmethod
    def validate_stop_label(cls, value: str | None) -> str | None:
        """Trim optional stop labels and normalize blank input to None."""
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class ConsoleTourUpsertRequest(BaseModel):
    tour_title: str = Field(..., min_length=1, max_length=255, description="Official or common tour title")
    band_ids: list[int] = Field(
        default_factory=list,
        max_length=100,
        description="Optional explicit tour bands; empty means aggregate bands from all stops",
    )
    stops: list[ConsoleTourStopRequest] = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Complete target stop collection",
    )

    @field_validator("tour_title")
    @classmethod
    def validate_tour_title(cls, value: str) -> str:
        """Normalize the required title before persistence."""
        return _strip_required_text(value)

    @field_validator("band_ids")
    @classmethod
    def validate_band_ids(cls, value: list[int]) -> list[int]:
        """Require positive, unique band IDs and persist them in stable ID order."""
        if any(band_id <= 0 for band_id in value):
            raise ValueError("band_ids must contain only positive IDs")
        if len(set(value)) != len(value):
            raise ValueError("band_ids must not contain duplicates")
        return sorted(value)

    @field_validator("stops")
    @classmethod
    def validate_stops(cls, value: list[ConsoleTourStopRequest]) -> list[ConsoleTourStopRequest]:
        """Reject duplicate Live IDs before opening a write transaction."""
        live_ids = [stop.live_id for stop in value]
        if len(set(live_ids)) != len(live_ids):
            raise ValueError("stops must not contain duplicate live_id values")
        return value


class ConsoleTourMutationItem(BaseModel):
    tour_id: int = Field(..., description="Created or updated tour ID")
    tour_title: str = Field(..., description="Normalized tour title")
    band_count: int = Field(..., ge=0, description="Persisted explicit tour band count")
    stop_count: int = Field(..., ge=1, description="Persisted tour stop count")


class ConsoleTourMutationResponse(BaseModel):
    ok: bool = Field(..., description="Whether the transaction succeeded")
    item: ConsoleTourMutationItem = Field(..., description="Mutation summary")


class ConsoleTourLiveCandidate(BaseModel):
    live_id: int = Field(..., description="live_attrs.id")
    live_date: date = Field(..., description="Live date")
    start_time: str = Field(..., description="Live start time with timezone")
    live_title: str = Field(..., description="Live title")
    venue: str | None = Field(default=None, description="Venue display name")
    tour_id: int | None = Field(default=None, description="Current tour ID, if assigned")
    tour_title: str | None = Field(default=None, description="Current tour title, if assigned")
    band_ids: list[int] = Field(default_factory=list, description="Effective Live band IDs")


class ConsoleTourLiveCandidatesResponse(BaseModel):
    items: list[ConsoleTourLiveCandidate] = Field(..., description="Live candidates for tour maintenance")
    page: int = Field(..., ge=1)
    page_size: int = Field(..., ge=1)
    total: int = Field(..., ge=0)
    total_pages: int = Field(..., ge=1)


class ConsoleTourEditStop(BaseModel):
    live_id: int = Field(..., description="Associated Live ID")
    live_date: date = Field(..., description="Live date")
    start_time: str = Field(..., description="Live start time with timezone")
    live_title: str = Field(..., description="Live title")
    venue: str | None = Field(default=None, description="Venue display name")
    stop_label: str | None = Field(default=None, description="Optional stop label")
    band_ids: list[int] = Field(default_factory=list, description="Effective Live band IDs")


class ConsoleTourEditResponse(BaseModel):
    tour_id: int = Field(..., description="Tour ID")
    tour_title: str = Field(..., description="Tour title")
    band_ids: list[int] = Field(default_factory=list, description="Explicit tour band IDs; empty enables fallback")
    stops: list[ConsoleTourEditStop] = Field(
        ..., min_length=1, description="Stops sorted by date, start time, and Live ID"
    )


class ConsolePerformanceGroupUpsertRequest(BaseModel):
    group_title: str = Field(..., min_length=1, max_length=255, description="Activity group display title")
    live_ids: list[int] = Field(
        ...,
        min_length=2,
        max_length=500,
        description="Complete target live ID collection",
    )

    @field_validator("group_title")
    @classmethod
    def validate_group_title(cls, value: str) -> str:
        return _strip_required_text(value)

    @field_validator("live_ids")
    @classmethod
    def validate_live_ids(cls, value: list[int]) -> list[int]:
        if any(live_id <= 0 for live_id in value):
            raise ValueError("live_ids must contain only positive IDs")
        if len(set(value)) != len(value):
            raise ValueError("live_ids must not contain duplicates")
        return value


class ConsolePerformanceGroupMutationItem(BaseModel):
    group_id: int = Field(..., description="Created or updated group ID")
    group_title: str = Field(..., description="Normalized group title")
    live_count: int = Field(..., ge=2, description="Persisted group live count")


class ConsolePerformanceGroupMutationResponse(BaseModel):
    ok: bool = Field(..., description="Whether the transaction succeeded")
    item: ConsolePerformanceGroupMutationItem = Field(..., description="Mutation summary")


class ConsolePerformanceGroupLiveCandidate(BaseModel):
    live_id: int = Field(..., description="live_attrs.id")
    live_date: date = Field(..., description="Live date")
    live_title: str = Field(..., description="Live title")
    start_time: str = Field(..., description="Live start time")
    venue: str | None = Field(default=None, description="Venue display name")
    band_ids: list[int] = Field(default_factory=list, description="Effective Live band IDs")


class ConsolePerformanceGroupLiveCandidatesResponse(BaseModel):
    items: list[ConsolePerformanceGroupLiveCandidate] = Field(..., description="Live candidates for group maintenance")
    page: int = Field(..., ge=1)
    page_size: int = Field(..., ge=1)
    total: int = Field(..., ge=0)
    total_pages: int = Field(..., ge=1)


class ConsolePerformanceGroupListItem(BaseModel):
    group_id: int = Field(..., description="Performance group ID")
    group_title: str = Field(..., description="Performance group title")


class ConsolePerformanceGroupListResponse(BaseModel):
    items: list[ConsolePerformanceGroupListItem] = Field(..., description="All editable performance groups")


class ConsolePerformanceGroupEditStop(BaseModel):
    live_id: int = Field(..., description="Associated Live ID")
    live_date: date = Field(..., description="Live date")
    live_title: str = Field(..., description="Live title")
    start_time: str = Field(..., description="Start time")
    venue: str | None = Field(default=None, description="Venue display name")
    band_ids: list[int] = Field(default_factory=list, description="Effective Live band IDs")


class ConsolePerformanceGroupEditResponse(BaseModel):
    group_id: int = Field(..., description="Group ID")
    group_title: str = Field(..., description="Group title")
    lives: list[ConsolePerformanceGroupEditStop] = Field(..., min_length=1, description="Group lives sorted by date/start_time/id")
