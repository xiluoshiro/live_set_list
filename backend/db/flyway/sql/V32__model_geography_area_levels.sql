SET ROLE live_project_owner;

-- Schema only. Corrections to existing localities and Venue addresses are kept
-- in a separately reviewed, manually executed backfill outside Flyway.
ALTER TABLE public.geo_localities
    ADD COLUMN area_level text NOT NULL DEFAULT 'locality',
    ALTER COLUMN locality_name DROP NOT NULL,
    ADD CONSTRAINT geo_locality_area_level_valid CHECK (
        (area_level = 'country' AND admin_area IS NULL AND locality_name IS NULL)
        OR (area_level = 'admin_area' AND NULLIF(btrim(admin_area), '') IS NOT NULL AND locality_name IS NULL)
        OR (area_level = 'locality' AND NULLIF(btrim(locality_name), '') IS NOT NULL)
    );

RESET ROLE;
