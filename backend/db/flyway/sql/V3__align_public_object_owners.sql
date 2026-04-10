-- 将当前数据库中由 Flyway 创建或管理的 public schema 业务对象 owner 收口到业务 owner。
-- 这一步不改变 ro / super_ro 的业务权限边界，只统一 owner 身份。

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = 'live_project_owner'
    ) THEN
        RAISE EXCEPTION 'required role live_project_owner does not exist';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = 'live_project_flyway'
    ) THEN
        RAISE EXCEPTION 'required role live_project_flyway does not exist';
    END IF;
END
$$;

-- public schema 当前 owner 是 pg_database_owner，这一步需要数据库 owner 身份执行。
SET ROLE live_project_owner;

ALTER SCHEMA public OWNER TO live_project_owner;

RESET ROLE;

DO $$
DECLARE
    object_record record;
BEGIN
    FOR object_record IN
        SELECT
            c.relname,
            c.relkind,
            EXISTS (
                SELECT 1
                FROM pg_depend d
                WHERE d.classid = 'pg_class'::regclass
                    AND d.objid = c.oid
                    AND d.deptype IN ('a', 'i')
            ) AS is_owned_sequence
        FROM pg_class c
        JOIN pg_namespace n
            ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
            AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
            AND c.relname <> 'flyway_schema_history'
    LOOP
        CASE object_record.relkind
            WHEN 'r' THEN
                EXECUTE format('ALTER TABLE public.%I OWNER TO live_project_owner', object_record.relname);
            WHEN 'p' THEN
                EXECUTE format('ALTER TABLE public.%I OWNER TO live_project_owner', object_record.relname);
            WHEN 'v' THEN
                EXECUTE format('ALTER VIEW public.%I OWNER TO live_project_owner', object_record.relname);
            WHEN 'm' THEN
                EXECUTE format('ALTER MATERIALIZED VIEW public.%I OWNER TO live_project_owner', object_record.relname);
            WHEN 'S' THEN
                IF NOT object_record.is_owned_sequence THEN
                    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO live_project_owner', object_record.relname);
                END IF;
            WHEN 'f' THEN
                EXECUTE format('ALTER FOREIGN TABLE public.%I OWNER TO live_project_owner', object_record.relname);
        END CASE;
    END LOOP;

    FOR object_record IN
        SELECT
            p.proname,
            pg_get_function_identity_arguments(p.oid) AS identity_args,
            p.prokind
        FROM pg_proc p
        JOIN pg_namespace n
            ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
    LOOP
        CASE object_record.prokind
            WHEN 'p' THEN
                EXECUTE format(
                    'ALTER PROCEDURE public.%I(%s) OWNER TO live_project_owner',
                    object_record.proname,
                    object_record.identity_args
                );
            WHEN 'a' THEN
                EXECUTE format(
                    'ALTER AGGREGATE public.%I(%s) OWNER TO live_project_owner',
                    object_record.proname,
                    object_record.identity_args
                );
            ELSE
                EXECUTE format(
                    'ALTER FUNCTION public.%I(%s) OWNER TO live_project_owner',
                    object_record.proname,
                    object_record.identity_args
                );
        END CASE;
    END LOOP;

    FOR object_record IN
        SELECT t.typname, t.typtype
        FROM pg_type t
        JOIN pg_namespace n
            ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
            AND t.typrelid = 0
            AND t.typelem = 0
            AND t.typtype IN ('d', 'e', 'r')
    LOOP
        CASE object_record.typtype
            WHEN 'd' THEN
                EXECUTE format('ALTER DOMAIN public.%I OWNER TO live_project_owner', object_record.typname);
            ELSE
                EXECUTE format('ALTER TYPE public.%I OWNER TO live_project_owner', object_record.typname);
        END CASE;
    END LOOP;
END
$$;
