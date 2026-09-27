from typing import Literal
from fastapi import APIRouter, Path, Query

from app.db import get_db_connection
from app.schemas.song_catalog import AlbumDetail, GroupPage, PerformancePage, SongGroup, SongVersion
from app.song_catalog import (
    VALID_PERFORMANCE_SQL, catalog_errors, classify_live_cover, one, read_album,
    read_song, rows,
)
from app.song_catalog_directory import SongSort, read_group_cover, read_group_page

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
    sort: SongSort = "name",
):
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        return read_group_page(cur, q=q, band_id=band_id, album_id=album_id, owner_mode=owner_mode,
                               member_id=member_id, sort=sort, page=page, page_size=page_size)



@router.get("/song-groups/{group_id}", response_model=SongGroup)
def song_group(group_id: int = Path(ge=1)):
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id AS group_id, group_name, revision FROM song_groups WHERE id = %s", (group_id,))
        group = one(cur)
        cur.execute("SELECT id FROM song_list WHERE group_id = %s ORDER BY version_order, id", (group_id,))
        group["versions"] = [read_song(cur, song_id) for song_id, in cur.fetchall()]
        group["display_cover"] = read_group_cover(cur, group_id)
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
def song_performances(song_id: int = Path(ge=1), page: int = Query(1, ge=1),
                      page_size: int = Query(30, ge=1, le=100), year: int | None = Query(None, ge=1, le=9999)):
    with catalog_errors(), get_db_connection() as conn, conn.cursor() as cur:
        song = read_song(cur, song_id)
        cur.execute("SELECT id FROM song_list WHERE group_id = %s AND version_label = ''", (song["group_id"],))
        default = cur.fetchone()
        ownership = read_song(cur, default[0])["ownership"] if default else {"band_ids": [], "member_groups": []}
        baseline = set(ownership["band_ids"]) | {group["band_id"] for group in ownership["member_groups"]}
        cur.execute(f"""SELECT EXTRACT(year FROM l.live_date)::int AS year, count(*) AS count
            FROM live_setlist s JOIN live_attrs l ON l.id = s.live_id LEFT JOIN venue_list v ON v.id = l.venue_id
            WHERE s.song_group_id = %s AND {VALID_PERFORMANCE_SQL}
            GROUP BY EXTRACT(year FROM l.live_date) ORDER BY year DESC""", (song["group_id"],))
        years = rows(cur)
        total = sum(item["count"] for item in years if year is None or item["year"] == year)
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
                AND (%s::int IS NULL OR EXTRACT(year FROM l.live_date) = %s)
            ORDER BY l.live_date DESC, l.id DESC, s.absolute_order, s.id LIMIT %s OFFSET %s""",
                    (song["group_id"], year, year, page_size, (page - 1) * page_size))
        items = rows(cur)
        for item in items:
            item["live_cover"] = classify_live_cover(baseline, set(item.pop("actual_bands")), item.pop("complete"))
        return {"items": items, "pagination": {"page": page, "page_size": page_size, "total": total, "total_pages": total_pages},
                "available_years": [item["year"] for item in years]}
