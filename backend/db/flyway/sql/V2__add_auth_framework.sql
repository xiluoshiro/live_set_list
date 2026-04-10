CREATE TABLE public.app_users (
    id bigserial PRIMARY KEY,
    username varchar(64) NOT NULL,
    password_hash text NOT NULL,
    display_name varchar(64) NOT NULL,
    role varchar(16) NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_users_username_unique UNIQUE (username),
    CONSTRAINT app_users_username_lowercase CHECK (username = lower(username)),
    CONSTRAINT app_users_role_check CHECK (role IN ('viewer', 'editor', 'admin'))
);

CREATE TABLE public.auth_sessions (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    session_token_hash text NOT NULL,
    csrf_token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_ip inet,
    user_agent text,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT auth_sessions_session_token_hash_unique UNIQUE (session_token_hash)
);

CREATE TABLE public.user_live_favorites (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    live_id integer NOT NULL REFERENCES public.live_attrs(id) ON DELETE CASCADE,
    source varchar(16) NOT NULL DEFAULT 'manual',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_live_favorites_user_live_unique UNIQUE (user_id, live_id),
    CONSTRAINT user_live_favorites_source_check CHECK (source IN ('manual', 'imported'))
);

CREATE TABLE public.audit_logs (
    id bigserial PRIMARY KEY,
    user_id bigint REFERENCES public.app_users(id) ON DELETE SET NULL,
    action varchar(64) NOT NULL,
    resource_type varchar(32) NOT NULL,
    resource_id varchar(64),
    payload_json jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_sessions_user_id_idx
    ON public.auth_sessions (user_id);

CREATE INDEX auth_sessions_expires_at_idx
    ON public.auth_sessions (expires_at);

CREATE INDEX user_live_favorites_user_id_created_at_idx
    ON public.user_live_favorites (user_id, created_at DESC, id DESC);

CREATE INDEX audit_logs_user_id_created_at_idx
    ON public.audit_logs (user_id, created_at DESC, id DESC);

CREATE INDEX audit_logs_action_created_at_idx
    ON public.audit_logs (action, created_at DESC, id DESC);
