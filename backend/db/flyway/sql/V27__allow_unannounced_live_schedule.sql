SET ROLE live_project_owner;

ALTER TABLE public.live_attrs
    ADD COLUMN timezone_offset_minutes smallint NOT NULL DEFAULT 540;

UPDATE public.live_attrs
SET timezone_offset_minutes = (EXTRACT(TIMEZONE FROM start_time) / 60)::smallint;

ALTER TABLE public.live_attrs
    ADD CONSTRAINT live_attrs_timezone_offset_minutes_check
        CHECK (
            timezone_offset_minutes BETWEEN -720 AND 840
            AND MOD(timezone_offset_minutes, 15) = 0
        ),
    ALTER COLUMN venue_id DROP NOT NULL,
    ALTER COLUMN opening_time DROP NOT NULL,
    ALTER COLUMN start_time DROP NOT NULL;

ALTER TABLE public.live_schedule_history
    ALTER COLUMN previous_venue_id DROP NOT NULL,
    ALTER COLUMN previous_opening_time DROP NOT NULL,
    ALTER COLUMN previous_start_time DROP NOT NULL;

COMMENT ON COLUMN public.live_attrs.timezone_offset_minutes
    IS 'Fixed UTC offset for the Live date, stored independently so schedule times may remain unannounced.';

RESET ROLE;
