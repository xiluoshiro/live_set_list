SET ROLE live_project_owner;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.band_name_versions
        WHERE valid_to IS NULL
        GROUP BY band_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'band_name_versions contains multiple open versions for one Band';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.band_lineup_versions
        WHERE valid_to IS NULL
        GROUP BY band_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'band_lineup_versions contains multiple open versions for one Band';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.band_lineup_versions
        WHERE predecessor_id IS NOT NULL
        GROUP BY predecessor_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'band_lineup_versions contains a branched predecessor chain';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.live_band_lineup_contexts
        WHERE next_lineup_version_id IS NOT NULL
        GROUP BY next_lineup_version_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'one successor lineup version is used by multiple transition Lives';
    END IF;
END
$$;

CREATE UNIQUE INDEX band_name_versions_one_open_idx
    ON public.band_name_versions (band_id)
    WHERE valid_to IS NULL;

CREATE UNIQUE INDEX band_lineup_versions_one_open_idx
    ON public.band_lineup_versions (band_id)
    WHERE valid_to IS NULL;

CREATE UNIQUE INDEX band_lineup_versions_one_successor_idx
    ON public.band_lineup_versions (predecessor_id)
    WHERE predecessor_id IS NOT NULL;

ALTER TABLE public.band_lineup_versions
    ADD COLUMN transition_live_id integer
        REFERENCES public.live_attrs(id) ON DELETE RESTRICT,
    ADD CONSTRAINT band_lineup_versions_transition_requires_predecessor
        CHECK (transition_live_id IS NULL OR predecessor_id IS NOT NULL),
    ADD CONSTRAINT band_lineup_versions_transition_change_type
        CHECK (
            transition_live_id IS NULL
            OR change_type IN ('addition', 'removal', 'replacement')
        );

CREATE INDEX band_lineup_versions_transition_live_idx
    ON public.band_lineup_versions (transition_live_id)
    WHERE transition_live_id IS NOT NULL;

UPDATE public.band_lineup_versions version
SET transition_live_id = context.live_id
FROM public.live_band_lineup_contexts context
WHERE context.next_lineup_version_id = version.id;

WITH current_versions AS (
    SELECT
        band.id AS band_id,
        name_version.id AS band_name_version_id,
        lineup_version.id AS lineup_version_id
    FROM public.band_attrs band
    JOIN LATERAL (
        SELECT version.id
        FROM public.band_name_versions version
        WHERE version.band_id = band.id
          AND version.valid_to IS NULL
    ) name_version ON true
    JOIN LATERAL (
        SELECT version.id
        FROM public.band_lineup_versions version
        WHERE version.band_id = band.id
          AND version.valid_to IS NULL
    ) lineup_version ON true
    WHERE band.id > 0
),
missing_live_bands AS (
    SELECT live.id AS live_id, default_band.band_id
    FROM public.live_attrs live
    CROSS JOIN LATERAL unnest(
        COALESCE(live.default_band_ids, ARRAY[]::integer[])
    ) default_band(band_id)
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.live_setlist setlist
        WHERE setlist.live_id = live.id
    )

    UNION

    SELECT live.id AS live_id, attendee.band_id::integer
    FROM public.live_attrs live
    CROSS JOIN LATERAL jsonb_object_keys(
        COALESCE(live.event_attendees, '{}'::jsonb)
    ) attendee(band_id)
)
INSERT INTO public.live_band_lineup_contexts (
    live_id,
    band_id,
    band_name_version_id,
    base_lineup_version_id,
    next_lineup_version_id,
    note
)
SELECT
    missing.live_id,
    missing.band_id,
    current.band_name_version_id,
    current.lineup_version_id,
    NULL,
    'V25 current-version context backfill'
FROM missing_live_bands missing
JOIN current_versions current ON current.band_id = missing.band_id
ON CONFLICT (live_id, band_id) DO NOTHING;

ALTER TABLE public.live_setlist
    ALTER COLUMN band_member DROP NOT NULL;

CREATE VIEW public.current_band_versions AS
SELECT
    band.id AS band_id,
    COALESCE(name_version.band_name, band.band_name) AS band_name,
    COALESCE(name_version.band_abbr, band.band_abbr) AS band_abbr,
    name_version.id AS band_name_version_id,
    lineup_version.id AS lineup_version_id,
    lineup_version.version_no,
    lineup_version.version_label,
    lineup_version.valid_from,
    COALESCE(lineup_members.members, ARRAY[]::text[]) AS band_members
FROM public.band_attrs band
LEFT JOIN LATERAL (
    SELECT version.id, version.band_name, version.band_abbr
    FROM public.band_name_versions version
    WHERE version.band_id = band.id
      AND version.valid_to IS NULL
) name_version ON true
LEFT JOIN LATERAL (
    SELECT
        version.id,
        version.version_no,
        version.version_label,
        version.valid_from
    FROM public.band_lineup_versions version
    WHERE version.band_id = band.id
      AND version.valid_to IS NULL
) lineup_version ON true
LEFT JOIN LATERAL (
    SELECT array_agg(member.member_name ORDER BY member.display_order) AS members
    FROM public.band_lineup_version_members member
    WHERE member.lineup_version_id = lineup_version.id
) lineup_members ON true;

CREATE VIEW public.effective_live_bands AS
SELECT DISTINCT performance.live_id, performance.band_id
FROM public.live_setlist_band_performances performance

UNION

SELECT live.id AS live_id, default_band.band_id
FROM public.live_attrs live
CROSS JOIN LATERAL unnest(
    COALESCE(live.default_band_ids, ARRAY[]::integer[])
) default_band(band_id)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.live_setlist setlist
    WHERE setlist.live_id = live.id
);

RESET ROLE;

GRANT SELECT ON TABLE
    public.current_band_versions,
    public.effective_live_bands
TO live_project_ro, live_project_super_ro;
