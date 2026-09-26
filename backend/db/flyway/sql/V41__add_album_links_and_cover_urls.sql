SET ROLE live_project_owner;

-- Retain cover_path during the rolling deployment/rollback window, but never
-- silently discard bundled covers when moving the application to external URLs.
LOCK TABLE public.albums IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.albums WHERE NULLIF(btrim(cover_path), '') IS NOT NULL) THEN
        RAISE EXCEPTION 'Migrate existing albums.cover_path values to reviewed HTTPS URLs before V41';
    END IF;
END $$;

ALTER TABLE public.albums
    ADD COLUMN album_url text,
    ADD COLUMN cover_urls text[] NOT NULL DEFAULT '{}'::text[],
    ADD CONSTRAINT albums_cover_urls_shape CHECK (
        cardinality(cover_urls) = 0 OR (
            array_ndims(cover_urls) = 1 AND array_lower(cover_urls, 1) = 1
            AND cardinality(cover_urls) <= 20
        )
    ),
    ADD CONSTRAINT albums_cover_urls_nonnull CHECK (
        array_position(cover_urls, NULL) IS NULL
    );

COMMENT ON COLUMN public.albums.album_url IS 'Album announcement or platform page (HTTPS)';
COMMENT ON COLUMN public.albums.cover_urls IS 'Ordered HTTPS cover URLs; first item is the default';

RESET ROLE;
