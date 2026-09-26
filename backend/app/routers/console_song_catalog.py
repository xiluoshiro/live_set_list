from typing import Any
from pathlib import Path as FilePath

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request

from fastapi.encoders import jsonable_encoder

from app.auth import AuthSessionContext, assert_valid_csrf, get_current_auth_context, require_role
from app.db import get_db_connection, get_write_db_connection
from app.routers.console_write import _write_console_audit_log
from app.schemas.song_catalog import (
    AlbumDetail, AlbumUpdate, AlbumWrite, AlbumTracksUpdate, GroupCreate, GroupMove, GroupUpdate,
    MemberUpdate, MemberWrite, OwnershipUpdate, SongMutation, SongVersion, VersionCreate, VersionUpdate,
)
from app.song_catalog import catalog_errors, lock_revision, one, read_album, read_song, rows, save_ownership

router = APIRouter(dependencies=[Depends(require_role("editor"))])


def audit(cur: Any, context: AuthSessionContext, action: str, kind: str, record_id: int, payload: dict[str, Any]) -> None:
    _write_console_audit_log(cur, user_id=context.user.id, action=action, resource_type=kind,
                             resource_id=str(record_id), payload_json=jsonable_encoder(payload))


def insert_version(cur: Any, payload: VersionCreate | GroupCreate, group_id: int) -> int:
    cur.execute("SELECT id FROM song_groups WHERE id = %s FOR UPDATE", (group_id,))
    if cur.fetchone() is None:
        raise HTTPException(404, "Song group not found")
    if isinstance(payload, VersionCreate):
        lock_revision(cur, "song_groups", group_id, payload.expected_group_revision)
    cur.execute("SELECT COALESCE(max(version_order), 0) + 1 FROM song_list WHERE group_id = %s", (group_id,))
    version_order = cur.fetchone()[0]
    cur.execute("""INSERT INTO song_list(song_name, group_id, version_label, version_order)
        VALUES (%s, %s, %s, %s) RETURNING id""",
                (payload.song_name, group_id, payload.version_label, version_order))
    song_id = cur.fetchone()[0]
    save_ownership(cur, song_id, payload.ownership)
    if isinstance(payload, VersionCreate):
        cur.execute("UPDATE song_groups SET revision = revision + 1 WHERE id = %s", (group_id,))
    return song_id


def create_version(payload: VersionCreate, request: Request, context: AuthSessionContext):
    assert_valid_csrf(request, context)
    with catalog_errors(), get_write_db_connection() as conn, conn.cursor() as cur:
        song_id = insert_version(cur, payload, payload.group_id)
        audit(cur, context, "song_create", "song", song_id, payload.model_dump(mode="json"))
        return {"ok": True, "item": read_song(cur, song_id)}


def update_version(payload: VersionUpdate, song_id: int, request: Request, context: AuthSessionContext):
    assert_valid_csrf(request, context)
    with catalog_errors(), get_write_db_connection() as conn, conn.cursor() as cur:
        lock_revision(cur, "song_list", song_id, payload.expected_revision)
        before = read_song(cur, song_id)
        if before["version_label"] == "" and payload.version_label:
            raise HTTPException(409, "歌曲组必须保留空版本的默认项")
        cur.execute("""UPDATE song_list SET song_name = %s, version_label = %s,
            revision = revision + 1 WHERE id = %s""",
                    (payload.song_name, payload.version_label, song_id))
        audit(cur, context, "song_update", "song", song_id,
              {"before": before, "after": payload.model_dump(mode="json")})
        return {"ok": True, "item": read_song(cur, song_id)}


@router.post("/song-groups", response_model=SongMutation, status_code=201)
def create_group(payload: GroupCreate, request: Request, context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    if payload.version_label:
        raise HTTPException(422, "新歌曲组的首个版本必须为默认项")
    with catalog_errors(), get_write_db_connection() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO song_groups(group_name) VALUES (%s) RETURNING id", (payload.group_name,))
        group_id = cur.fetchone()[0]
        song_id = insert_version(cur, payload, group_id)
        audit(cur, context, "song_create", "song", song_id, payload.model_dump(mode="json"))
        return {"ok": True, "item": read_song(cur, song_id)}


@router.put("/song-groups/{group_id}")
def update_group(payload: GroupUpdate, request: Request, group_id: int = Path(ge=1), context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    with catalog_errors(), get_write_db_connection() as conn, conn.cursor() as cur:
        lock_revision(cur, "song_groups", group_id, payload.expected_revision)
        cur.execute("SELECT id FROM song_list WHERE group_id = %s ORDER BY id FOR UPDATE", (group_id,))
        existing_ids = [row[0] for row in cur.fetchall()]
        if sorted(payload.song_ids) != existing_ids:
            raise HTTPException(422, "Provide every group version exactly once")
        for order, song_id in enumerate(payload.song_ids, 1):
            cur.execute("UPDATE song_list SET version_order = %s, revision = revision + 1 WHERE id = %s", (order, song_id))
        cur.execute("UPDATE song_groups SET group_name = %s, revision = revision + 1 WHERE id = %s", (payload.group_name, group_id))
        audit(cur, context, "song_group_update", "song_group", group_id, payload.model_dump())
        return {"ok": True, "revision": payload.expected_revision + 1}


@router.get("/songs/{song_id}", response_model=SongVersion)
def edit_song(song_id: int = Path(ge=1)):
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        return read_song(cur, song_id)


@router.put("/songs/{song_id}/ownership", response_model=SongMutation)
def correct_ownership(payload: OwnershipUpdate, request: Request, song_id: int = Path(ge=1), context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    with catalog_errors(), get_write_db_connection() as conn, conn.cursor() as cur:
        lock_revision(cur, "song_list", song_id, payload.expected_revision)
        before = read_song(cur, song_id)["ownership"]
        cur.execute("SELECT band_id FROM song_list WHERE id = %s", (song_id,))
        legacy_band_id = cur.fetchone()[0]
        save_ownership(cur, song_id, payload.ownership)
        cur.execute("UPDATE song_list SET revision = revision + 1 WHERE id = %s", (song_id,))
        audit(cur, context, "song_ownership_update", "song", song_id,
              {"before": before, "legacy_band_id": legacy_band_id, "after": payload.ownership.model_dump(), "reason": payload.reason})
        return {"ok": True, "item": read_song(cur, song_id)}


@router.put("/songs/{song_id}/group", response_model=SongMutation)
def move_group(payload: GroupMove, request: Request, song_id: int = Path(ge=1), context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    with catalog_errors(), get_write_db_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT group_id FROM song_list WHERE id = %s", (song_id,))
        record = cur.fetchone()
        if record is None:
            raise HTTPException(404, "Song not found")
        before = record[0]
        cur.execute("SELECT version_label FROM song_list WHERE id = %s", (song_id,))
        if cur.fetchone()[0] == "":
            raise HTTPException(409, "默认版本保留在所属歌曲组中")
        cur.execute("SELECT id FROM song_groups WHERE id = ANY(%s) ORDER BY id FOR UPDATE", ([before, payload.group_id],))
        if payload.group_id not in [row[0] for row in cur.fetchall()]:
            raise HTTPException(404, "Target group not found")
        lock_revision(cur, "song_list", song_id, payload.expected_revision)
        cur.execute("SELECT COALESCE(max(version_order), 0) + 1 FROM song_list WHERE group_id = %s", (payload.group_id,))
        order = cur.fetchone()[0]
        cur.execute("UPDATE song_list SET group_id = %s, version_order = %s, revision = revision + 1 WHERE id = %s", (payload.group_id, order, song_id))
        cur.execute("UPDATE song_groups SET revision = revision + 1 WHERE id = ANY(%s)", ([before, payload.group_id],))
        cur.execute("DELETE FROM song_groups g WHERE id = %s AND NOT EXISTS(SELECT 1 FROM song_list s WHERE s.group_id = g.id)", (before,))
        audit(cur, context, "song_group_move", "song", song_id,
              {"before": before, "after": payload.group_id, "reason": payload.reason})
        return {"ok": True, "item": read_song(cur, song_id)}


@router.get("/albums")
def list_albums(q: str = Query("", max_length=255)):
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id AS album_id, album_name, release_label, release_date, cover_path, revision
            FROM albums WHERE album_name ILIKE %s ORDER BY release_date DESC NULLS LAST, id DESC LIMIT 500""", ("%" + q + "%",))
        return {"items": rows(cur)}


@router.get("/albums/{album_id}", response_model=AlbumDetail)
def edit_album(album_id: int = Path(ge=1)):
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        return read_album(cur, album_id)


def save_album(payload: AlbumWrite, request: Request, context: AuthSessionContext, album_id: int | None = None):
    assert_valid_csrf(request, context)
    if payload.cover_path:
        frontend = FilePath(__file__).resolve().parents[3] / "frontend"
        relative = payload.cover_path.lstrip("/")
        if not any((frontend / folder / relative).is_file() for folder in ("public", "dist")):
            raise HTTPException(422, "封面文件不存在，请先将图片放入随包目录")
    with catalog_errors(), get_write_db_connection() as conn, conn.cursor() as cur:
        fields = (payload.album_name, payload.release_label, payload.release_date, payload.cover_path)
        if album_id is None:
            cur.execute("""INSERT INTO albums(album_name, release_label, release_date, cover_path)
                VALUES (%s, %s, %s, %s) RETURNING id""", fields)
            album_id = cur.fetchone()[0]
            existing_tracks: set[int] = set()
        else:
            assert isinstance(payload, AlbumUpdate)
            lock_revision(cur, "albums", album_id, payload.expected_revision)
            cur.execute("""UPDATE albums SET album_name = %s, release_label = %s, release_date = %s,
                cover_path = %s, revision = revision + 1 WHERE id = %s""", (*fields, album_id))
            cur.execute("SELECT id FROM album_tracks WHERE album_id = %s", (album_id,))
            existing_tracks = {row[0] for row in cur.fetchall()}
        if payload.tracks is not None:
            retained = {track.album_track_id for track in payload.tracks if track.album_track_id is not None}
            if not retained <= existing_tracks:
                raise HTTPException(422, "Track ID does not belong to this album")
            cur.execute("DELETE FROM album_tracks WHERE album_id = %s AND NOT(id = ANY(%s))", (album_id, list(retained)))
            cur.execute("SELECT section_name, id FROM album_sections WHERE album_id = %s", (album_id,))
            section_ids = dict(cur.fetchall())
            section_names = list(dict.fromkeys(track.section_name for track in payload.tracks)) or [""]
            for position, name in enumerate(section_names, 1):
                if name not in section_ids:
                    cur.execute("""INSERT INTO album_sections(album_id, section_name, display_order)
                        VALUES (%s, %s, %s) RETURNING id""", (album_id, name, position))
                    section_ids[name] = cur.fetchone()[0]
                else:
                    cur.execute("UPDATE album_sections SET display_order = %s WHERE id = %s",
                                (position, section_ids[name]))
            track_orders: dict[str, int] = {}
            for track in payload.tracks:
                order = track_orders.get(track.section_name, 0) + 1
                track_orders[track.section_name] = order
                section_id = section_ids[track.section_name]
                if track.album_track_id is None:
                    cur.execute("""INSERT INTO album_tracks(album_id, song_id, track_order, edition_label, section_id)
                        VALUES (%s, %s, %s, %s, %s)""", (album_id, track.song_id, order, track.edition_label, section_id))
                else:
                    cur.execute("""UPDATE album_tracks SET song_id = %s, track_order = %s, edition_label = %s, section_id = %s
                        WHERE id = %s AND album_id = %s""", (track.song_id, order, track.edition_label, section_id, track.album_track_id, album_id))
            cur.execute("DELETE FROM album_sections WHERE album_id = %s AND NOT(section_name = ANY(%s))",
                        (album_id, section_names))
        assert album_id is not None
        audit(cur, context, "album_save", "album", album_id, payload.model_dump(mode="json"))
        return read_album(cur, album_id)


@router.post("/albums", response_model=AlbumDetail, status_code=201)
def create_album(payload: AlbumWrite, request: Request, context: AuthSessionContext = Depends(get_current_auth_context)):
    return save_album(payload, request, context)


@router.put("/albums/{album_id}", response_model=AlbumDetail)
def update_album(payload: AlbumUpdate, request: Request, album_id: int = Path(ge=1), context: AuthSessionContext = Depends(get_current_auth_context)):
    return save_album(payload, request, context, album_id)


@router.put("/albums/{album_id}/tracks", response_model=AlbumDetail)
def update_album_tracks(payload: AlbumTracksUpdate, request: Request, album_id: int = Path(ge=1), context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        album = read_album(cur, album_id)
    return save_album(AlbumUpdate(
        album_name=album["album_name"], release_label=album["release_label"], release_date=album["release_date"],
        cover_path=album["cover_path"], expected_revision=payload.expected_revision, tracks=payload.tracks,
    ), request, context, album_id)


@router.get("/members")
def list_members():
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id AS member_id, display_name, revision FROM members ORDER BY id")
        return {"items": rows(cur)}


@router.post("/members", status_code=201)
def create_member(payload: MemberWrite, request: Request, context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    with catalog_errors(), get_write_db_connection() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO members(display_name) VALUES (%s) RETURNING id AS member_id, display_name, revision", (payload.display_name,))
        member = one(cur)
        audit(cur, context, "member_create", "member", member["member_id"], payload.model_dump())
        return member


@router.put("/members/{member_id}")
def update_member(payload: MemberUpdate, request: Request, member_id: int = Path(ge=1), context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    with catalog_errors(), get_write_db_connection() as conn, conn.cursor() as cur:
        lock_revision(cur, "members", member_id, payload.expected_revision)
        cur.execute("""UPDATE members SET display_name = %s, revision = revision + 1 WHERE id = %s
            RETURNING id AS member_id, display_name, revision""", (payload.display_name, member_id))
        member = one(cur)
        audit(cur, context, "member_update", "member", member_id, payload.model_dump())
        return member
