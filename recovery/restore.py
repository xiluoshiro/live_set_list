from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .common import (
    FLYWAY_CONFIG,
    OWNERSHIP_CONTRACT_SQL,
    ROOT,
    SEED_SQL,
    run_binary_step,
    run_step,
    run_step_capture,
)
from .docker_ops import ensure_container_ready


def confirm_restore(backup_path: Path) -> None:
    print(f"即将使用最近备份恢复主库：{backup_path}", flush=True)
    answer = input("确认继续恢复主库吗？输入 yes 继续：").strip().lower()
    if answer != "yes":
        raise SystemExit("已取消主库恢复。")


def confirm_finalize() -> None:
    print("候选恢复已完成，且 run_checks functional 已通过。", flush=True)
    answer = input("请人工检查当前候选容器；确认转正请输入 yes：").strip().lower()
    if answer != "yes":
        raise SystemExit("已取消主库转正。")


def run_flyway_for_environment(command: str, environment: str) -> None:
    flyway_cmd = shutil.which("flyway.cmd") or shutil.which("flyway") or "flyway"
    run_step(
        "flyway",
        [
            flyway_cmd,
            f"-configFiles={FLYWAY_CONFIG.relative_to(ROOT)}",
            f"-environment={environment}",
            command,
        ],
    )


def run_flyway_info_capture(environment: str) -> subprocess.CompletedProcess[str]:
    flyway_cmd = shutil.which("flyway.cmd") or shutil.which("flyway") or "flyway"
    return run_step_capture(
        "flyway",
        [
            flyway_cmd,
            f"-configFiles={FLYWAY_CONFIG.relative_to(ROOT)}",
            f"-environment={environment}",
            "info",
        ],
    )


def check_database_ownership(
    env_values: dict[str, str],
    docker_cmd: str,
    container_name: str,
    database_name: str,
) -> None:
    postgres_user = env_values.get("POSTGRES_USER", "postgres")
    app_owner = env_values.get("APP_OWNER", "live_project_owner")
    flyway_user = env_values.get("FLYWAY_USER", "live_project_flyway")
    completed = run_step_capture(
        "ownership-contract",
        [
            docker_cmd,
            "exec",
            "-i",
            container_name,
            "psql",
            "-X",
            "--no-psqlrc",
            "--tuples-only",
            "--no-align",
            "--field-separator=|",
            "-v",
            "ON_ERROR_STOP=1",
            "-v",
            f"app_owner={app_owner}",
            "-v",
            f"flyway_user={flyway_user}",
            "-U",
            postgres_user,
            "-d",
            database_name,
        ],
        input_text=OWNERSHIP_CONTRACT_SQL.read_text(encoding="utf-8"),
    )
    if completed.returncode != 0:
        raise SystemExit(
            "数据库 owner 契约检查执行失败。\n"
            f"stdout:\n{completed.stdout}\n"
            f"stderr:\n{completed.stderr}"
        )
    violations = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    if violations:
        details = "\n".join(f"- {line}" for line in violations)
        raise SystemExit(f"数据库 owner 契约不满足：\n{details}")


def recover_test_database(env_values: dict[str, str], docker_cmd: str, container_name: str) -> int:
    reset_test_database_for_restore(env_values, docker_cmd, container_name)
    run_flyway_for_environment("migrate", "test")
    apply_test_database_permissions(env_values, docker_cmd, container_name)
    test_db_name = env_values.get("TEST_DB_NAME", "live_statistic_test")
    check_database_ownership(env_values, docker_cmd, container_name, test_db_name)
    test_admin_user = env_values.get("TEST_ADMIN_USER", "live_project_test_admin")
    seed_sql = SEED_SQL.read_text(encoding="utf-8")
    run_step(
        "seed",
        [
            docker_cmd,
            "exec",
            "-i",
            container_name,
            "psql",
            "-U",
            test_admin_user,
            "-d",
            test_db_name,
            "-v",
            "ON_ERROR_STOP=1",
        ],
        input_text=seed_sql,
    )

    print("测试库恢复完成。", flush=True)
    return 0


def reset_test_database_for_restore(env_values: dict[str, str], docker_cmd: str, container_name: str) -> None:
    # 测试库 fresh rebuild：先断开连接，再 drop/create，避免沿用旧的 flyway history。
    postgres_user = env_values.get("POSTGRES_USER", "postgres")
    test_db_name = env_values.get("TEST_DB_NAME", "live_statistic_test")
    app_owner = env_values.get("APP_OWNER", "live_project_owner")
    flyway_user = env_values.get("FLYWAY_USER", "live_project_flyway")
    readonly_user = env_values.get("APP_RO_USER", "live_project_ro")
    super_user = env_values.get("APP_SUPER_USER", "live_project_super_ro")
    user_rw_user = env_values.get("APP_USER_RW_USER", "live_project_user_rw")
    test_admin_user = env_values.get("TEST_ADMIN_USER", "live_project_test_admin")

    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{test_db_name}' AND pid <> pg_backend_pid();",
        ],
    )
    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            f"DROP DATABASE IF EXISTS {test_db_name};",
        ],
    )
    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            f"CREATE DATABASE {test_db_name} OWNER {app_owner};",
        ],
    )
    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            f"GRANT CONNECT ON DATABASE {test_db_name} TO {flyway_user}, {readonly_user}, {super_user}, {user_rw_user}, {test_admin_user};",
        ],
    )


def apply_test_database_permissions(env_values: dict[str, str], docker_cmd: str, container_name: str) -> None:
    # 测试库重建后，要把 test_admin 和运行时角色的权限重新补齐回初始化约定。
    postgres_user = env_values.get("POSTGRES_USER", "postgres")
    test_db_name = env_values.get("TEST_DB_NAME", "live_statistic_test")
    app_owner = env_values.get("APP_OWNER", "live_project_owner")
    flyway_user = env_values.get("FLYWAY_USER", "live_project_flyway")
    readonly_user = env_values.get("APP_RO_USER", "live_project_ro")
    super_user = env_values.get("APP_SUPER_USER", "live_project_super_ro")
    user_rw_user = env_values.get("APP_USER_RW_USER", "live_project_user_rw")
    test_admin_user = env_values.get("TEST_ADMIN_USER", "live_project_test_admin")

    permission_sql = f"""
ALTER SCHEMA public OWNER TO {app_owner};

GRANT USAGE ON SCHEMA public TO {readonly_user}, {super_user}, {user_rw_user};
GRANT USAGE, CREATE ON SCHEMA public TO {flyway_user}, {test_admin_user};

GRANT SELECT ON ALL TABLES IN SCHEMA public TO {readonly_user};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO {super_user};
GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO {super_user};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {test_admin_user};
GRANT SELECT ON TABLE public.live_attrs TO {user_rw_user};
GRANT SELECT, INSERT, DELETE ON TABLE public.user_live_favorites TO {user_rw_user};
GRANT INSERT ON TABLE public.audit_logs TO {user_rw_user};

GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO {readonly_user};
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO {super_user};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO {test_admin_user};
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.user_live_favorites_id_seq TO {user_rw_user};
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.audit_logs_id_seq TO {user_rw_user};

ALTER DEFAULT PRIVILEGES FOR ROLE {app_owner} IN SCHEMA public
GRANT SELECT ON TABLES TO {readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {app_owner} IN SCHEMA public
GRANT SELECT, INSERT, UPDATE ON TABLES TO {super_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {app_owner} IN SCHEMA public
GRANT ALL PRIVILEGES ON TABLES TO {test_admin_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {app_owner} IN SCHEMA public
GRANT SELECT ON SEQUENCES TO {readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {app_owner} IN SCHEMA public
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {super_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {app_owner} IN SCHEMA public
GRANT ALL PRIVILEGES ON SEQUENCES TO {test_admin_user};

ALTER DEFAULT PRIVILEGES FOR ROLE {flyway_user} IN SCHEMA public
GRANT SELECT ON TABLES TO {readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {flyway_user} IN SCHEMA public
GRANT SELECT, INSERT, UPDATE ON TABLES TO {super_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {flyway_user} IN SCHEMA public
GRANT ALL PRIVILEGES ON TABLES TO {test_admin_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {flyway_user} IN SCHEMA public
GRANT SELECT ON SEQUENCES TO {readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {flyway_user} IN SCHEMA public
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {super_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {flyway_user} IN SCHEMA public
GRANT ALL PRIVILEGES ON SEQUENCES TO {test_admin_user};
"""
    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            "-i",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            test_db_name,
            "-v",
            "ON_ERROR_STOP=1",
        ],
        input_text=permission_sql,
    )


def recover_test_database_in_place(env_values: dict[str, str], docker_cmd: str) -> int:
    container_name = env_values.get("POSTGRES_CONTAINER_NAME", "live-set-list-docker")
    ensure_container_ready(docker_cmd, container_name)
    return recover_test_database(env_values, docker_cmd, container_name)


def reset_database_for_restore(env_values: dict[str, str], docker_cmd: str, container_name: str) -> None:
    postgres_user = env_values.get("POSTGRES_USER", "postgres")
    app_db_name = env_values.get("APP_DB", "live_statistic")
    app_owner = env_values.get("APP_OWNER", "live_project_owner")

    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{app_db_name}' AND pid <> pg_backend_pid();",
        ],
    )
    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            f"DROP DATABASE IF EXISTS {app_db_name};",
        ],
    )
    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            f"CREATE DATABASE {app_db_name} OWNER {app_owner};",
        ],
    )


def apply_app_database_permissions(env_values: dict[str, str], docker_cmd: str, container_name: str) -> None:
    # 恢复后重新把主库对象 owner 和读/写/Flyway 权限收口回项目约定的角色体系。
    postgres_user = env_values.get("POSTGRES_USER", "postgres")
    app_db_name = env_values.get("APP_DB", "live_statistic")
    app_owner = env_values.get("APP_OWNER", "live_project_owner")
    flyway_user = env_values.get("FLYWAY_USER", "live_project_flyway")
    readonly_user = env_values.get("APP_RO_USER", "live_project_ro")
    super_user = env_values.get("APP_SUPER_USER", "live_project_super_ro")
    user_rw_user = env_values.get("APP_USER_RW_USER", "live_project_user_rw")

    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            f"GRANT CONNECT ON DATABASE {app_db_name} TO {flyway_user}, {readonly_user}, {super_user}, {user_rw_user};",
        ],
    )

    permission_sql = f"""
-- 将恢复出来的 public schema、表和序列 owner 统一到业务 owner，
-- 再补齐 Flyway / 只读 / 读写角色需要的 schema、表、序列权限。
ALTER SCHEMA public OWNER TO {app_owner};

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
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
          AND c.relname <> 'flyway_schema_history'
    LOOP
        CASE object_record.relkind
            WHEN 'r' THEN
                EXECUTE format('ALTER TABLE public.%I OWNER TO {app_owner}', object_record.relname);
            WHEN 'p' THEN
                EXECUTE format('ALTER TABLE public.%I OWNER TO {app_owner}', object_record.relname);
            WHEN 'v' THEN
                EXECUTE format('ALTER VIEW public.%I OWNER TO {app_owner}', object_record.relname);
            WHEN 'm' THEN
                EXECUTE format('ALTER MATERIALIZED VIEW public.%I OWNER TO {app_owner}', object_record.relname);
            WHEN 'S' THEN
                IF NOT object_record.is_owned_sequence THEN
                    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO {app_owner}', object_record.relname);
                END IF;
            WHEN 'f' THEN
                EXECUTE format('ALTER FOREIGN TABLE public.%I OWNER TO {app_owner}', object_record.relname);
        END CASE;
    END LOOP;

    FOR object_record IN
        SELECT
            p.proname,
            pg_get_function_identity_arguments(p.oid) AS identity_args,
            p.prokind
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
    LOOP
        CASE object_record.prokind
            WHEN 'p' THEN
                EXECUTE format(
                    'ALTER PROCEDURE public.%I(%s) OWNER TO {app_owner}',
                    object_record.proname,
                    object_record.identity_args
                );
            WHEN 'a' THEN
                EXECUTE format(
                    'ALTER AGGREGATE public.%I(%s) OWNER TO {app_owner}',
                    object_record.proname,
                    object_record.identity_args
                );
            ELSE
                EXECUTE format(
                    'ALTER FUNCTION public.%I(%s) OWNER TO {app_owner}',
                    object_record.proname,
                    object_record.identity_args
                );
        END CASE;
    END LOOP;

    FOR object_record IN
        SELECT t.typname, t.typtype
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typrelid = 0
          AND t.typelem = 0
          AND t.typtype IN ('d', 'e', 'r')
    LOOP
        CASE object_record.typtype
            WHEN 'd' THEN
                EXECUTE format('ALTER DOMAIN public.%I OWNER TO {app_owner}', object_record.typname);
            ELSE
                EXECUTE format('ALTER TYPE public.%I OWNER TO {app_owner}', object_record.typname);
        END CASE;
    END LOOP;
END
$$;

ALTER TABLE public.flyway_schema_history OWNER TO {flyway_user};

GRANT USAGE ON SCHEMA public TO {readonly_user}, {super_user}, {user_rw_user};
GRANT USAGE, CREATE ON SCHEMA public TO {flyway_user};

GRANT SELECT ON ALL TABLES IN SCHEMA public TO {readonly_user};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO {super_user};
GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO {super_user};
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.flyway_schema_history TO {flyway_user};
GRANT SELECT ON TABLE public.live_attrs TO {user_rw_user};
GRANT SELECT, INSERT, DELETE ON TABLE public.user_live_favorites TO {user_rw_user};
GRANT INSERT ON TABLE public.audit_logs TO {user_rw_user};

GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO {readonly_user};
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO {super_user};
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.user_live_favorites_id_seq TO {user_rw_user};
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.audit_logs_id_seq TO {user_rw_user};

ALTER DEFAULT PRIVILEGES FOR ROLE {app_owner} IN SCHEMA public
GRANT SELECT ON TABLES TO {readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {app_owner} IN SCHEMA public
GRANT SELECT, INSERT, UPDATE ON TABLES TO {super_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {app_owner} IN SCHEMA public
GRANT SELECT ON SEQUENCES TO {readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {app_owner} IN SCHEMA public
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {super_user};

ALTER DEFAULT PRIVILEGES FOR ROLE {flyway_user} IN SCHEMA public
GRANT SELECT ON TABLES TO {readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {flyway_user} IN SCHEMA public
GRANT SELECT, INSERT, UPDATE ON TABLES TO {super_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {flyway_user} IN SCHEMA public
GRANT SELECT ON SEQUENCES TO {readonly_user};
ALTER DEFAULT PRIVILEGES FOR ROLE {flyway_user} IN SCHEMA public
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {super_user};
"""
    run_step(
        "psql",
        [
            docker_cmd,
            "exec",
            "-i",
            container_name,
            "psql",
            "-U",
            postgres_user,
            "-d",
            app_db_name,
            "-v",
            "ON_ERROR_STOP=1",
        ],
        input_text=permission_sql,
    )


def restore_app_database_from_backup(
    env_values: dict[str, str],
    docker_cmd: str,
    container_name: str,
    backup_path: Path,
) -> int:
    # 先重建空主库，再导入 dump，并在导入后用 Flyway 校验版本状态。
    reset_database_for_restore(env_values, docker_cmd, container_name)
    postgres_user = env_values.get("POSTGRES_USER", "postgres")
    app_db_name = env_values.get("APP_DB", "live_statistic")
    completed = run_binary_step(
        "pg_restore",
        [
            docker_cmd,
            "exec",
            "-i",
            container_name,
            "pg_restore",
            "-U",
            postgres_user,
            "-d",
            app_db_name,
            "--no-owner",
            "--no-privileges",
        ],
        stdin_path=backup_path,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="ignore")
        raise SystemExit(f"主库恢复失败：{backup_path}\n{stderr}")

    apply_app_database_permissions(env_values, docker_cmd, container_name)
    check_database_ownership(env_values, docker_cmd, container_name, app_db_name)

    info = run_flyway_info_capture("dev")
    output = info.stdout or ""
    if info.returncode != 0:
        raise SystemExit(
            "主库恢复后 Flyway info 失败。\n"
            f"stdout:\n{info.stdout}\n"
            f"stderr:\n{info.stderr}"
        )
    run_flyway_for_environment("validate", "dev")
    if "Pending" in output:
        run_flyway_for_environment("migrate", "dev")
        check_database_ownership(env_values, docker_cmd, container_name, app_db_name)

    print(f"主库已从备份恢复：{backup_path}", flush=True)
    return 0


def run_functional_checks() -> int:
    run_step("checks", ["python", "scripts/run_checks.py", "functional"])
    return 0
