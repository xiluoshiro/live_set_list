-- psql variables required:
--   app_owner: expected owner for the database, public schema, and business objects
--   flyway_user: expected owner for flyway_schema_history and member of app_owner

WITH expected_roles AS (
    SELECT
        (SELECT oid FROM pg_roles WHERE rolname = :'app_owner') AS app_owner_oid,
        (SELECT oid FROM pg_roles WHERE rolname = :'flyway_user') AS flyway_user_oid
),
violations (object_type, object_name, expected_owner, actual_owner) AS (
    SELECT 'role', :'app_owner', 'role exists', '<missing>'
    FROM expected_roles
    WHERE app_owner_oid IS NULL

    UNION ALL

    SELECT 'role', :'flyway_user', 'role exists', '<missing>'
    FROM expected_roles
    WHERE flyway_user_oid IS NULL

    UNION ALL

    SELECT
        'role membership',
        format('%I -> %I', :'flyway_user', :'app_owner'),
        'member',
        'not a member'
    FROM expected_roles
    WHERE app_owner_oid IS NOT NULL
      AND flyway_user_oid IS NOT NULL
      AND NOT pg_has_role(flyway_user_oid, app_owner_oid, 'MEMBER')

    UNION ALL

    SELECT
        'database',
        current_database(),
        :'app_owner',
        pg_get_userbyid(d.datdba)
    FROM pg_database d
    CROSS JOIN expected_roles
    WHERE d.datname = current_database()
      AND d.datdba IS DISTINCT FROM app_owner_oid

    UNION ALL

    SELECT
        'schema',
        'public',
        :'app_owner',
        COALESCE(pg_get_userbyid(n.nspowner), '<missing>')
    FROM expected_roles
    LEFT JOIN pg_namespace n ON n.nspname = 'public'
    WHERE n.oid IS NULL
       OR n.nspowner IS DISTINCT FROM app_owner_oid

    UNION ALL

    SELECT
        CASE c.relkind
            WHEN 'r' THEN 'table'
            WHEN 'p' THEN 'partitioned table'
            WHEN 'v' THEN 'view'
            WHEN 'm' THEN 'materialized view'
            WHEN 'S' THEN 'sequence'
            WHEN 'f' THEN 'foreign table'
            ELSE 'relation'
        END,
        format('%I.%I', n.nspname, c.relname),
        :'app_owner',
        pg_get_userbyid(c.relowner)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN expected_roles
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND c.relname <> 'flyway_schema_history'
      AND c.relowner IS DISTINCT FROM app_owner_oid

    UNION ALL

    SELECT
        'Flyway history table',
        'public.flyway_schema_history',
        :'flyway_user',
        COALESCE(pg_get_userbyid(c.relowner), '<missing>')
    FROM expected_roles
    LEFT JOIN pg_namespace n ON n.nspname = 'public'
    LEFT JOIN pg_class c
        ON c.relnamespace = n.oid
       AND c.relname = 'flyway_schema_history'
       AND c.relkind IN ('r', 'p')
    WHERE c.oid IS NULL
       OR c.relowner IS DISTINCT FROM flyway_user_oid

    UNION ALL

    SELECT
        CASE p.prokind
            WHEN 'p' THEN 'procedure'
            WHEN 'a' THEN 'aggregate'
            ELSE 'function'
        END,
        format(
            '%I.%I(%s)',
            n.nspname,
            p.proname,
            pg_get_function_identity_arguments(p.oid)
        ),
        :'app_owner',
        pg_get_userbyid(p.proowner)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN expected_roles
    WHERE n.nspname = 'public'
      AND p.proowner IS DISTINCT FROM app_owner_oid

    UNION ALL

    SELECT
        CASE t.typtype
            WHEN 'd' THEN 'domain'
            WHEN 'e' THEN 'enum type'
            WHEN 'r' THEN 'range type'
            ELSE 'type'
        END,
        format('%I.%I', n.nspname, t.typname),
        :'app_owner',
        pg_get_userbyid(t.typowner)
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    CROSS JOIN expected_roles
    WHERE n.nspname = 'public'
      AND t.typrelid = 0
      AND t.typelem = 0
      AND t.typtype IN ('d', 'e', 'r')
      AND t.typowner IS DISTINCT FROM app_owner_oid
)
SELECT object_type, object_name, expected_owner, actual_owner
FROM violations
ORDER BY object_type, object_name;
