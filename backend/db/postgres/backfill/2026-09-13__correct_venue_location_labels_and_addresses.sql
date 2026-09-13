\set ON_ERROR_STOP on

-- One-time data correction after Flyway V32 and the 2026-09-11 Venue backfill.
-- Run manually on live_statistic; do not include this script in Flyway.
-- Preserve locality IDs, Venue/Live references, timezones, coordinates,
-- map links, revision counters, and location verification timestamps.

BEGIN;

DO $block$
DECLARE
    current_flyway_version text;
BEGIN
    IF current_database() <> 'live_statistic' THEN
        RAISE EXCEPTION 'Refusing location correction on database %; expected live_statistic', current_database();
    END IF;

    SELECT version INTO current_flyway_version
    FROM public.flyway_schema_history
    WHERE success
    ORDER BY installed_rank DESC
    LIMIT 1;

    IF current_flyway_version IS DISTINCT FROM '32' THEN
        RAISE EXCEPTION 'Location correction requires Flyway V32; current version is %',
            COALESCE(current_flyway_version, '<none>');
    END IF;
END
$block$;

SET LOCAL ROLE live_project_owner;

CREATE TEMP TABLE _locality_corrections (
    country_code text NOT NULL,
    admin_area text,
    old_locality_name text NOT NULL,
    timezone_id text NOT NULL,
    new_area_level text NOT NULL
) ON COMMIT DROP;

INSERT INTO _locality_corrections
    (country_code, admin_area, old_locality_name, timezone_id, new_area_level)
VALUES
    ('JP', '東京都', '東京都区部', 'Asia/Tokyo', 'admin_area'),
    ('SG', NULL, 'Singapore', 'Asia/Singapore', 'country'),
    ('HK', NULL, '香港', 'Asia/Hong_Kong', 'country');

CREATE TEMP TABLE _address_corrections (
    venue_id integer PRIMARY KEY,
    old_address text NOT NULL,
    new_address text NOT NULL
) ON COMMIT DROP;

INSERT INTO _address_corrections (venue_id, old_address, new_address)
VALUES
    (45, '145 Anam-ro, Seongbuk-gu, Seoul 02841, South Korea',
         '145 Anam-ro, Seongbuk-gu, Seoul 02841'),
    (112, 'Good Morning City 9F, 247 Jangchungdan-ro, Jung-gu, Seoul 04564, South Korea',
          'Good Morning City 9F, 247 Jangchungdan-ro, Jung-gu, Seoul 04564'),
    (145, '26 Kyungheedae-ro, Dongdaemun-gu, Seoul 02447, South Korea',
          '26 Kyungheedae-ro, Dongdaemun-gu, Seoul 02447'),
    (155, 'KINTEX 2, 217-59 Kintex-ro, Ilsanseo-gu, Goyang-si, Gyeonggi-do 10390, South Korea',
          'KINTEX 2, 217-59 Kintex-ro, Ilsanseo-gu, Goyang-si, Gyeonggi-do 10390');

DO $block$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM _locality_corrections correction
        LEFT JOIN public.geo_localities locality
          ON locality.country_code = correction.country_code
         AND locality.admin_area IS NOT DISTINCT FROM correction.admin_area
         AND locality.locality_name = correction.old_locality_name
        GROUP BY correction.country_code, correction.admin_area, correction.old_locality_name
        HAVING count(locality.id) <> 1
    ) THEN
        RAISE EXCEPTION 'Expected original locality rows are missing or duplicated';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM _locality_corrections correction
        JOIN public.geo_localities locality
          ON locality.country_code = correction.country_code
         AND locality.admin_area IS NOT DISTINCT FROM correction.admin_area
         AND locality.locality_name = correction.old_locality_name
        WHERE locality.timezone_id IS DISTINCT FROM correction.timezone_id
           OR locality.area_level <> 'locality'
           OR locality.revision <> 1
    ) THEN
        RAISE EXCEPTION 'Original locality timezone, level or revision has changed';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM _locality_corrections correction
        JOIN public.geo_localities locality
          ON locality.country_code = correction.country_code
         AND locality.admin_area IS NOT DISTINCT FROM correction.admin_area
         AND locality.locality_name IS NULL
         AND locality.area_level = correction.new_area_level
    ) THEN
        RAISE EXCEPTION 'Corrected locality rows already exist';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM _address_corrections correction
        LEFT JOIN public.venue_list venue ON venue.id = correction.venue_id
        WHERE venue.id IS NULL
           OR venue.venue_kind <> 'physical'
           OR venue.merged_into_venue_id IS NOT NULL
           OR venue.address IS DISTINCT FROM correction.old_address
           OR venue.location_revision <> 2
           OR venue.location_verified_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Expected original Venue addresses or revisions have changed';
    END IF;
END
$block$;

UPDATE public.geo_localities locality
SET area_level = correction.new_area_level,
    locality_name = NULL
FROM _locality_corrections correction
WHERE locality.country_code = correction.country_code
  AND locality.admin_area IS NOT DISTINCT FROM correction.admin_area
  AND locality.locality_name = correction.old_locality_name
  AND locality.timezone_id = correction.timezone_id
  AND locality.area_level = 'locality'
  AND locality.revision = 1;

UPDATE public.venue_list venue
SET address = correction.new_address
FROM _address_corrections correction
WHERE venue.id = correction.venue_id
  AND venue.address = correction.old_address
  AND venue.location_revision = 2;

DO $block$
BEGIN
    IF (
        SELECT count(*)
        FROM _locality_corrections correction
        JOIN public.geo_localities locality
          ON locality.country_code = correction.country_code
         AND locality.admin_area IS NOT DISTINCT FROM correction.admin_area
         AND locality.locality_name IS NULL
         AND locality.timezone_id = correction.timezone_id
         AND locality.area_level = correction.new_area_level
         AND locality.revision = 1
    ) <> 3 THEN
        RAISE EXCEPTION 'Locality correction postcondition failed';
    END IF;

    IF (
        SELECT count(*)
        FROM _address_corrections correction
        JOIN public.venue_list venue ON venue.id = correction.venue_id
        WHERE venue.address = correction.new_address
          AND venue.location_revision = 2
          AND venue.location_verified_at IS NOT NULL
    ) <> 4 THEN
        RAISE EXCEPTION 'Venue address correction postcondition failed';
    END IF;
END
$block$;

INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, payload_json)
SELECT NULL, 'venue_address_correction', 'venue', correction.venue_id::text,
       jsonb_build_object(
           'source', 'manual_venue_location_label_address_backfill',
           'previous_address', correction.old_address,
           'address', correction.new_address,
           'location_revision', venue.location_revision
       )
FROM _address_corrections correction
JOIN public.venue_list venue ON venue.id = correction.venue_id;

COMMIT;
