SET ROLE live_project_owner;

-- Keep each name attached to its URL, including when the default/order changes.
CREATE FUNCTION public.cover_entries_from_urls(urls text[]) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('url', url, 'name', '') ORDER BY position), '[]'::jsonb)
    FROM unnest(urls) WITH ORDINALITY AS covers(url, position)
$$;

ALTER TABLE public.albums
    DROP CONSTRAINT albums_cover_urls_shape,
    DROP CONSTRAINT albums_cover_urls_nonnull,
    ALTER COLUMN cover_urls DROP DEFAULT,
    ALTER COLUMN cover_urls TYPE jsonb USING public.cover_entries_from_urls(cover_urls),
    ALTER COLUMN cover_urls SET DEFAULT '[]'::jsonb;

ALTER TABLE public.song_list
    DROP CONSTRAINT song_cover_urls_shape,
    DROP CONSTRAINT song_cover_urls_nonnull,
    ALTER COLUMN cover_urls DROP DEFAULT,
    ALTER COLUMN cover_urls TYPE jsonb USING public.cover_entries_from_urls(cover_urls),
    ALTER COLUMN cover_urls SET DEFAULT '[]'::jsonb;

DROP FUNCTION public.cover_entries_from_urls(text[]);

CREATE FUNCTION public.valid_cover_entries(covers jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE WHEN jsonb_typeof(covers) = 'array' THEN
        jsonb_array_length(covers) <= 20 AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(covers) AS entries(entry)
            WHERE jsonb_typeof(entry) IS DISTINCT FROM 'object'
               OR jsonb_typeof(entry -> 'url') IS DISTINCT FROM 'string'
               OR jsonb_typeof(entry -> 'name') IS DISTINCT FROM 'string'
               OR length(entry ->> 'name') > 255
        ) ELSE false END
$$;

ALTER TABLE public.albums ADD CONSTRAINT albums_cover_urls_shape
    CHECK (public.valid_cover_entries(cover_urls));
ALTER TABLE public.song_list ADD CONSTRAINT song_cover_urls_shape
    CHECK (public.valid_cover_entries(cover_urls));

COMMENT ON COLUMN public.albums.cover_urls IS 'Ordered cover objects {url, name}; empty name is allowed; first item is the default';
COMMENT ON COLUMN public.song_list.cover_urls IS 'Ordered song version cover objects {url, name}; first item is the default; empty array falls back to album artwork';

RESET ROLE;
