SET ROLE live_project_owner;

ALTER TABLE public.live_attrs
    ADD COLUMN announced_locality_id integer REFERENCES public.geo_localities(id) ON DELETE RESTRICT,
    ADD COLUMN timezone_id text,
    ADD COLUMN timezone_source text NOT NULL DEFAULT 'legacy_offset',
    ADD COLUMN timezone_source_revision integer,
    ADD COLUMN opening_time_fold smallint,
    ADD COLUMN start_time_fold smallint,
    ADD CONSTRAINT live_attrs_timezone_source_check
        CHECK (timezone_source IN ('venue', 'locality', 'explicit', 'legacy_offset')),
    ADD CONSTRAINT live_attrs_announced_locality_without_venue_check
        CHECK (announced_locality_id IS NULL OR venue_id IS NULL),
    ADD CONSTRAINT live_attrs_timezone_snapshot_check
        CHECK (
            (timezone_source = 'legacy_offset' AND timezone_id IS NULL AND timezone_source_revision IS NULL)
            OR (timezone_source <> 'legacy_offset' AND timezone_id IS NOT NULL)
        ),
    ADD CONSTRAINT live_attrs_timezone_fold_check
        CHECK (opening_time_fold IS NULL OR opening_time_fold IN (0, 1)),
    ADD CONSTRAINT live_attrs_start_time_fold_check
        CHECK (start_time_fold IS NULL OR start_time_fold IN (0, 1));

CREATE INDEX live_attrs_announced_locality_idx ON public.live_attrs(announced_locality_id);

ALTER TABLE public.live_schedule_history
    ADD COLUMN previous_announced_locality_id integer REFERENCES public.geo_localities(id) ON DELETE RESTRICT,
    ADD COLUMN previous_timezone_id text,
    ADD COLUMN previous_timezone_source text,
    ADD COLUMN previous_timezone_source_revision integer,
    ADD COLUMN previous_timezone_offset_minutes smallint,
    ADD COLUMN previous_opening_time_fold smallint,
    ADD COLUMN previous_start_time_fold smallint,
    ADD CONSTRAINT live_schedule_history_timezone_source_check
        CHECK (previous_timezone_source IS NULL OR previous_timezone_source IN ('venue', 'locality', 'explicit', 'legacy_offset')),
    ADD CONSTRAINT live_schedule_history_timezone_fold_check
        CHECK (previous_opening_time_fold IS NULL OR previous_opening_time_fold IN (0, 1)),
    ADD CONSTRAINT live_schedule_history_start_time_fold_check
        CHECK (previous_start_time_fold IS NULL OR previous_start_time_fold IN (0, 1));

COMMENT ON COLUMN public.live_attrs.timezone_id
    IS 'IANA timezone snapshot for new Live records; NULL only for retained legacy fixed-offset records.';
COMMENT ON COLUMN public.live_attrs.timezone_source
    IS 'venue, locality, explicit activity exception, or legacy_offset compatibility source.';
COMMENT ON COLUMN public.live_attrs.timezone_offset_minutes
    IS 'Compatibility offset for the Live date. IANA timezone_id is authoritative when present.';

RESET ROLE;
