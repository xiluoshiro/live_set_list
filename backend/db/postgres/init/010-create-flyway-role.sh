#!/bin/sh
set -eu

flyway_user="${FLYWAY_USER:-live_project_flyway}"
flyway_password="${FLYWAY_PASSWORD:-$POSTGRES_PASSWORD}"
app_db="${APP_DB:-live_statistic}"
app_owner="${APP_OWNER:-live_project_owner}"
app_owner_password="${APP_OWNER_PASSWORD:-$POSTGRES_PASSWORD}"
readonly_user="${APP_RO_USER:-live_project_ro}"
readonly_password="${APP_RO_PASSWORD:-$POSTGRES_PASSWORD}"
super_user="${APP_SUPER_USER:-live_project_super_ro}"
super_password="${APP_SUPER_PASSWORD:-$POSTGRES_PASSWORD}"
test_admin_user="${TEST_ADMIN_USER:-live_project_test_admin}"
test_admin_password="${TEST_ADMIN_PASSWORD:-$POSTGRES_PASSWORD}"
test_db="${TEST_DB_NAME:-live_statistic_test}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${app_owner}') THEN
        CREATE ROLE ${app_owner} LOGIN PASSWORD '${app_owner_password}';
    ELSE
        ALTER ROLE ${app_owner} WITH LOGIN PASSWORD '${app_owner_password}';
    END IF;
END
\$\$;

DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${flyway_user}') THEN
        CREATE ROLE ${flyway_user} LOGIN PASSWORD '${flyway_password}';
    ELSE
        ALTER ROLE ${flyway_user} WITH LOGIN PASSWORD '${flyway_password}';
    END IF;
END
\$\$;

DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${readonly_user}') THEN
        CREATE ROLE ${readonly_user} LOGIN PASSWORD '${readonly_password}';
    ELSE
        ALTER ROLE ${readonly_user} WITH LOGIN PASSWORD '${readonly_password}';
    END IF;
END
\$\$;

DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${super_user}') THEN
        CREATE ROLE ${super_user} LOGIN PASSWORD '${super_password}';
    ELSE
        ALTER ROLE ${super_user} WITH LOGIN PASSWORD '${super_password}';
    END IF;
END
\$\$;

DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${test_admin_user}') THEN
        CREATE ROLE ${test_admin_user} LOGIN PASSWORD '${test_admin_password}';
    ELSE
        ALTER ROLE ${test_admin_user} WITH LOGIN PASSWORD '${test_admin_password}';
    END IF;
END
\$\$;

SELECT 'CREATE DATABASE ${app_db} OWNER ${app_owner}'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${app_db}')\gexec

SELECT 'CREATE DATABASE ${test_db} OWNER ${app_owner}'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${test_db}')\gexec

GRANT ${app_owner} TO ${flyway_user};
GRANT ${flyway_user} TO ${test_admin_user};

GRANT CONNECT ON DATABASE ${app_db} TO ${flyway_user}, ${readonly_user}, ${super_user};
GRANT CONNECT ON DATABASE ${test_db} TO ${flyway_user}, ${readonly_user}, ${super_user}, ${test_admin_user};
EOSQL

for db_name in "$app_db" "$test_db"; do
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db_name" <<EOSQL
GRANT USAGE ON SCHEMA public TO ${readonly_user}, ${super_user};
GRANT USAGE, CREATE ON SCHEMA public TO ${flyway_user};

GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${readonly_user};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${super_user};
GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${super_user};

GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${readonly_user};
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${super_user};

ALTER DEFAULT PRIVILEGES FOR ROLE ${app_owner} IN SCHEMA public
GRANT SELECT ON TABLES TO ${readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE ${app_owner} IN SCHEMA public
GRANT SELECT, INSERT, UPDATE ON TABLES TO ${super_user};
ALTER DEFAULT PRIVILEGES FOR ROLE ${app_owner} IN SCHEMA public
GRANT SELECT ON SEQUENCES TO ${readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE ${app_owner} IN SCHEMA public
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${super_user};

ALTER DEFAULT PRIVILEGES FOR ROLE ${flyway_user} IN SCHEMA public
GRANT SELECT ON TABLES TO ${readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE ${flyway_user} IN SCHEMA public
GRANT SELECT, INSERT, UPDATE ON TABLES TO ${super_user};
ALTER DEFAULT PRIVILEGES FOR ROLE ${flyway_user} IN SCHEMA public
GRANT SELECT ON SEQUENCES TO ${readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE ${flyway_user} IN SCHEMA public
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${super_user};
EOSQL
done

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$test_db" <<EOSQL
GRANT USAGE, CREATE ON SCHEMA public TO ${test_admin_user};

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${test_admin_user};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${test_admin_user};

ALTER DEFAULT PRIVILEGES FOR ROLE ${app_owner} IN SCHEMA public
GRANT ALL PRIVILEGES ON TABLES TO ${test_admin_user};
ALTER DEFAULT PRIVILEGES FOR ROLE ${app_owner} IN SCHEMA public
GRANT ALL PRIVILEGES ON SEQUENCES TO ${test_admin_user};

ALTER DEFAULT PRIVILEGES FOR ROLE ${flyway_user} IN SCHEMA public
GRANT ALL PRIVILEGES ON TABLES TO ${test_admin_user};
ALTER DEFAULT PRIVILEGES FOR ROLE ${flyway_user} IN SCHEMA public
GRANT ALL PRIVILEGES ON SEQUENCES TO ${test_admin_user};
EOSQL
