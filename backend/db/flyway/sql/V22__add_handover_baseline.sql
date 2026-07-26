SET ROLE live_project_owner;

ALTER TABLE public.live_setlist_band_performances
    ADD COLUMN handover_baseline text;

UPDATE public.live_setlist_band_performances
SET handover_baseline = 'base'
WHERE lineup_usage = 'handover';

ALTER TABLE public.live_setlist_band_performances
    ADD CONSTRAINT live_setlist_band_performances_handover_baseline
    CHECK (
        (
            lineup_usage = 'handover'
            AND handover_baseline IN ('base', 'next')
        )
        OR
        (
            lineup_usage <> 'handover'
            AND handover_baseline IS NULL
        )
    );

RESET ROLE;
