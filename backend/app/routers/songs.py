from typing import Literal
from app.song_lookup import normalize_song_lookup_text, song_lookup_sql
from fastapi import APIRouter, Path, Query

from app.db import get_db_connection
from app.schemas.song_catalog import AlbumDetail, GroupPage, PerformancePage, SongGroup, SongVersion
from app.song_catalog import (
    VALID_PERFORMANCE_SQL, catalog_errors, classify_live_cover, one, read_album,
    read_song, rows,
)

router = APIRouter(prefix="/api", tags=["songs"])


@router.get("/song-groups", response_model=GroupPage)
def list_song_groups(
    q: str = Query(default="", max_length=255),
    band_id: int | None = Query(default=None, ge=1),
    album_id: int | None = Query(default=None, ge=1),
    page: int = Query(default=1, ge=1),
    owner_mode: Literal["bands", "members", "mixed", "pending"] | None = None,
    member_id: int | None = Query(default=None, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    # All predicates refer to one version before groups are deduplicated.
    pattern = "%" + normalize_song_lookup_text(q).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    name_predicates = []
    parameters: list[object] = []
    for column in ["g.group_name", "s.song_name", "s.version_label"]:
        expression, normalization_params = song_lookup_sql(column)
        name_predicates.append(f"{expression} ILIKE %s")
        parameters.extend((*normalization_params, pattern))
    where = "(" + " OR ".join(name_predicates) + """ )
        AND (%s::int IS NULL OR EXISTS(SELECT 1 FROM song_bands b WHERE b.song_id = s.id AND b.band_id = %s)
             OR EXISTS(SELECT 1 FROM song_member_groups m WHERE m.song_id = s.id AND m.band_id = %s))
        AND (%s::int IS NULL OR EXISTS(SELECT 1 FROM album_tracks t WHERE t.song_id = s.id AND t.album_id = %s))
        AND (%s::text IS NULL OR COALESCE(s.owner_mode, 'pending') = %s)
        AND (%s::int IS NULL OR EXISTS(SELECT 1 FROM song_members m WHERE m.song_id = s.id AND m.member_id = %s))"""
    parameters.extend((band_id, band_id, band_id, album_id, album_id, owner_mode, owner_mode, member_id, member_id))
    matches = f"SELECT g.id AS group_id, s.id AS song_id, s.version_order FROM song_groups g JOIN song_list s ON s.group_id = g.id WHERE {where}"
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT count(DISTINCT group_id) FROM ({matches}) matched", parameters)
        total = cur.fetchone()[0]
        total_pages = max(1, (total + page_size - 1) // page_size)
        cur.execute(f"""WITH matched AS ({matches}) SELECT g.id AS group_id, g.group_name,
            (SELECT count(*) FROM song_list v WHERE v.group_id = g.id) AS version_count,
            array_agg(m.song_id ORDER BY m.version_order, m.song_id) AS matched_song_ids
            FROM song_groups g JOIN matched m ON m.group_id = g.id
            GROUP BY g.id ORDER BY lower(normalize(g.group_name, NFKC)), g.id LIMIT %s OFFSET %s""",
                    (*parameters, page_size, (page - 1) * page_size))
        return {"items": rows(cur), "pagination": {"page": page, "page_size": page_size, "total": total, "total_pages": total_pages}}



@router.get("/song-groups/{group_id}", response_model=SongGroup)
def song_group(group_id: int = Path(ge=1)):
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id AS group_id, group_name, revision FROM song_groups WHERE id = %s", (group_id,))
        group = one(cur)
        cur.execute("SELECT id FROM song_list WHERE group_id = %s ORDER BY version_order, id", (group_id,))
        group["versions"] = [read_song(cur, song_id) for song_id, in cur.fetchall()]
        return group


@router.get("/songs/{song_id}", response_model=SongVersion)
def song_detail(song_id: int = Path(ge=1)):
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        return read_song(cur, song_id)


@router.get("/albums/{album_id}", response_model=AlbumDetail)
def album_detail(album_id: int = Path(ge=1)):
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        return read_album(cur, album_id)


@router.get("/songs/{song_id}/performances", response_model=PerformancePage)
def song_performances(song_id: int = Path(ge=1), page: int = Query(1, ge=1), page_size: int = Query(30, ge=1, le=100)):
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        song = read_song(cur, song_id)
        cur.execute("SELECT id FROM song_list WHERE group_id = %s AND version_label = ''", (song["group_id"],))
        default = cur.fetchone()
        ownership = read_song(cur, default[0])["ownership"] if default else {"band_ids": [], "member_groups": []}
        baseline = set(ownership["band_ids"]) | {group["band_id"] for group in ownership["member_groups"]}
        total = song["performance_count"]
        total_pages = max(1, (total + page_size - 1) // page_size)
        cur.execute(f"""SELECT s.id::text AS setlist_id, l.id AS live_id, l.live_title, l.live_date,
            s.segment_type, s.sub_order, s.absolute_order, s.is_short,
            ARRAY(SELECT DISTINCT m.band_id FROM live_setlist_band_performance_members m
                  WHERE m.setlist_id = s.id) AS actual_bands,
            NOT EXISTS(SELECT 1 FROM live_setlist_band_performances p WHERE p.setlist_id = s.id
                AND NOT EXISTS(SELECT 1 FROM live_setlist_band_performance_members m
                    WHERE m.setlist_id = p.setlist_id AND m.band_id = p.band_id)) AS complete
            FROM live_setlist s JOIN live_attrs l ON l.id = s.live_id LEFT JOIN venue_list v ON v.id = l.venue_id
            WHERE s.song_group_id = %s AND {VALID_PERFORMANCE_SQL}
            ORDER BY l.live_date DESC, l.id DESC, s.absolute_order, s.id LIMIT %s OFFSET %s""",
                    (song["group_id"], page_size, (page - 1) * page_size))
        items = rows(cur)
        for item in items:
            item["live_cover"] = classify_live_cover(baseline, set(item.pop("actual_bands")), item.pop("complete"))
        return {"items": items, "pagination": {"page": page, "page_size": page_size, "total": total, "total_pages": total_pages}}
