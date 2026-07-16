ALTER TABLE public.live_attrs
    ADD COLUMN default_band_ids integer[] NOT NULL DEFAULT ARRAY[]::integer[];

ALTER TABLE public.live_attrs
    ADD CONSTRAINT live_attrs_default_band_ids_positive
    CHECK (0 < ALL (default_band_ids));
