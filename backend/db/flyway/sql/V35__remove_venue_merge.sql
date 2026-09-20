SET ROLE live_project_owner;

-- Do not silently discard an unexpected merge relationship.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.venue_list WHERE merged_into_venue_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Venue merge relationships must be resolved before removing merge support';
    END IF;
END $$;

DROP VIEW public.current_venue_versions;
ALTER TABLE public.venue_list DROP COLUMN merged_into_venue_id;

CREATE VIEW public.current_venue_versions AS
SELECT venue.id AS venue_id,
       version.venue_name,
       version.id AS venue_name_version_id,
       venue.venue_kind
FROM public.venue_list venue
JOIN public.venue_name_versions version
  ON version.venue_id = venue.id AND version.valid_to IS NULL;

RESET ROLE;
GRANT SELECT ON TABLE public.current_venue_versions TO live_project_ro, live_project_super_ro;
