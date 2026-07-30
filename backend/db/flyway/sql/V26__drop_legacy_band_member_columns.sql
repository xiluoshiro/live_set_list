SET ROLE live_project_owner;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.band_attrs band
        WHERE band.id > 0
          AND (
              (
                  SELECT COUNT(*)
                  FROM public.band_name_versions name_version
                  WHERE name_version.band_id = band.id
                    AND name_version.valid_to IS NULL
              ) <> 1
              OR (
                  SELECT COUNT(*)
                  FROM public.band_lineup_versions lineup_version
                  WHERE lineup_version.band_id = band.id
                    AND lineup_version.valid_to IS NULL
              ) <> 1
          )
    ) THEN
        RAISE EXCEPTION 'cannot drop legacy Band columns: a real Band lacks exactly one open name or lineup version';
    END IF;

    -- V25 intentionally stopped synchronizing band_attrs.band_members. A later
    -- open lineup may therefore differ from this deprecated projection; only
    -- the versioned lineup tables are required to be complete before deletion.

    IF EXISTS (
        SELECT 1
        FROM public.live_setlist setlist
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.live_setlist_band_performances performance
            WHERE performance.setlist_id = setlist.id
        )
    ) THEN
        RAISE EXCEPTION 'cannot drop live_setlist.band_member: a Setlist row lacks versioned performances';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.live_setlist setlist
        LEFT JOIN LATERAL (
            SELECT jsonb_object_agg(
                name_version.band_name,
                to_jsonb(COALESCE(performance_members.members, ARRAY[]::text[]))
                ORDER BY performance.band_id
            ) AS band_members
            FROM public.live_setlist_band_performances performance
            JOIN public.live_band_lineup_contexts context
              ON context.live_id = performance.live_id
             AND context.band_id = performance.band_id
            JOIN public.band_name_versions name_version
              ON name_version.id = context.band_name_version_id
            LEFT JOIN LATERAL (
                SELECT array_agg(member.member_name ORDER BY member.display_order) AS members
                FROM public.live_setlist_band_performance_members member
                WHERE member.setlist_id = performance.setlist_id
                  AND member.band_id = performance.band_id
            ) performance_members ON true
            WHERE performance.setlist_id = setlist.id
        ) versioned ON true
        WHERE setlist.band_member IS NOT NULL
          AND setlist.band_member IS DISTINCT FROM COALESCE(versioned.band_members, '{}'::jsonb)
    ) THEN
        RAISE EXCEPTION 'cannot drop live_setlist.band_member: legacy and versioned performances differ';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.live_attrs live
        CROSS JOIN LATERAL unnest(
            COALESCE(live.default_band_ids, ARRAY[]::integer[])
        ) default_band(band_id)
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.live_setlist setlist
            WHERE setlist.live_id = live.id
        )
          AND NOT EXISTS (
              SELECT 1
              FROM public.live_band_lineup_contexts context
              WHERE context.live_id = live.id
                AND context.band_id = default_band.band_id
          )
    ) THEN
        RAISE EXCEPTION 'cannot drop legacy Band columns: a default Band lacks a frozen Live context';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.live_attrs live
        CROSS JOIN LATERAL jsonb_object_keys(
            COALESCE(live.event_attendees, '{}'::jsonb)
        ) attendee(band_id)
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.live_band_lineup_contexts context
            WHERE context.live_id = live.id
              AND context.band_id = attendee.band_id::integer
        )
    ) THEN
        RAISE EXCEPTION 'cannot drop legacy Band columns: an event attendee lacks a frozen Live context';
    END IF;
END
$$;

ALTER TABLE public.live_setlist
    DROP COLUMN band_member;

ALTER TABLE public.band_attrs
    DROP COLUMN band_members;

RESET ROLE;
