-- Manually reviewed local-main-DB backfill. Do not add to Flyway.
-- Preconditions freeze the 2026-09-13 source rows; any drift aborts the transaction.
-- ONLINE Lives and pre-V31 schedule-history snapshots remain unchanged.

BEGIN;

DO $guard$
DECLARE
    flyway_version text;
BEGIN
    IF current_database() <> 'live_statistic' THEN
        RAISE EXCEPTION 'Refusing Live timezone backfill on %', current_database();
    END IF;
    SELECT version INTO flyway_version
    FROM public.flyway_schema_history WHERE success
    ORDER BY installed_rank DESC LIMIT 1;
    IF flyway_version IS DISTINCT FROM '32' THEN
        RAISE EXCEPTION 'Expected Flyway V32, found %', flyway_version;
    END IF;
END
$guard$;

SET LOCAL ROLE live_project_owner;
LOCK TABLE public.live_attrs, public.venue_list, public.geo_localities
    IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE _timezone_candidates ON COMMIT DROP AS
SELECT l.id, l.live_date, l.venue_id,
       l.opening_time AS old_opening_time,
       l.start_time AS old_start_time,
       l.timezone_offset_minutes AS old_offset,
       COALESCE(v.timezone_id, g.timezone_id) AS timezone_id,
       v.location_revision,
       (EXTRACT(EPOCH FROM (
           ((l.live_date + time '12:00') AT TIME ZONE 'UTC')
           - ((l.live_date + time '12:00') AT TIME ZONE COALESCE(v.timezone_id, g.timezone_id))
       )) / 60)::integer AS noon_offset,
       CASE WHEN l.opening_time IS NULL THEN NULL ELSE
           (EXTRACT(EPOCH FROM (
               ((l.live_date + left(l.opening_time::text, 8)::time) AT TIME ZONE 'UTC')
               - ((l.live_date + left(l.opening_time::text, 8)::time)
                  AT TIME ZONE COALESCE(v.timezone_id, g.timezone_id))
           )) / 60)::integer END AS opening_offset,
       CASE WHEN l.start_time IS NULL THEN NULL ELSE
           (EXTRACT(EPOCH FROM (
               ((l.live_date + left(l.start_time::text, 8)::time) AT TIME ZONE 'UTC')
               - ((l.live_date + left(l.start_time::text, 8)::time)
                  AT TIME ZONE COALESCE(v.timezone_id, g.timezone_id))
           )) / 60)::integer END AS start_offset
FROM public.live_attrs l
JOIN public.venue_list v ON v.id = l.venue_id
LEFT JOIN public.geo_localities g ON g.id = v.locality_id
WHERE l.timezone_source = 'legacy_offset'
  AND v.venue_kind = 'physical'
  AND v.merged_into_venue_id IS NULL
  AND COALESCE(v.timezone_id, g.timezone_id) IS NOT NULL;

DO $guard$
DECLARE
    fingerprint text;
BEGIN
    IF (SELECT count(*) FROM public.live_attrs WHERE timezone_source = 'legacy_offset') <> 594
       OR (SELECT count(*) FROM _timezone_candidates) <> 576 THEN
        RAISE EXCEPTION 'Legacy or candidate row count drifted';
    END IF;

    SELECT md5(string_agg(
        id::text || ':' || live_date::text || ':' || venue_id::text || ':'
        || COALESCE(old_opening_time::text, 'NULL') || ':'
        || COALESCE(old_start_time::text, 'NULL') || ':'
        || old_offset::text || ':' || timezone_id || ':' || location_revision::text,
        ',' ORDER BY id
    )) INTO fingerprint FROM _timezone_candidates;
    IF fingerprint IS DISTINCT FROM '7cae31b140d34992fa0772c7e377d2b0' THEN
        RAISE EXCEPTION 'Candidate fingerprint drifted: %', fingerprint;
    END IF;

    IF (SELECT count(*) FROM _timezone_candidates
        WHERE id <> 377 AND old_offset = noon_offset
          AND (opening_offset IS NULL OR opening_offset = old_offset)
          AND (start_offset IS NULL OR start_offset = old_offset)
          AND location_revision = 2) <> 575 THEN
        RAISE EXCEPTION 'The 575 consistent rows are no longer consistent';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM _timezone_candidates
        WHERE id = 377 AND live_date = date '2018-07-22' AND venue_id = 116
          AND timezone_id = 'Asia/Shanghai' AND location_revision = 2
          AND old_offset = 540 AND noon_offset = 480
          AND old_opening_time = '09:00:00+09'::timetz
          AND old_start_time = '10:30:00+09'::timetz
          AND opening_offset = 480 AND start_offset = 480
    ) THEN
        RAISE EXCEPTION 'Live 377 old values or Shanghai timezone drifted';
    END IF;
    IF (SELECT array_agg(l.id ORDER BY l.id)
        FROM public.live_attrs l JOIN public.venue_list v ON v.id = l.venue_id
        WHERE l.timezone_source = 'legacy_offset' AND v.venue_kind = 'online')
       IS DISTINCT FROM ARRAY[496,497,498,499,502,503,504,506,510,511,514,515,519,520,531,533] THEN
        RAISE EXCEPTION 'ONLINE exclusion set drifted';
    END IF;
    IF EXISTS (SELECT 1 FROM public.geo_localities
               WHERE country_code = 'JP' AND admin_area = '沖縄県') THEN
        RAISE EXCEPTION 'Okinawa administrative area already exists';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.venue_list
        WHERE id = 32 AND venue = '沖縄県某所' AND venue_kind = 'undisclosed'
          AND merged_into_venue_id IS NULL AND locality_id IS NULL
          AND address IS NULL AND latitude IS NULL AND longitude IS NULL
          AND timezone_id IS NULL AND location_revision = 1
    ) THEN
        RAISE EXCEPTION 'Venue 32 no longer matches county-only baseline';
    END IF;
    IF (SELECT count(*) FROM public.live_schedule_history) <> 4
       OR EXISTS (SELECT 1 FROM public.live_schedule_history
                  WHERE previous_timezone_source IS NOT NULL
                     OR previous_timezone_id IS NOT NULL
                     OR previous_timezone_offset_minutes IS NOT NULL) THEN
        RAISE EXCEPTION 'Pre-V31 schedule history drifted';
    END IF;
END
$guard$;

CREATE TEMP TABLE _okinawa ON COMMIT DROP AS
WITH inserted AS (
    INSERT INTO public.geo_localities
        (country_code, admin_area, locality_name, area_level, timezone_id)
    VALUES ('JP', '沖縄県', NULL, 'admin_area', 'Asia/Tokyo')
    RETURNING id, revision
)
SELECT * FROM inserted;

CREATE TEMP TABLE _venue32_updated ON COMMIT DROP AS
WITH updated AS (
    UPDATE public.venue_list v
    SET locality_id = (SELECT id FROM _okinawa),
        location_revision = location_revision + 1,
        location_verified_at = CURRENT_TIMESTAMP
    WHERE v.id = 32 AND v.locality_id IS NULL AND v.location_revision = 1
    RETURNING v.id, v.location_revision
)
SELECT * FROM updated;

CREATE TEMP TABLE _regular_updated ON COMMIT DROP AS
WITH updated AS (
    UPDATE public.live_attrs l
    SET timezone_id = c.timezone_id,
        timezone_source = 'venue',
        timezone_source_revision = c.location_revision
    FROM _timezone_candidates c
    WHERE l.id = c.id AND c.id <> 377
      AND c.old_offset = c.noon_offset
      AND l.timezone_source = 'legacy_offset' AND l.timezone_id IS NULL
    RETURNING l.id
)
SELECT * FROM updated;

CREATE TEMP TABLE _okinawa_lives_updated ON COMMIT DROP AS
WITH updated AS (
    UPDATE public.live_attrs l
    SET timezone_id = 'Asia/Tokyo',
        timezone_source = 'venue',
        timezone_source_revision = (SELECT location_revision FROM _venue32_updated)
    WHERE l.id IN (54, 55) AND l.venue_id = 32
      AND l.timezone_source = 'legacy_offset' AND l.timezone_id IS NULL
      AND l.timezone_offset_minutes = 540
      AND l.live_date = CASE l.id WHEN 54 THEN date '2026-07-04'
                                  WHEN 55 THEN date '2026-07-05' END
      AND EXTRACT(TIMEZONE FROM l.opening_time) = 32400
      AND EXTRACT(TIMEZONE FROM l.start_time) = 32400
    RETURNING l.id
)
SELECT * FROM updated;

CREATE TEMP TABLE _shanghai_updated ON COMMIT DROP AS
WITH updated AS (
    UPDATE public.live_attrs l
    SET opening_time = '09:00:00+08'::timetz,
        start_time = '10:30:00+08'::timetz,
        timezone_offset_minutes = 480,
        timezone_id = 'Asia/Shanghai',
        timezone_source = 'venue',
        timezone_source_revision = 2
    WHERE l.id = 377 AND l.venue_id = 116
      AND l.timezone_source = 'legacy_offset' AND l.timezone_id IS NULL
      AND l.opening_time = '09:00:00+09'::timetz
      AND l.start_time = '10:30:00+09'::timetz
      AND l.timezone_offset_minutes = 540
    RETURNING l.id
)
SELECT * FROM updated;

DO $guard$
BEGIN
    IF (SELECT count(*) FROM _okinawa) <> 1
       OR (SELECT count(*) FROM _venue32_updated) <> 1
       OR (SELECT location_revision FROM _venue32_updated) <> 2
       OR (SELECT count(*) FROM _regular_updated) <> 575
       OR (SELECT count(*) FROM _okinawa_lives_updated) <> 2
       OR (SELECT count(*) FROM _shanghai_updated) <> 1 THEN
        RAISE EXCEPTION 'One or more backfill batches updated an unexpected row count';
    END IF;
END
$guard$;

INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, payload_json)
SELECT NULL, 'locality_create', 'locality', o.id::text,
       jsonb_build_object('source', 'manual_verified_live_timezone_backfill',
                          'country_code', 'JP', 'admin_area', '沖縄県',
                          'area_level', 'admin_area', 'timezone_id', 'Asia/Tokyo',
                          'revision', o.revision)
FROM _okinawa o;

INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, payload_json)
SELECT NULL, 'venue_location_update', 'venue', '32',
       jsonb_build_object('source', 'manual_verified_live_timezone_backfill',
                          'published_scope', '沖縄県', 'old_locality_id', NULL,
                          'locality_id', o.id, 'old_location_revision', 1,
                          'location_revision', v.location_revision,
                          'address_and_coordinates_unchanged', true)
FROM _okinawa o CROSS JOIN _venue32_updated v;

INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, payload_json)
SELECT NULL, 'live_timezone_backfill', 'live', c.id::text,
       jsonb_build_object('source', 'manual_verified_live_timezone_backfill',
                          'reason', 'verified_venue_offset_consistent',
                          'venue_id', c.venue_id, 'live_date', c.live_date,
                          'old_timezone_source', 'legacy_offset',
                          'old_timezone_offset_minutes', c.old_offset,
                          'timezone_id', c.timezone_id, 'timezone_source', 'venue',
                          'timezone_source_revision', c.location_revision,
                          'schedule_times_unchanged', true)
FROM _timezone_candidates c JOIN _regular_updated u ON u.id = c.id;

INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, payload_json)
SELECT NULL, 'live_timezone_backfill', 'live', u.id::text,
       jsonb_build_object('source', 'manual_verified_live_timezone_backfill',
                          'reason', 'published_okinawa_admin_area',
                          'venue_id', 32, 'locality_id', o.id,
                          'timezone_id', 'Asia/Tokyo', 'timezone_source', 'venue',
                          'timezone_source_revision', 2,
                          'old_timezone_offset_minutes', 540,
                          'timezone_offset_minutes', 540,
                          'schedule_times_unchanged', true)
FROM _okinawa_lives_updated u CROSS JOIN _okinawa o;

INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, payload_json)
SELECT NULL, 'live_timezone_backfill', 'live', '377',
       jsonb_build_object('source', 'manual_verified_live_timezone_backfill',
                          'reason', 'historical_offset_error_venue_correct',
                          'venue_id', 116, 'live_date', c.live_date,
                          'old_opening_time', c.old_opening_time::text,
                          'opening_time', l.opening_time::text,
                          'old_start_time', c.old_start_time::text,
                          'start_time', l.start_time::text,
                          'old_timezone_offset_minutes', c.old_offset,
                          'timezone_offset_minutes', l.timezone_offset_minutes,
                          'timezone_id', l.timezone_id,
                          'timezone_source_revision', l.timezone_source_revision,
                          'wall_clock_times_unchanged', true)
FROM _shanghai_updated u
JOIN _timezone_candidates c ON c.id = u.id
JOIN public.live_attrs l ON l.id = u.id;

DO $guard$
BEGIN
    IF (SELECT count(*) FROM public.live_attrs WHERE timezone_source = 'legacy_offset') <> 16
       OR (SELECT count(*) FROM public.live_attrs WHERE timezone_source = 'venue') <> 578
       OR EXISTS (SELECT 1 FROM public.live_attrs l
                  JOIN public.venue_list v ON v.id = l.venue_id
                  WHERE l.timezone_source = 'legacy_offset'
                    AND v.venue_kind <> 'online') THEN
        RAISE EXCEPTION 'Postcondition: only 16 ONLINE Lives may remain legacy';
    END IF;
    IF EXISTS (
        SELECT 1 FROM _timezone_candidates c
        JOIN public.live_attrs l ON l.id = c.id
        WHERE c.id <> 377
          AND (l.opening_time IS DISTINCT FROM c.old_opening_time
               OR l.start_time IS DISTINCT FROM c.old_start_time
               OR l.timezone_offset_minutes <> c.old_offset
               OR l.timezone_id IS DISTINCT FROM c.timezone_id
               OR l.timezone_source <> 'venue'
               OR l.timezone_source_revision <> c.location_revision)
    ) THEN
        RAISE EXCEPTION 'Postcondition: consistent Lives changed schedule facts';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.live_attrs l
        WHERE l.timezone_source = 'venue'
          AND ((l.opening_time IS NOT NULL AND
                EXTRACT(TIMEZONE FROM l.opening_time) / 60 <> l.timezone_offset_minutes)
               OR (l.start_time IS NOT NULL AND
                   EXTRACT(TIMEZONE FROM l.start_time) / 60 <> l.timezone_offset_minutes))
    ) THEN
        RAISE EXCEPTION 'Postcondition: time values and compatibility offset disagree';
    END IF;
    IF (SELECT count(*) FROM public.audit_logs
        WHERE action = 'live_timezone_backfill'
          AND payload_json ->> 'source' = 'manual_verified_live_timezone_backfill') <> 578 THEN
        RAISE EXCEPTION 'Postcondition: Live audit count mismatch';
    END IF;
    IF (SELECT count(*) FROM public.live_schedule_history) <> 4
       OR EXISTS (SELECT 1 FROM public.live_schedule_history
                  WHERE previous_timezone_source IS NOT NULL
                     OR previous_timezone_id IS NOT NULL
                     OR previous_timezone_offset_minutes IS NOT NULL) THEN
        RAISE EXCEPTION 'Postcondition: old schedule history changed';
    END IF;
END
$guard$;

COMMIT;

SELECT timezone_source, count(*) AS live_count
FROM public.live_attrs GROUP BY timezone_source ORDER BY timezone_source;
