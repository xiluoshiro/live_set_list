from dataclasses import dataclass
from datetime import date
from typing import Literal


LiveType = Literal["oneman", "taiban", "multi_act", "festival", "event", "other"]
LiveListSort = Literal["date_desc", "date_asc"]


def effective_band_ids_sql(*, live_alias: str, setlist_alias: str, band_alias: str) -> str:
    """Build the shared stable-band projection for a Live."""
    return f"""
        COALESCE(
            (
                SELECT array_agg(effective.band_id ORDER BY effective.band_id)
                FROM effective_live_bands effective
                WHERE effective.live_id = {live_alias}.id
            ),
            ARRAY[]::int[]
        )
    """


@dataclass(frozen=True)
class LiveListFilters:
    q: str | None = None
    year: int | None = None
    live_type: LiveType | None = None
    band_id: int | None = None
    sort: LiveListSort = "date_desc"
    without_setlist: bool = False

    @property
    def is_default(self) -> bool:
        return (
            self.q is None
            and self.year is None
            and self.live_type is None
            and self.band_id is None
            and self.sort == "date_desc"
            and not self.without_setlist
        )


def normalize_list_query(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def build_lookup_pattern(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def build_live_where(filters: LiveListFilters) -> tuple[str, list[object]]:
    conditions: list[str] = []
    params: list[object] = []

    if filters.q is not None:
        pattern = build_lookup_pattern(filters.q)
        conditions.append(
            """
            (
                l.live_title ILIKE %s ESCAPE '\\'
                OR EXISTS (
                    SELECT 1
                    FROM venue_list filter_venue
                    WHERE filter_venue.id = l.venue_id
                      AND filter_venue.venue ILIKE %s ESCAPE '\\'
                )
                OR EXISTS (
                    SELECT 1
                    FROM live_setlist filter_setlist
                    LEFT JOIN song_list filter_song
                        ON filter_song.id = filter_setlist.song_id
                    WHERE filter_setlist.live_id = l.id
                      AND (
                          filter_song.song_name ILIKE %s ESCAPE '\\'
                      )
                )
                OR EXISTS (
                    SELECT 1
                    FROM effective_live_bands effective
                    JOIN current_band_versions filter_band
                      ON filter_band.band_id = effective.band_id
                    WHERE effective.live_id = l.id
                      AND (
                          filter_band.band_name ILIKE %s ESCAPE '\\'
                          OR filter_band.band_abbr ILIKE %s ESCAPE '\\'
                      )
                    )
            )
            """
        )
        params.extend([pattern, pattern, pattern, pattern, pattern])

    if filters.year is not None:
        conditions.append("l.live_date >= %s AND l.live_date < %s")
        params.extend([date(filters.year, 1, 1), date(filters.year + 1, 1, 1)])

    if filters.live_type is not None:
        conditions.append("l.live_type = %s")
        params.append(filters.live_type)

    if filters.band_id is not None:
        conditions.append(
            """
            EXISTS (
                SELECT 1
                FROM effective_live_bands effective
                WHERE effective.live_id = l.id
                  AND effective.band_id = %s
            )
            """
        )
        params.append(filters.band_id)

    if filters.without_setlist:
        conditions.append(
            """
            l.event_status <> 'cancelled'
            AND NOT EXISTS (
                SELECT 1
                FROM live_setlist missing_setlist
                WHERE missing_setlist.live_id = l.id
            )
            """
        )

    return (" AND ".join(f"({condition.strip()})" for condition in conditions) or "TRUE", params)


def build_filtered_live_queries(
    filters: LiveListFilters,
    *,
    favorite_user_id: int | None = None,
) -> tuple[str, tuple[object, ...], str, tuple[object, ...]]:
    where_sql, filter_params = build_live_where(filters)
    favorite_join = ""
    leading_params: list[object] = []
    if favorite_user_id is not None:
        favorite_join = "JOIN user_live_favorites favorite ON favorite.live_id = l.id AND favorite.user_id = %s"
        leading_params.append(favorite_user_id)

    event_priority_sql = "(l.live_type = 'event') ASC, " if filters.without_setlist else ""
    result_event_priority_sql = "(matched.live_type = 'event') ASC, " if filters.without_setlist else ""
    order_sql = event_priority_sql + (
        "l.live_date ASC, l.id ASC" if filters.sort == "date_asc" else "l.live_date DESC, l.id DESC"
    )
    result_order_sql = (
        result_event_priority_sql + "matched.live_date ASC, matched.id ASC"
        if filters.sort == "date_asc"
        else result_event_priority_sql + "matched.live_date DESC, matched.id DESC"
    )
    matched_params = tuple([*leading_params, *filter_params])
    band_ids_sql = effective_band_ids_sql(
        live_alias="matched",
        setlist_alias="setlist",
        band_alias="band",
    )
    count_query = f"""
        SELECT COUNT(*)
        FROM live_attrs l
        {favorite_join}
        WHERE {where_sql}
    """
    page_query = f"""
        WITH matched_lives AS (
            SELECT
                l.id,
                l.live_date,
                l.live_title,
                l.url,
                l.live_type,
                l.default_band_ids,
                tour.id AS tour_id,
                tour.tour_title,
                pg.id AS performance_group_id,
                pg.group_title,
                l.start_time,
                l.event_status,
                EXISTS (
                    SELECT 1 FROM live_schedule_history history
                    WHERE history.live_id = l.id
                ) AS was_rescheduled
            FROM live_attrs l
            {favorite_join}
            LEFT JOIN tour_lives tour_live
                ON tour_live.live_id = l.id
            LEFT JOIN tour_attrs tour
                ON tour.id = tour_live.tour_id
            LEFT JOIN performance_group_lives pgl
                ON pgl.live_id = l.id
            LEFT JOIN performance_group_attrs pg
                ON pg.id = pgl.group_id
            WHERE {where_sql}
            ORDER BY {order_sql}
            LIMIT %s OFFSET %s
        )
        SELECT
            matched.id,
            matched.live_date,
            matched.live_title,
            {band_ids_sql} AS band_ids,
            matched.url,
            matched.live_type,
            matched.tour_id,
            matched.tour_title,
            matched.performance_group_id,
            matched.group_title,
            matched.start_time,
            matched.event_status,
            matched.was_rescheduled
        FROM matched_lives matched
        GROUP BY
            matched.id,
            matched.live_date,
            matched.live_title,
            matched.url,
            matched.live_type,
            matched.default_band_ids,
            matched.tour_id,
            matched.tour_title,
            matched.performance_group_id,
            matched.group_title,
            matched.start_time,
            matched.event_status,
            matched.was_rescheduled
        ORDER BY {result_order_sql}
    """
    return count_query, matched_params, page_query, matched_params
