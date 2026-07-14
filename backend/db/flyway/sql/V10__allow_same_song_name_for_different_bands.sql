-- A song title may be reused by a different owning band, including Other bands (id 0).
ALTER TABLE public.song_list
    DROP CONSTRAINT song_list_song_name_key;

ALTER TABLE public.song_list
    ADD CONSTRAINT song_list_song_name_band_id_key UNIQUE (song_name, band_id);
