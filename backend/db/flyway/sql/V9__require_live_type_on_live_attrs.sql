DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.live_attrs
        WHERE live_type IS NULL
    ) THEN
        RAISE EXCEPTION 'live_attrs.live_type still contains NULL rows; backfill before applying V9';
    END IF;
END $$;

ALTER TABLE public.live_attrs
    DROP CONSTRAINT live_attrs_live_type_check;

ALTER TABLE public.live_attrs
    ALTER COLUMN live_type SET NOT NULL;

ALTER TABLE public.live_attrs
    ADD CONSTRAINT live_attrs_live_type_check
    CHECK (live_type IN ('oneman', 'taiban', 'multi_act', 'festival', 'event', 'other'));

COMMENT ON COLUMN public.live_attrs.live_type
    IS 'Stable live type code: oneman, taiban, multi_act, festival, event, other.';
