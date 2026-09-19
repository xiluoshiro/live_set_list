SET ROLE live_project_owner;

ALTER TABLE venue_list DROP CONSTRAINT venue_precise_timezone_requires_point;
ALTER TABLE venue_list DROP CONSTRAINT venue_location_scope;
ALTER TABLE venue_list ADD CONSTRAINT venue_location_scope CHECK (
    venue_kind = 'physical'
    OR (venue_kind = 'undisclosed' AND address IS NULL AND latitude IS NULL AND longitude IS NULL)
    OR (venue_kind = 'online' AND locality_id IS NULL AND address IS NULL
        AND latitude IS NULL AND longitude IS NULL AND timezone_id IS NULL)
);

-- Existing unannounced venues may inherit only an unambiguous, already recorded zone.
UPDATE venue_list venue SET timezone_id = known.timezone_id
FROM (
    SELECT venue_id, min(timezone_id) AS timezone_id
    FROM live_attrs WHERE timezone_id IS NOT NULL
    GROUP BY venue_id HAVING count(DISTINCT timezone_id) = 1
) known
WHERE venue.id = known.venue_id AND venue.venue_kind = 'undisclosed' AND venue.timezone_id IS NULL;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM venue_list WHERE venue_kind = 'undisclosed' AND timezone_id IS NULL) THEN
        RAISE EXCEPTION 'Undisclosed venues require a verified timezone before migration';
    END IF;
END $$;

ALTER TABLE live_attrs
    ADD CONSTRAINT live_times_require_venue CHECK (venue_id IS NOT NULL OR (opening_time IS NULL AND start_time IS NULL)),
    DROP COLUMN timezone_id,
    DROP COLUMN timezone_source,
    DROP COLUMN timezone_source_revision,
    DROP COLUMN timezone_offset_minutes,
    DROP COLUMN opening_time_fold,
    DROP COLUMN start_time_fold;

ALTER TABLE live_schedule_history
    DROP COLUMN previous_timezone_id,
    DROP COLUMN previous_timezone_source,
    DROP COLUMN previous_timezone_source_revision,
    DROP COLUMN previous_timezone_offset_minutes,
    DROP COLUMN previous_opening_time_fold,
    DROP COLUMN previous_start_time_fold;

ALTER TABLE geo_localities DROP COLUMN timezone_id;
RESET ROLE;
