from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class CatalogModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class MemberGroup(CatalogModel):
    band_id: int = Field(ge=1)
    member_ids: list[int] = Field(min_length=1)


class Ownership(CatalogModel):
    mode: Literal["bands", "members", "pending"]
    band_ids: list[int] = Field(default_factory=list)
    member_groups: list[MemberGroup] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_shape(self):
        if self.mode == "pending" and (self.band_ids or self.member_groups):
            raise ValueError("Pending ownership must be empty")
        if self.mode == "bands" and (not self.band_ids or self.member_groups):
            raise ValueError("Band ownership requires only band_ids")
        if self.mode == "members" and (self.band_ids or not self.member_groups):
            raise ValueError("Member ownership requires only member_groups")
        ids = self.band_ids or [group.band_id for group in self.member_groups]
        members = [member for group in self.member_groups for member in group.member_ids]
        if any(value < 1 for value in ids + members):
            raise ValueError("Ownership IDs must be positive")
        if len(set(ids)) != len(ids) or len(set(members)) != len(members):
            raise ValueError("Ownership IDs must not repeat")
        return self


class VersionFields(CatalogModel):
    song_name: str = Field(min_length=1, max_length=255)
    version_label: str = Field(default="", max_length=255)


class VersionCreate(VersionFields):
    group_id: int = Field(ge=1)
    expected_group_revision: int = Field(ge=1)
    ownership: Ownership


class GroupCreate(VersionFields):
    group_name: str = Field(min_length=1, max_length=255)
    ownership: Ownership


class VersionUpdate(VersionFields):
    expected_revision: int = Field(ge=1)


class OwnershipUpdate(CatalogModel):
    expected_revision: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=1000)
    ownership: Ownership


class GroupUpdate(CatalogModel):
    group_name: str = Field(min_length=1, max_length=255)
    expected_revision: int = Field(ge=1)
    song_ids: list[int] = Field(min_length=1)


class GroupMove(CatalogModel):
    group_id: int = Field(ge=1)
    expected_revision: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=1000)


class AlbumTrackWrite(CatalogModel):
    album_track_id: int | None = Field(default=None, ge=1)
    song_id: int = Field(ge=1)
    track_order: int | None = Field(default=None, ge=1)
    edition_label: str = Field(default="", max_length=255)


class AlbumWrite(CatalogModel):
    album_name: str = Field(min_length=1, max_length=255)
    release_label: str = Field(default="", max_length=255)
    release_date: date | None = None
    cover_path: str | None = Field(default=None, max_length=255)
    tracks: list[AlbumTrackWrite] | None = Field(default=None, max_length=500)

    @field_validator("release_date", mode="before")
    @classmethod
    def exact_date(cls, value):
        if value is not None and not isinstance(value, date):
            if not isinstance(value, str) or len(value) != 10:
                raise ValueError("Release date must be YYYY-MM-DD or null")
        return value

    @field_validator("cover_path")
    @classmethod
    def bundled_cover(cls, value: str | None) -> str | None:
        if value is not None:
            import re
            if not re.fullmatch(r"/album-covers/[A-Za-z0-9_-]+\.(?:webp|jpg|jpeg|png|avif)", value):
                raise ValueError("Cover must be a bundled /album-covers/ image")
        return value

    @model_validator(mode="after")
    def unique_order(self):
        ids = [track.album_track_id for track in self.tracks or [] if track.album_track_id is not None]
        if len(set(ids)) != len(ids):
            raise ValueError("Album track IDs must not repeat")
        return self


class AlbumUpdate(AlbumWrite):
    expected_revision: int = Field(ge=1)


class AlbumTracksUpdate(CatalogModel):
    expected_revision: int = Field(ge=1)
    tracks: list[AlbumTrackWrite] = Field(max_length=500)

    @model_validator(mode="after")
    def unique_track_ids(self):
        ids = [track.album_track_id for track in self.tracks if track.album_track_id is not None]
        if len(set(ids)) != len(ids):
            raise ValueError("Album track IDs must not repeat")
        return self


class MemberWrite(CatalogModel):
    display_name: str = Field(min_length=1, max_length=100)


class MemberUpdate(MemberWrite):
    expected_revision: int = Field(ge=1)


class BandRef(BaseModel):
    band_id: int
    band_name: str


class MemberRef(BaseModel):
    member_id: int
    display_name: str


class MemberGroupDetail(BandRef):
    members: list[MemberRef]


class OwnershipDetail(Ownership):
    bands: list[BandRef] = Field(default_factory=list)
    groups: list[MemberGroupDetail] = Field(default_factory=list)


class AlbumSummary(BaseModel):
    album_id: int
    album_name: str
    release_label: str
    release_date: date | None
    cover_path: str | None
    revision: int


class SongAlbum(AlbumSummary):
    track_order: int
    edition_label: str


class SongVersion(VersionFields):
    version_order: int
    song_id: int
    group_id: int
    group_name: str
    revision: int
    ownership: OwnershipDetail
    legacy_cover: bool
    performance_count: int
    albums: list[AlbumSummary]


class SongMutation(BaseModel):
    ok: bool = True
    item: SongVersion


class SongGroup(BaseModel):
    group_id: int
    group_name: str
    revision: int
    versions: list[SongVersion]


class GroupSummary(BaseModel):
    group_id: int
    group_name: str
    version_count: int
    matched_song_ids: list[int]


class CatalogPagination(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int


class GroupPage(BaseModel):
    items: list[GroupSummary]
    pagination: CatalogPagination


class AlbumTrack(AlbumTrackWrite):
    album_track_id: int
    track_order: int
    song_name: str
    version_label: str
    group_id: int


class AlbumDetail(AlbumSummary):
    tracks: list[AlbumTrack]


class Performance(BaseModel):
    setlist_id: str
    live_id: int
    live_title: str
    live_date: date
    segment_type: str
    sub_order: int
    absolute_order: int
    is_short: bool
    live_cover: Literal["original", "cover", "unknown"]


class PerformancePage(BaseModel):
    items: list[Performance]
    pagination: CatalogPagination
