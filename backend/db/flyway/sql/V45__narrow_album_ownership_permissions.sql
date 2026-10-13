SET ROLE live_project_owner;
-- Album ownership is read through the catalog role, and maintained by Console only.
REVOKE ALL ON public.album_bands, public.album_member_groups, public.album_members
    FROM live_project_user_rw;
RESET ROLE;
