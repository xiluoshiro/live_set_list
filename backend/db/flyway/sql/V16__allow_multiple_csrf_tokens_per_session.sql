ALTER TABLE public.auth_sessions
    ADD COLUMN csrf_token_hashes text[] NOT NULL DEFAULT ARRAY[]::text[];

UPDATE public.auth_sessions
SET csrf_token_hashes = ARRAY[csrf_token_hash];
