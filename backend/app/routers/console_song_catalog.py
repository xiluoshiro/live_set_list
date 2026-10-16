from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request

from fastapi.encoders import jsonable_encoder
from psycopg2.extras import Json

from app.auth import AuthSessionContext, assert_valid_csrf, get_current_auth_context, require_role
from app.db import get_db_connection, get_write_db_connection
from app.routers.console_write import _write_console_audit_log
from app.schemas.song_catalog import (
    AlbumDetail, AlbumPage, AlbumUpdate, AlbumWrite, AlbumTracksUpdate, GroupCreate, GroupMove, GroupUpdate,
    MemberUpdate, MemberWrite, OwnershipUpdate, SongEditMutation, SongEditUpdate, SongMutation, SongVersion, VersionCreate, VersionUpdate,
)
from app.song_catalog import catalog_errors, lock_revision, one, read_album, read_ownership, read_song, read_song_group, rows, save_ownership
from app.song_lookup import normalize_song_lookup_text, song_lookup_sql
from app.schemas.console import ConsoleSongBatchCreateRequest

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
    cur.execute("""INSERT INTO song_list(group_id, version_label, version_order, cover_urls)
        VALUES (%s, %s, %s, %s) RETURNING id""",
                (group_id, payload.version_label, version_order,
                 Json(payload.model_dump(mode="json")["cover_urls"])))
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
        cover_urls = payload.model_dump(mode="json")["cover_urls"] if "cover_urls" in payload.model_fields_set else before["cover_urls"]
        cur.execute("""UPDATE song_list SET version_label = %s, cover_urls = %s,
            revision = revision + 1 WHERE id = %s""",
                    (payload.version_label, Json(cover_urls), song_id))
        audit(cur, context, "song_update", "song", song_id,
              {"before": before, "after": {**payload.model_dump(mode="json"), "cover_urls": cover_urls}})
        return {"ok": True, "item": read_song(cur, song_id)}


def ownership_identity(owner: dict[str, Any]) -> tuple[Any, ...]:
    return (owner["mode"], tuple(sorted(owner["band_ids"])), tuple(sorted(
        (group["band_id"], tuple(sorted(group["member_ids"]))) for group in owner["member_groups"])))


def find_default_version(cur: Any, payload: GroupCreate) -> int | None:
    # Display order is editable; it does not change the identity of an owner set.
    expression, params = song_lookup_sql("g.group_name")
    cur.execute(f"SELECT s.id, s.owner_mode FROM song_list s JOIN song_groups g ON g.id = s.group_id WHERE s.version_label='' AND lower(btrim({expression})) = %s ORDER BY s.id",
                (*params, normalize_song_lookup_text(payload.group_name)))
    existing = cur.fetchall()
    expected = ownership_identity(payload.ownership.model_dump())
    for song_id, mode in existing:
        if ownership_identity(read_ownership(cur, song_id, mode)) == expected:
            return song_id
    return None


def insert_group(cur: Any, payload: GroupCreate) -> int:
    if payload.version_label:
        raise HTTPException(422, "新歌曲组的首个版本必须为默认项")
    cur.execute("INSERT INTO song_groups(group_name) VALUES (%s) RETURNING id", (payload.group_name,))
    return insert_version(cur, payload, cur.fetchone()[0])


def lock_song_title(cur: Any, title: str) -> None:
    cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (normalize_song_lookup_text(title),))


def create_groups_batch(payload: ConsoleSongBatchCreateRequest, request: Request, context: AuthSessionContext):
    assert_valid_csrf(request, context)
    results: list[dict[str, Any]] = []
    with catalog_errors(), get_write_db_connection() as conn, conn.cursor() as cur:
        # Stable lock ordering also serializes overlapping concurrent batches.
        for title in sorted({normalize_song_lookup_text(song.group_name) for song in payload.songs}):
            lock_song_title(cur, title)
        for index, song in enumerate(payload.songs):
            cur.execute("SAVEPOINT batch_song")
            try:
                with catalog_errors():
                    if song.version_label:
                        raise HTTPException(422, "新歌曲组的首个版本必须为默认项")
                    existing_id = find_default_version(cur, song)
                    song_id = existing_id if existing_id is not None else insert_group(cur, song)
                    if existing_id is None:
                        audit(cur, context, "song_create", "song", song_id, song.model_dump(mode="json"))
                    item = read_song(cur, song_id)
                results.append({"index": index, "item": item, "created": existing_id is None})
            except HTTPException as exc:
                if exc.status_code >= 500:
                    raise
                cur.execute("ROLLBACK TO SAVEPOINT batch_song")
                results.append({"index": index, "error": str(exc.detail)})
            cur.execute("RELEASE SAVEPOINT batch_song")
        return {"ok": all(result.get("item") is not None for result in results), "results": results}


@router.post("/song-groups", response_model=SongMutation, status_code=201)
def create_group(payload: GroupCreate, request: Request, context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    if payload.version_label:
        raise HTTPException(422, "新歌曲组的首个版本必须为默认项")
    with catalog_errors(), get_write_db_connection() as conn, conn.cursor() as cur:
        lock_song_title(cur, payload.group_name)
        if find_default_version(cur, payload) is not None:
            raise HTTPException(409, "同名歌曲及相同归属的默认版本已存在，请选择已有歌曲组")
        song_id = insert_group(cur, payload)
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
        save_ownership(cur, song_id, payload.ownership)
        cur.execute("UPDATE song_list SET revision = revision + 1 WHERE id = %s", (song_id,))
        audit(cur, context, "song_ownership_update", "song", song_id,
              {"before": before, "after": payload.ownership.model_dump()})
        return {"ok": True, "item": read_song(cur, song_id)}


@router.put("/songs/{song_id}/edit", response_model=SongEditMutation)
def edit_song_catalog(payload: SongEditUpdate, request: Request, song_id: int = Path(ge=1),
                      context: AuthSessionContext = Depends(get_current_auth_context)):
    """Save the entire editor as one transaction and one audit operation."""
    assert_valid_csrf(request, context)
    with catalog_errors(), get_write_db_connection() as conn, conn.cursor() as cur:
        source = payload.group
        target = payload.move_to_group
        # Match the group -> song lock ordering used by create, reorder and move.
        expected_groups = {source.group_id: source.expected_revision}
        if target:
            expected_groups[target.group_id] = target.expected_revision
        for group_id in sorted(expected_groups):
            lock_revision(cur, "song_groups", group_id, expected_groups[group_id])
        cur.execute("SELECT id, version_order FROM song_list WHERE group_id = %s ORDER BY id FOR UPDATE", (source.group_id,))
        existing = dict(cur.fetchall())
        if song_id not in existing:
            raise HTTPException(409, "歌曲归组已被修改，请重新加载后编辑")
        if sorted(source.song_ids) != sorted(existing):
            raise HTTPException(422, "Provide every group version exactly once")
        lock_revision(cur, "song_list", song_id, payload.expected_revision)
        before = read_song(cur, song_id)
        if before["version_label"] == "" and (payload.version_label or target):
            raise HTTPException(409, "默认版本须保留空版本标识并留在所属歌曲组中")
        old_ownership = {key: before["ownership"][key] for key in ("mode", "band_ids", "member_groups")}
        ownership_changed = old_ownership != payload.ownership.model_dump()
        cover_urls = payload.model_dump(mode="json")["cover_urls"] if "cover_urls" in payload.model_fields_set else before["cover_urls"]
        old_order = sorted(existing, key=lambda item: (existing[item], item))
        order_changed = source.song_ids != old_order or target is not None
        group_changed = source.group_name != before["group_name"] or order_changed
        song_changed = ownership_changed or target is not None or any((
            payload.version_label != before["version_label"],
            cover_urls != before["cover_urls"],
        ))
        if ownership_changed:
            save_ownership(cur, song_id, payload.ownership)
        remaining = [item for item in source.song_ids if not target or item != song_id]
        new_order = {item: index for index, item in enumerate(remaining, 1)} if order_changed else existing
        destination = target.group_id if target else source.group_id
        if target:
            cur.execute("SELECT COALESCE(max(version_order), 0) + 1 FROM song_list WHERE group_id = %s", (destination,))
            new_order[song_id] = cur.fetchone()[0]
        if song_changed or group_changed:
            cur.execute("""UPDATE song_list SET version_label = %s, cover_urls = %s,
                group_id = %s, version_order = %s, revision = revision + 1 WHERE id = %s""",
                        (payload.version_label, Json(cover_urls), destination, new_order[song_id], song_id))
        if group_changed:
            for other_id in remaining:
                if other_id != song_id:
                    cur.execute("UPDATE song_list SET version_order = %s, revision = revision + 1 WHERE id = %s",
                                (new_order[other_id], other_id))
            cur.execute("UPDATE song_groups SET group_name = %s, revision = revision + 1 WHERE id = %s",
                        (source.group_name, source.group_id))
            if target:
                cur.execute("UPDATE song_groups SET revision = revision + 1 WHERE id = %s", (destination,))
        if song_changed or group_changed:
            audit(cur, context, "song_edit", "song", song_id, {
                "before": {"song": before, "group": {"group_id": source.group_id,
                    "group_name": before["group_name"], "song_ids": old_order, "revision": source.expected_revision}},
                "after": {**payload.model_dump(mode="json"), "cover_urls": cover_urls},
            })
        return {"ok": True, "item": read_song(cur, song_id), "group": read_song_group(cur, destination)}


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


@router.get("/albums", response_model=AlbumPage)
def list_albums(
    q: str = Query("", max_length=255),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
):
    query = q.strip()
    pattern = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    where = "album_name ILIKE %s OR release_label ILIKE %s OR id::text = %s"
    params = (pattern, pattern, query)
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT count(*) FROM albums WHERE {where}", params)
        total = cur.fetchone()[0]
        total_pages = max(1, (total + limit - 1) // limit)
        safe_page = min(page, total_pages)
        cur.execute(f"""SELECT id AS album_id, album_name, release_label, release_date, album_url, cover_urls, revision
            FROM albums WHERE {where} ORDER BY release_date DESC NULLS LAST, id DESC LIMIT %s OFFSET %s""",
                    (*params, limit, (safe_page - 1) * limit))
        return {"items": rows(cur), "page": safe_page, "page_size": limit, "total": total, "total_pages": total_pages}


@router.get("/albums/{album_id}", response_model=AlbumDetail)
def edit_album(album_id: int = Path(ge=1)):
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        return read_album(cur, album_id)


def save_album(payload: AlbumWrite, request: Request, context: AuthSessionContext, album_id: int | None = None):
    assert_valid_csrf(request, context)
    with catalog_errors(), get_write_db_connection() as conn, conn.cursor() as cur:
        album_url, cover_urls = payload.album_url, payload.model_dump(mode="json")["cover_urls"]
        fields = (payload.album_name, payload.release_label, payload.release_date)
        if album_id is None:
            cur.execute("""INSERT INTO albums(album_name, release_label, release_date, album_url, cover_urls)
                VALUES (%s, %s, %s, %s, %s) RETURNING id""", (*fields, album_url, Json(cover_urls)))
            album_id = cur.fetchone()[0]
            existing_tracks: set[int] = set()
        else:
            assert isinstance(payload, AlbumUpdate)
            lock_revision(cur, "albums", album_id, payload.expected_revision)
            cur.execute("SELECT album_url, cover_urls FROM albums WHERE id = %s", (album_id,))
            previous_url, previous_covers = cur.fetchone()
            if "album_url" not in payload.model_fields_set:
                album_url = previous_url
            if "cover_urls" not in payload.model_fields_set:
                cover_urls = previous_covers
            cur.execute("""UPDATE albums SET album_name = %s, release_label = %s, release_date = %s,
                album_url = %s, cover_urls = %s, revision = revision + 1 WHERE id = %s""",
                        (*fields, album_url, Json(cover_urls), album_id))
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
        album = read_album(cur, album_id)
        audit(cur, context, "album_save", "album", album_id,
              {**payload.model_dump(mode="json"), "album_url": album_url, "cover_urls": cover_urls})
        return album


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
        expected_revision=payload.expected_revision, tracks=payload.tracks,
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
