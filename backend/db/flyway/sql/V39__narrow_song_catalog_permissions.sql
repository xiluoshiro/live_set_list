SET ROLE live_project_owner;
-- Only relation replacement and removal of an emptied group need DELETE.
REVOKE DELETE ON public.members, public.albums FROM live_project_super_ro;
REVOKE SELECT ON public.song_groups, public.members, public.song_bands, public.song_member_groups,
    public.song_members, public.albums, public.album_tracks FROM live_project_user_rw;
RESET ROLE;
