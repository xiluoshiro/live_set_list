SET ROLE live_project_owner;

-- Prevent duplicate master-data identities while preserving locally formatted display text.
CREATE UNIQUE INDEX geo_localities_country_identity_uq
    ON public.geo_localities (country_code)
    WHERE area_level = 'country';

CREATE UNIQUE INDEX geo_localities_admin_area_identity_uq
    ON public.geo_localities (country_code, lower(btrim(admin_area)))
    WHERE area_level = 'admin_area';

CREATE UNIQUE INDEX geo_localities_locality_identity_uq
    ON public.geo_localities (
        country_code,
        COALESCE(lower(btrim(admin_area)), ''),
        lower(btrim(locality_name))
    )
    WHERE area_level = 'locality';

-- Keep the useful venue-kind location boundary; the removed verification fields
-- and timezone-review workflow are not part of the consolidated migration.
ALTER TABLE public.venue_list
    ADD CONSTRAINT venue_location_scope CHECK (
        venue_kind = 'physical'
        OR (
            venue_kind = 'undisclosed'
            AND address IS NULL
            AND latitude IS NULL
            AND longitude IS NULL
            AND timezone_id IS NULL
        )
        OR (
            venue_kind = 'online'
            AND locality_id IS NULL
            AND address IS NULL
            AND latitude IS NULL
            AND longitude IS NULL
            AND timezone_id IS NULL
        )
    );

RESET ROLE;
