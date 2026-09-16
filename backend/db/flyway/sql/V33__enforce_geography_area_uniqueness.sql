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

RESET ROLE;
