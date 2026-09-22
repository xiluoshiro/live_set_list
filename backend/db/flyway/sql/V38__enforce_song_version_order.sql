SET ROLE live_project_owner;
ALTER TABLE public.song_list
    ADD CONSTRAINT song_version_order_unique UNIQUE(group_id, version_order) DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT song_version_label_unique UNIQUE(group_id, version_label) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.song_bands
    ADD CHECK (band_id > 0),
    ADD UNIQUE(song_id, display_order);
ALTER TABLE public.song_member_groups
    ADD CHECK (band_id > 0),
    ADD UNIQUE(song_id, display_order);
ALTER TABLE public.song_members ADD UNIQUE(song_id, band_id, display_order);
RESET ROLE;
