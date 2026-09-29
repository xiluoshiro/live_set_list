"""Set-based public song directory summaries and band facets."""
from typing import Any, Literal

from app.song_catalog import VALID_PERFORMANCE_SQL, one, rows
from app.song_lookup import normalize_song_lookup_text, song_lookup_sql

SongSort = Literal["name", "plays", "recent", "release"]

SORT_SQL: dict[SongSort, str] = {
    "name": "",
    "plays": "COALESCE(p.performance_count, 0) DESC, ",
    "recent": "p.latest_performance_date DESC NULLS LAST, ",
    "release": "r.first_release_date ASC NULLS LAST, ",
}


def directory_matches(
    q: str, band_id: int | None, album_id: int | None,
    owner_mode: str | None, member_id: int | None,
) -> tuple[str, list[object]]:
    pattern = "%" + normalize_song_lookup_text(q).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    predicates = []
    params: list[object] = []
    for column in ("g.group_name", "s.song_name", "s.version_label", "b.band_name"):
        expression, normalization_params = song_lookup_sql(column)
        predicate = f"{expression} ILIKE %s"
        if column == "b.band_name":
            predicate = f"""EXISTS(SELECT 1 FROM owners o JOIN band_attrs b ON b.id = o.band_id
                WHERE o.song_id = s.id AND {predicate})"""
        predicates.append(predicate)
        params.extend((*normalization_params, pattern))
    # All filters apply to the same version, before grouping. Facets omit only band_id.
    base = f"""WITH owners AS (
        SELECT song_id, band_id FROM song_bands
        UNION SELECT song_id, band_id FROM song_member_groups
    ), matched AS (
        SELECT g.id AS group_id, s.id AS song_id, s.version_order
        FROM song_groups g JOIN song_list s ON s.group_id = g.id
        WHERE ({' OR '.join(predicates)})
        AND (%s::int IS NULL OR EXISTS(SELECT 1 FROM album_tracks t WHERE t.song_id = s.id AND t.album_id = %s))
        AND (%s::text IS NULL OR COALESCE(s.owner_mode, 'pending') = %s)
        AND (%s::int IS NULL OR EXISTS(SELECT 1 FROM song_members m WHERE m.song_id = s.id AND m.member_id = %s))
    ), selected_groups AS (
        SELECT m.group_id, array_agg(m.song_id ORDER BY m.version_order, m.song_id) AS matched_song_ids
        FROM matched m WHERE %s::int IS NULL OR EXISTS(
            SELECT 1 FROM owners o WHERE o.song_id = m.song_id AND o.band_id = %s)
        GROUP BY m.group_id
    )"""
    params.extend((album_id, album_id, owner_mode, owner_mode, member_id, member_id, band_id, band_id))
    return base, params


def read_group_page(
    cur: Any, *, q: str, band_id: int | None, album_id: int | None,
    owner_mode: str | None, member_id: int | None, sort: SongSort, page: int, page_size: int,
) -> dict[str, Any]:
    base, params = directory_matches(q, band_id, album_id, owner_mode, member_id)
    cur.execute(base + """ SELECT
        (SELECT count(*) FROM selected_groups) AS total,
        (SELECT count(DISTINCT group_id) FROM matched) AS facet_total,
        COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.band_id) FROM (
            SELECT o.band_id, b.band_name, count(DISTINCT m.group_id) AS song_count
            FROM matched m JOIN owners o ON o.song_id = m.song_id JOIN band_attrs b ON b.id = o.band_id
            GROUP BY o.band_id, b.band_name
        ) f), '[]'::jsonb) AS bands""", params)
    counts = one(cur)
    cur.execute(base + f""", group_albums AS (
        SELECT DISTINCT v.group_id, a.id AS album_id, a.album_name, a.release_label,
            a.release_date, a.album_url, a.cover_urls, a.revision
        FROM selected_groups g JOIN song_list v ON v.group_id = g.group_id
        JOIN album_tracks t ON t.song_id = v.id JOIN albums a ON a.id = t.album_id
    ), release_dates AS (
        SELECT group_id, min(release_date) AS first_release_date FROM group_albums GROUP BY group_id
    ), first_albums AS (
        SELECT a.group_id, jsonb_agg(to_jsonb(a) - 'group_id' ORDER BY a.album_id) AS albums
        FROM group_albums a JOIN release_dates r ON r.group_id = a.group_id AND r.first_release_date = a.release_date
        GROUP BY a.group_id
    ), covers AS (
        SELECT v.group_id, CASE WHEN jsonb_array_length(v.cover_urls) > 0
            THEN (v.cover_urls -> 0) || jsonb_build_object('source', 'song')
            ELSE a.display_cover END AS display_cover
        FROM selected_groups g JOIN song_list v ON v.group_id = g.group_id AND v.version_label = ''
        LEFT JOIN LATERAL (
            SELECT (a.cover_urls -> 0) || jsonb_build_object('source', 'album',
                'album_id', a.id, 'album_name', a.album_name) AS display_cover
            FROM albums a WHERE jsonb_array_length(a.cover_urls) > 0 AND EXISTS(
                SELECT 1 FROM album_tracks t WHERE t.album_id = a.id AND t.song_id = v.id)
            ORDER BY a.release_date ASC NULLS LAST, a.id LIMIT 1
        ) a ON true
    ), plays AS (
        SELECT s.song_group_id AS group_id, count(*) AS performance_count, max(l.live_date) AS latest_performance_date
        FROM live_setlist s JOIN selected_groups g ON g.group_id = s.song_group_id
        JOIN live_attrs l ON l.id = s.live_id LEFT JOIN venue_list v ON v.id = l.venue_id
        WHERE {VALID_PERFORMANCE_SQL} GROUP BY s.song_group_id
    ), versions AS (
        SELECT v.group_id, count(*) AS version_count FROM song_list v
        JOIN selected_groups g ON g.group_id = v.group_id GROUP BY v.group_id
    ) SELECT g.id AS group_id, g.group_name, versions.version_count, m.matched_song_ids,
        r.first_release_date, COALESCE(f.albums, '[]'::jsonb) AS first_release_albums,
        COALESCE(p.performance_count, 0) AS performance_count, p.latest_performance_date, c.display_cover
        FROM selected_groups m JOIN song_groups g ON g.id = m.group_id
        JOIN versions ON versions.group_id = g.id
        LEFT JOIN release_dates r ON r.group_id = g.id LEFT JOIN first_albums f ON f.group_id = g.id
        LEFT JOIN covers c ON c.group_id = g.id LEFT JOIN plays p ON p.group_id = g.id
        ORDER BY {SORT_SQL[sort]}lower(normalize(g.group_name, NFKC)), g.id LIMIT %s OFFSET %s""",
        (*params, page_size, (page - 1) * page_size))
    return {
        "items": rows(cur),
        "pagination": {"page": page, "page_size": page_size, "total": counts["total"],
                       "total_pages": max(1, (counts["total"] + page_size - 1) // page_size)},
        "facets": {"total": counts["facet_total"], "bands": counts["bands"]},
    }
