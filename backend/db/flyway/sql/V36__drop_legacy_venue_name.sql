SET ROLE live_project_owner;

-- Keep the comparison and removal in one transaction without concurrent name writes.
LOCK TABLE public.venue_list, public.venue_name_versions,
    public.live_attrs, public.live_schedule_history IN ACCESS EXCLUSIVE MODE;

DO $$ BEGIN
    IF EXISTS (
        SELECT venue.id
        FROM public.venue_list venue
        LEFT JOIN public.venue_name_versions version
          ON version.venue_id = venue.id AND version.valid_to IS NULL
        GROUP BY venue.id
        HAVING count(version.id) <> 1
    ) THEN
        RAISE EXCEPTION 'Every Venue must have exactly one current name before removing the legacy name';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.venue_list venue
        JOIN public.venue_name_versions version
          ON version.venue_id = venue.id AND version.valid_to IS NULL
        WHERE venue.venue IS DISTINCT FROM version.venue_name
    ) THEN
        RAISE EXCEPTION 'Legacy Venue names must match current name versions before removal';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.live_attrs live
        LEFT JOIN public.venue_name_versions version ON version.id = live.venue_name_version_id
        WHERE (live.venue_id IS NULL) <> (live.venue_name_version_id IS NULL)
           OR (live.venue_id IS NOT NULL AND version.venue_id IS DISTINCT FROM live.venue_id)
    ) OR EXISTS (
        SELECT 1 FROM public.live_schedule_history history
        LEFT JOIN public.venue_name_versions version ON version.id = history.previous_venue_name_version_id
        WHERE (history.previous_venue_id IS NULL) <> (history.previous_venue_name_version_id IS NULL)
           OR (history.previous_venue_id IS NOT NULL AND version.venue_id IS DISTINCT FROM history.previous_venue_id)
    ) THEN
        RAISE EXCEPTION 'Live and schedule history must retain valid Venue/name-version pairs';
    END IF;
END $$;

ALTER TABLE public.venue_list DROP COLUMN venue;

RESET ROLE;
