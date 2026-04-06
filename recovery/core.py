import argparse
from datetime import datetime

from .backup import (
    build_backup_path,
    create_app_backup,
    ensure_backup_dirs,
    get_backup_timestamp,
    get_latest_app_backup,
    list_backup_files,
    prune_old_backups,
    remove_recovery_snapshot,
    validate_backup_file,
)
from .common import COMPOSE_FILE, ENV_FILE, FLYWAY_CONFIG, SEED_SQL, load_env_file
from .docker_ops import (
    build_compose_env,
    cleanup_stale_backup_containers,
    container_exists,
    copy_volume_data,
    create_volume_if_missing,
    ensure_container_ready,
    finalize_candidate_as_formal,
    prepare_candidate_database,
    remove_container_if_exists,
    remove_volume_if_exists,
    restore_formal_from_snapshot,
    rollback_candidate,
    start_container_if_stopped,
    stop_container_if_running,
    wait_for_container_ready,
)
from .restore import (
    apply_app_database_permissions,
    confirm_finalize,
    confirm_restore,
    recover_test_database,
    recover_test_database_in_place,
    reset_database_for_restore,
    restore_app_database_from_backup,
    run_flyway_for_environment,
    run_flyway_info_capture,
    run_functional_checks,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Recover or back up Docker PostgreSQL databases.")
    parser.add_argument(
        "target",
        choices=["test", "recovery", "backup-app-auto", "backup-app-manual"],
        help="Action target.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Actually perform destructive recovery steps.",
    )
    return parser.parse_args()



def recover_main_database(env_values: dict[str, str], docker_cmd: str) -> int:
    # 主库恢复主流程：选备份、保底再备份、候选恢复、跑全量检查、人工确认后转正。
    container_name = env_values.get("POSTGRES_CONTAINER_NAME", "live-set-list-docker")
    current_volume_name = env_values.get("POSTGRES_VOLUME_NAME", "live_set_list_docker_data")
    backup_to_restore = get_latest_app_backup()
    confirm_restore(backup_to_restore)
    pre_restore_snapshot = create_app_backup(env_values, docker_cmd, kind="snapshot", container_name=container_name)
    print(f"已生成恢复流程专用快照：{pre_restore_snapshot}", flush=True)

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    candidate_volume_name = f"{current_volume_name}_candidate_{suffix}"
    backup_snapshot_volume_name = f"{current_volume_name}_snapshot_{suffix}" if container_exists(docker_cmd, container_name) else None
    old_container_name = f"{container_name}-backup-{suffix}" if container_exists(docker_cmd, container_name) else None
    old_volume_name = current_volume_name if old_container_name else None

    try:
        try:
            container_name, candidate_volume_name, old_container_name, old_volume_name = prepare_candidate_database(
                env_values,
                docker_cmd,
                suffix=suffix,
            )
            restore_app_database_from_backup(env_values, docker_cmd, container_name, backup_to_restore)
            recover_test_database(env_values, docker_cmd, container_name)
            run_functional_checks()
            confirm_finalize()
        except (SystemExit, Exception) as exc:
            print("候选容器验证未通过，正在回滚到旧容器。", flush=True)
            rollback_candidate(env_values, docker_cmd, container_name, candidate_volume_name, old_container_name)
            if isinstance(exc, SystemExit):
                message = str(exc)
                if message and not message.isdigit():
                    print(f"回滚原因：{message}", flush=True)
                return int(message) if message.isdigit() else 1
            print(f"回滚原因：{exc}", flush=True)
            return 1

        try:
            finalize_candidate_as_formal(
                env_values,
                docker_cmd,
                container_name=container_name,
                candidate_volume_name=candidate_volume_name,
                old_container_name=old_container_name,
                old_volume_name=old_volume_name,
                backup_snapshot_volume_name=backup_snapshot_volume_name,
            )
        except (SystemExit, Exception) as exc:
            print("候选数据转正失败，正在尝试回滚到旧容器。", flush=True)
            if backup_snapshot_volume_name:
                restore_formal_from_snapshot(
                    env_values,
                    docker_cmd,
                    container_name=container_name,
                    backup_snapshot_volume_name=backup_snapshot_volume_name,
                )
            else:
                rollback_candidate(
                    env_values,
                    docker_cmd,
                    container_name,
                    candidate_volume_name,
                    old_container_name,
                    restore_old_container=bool(old_container_name),
                )
            if isinstance(exc, SystemExit):
                message = str(exc)
                if message and not message.isdigit():
                    print(f"回滚原因：{message}", flush=True)
                return int(message) if message.isdigit() else 1
            print(f"回滚原因：{exc}", flush=True)
            return 1

        if backup_snapshot_volume_name:
            remove_volume_if_exists(docker_cmd, backup_snapshot_volume_name)
        print("主库恢复、测试库重建与校验完成，正式 volume 名保持不变。", flush=True)
        return 0
    finally:
        remove_recovery_snapshot(pre_restore_snapshot)



def main() -> int:
    # 主流程分成三段：普通备份、测试库就地恢复、主库候选恢复与回滚。
    args = parse_args()
    if not ENV_FILE.exists():
        raise SystemExit(f"未找到环境文件：{ENV_FILE}")
    if not COMPOSE_FILE.exists():
        raise SystemExit(f"未找到 compose 文件：{COMPOSE_FILE}")
    if not FLYWAY_CONFIG.exists():
        raise SystemExit(f"未找到 Flyway 配置：{FLYWAY_CONFIG}")
    if not SEED_SQL.exists():
        raise SystemExit(f"未找到 seed 文件：{SEED_SQL}")

    env_values = load_env_file(ENV_FILE)
    docker_cmd = "docker"

    if args.target == "backup-app-auto":
        create_app_backup(env_values, docker_cmd, kind="auto")
        return 0
    if args.target == "backup-app-manual":
        create_app_backup(env_values, docker_cmd, kind="manual")
        return 0

    if not args.force:
        print("此脚本会执行数据库恢复或重建操作。")
        print("确认执行请加上参数：--force")
        return 1

    if args.target == "test":
        return recover_test_database_in_place(env_values, docker_cmd)
    if args.target == "recovery":
        return recover_main_database(env_values, docker_cmd)

    raise SystemExit(f"不支持的目标：{args.target}")


if __name__ == "__main__":
    raise SystemExit(main())
