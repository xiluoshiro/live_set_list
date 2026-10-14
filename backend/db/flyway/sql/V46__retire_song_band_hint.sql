SET ROLE live_project_owner;

-- Preserve the complete legacy evidence, including unresolved covers. It is an
-- audit snapshot, never an input to current ownership or cover classification.
INSERT INTO public.audit_logs(action, resource_type, resource_id, payload_json)
SELECT 'song_legacy_band_archived', 'song', s.id::text,
       jsonb_build_object('migration', 'V46', 'song_name', s.song_name,
                          'group_id', s.group_id, 'version_label', s.version_label,
                          'legacy_band_id', s.band_id, 'legacy_band_name', b.band_name,
                          'legacy_cover', s.is_cover, 'owner_mode', s.owner_mode)
FROM public.song_list s
JOIN public.band_attrs b ON b.id = s.band_id
WHERE s.band_id IS NOT NULL;

DO $$
BEGIN
    IF (SELECT count(*) FROM public.song_list WHERE band_id IS NOT NULL) <>
       (SELECT count(*) FROM public.audit_logs WHERE action = 'song_legacy_band_archived'
        AND payload_json->>'migration' = 'V46') THEN
        RAISE EXCEPTION 'Legacy song band evidence was not fully archived';
    END IF;
END $$;

ALTER TABLE public.song_list DROP COLUMN band_id;
RESET ROLE;
