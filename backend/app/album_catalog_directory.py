"""Public album directory; band associations come from the album's tracks."""
from typing import Any, Literal

from app.song_catalog import one, rows
from app.song_lookup import normalize_song_lookup_text, song_lookup_sql

AlbumSort = Literal["name", "recent", "release"]
SORT_SQL: dict[AlbumSort, str] = {
    "name": "",
    "recent": "a.release_date DESC NULLS LAST, ",
    "release": "a.release_date ASC NULLS LAST, ",
}


def read_album_page(cur: Any, *, q: str, band_id: int | None, sort: AlbumSort,
                    page: int, page_size: int) -> dict[str, Any]:
    pattern = "%" + normalize_song_lookup_text(q).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    predicates = []
    params: list[object] = []
    for column in ("a.album_name", "a.release_label", "b.band_name"):
        expression, normalization_params = song_lookup_sql(column)
        predicate = f"{expression} ILIKE %s"
        if column == "b.band_name":
            predicate = f"""EXISTS(SELECT 1 FROM album_owners o JOIN band_attrs b ON b.id = o.band_id
                WHERE o.album_id = a.id AND {predicate})"""
        predicates.append(predicate)
        params.extend((*normalization_params, pattern))
    base = f"""WITH owners AS (
        SELECT song_id, band_id FROM song_bands
        UNION SELECT song_id, band_id FROM song_member_groups
    ), album_owners AS (
        SELECT DISTINCT t.album_id, o.band_id FROM album_tracks t JOIN owners o ON o.song_id = t.song_id
    ), matched AS (
        SELECT a.* FROM albums a WHERE {' OR '.join(predicates)}
    ), selected AS (
        SELECT a.* FROM matched a WHERE %s::int IS NULL OR CASE WHEN %s = 0 THEN NOT EXISTS(
            SELECT 1 FROM album_owners o WHERE o.album_id = a.id)
            ELSE EXISTS(SELECT 1 FROM album_owners o WHERE o.album_id = a.id AND o.band_id = %s) END
    )"""
    params.extend((band_id, band_id, band_id))
    cur.execute(base + """ SELECT
        (SELECT count(*) FROM selected) AS total,
        (SELECT count(*) FROM matched) AS facet_total,
        COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.band_id = 0, f.band_id) FROM (
            SELECT o.band_id, b.band_name, count(*) AS album_count
            FROM matched a JOIN album_owners o ON o.album_id = a.id JOIN band_attrs b ON b.id = o.band_id
            GROUP BY o.band_id, b.band_name
            UNION ALL
            SELECT 0, '其他乐队', count(*)
            FROM matched a WHERE NOT EXISTS(SELECT 1 FROM album_owners o WHERE o.album_id = a.id)
        ) f), '[]'::jsonb) AS bands""", params)
    counts = one(cur)
    total_pages = max(1, (counts["total"] + page_size - 1) // page_size)
    page = min(page, total_pages)
    cur.execute(base + f""" SELECT a.id AS album_id, a.album_name, a.release_label, a.release_date,
        a.album_url, a.cover_urls, a.revision,
        (SELECT count(*) FROM album_tracks t WHERE t.album_id = a.id) AS track_count
        FROM selected a ORDER BY {SORT_SQL[sort]}lower(normalize(a.album_name, NFKC)), a.id
        LIMIT %s OFFSET %s""", (*params, page_size, (page - 1) * page_size))
    return {
        "items": rows(cur),
        "pagination": {"page": page, "page_size": page_size, "total": counts["total"], "total_pages": total_pages},
        "facets": {"total": counts["facet_total"], "bands": counts["bands"]},
    }
