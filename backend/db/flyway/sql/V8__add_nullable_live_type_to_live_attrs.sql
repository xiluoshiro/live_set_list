ALTER TABLE public.live_attrs
    ADD COLUMN live_type text;

ALTER TABLE public.live_attrs
    ADD CONSTRAINT live_attrs_live_type_check
    CHECK (
        live_type IS NULL
        OR live_type IN ('oneman', 'taiban', 'multi_act', 'festival', 'event', 'other')
    );

COMMENT ON COLUMN public.live_attrs.live_type
    IS 'Stable live type code: oneman, taiban, multi_act, festival, event, other. NULL means legacy row pending classification.';
