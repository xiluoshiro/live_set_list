SET ROLE live_project_owner;

LOCK TABLE public.albums, public.album_bands, public.album_member_groups, public.album_members
    IN ACCESS EXCLUSIVE MODE;

-- Preserve any explicitly entered ownership as historical audit data before retirement.
INSERT INTO public.audit_logs(action, resource_type, resource_id, payload_json)
SELECT 'album_ownership_archived', 'album', a.id::text,
    jsonb_build_object(
        'migration', 'V47', 'album_name', a.album_name, 'owner_mode', a.owner_mode,
        'bands', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.display_order, b.band_id)
            FROM public.album_bands b WHERE b.album_id = a.id), '[]'::jsonb),
        'member_groups', COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.display_order, g.band_id)
            FROM public.album_member_groups g WHERE g.album_id = a.id), '[]'::jsonb),
        'members', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.band_id, m.display_order, m.member_id)
            FROM public.album_members m WHERE m.album_id = a.id), '[]'::jsonb))
FROM public.albums a
WHERE a.owner_mode IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.album_bands b WHERE b.album_id = a.id)
    OR EXISTS(SELECT 1 FROM public.album_member_groups g WHERE g.album_id = a.id)
    OR EXISTS(SELECT 1 FROM public.album_members m WHERE m.album_id = a.id);

DROP TRIGGER album_ownership_check ON public.albums;
DROP TABLE public.album_members;
DROP TABLE public.album_member_groups;
DROP TABLE public.album_bands;
DROP FUNCTION public.check_album_ownership();
DROP FUNCTION public.lock_album_ownership();
ALTER TABLE public.albums DROP COLUMN owner_mode;

RESET ROLE;
