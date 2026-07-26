SET ROLE live_project_owner;

ALTER TABLE public.live_setlist_band_performances
    DROP CONSTRAINT live_setlist_band_performances_handover_baseline;

ALTER TABLE public.live_setlist_band_performances
    ADD CONSTRAINT live_setlist_band_performances_handover_baseline
    CHECK (
        (
            lineup_usage = 'handover'
            AND handover_baseline IS NOT NULL
            AND handover_baseline IN ('base', 'next')
        )
        OR
        (
            lineup_usage <> 'handover'
            AND handover_baseline IS NULL
        )
    );

RESET ROLE;
