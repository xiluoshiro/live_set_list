"""Shared song catalog reads and transactional ownership persistence."""
from contextlib import contextmanager
from typing import Any

from fastapi import HTTPException
from psycopg2 import Error
from psycopg2.errors import CheckViolation, ForeignKeyViolation, QueryCanceled, UniqueViolation

from app.schemas.song_catalog import Ownership


@contextmanager
def catalog_errors():
    try:
        yield
    except (UniqueViolation, CheckViolation) as exc:
        raise HTTPException(409, "Catalog constraint conflict") from exc
    except ForeignKeyViolation as exc:
        raise HTTPException(422, "Referenced catalog record does not exist or is in use") from exc
    except QueryCanceled as exc:
        raise HTTPException(504, "Database query timeout") from exc
    except Error as exc:
        raise HTTPException(500, "Database error") from exc


def rows(cur: Any) -> list[dict[str, Any]]:
    names = [column.name for column in cur.description]
    return [dict(zip(names, row)) for row in cur.fetchall()]


def one(cur: Any) -> dict[str, Any]:
    result = rows(cur)
    if not result:
        raise HTTPException(404, "Catalog record not found")
    return result[0]


# Fixed event clock, independent of X-Visitor-Timezone. Unknown clocks remain unknown.
EVENT_TODAY_SQL = """CASE
    WHEN v.timezone_id IS NOT NULL THEN (CURRENT_TIMESTAMP AT TIME ZONE v.timezone_id)::date
    WHEN COALESCE(l.start_time, l.opening_time) IS NOT NULL THEN
        ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') +
         make_interval(secs => EXTRACT(timezone FROM COALESCE(l.start_time, l.opening_time))::double precision))::date
    ELSE NULL END"""
VALID_PERFORMANCE_SQL = f"l.event_status <> 'cancelled' AND l.live_date <= ({EVENT_TODAY_SQL})"

# Aliases s (song) and stl (setlist) are used by both single and batch Live reads.
LIVE_COVER_SQL = """CASE
    WHEN s.owner_mode IS NULL THEN 'unknown'
    WHEN EXISTS(SELECT 1 FROM live_setlist_band_performance_members m WHERE m.setlist_id = stl.id
        AND (EXISTS(SELECT 1 FROM song_bands b WHERE b.song_id = s.id AND b.band_id = m.band_id)
             OR EXISTS(SELECT 1 FROM song_member_groups g WHERE g.song_id = s.id AND g.band_id = m.band_id)))
        THEN 'original'
    WHEN NOT EXISTS(SELECT 1 FROM live_setlist_band_performance_members m WHERE m.setlist_id = stl.id)
        OR EXISTS(SELECT 1 FROM live_setlist_band_performances p WHERE p.setlist_id = stl.id
            AND NOT EXISTS(SELECT 1 FROM live_setlist_band_performance_members m
                WHERE m.setlist_id = p.setlist_id AND m.band_id = p.band_id)) THEN 'unknown'
    ELSE 'cover' END"""


def require_setlist_date(cur: Any, live_id: int) -> None:
    """Caller holds the Live row lock throughout validation and setlist persistence."""
    cur.execute(f"""SELECT l.event_status, l.live_date, ({EVENT_TODAY_SQL}) AS today
        FROM live_attrs l LEFT JOIN venue_list v ON v.id = l.venue_id WHERE l.id = %s""", (live_id,))
    record = cur.fetchone()
    if record is None:
        raise HTTPException(404, "Live not found")
    event_status, live_date, today = record
    if event_status == "cancelled":
        raise HTTPException(409, "取消的演出不能保存歌单")
    if today is None:
        raise HTTPException(409, "请先补全演出场馆时区或线上演出时间，再保存歌单")
    if live_date > today:
        raise HTTPException(409, "未来的演出不能保存歌单")


def read_ownership(cur: Any, song_id: int, mode: str | None) -> dict[str, Any]:
    if mode is None:
        return {"mode": "pending", "band_ids": [], "member_groups": [], "bands": [], "groups": []}
    cur.execute("""SELECT sb.band_id, b.band_name FROM song_bands sb
        JOIN band_attrs b ON b.id = sb.band_id WHERE sb.song_id = %s
        ORDER BY sb.display_order, sb.band_id""", (song_id,))
    bands = rows(cur)
    cur.execute("""SELECT g.band_id, b.band_name, m.member_id, p.display_name
        FROM song_member_groups g JOIN band_attrs b ON b.id = g.band_id
        JOIN song_members m ON m.song_id = g.song_id AND m.band_id = g.band_id
        JOIN members p ON p.id = m.member_id WHERE g.song_id = %s
        ORDER BY g.display_order, g.band_id, m.display_order, m.member_id""", (song_id,))
    groups: dict[int, dict[str, Any]] = {}
    for member in rows(cur):
        group = groups.setdefault(member["band_id"], {
            "band_id": member["band_id"], "band_name": member["band_name"], "members": [],
        })
        group["members"].append({"member_id": member["member_id"], "display_name": member["display_name"]})
    return {
        "mode": mode or "pending", "band_ids": [band["band_id"] for band in bands],
        "member_groups": [{"band_id": g["band_id"], "member_ids": [m["member_id"] for m in g["members"]]}
                          for g in groups.values()],
        "bands": bands, "groups": list(groups.values()),
    }


def read_song(cur: Any, song_id: int) -> dict[str, Any]:
    cur.execute("""SELECT s.id AS song_id, s.song_name, s.group_id, g.group_name,
        s.version_label, s.version_order, s.owner_mode, s.revision, s.is_cover AS legacy_cover
        FROM song_list s JOIN song_groups g ON g.id = s.group_id WHERE s.id = %s""", (song_id,))
    song = one(cur)
    song["ownership"] = read_ownership(cur, song_id, song.pop("owner_mode"))
    cur.execute(f"""SELECT count(*) FROM live_setlist s JOIN live_attrs l ON l.id = s.live_id
        LEFT JOIN venue_list v ON v.id = l.venue_id WHERE s.song_id = %s AND {VALID_PERFORMANCE_SQL}""", (song_id,))
    song["performance_count"] = cur.fetchone()[0]
    cur.execute("""SELECT DISTINCT a.id AS album_id, a.album_name, a.release_label, a.release_date,
        a.cover_path, a.revision
        FROM album_tracks t JOIN albums a ON a.id = t.album_id WHERE t.song_id = %s
        ORDER BY a.release_date NULLS LAST, a.id""", (song_id,))
    song["albums"] = rows(cur)
    return song


def read_album(cur: Any, album_id: int) -> dict[str, Any]:
    cur.execute("""SELECT id AS album_id, album_name, release_label, release_date, cover_path,
        revision FROM albums WHERE id = %s""", (album_id,))
    album = one(cur)
    cur.execute("""SELECT t.id AS album_track_id, t.song_id, t.track_order, t.edition_label,
        s.song_name, s.version_label, s.group_id FROM album_tracks t
        JOIN song_list s ON s.id = t.song_id WHERE t.album_id = %s ORDER BY t.track_order, t.id""", (album_id,))
    album["tracks"] = rows(cur)
    return album


def lock_revision(cur: Any, table: str, record_id: int, expected: int) -> None:
    if table not in {"song_list", "song_groups", "albums", "members"}:
        raise ValueError("Unsupported catalog table")
    cur.execute(f"SELECT revision FROM {table} WHERE id = %s FOR UPDATE", (record_id,))
    record = cur.fetchone()
    if record is None:
        raise HTTPException(404, "Catalog record not found")
    if record[0] != expected:
        raise HTTPException(409, "资料已被修改，请重新加载后编辑")


def save_ownership(cur: Any, song_id: int, ownership: Ownership) -> None:
    cur.execute("SELECT id FROM song_list WHERE id = %s FOR UPDATE", (song_id,))
    if cur.fetchone() is None:
        raise HTTPException(404, "Song not found")
    cur.execute("DELETE FROM song_members WHERE song_id = %s", (song_id,))
    cur.execute("DELETE FROM song_member_groups WHERE song_id = %s", (song_id,))
    cur.execute("DELETE FROM song_bands WHERE song_id = %s", (song_id,))
    cur.execute("UPDATE song_list SET owner_mode = %s, band_id = NULL WHERE id = %s",
                (None if ownership.mode == "pending" else ownership.mode, song_id))
    for order, band_id in enumerate(ownership.band_ids, 1):
        cur.execute("INSERT INTO song_bands(song_id, band_id, display_order) VALUES (%s, %s, %s)",
                    (song_id, band_id, order))
    for order, group in enumerate(ownership.member_groups, 1):
        cur.execute("INSERT INTO song_member_groups(song_id, band_id, display_order) VALUES (%s, %s, %s)",
                    (song_id, group.band_id, order))
        for member_order, member_id in enumerate(group.member_ids, 1):
            cur.execute("INSERT INTO song_members(song_id, band_id, member_id, display_order) VALUES (%s, %s, %s, %s)",
                        (song_id, group.band_id, member_id, member_order))


def classify_live_cover(baseline: set[int], actual: set[int], complete: bool = True) -> str:
    if baseline & actual:
        return "original"
    if not baseline or not actual or not complete:
        return "unknown"
    return "cover"
