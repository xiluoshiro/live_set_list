SET ROLE live_project_owner;

ALTER TABLE public.song_list
    ADD COLUMN cover_urls text[] NOT NULL DEFAULT '{}'::text[],
    ADD CONSTRAINT song_cover_urls_shape CHECK (
        cardinality(cover_urls) = 0 OR (
            array_ndims(cover_urls) = 1 AND array_lower(cover_urls, 1) = 1
            AND cardinality(cover_urls) <= 20
        )
    ),
    ADD CONSTRAINT song_cover_urls_nonnull CHECK (array_position(cover_urls, NULL) IS NULL);

COMMENT ON COLUMN public.song_list.cover_urls IS 'Ordered HTTPS song version cover URLs; first item is the default; empty falls back to album artwork';

RESET ROLE;
