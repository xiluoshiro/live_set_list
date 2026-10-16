SET ROLE live_project_owner;

LOCK TABLE public.song_groups, public.song_list IN ACCESS EXCLUSIVE MODE;

-- Refuse to discard independently named versions; resolve them before migrating.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.song_list s
        JOIN public.song_groups g ON g.id = s.group_id
        WHERE s.song_name COLLATE "C" IS DISTINCT FROM g.group_name COLLATE "C"
    ) THEN
        RAISE EXCEPTION 'Song version names differ from their group names; reconcile them before migration';
    END IF;
END;
$$;

ALTER TABLE public.song_list DROP COLUMN song_name;

RESET ROLE;
