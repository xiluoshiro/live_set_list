SET ROLE live_project_owner;

DO $assert_venue_history$
BEGIN
    IF EXISTS (
        SELECT venue.id
        FROM public.venue_list venue
        LEFT JOIN public.venue_name_versions version
          ON version.venue_id = venue.id
         AND version.valid_to IS NULL
        WHERE venue.merged_into_venue_id IS NULL
        GROUP BY venue.id
        HAVING count(version.id) <> 1
    ) THEN
        RAISE EXCEPTION 'every active Venue must have exactly one open name version';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.live_attrs live
        LEFT JOIN public.venue_name_versions version
          ON version.id = live.venue_name_version_id
        WHERE (live.venue_id IS NULL) <> (live.venue_name_version_id IS NULL)
           OR (live.venue_id IS NOT NULL AND version.venue_id IS DISTINCT FROM live.venue_id)
    ) THEN
        RAISE EXCEPTION 'live_attrs contains an invalid Venue/name-version pair';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.live_schedule_history history
        LEFT JOIN public.venue_name_versions version
          ON version.id = history.previous_venue_name_version_id
        WHERE (history.previous_venue_id IS NULL)
                  <> (history.previous_venue_name_version_id IS NULL)
           OR (history.previous_venue_id IS NOT NULL
               AND version.venue_id IS DISTINCT FROM history.previous_venue_id)
    ) THEN
        RAISE EXCEPTION 'live_schedule_history contains an invalid Venue/name-version pair';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.venue_list source
        JOIN public.venue_list target ON target.id = source.merged_into_venue_id
        WHERE target.merged_into_venue_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Venue merge chains or cycles are not allowed';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.venue_name_versions earlier
        JOIN public.venue_name_versions later
          ON later.venue_id = earlier.venue_id
         AND later.id > earlier.id
         AND daterange(
                 COALESCE(earlier.valid_from, '-infinity'::date),
                 COALESCE(earlier.valid_to, 'infinity'::date),
                 '[)'
             ) && daterange(
                 COALESCE(later.valid_from, '-infinity'::date),
                 COALESCE(later.valid_to, 'infinity'::date),
                 '[)'
             )
    ) THEN
        RAISE EXCEPTION 'Venue name-version validity ranges must not overlap';
    END IF;
END
$assert_venue_history$;

ALTER TABLE public.live_attrs
    DROP CONSTRAINT live_attrs_venue_name_version_id_fkey,
    ADD CONSTRAINT live_attrs_venue_name_version_fkey
        FOREIGN KEY (venue_id, venue_name_version_id)
        REFERENCES public.venue_name_versions (venue_id, id)
        MATCH FULL
        ON DELETE RESTRICT;

ALTER TABLE public.live_schedule_history
    DROP CONSTRAINT live_schedule_history_previous_venue_name_version_id_fkey,
    ADD CONSTRAINT live_schedule_history_venue_name_version_fkey
        FOREIGN KEY (previous_venue_id, previous_venue_name_version_id)
        REFERENCES public.venue_name_versions (venue_id, id)
        MATCH FULL
        ON DELETE RESTRICT;

RESET ROLE;
