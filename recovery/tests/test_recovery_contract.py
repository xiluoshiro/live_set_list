from __future__ import annotations

import subprocess
from pathlib import Path

from recovery import core
from recovery import docker_ops, restore


def _env_values() -> dict[str, str]:
    return {
        "POSTGRES_CONTAINER_NAME": "live-set-list-docker",
        "POSTGRES_VOLUME_NAME": "live_set_list_docker_data",
        "POSTGRES_IMAGE": "postgres:18.3-trixie",
        "POSTGRES_USER": "postgres",
        "APP_DB": "live_statistic",
        "APP_OWNER": "live_project_owner",
        "FLYWAY_USER": "live_project_flyway",
        "APP_RO_USER": "live_project_ro",
        "APP_SUPER_USER": "live_project_super_ro",
        "TEST_DB_NAME": "live_statistic_test",
        "TEST_ADMIN_USER": "live_project_test_admin",
    }


def test_prepare_candidate_database_creates_external_volume_before_compose_up(monkeypatch) -> None:
    # 测试点：候选恢复在 external volume 模式下，应先创建候选 volume 再 compose up。
    steps: list[str] = []

    monkeypatch.setattr(docker_ops, "container_exists", lambda *_args: True)
    monkeypatch.setattr(docker_ops, "stop_container_if_running", lambda *_args: steps.append("stop"))
    monkeypatch.setattr(docker_ops, "create_volume_if_missing", lambda *_args: steps.append("create-volume"))
    monkeypatch.setattr(docker_ops, "wait_for_container_ready", lambda *_args: steps.append("wait"))

    def fake_run_step(label: str, args: list[str], **_kwargs) -> None:
        if args[1] == "rename":
            steps.append("rename")
        elif args[1] == "compose":
            steps.append("compose-up")

    monkeypatch.setattr(docker_ops, "run_step", fake_run_step)

    container_name, candidate_volume_name, old_container_name, old_volume_name = docker_ops.prepare_candidate_database(
        _env_values(),
        "docker",
        suffix="20260406230000",
    )

    assert container_name == "live-set-list-docker"
    assert candidate_volume_name == "live_set_list_docker_data_candidate_20260406230000"
    assert old_container_name == "live-set-list-docker-backup-20260406230000"
    assert old_volume_name == "live_set_list_docker_data"
    assert steps == ["stop", "rename", "create-volume", "compose-up", "wait"]


def test_restore_app_database_applies_permissions_and_migrates_only_when_pending(monkeypatch, tmp_path) -> None:
    # 测试点：主库恢复后要先回灌权限，再 validate；只有存在 Pending 才追加 migrate。
    steps: list[str] = []
    backup_path = tmp_path / "backup.dump"
    backup_path.write_bytes(b"dump")

    monkeypatch.setattr(restore, "reset_database_for_restore", lambda *_args: steps.append("reset-db"))
    monkeypatch.setattr(
        restore,
        "run_binary_step",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(args=[], returncode=0, stdout=b"", stderr=b""),
    )
    monkeypatch.setattr(restore, "apply_app_database_permissions", lambda *_args: steps.append("permissions"))
    monkeypatch.setattr(
        restore,
        "run_flyway_info_capture",
        lambda _environment: subprocess.CompletedProcess(args=[], returncode=0, stdout="Pending", stderr=""),
    )
    monkeypatch.setattr(restore, "run_flyway_for_environment", lambda command, environment: steps.append(f"flyway:{environment}:{command}"))

    exit_code = restore.restore_app_database_from_backup(
        _env_values(),
        "docker",
        "candidate-container",
        backup_path,
    )

    assert exit_code == 0
    assert steps == [
        "reset-db",
        "permissions",
        "flyway:dev:validate",
        "flyway:dev:migrate",
    ]


def test_recover_main_database_uses_snapshot_backup_and_rolls_back_on_check_failure(monkeypatch, tmp_path) -> None:
    # 测试点：恢复流程应使用临时快照，且在 run_checks 失败时回滚并清理快照。
    calls: list[str] = []
    backup_path = tmp_path / "restore.dump"
    snapshot_path = tmp_path / "snapshot.dump"
    backup_path.write_bytes(b"backup")
    snapshot_path.write_bytes(b"snapshot")

    monkeypatch.setattr(core, "get_latest_app_backup", lambda: backup_path)
    monkeypatch.setattr(core, "confirm_restore", lambda _path: calls.append("confirm-restore"))

    def fake_create_app_backup(_env_values: dict[str, str], _docker_cmd: str, *, kind: str, container_name: str | None = None) -> Path:
        calls.append(f"create-backup:{kind}")
        assert kind == "snapshot"
        return snapshot_path

    monkeypatch.setattr(core, "create_app_backup", fake_create_app_backup)
    monkeypatch.setattr(core, "container_exists", lambda *_args: True)
    monkeypatch.setattr(
        core,
        "prepare_candidate_database",
        lambda *_args, **_kwargs: ("candidate-container", "candidate-volume", "old-container", "old-volume"),
    )
    monkeypatch.setattr(core, "restore_app_database_from_backup", lambda *_args: calls.append("restore-app"))
    monkeypatch.setattr(core, "recover_test_database", lambda *_args: calls.append("recover-test"))
    monkeypatch.setattr(core, "run_functional_checks", lambda: (_ for _ in ()).throw(SystemExit("checks failed")))
    monkeypatch.setattr(core, "rollback_candidate", lambda *_args, **_kwargs: calls.append("rollback"))
    monkeypatch.setattr(core, "remove_recovery_snapshot", lambda path: calls.append(f"cleanup:{path.name if path else 'none'}"))

    exit_code = core.recover_main_database(_env_values(), "docker")

    assert exit_code == 1
    assert calls == [
        "confirm-restore",
        "create-backup:snapshot",
        "restore-app",
        "recover-test",
        "rollback",
        "cleanup:snapshot.dump",
    ]


def test_recover_main_database_rolls_back_when_manual_confirmation_is_cancelled(monkeypatch, tmp_path) -> None:
    # 测试点：人工确认阶段取消时，也应回滚候选恢复并清理临时快照。
    calls: list[str] = []
    backup_path = tmp_path / "restore.dump"
    snapshot_path = tmp_path / "snapshot.dump"
    backup_path.write_bytes(b"backup")
    snapshot_path.write_bytes(b"snapshot")

    monkeypatch.setattr(core, "get_latest_app_backup", lambda: backup_path)
    monkeypatch.setattr(core, "confirm_restore", lambda _path: None)
    monkeypatch.setattr(core, "create_app_backup", lambda *_args, **_kwargs: snapshot_path)
    monkeypatch.setattr(core, "container_exists", lambda *_args: True)
    monkeypatch.setattr(
        core,
        "prepare_candidate_database",
        lambda *_args, **_kwargs: ("candidate-container", "candidate-volume", "old-container", "old-volume"),
    )
    monkeypatch.setattr(core, "restore_app_database_from_backup", lambda *_args: calls.append("restore-app"))
    monkeypatch.setattr(core, "recover_test_database", lambda *_args: calls.append("recover-test"))
    monkeypatch.setattr(core, "run_functional_checks", lambda: calls.append("checks"))
    monkeypatch.setattr(core, "confirm_finalize", lambda: (_ for _ in ()).throw(SystemExit("cancelled")))
    monkeypatch.setattr(core, "rollback_candidate", lambda *_args, **_kwargs: calls.append("rollback"))
    monkeypatch.setattr(core, "remove_recovery_snapshot", lambda path: calls.append(f"cleanup:{path.name if path else 'none'}"))

    exit_code = core.recover_main_database(_env_values(), "docker")

    assert exit_code == 1
    assert calls == [
        "restore-app",
        "recover-test",
        "checks",
        "rollback",
        "cleanup:snapshot.dump",
    ]


def test_recover_main_database_restores_formal_snapshot_when_finalize_fails(monkeypatch, tmp_path) -> None:
    # 测试点：候选转正失败时，应优先用正式 volume 快照恢复，而不是直接放弃。
    calls: list[str] = []
    backup_path = tmp_path / "restore.dump"
    snapshot_path = tmp_path / "snapshot.dump"
    backup_path.write_bytes(b"backup")
    snapshot_path.write_bytes(b"snapshot")

    monkeypatch.setattr(core, "get_latest_app_backup", lambda: backup_path)
    monkeypatch.setattr(core, "confirm_restore", lambda _path: None)
    monkeypatch.setattr(core, "create_app_backup", lambda *_args, **_kwargs: snapshot_path)
    monkeypatch.setattr(core, "container_exists", lambda *_args: True)
    monkeypatch.setattr(
        core,
        "prepare_candidate_database",
        lambda *_args, **_kwargs: ("candidate-container", "candidate-volume", "old-container", "old-volume"),
    )
    monkeypatch.setattr(core, "restore_app_database_from_backup", lambda *_args: calls.append("restore-app"))
    monkeypatch.setattr(core, "recover_test_database", lambda *_args: calls.append("recover-test"))
    monkeypatch.setattr(core, "run_functional_checks", lambda: calls.append("checks"))
    monkeypatch.setattr(core, "confirm_finalize", lambda: calls.append("confirm-finalize"))
    monkeypatch.setattr(core, "finalize_candidate_as_formal", lambda *_args, **_kwargs: (_ for _ in ()).throw(SystemExit("finalize failed")))
    monkeypatch.setattr(core, "restore_formal_from_snapshot", lambda *_args, **_kwargs: calls.append("restore-formal"))
    monkeypatch.setattr(core, "rollback_candidate", lambda *_args, **_kwargs: calls.append("rollback"))
    monkeypatch.setattr(core, "remove_recovery_snapshot", lambda path: calls.append(f"cleanup:{path.name if path else 'none'}"))

    exit_code = core.recover_main_database(_env_values(), "docker")

    assert exit_code == 1
    assert calls == [
        "restore-app",
        "recover-test",
        "checks",
        "confirm-finalize",
        "restore-formal",
        "cleanup:snapshot.dump",
    ]


def test_finalize_candidate_as_formal_restarts_formal_container_then_cleans_stale_backups(monkeypatch) -> None:
    # 测试点：候选转正成功后，应先拉起正式容器，再清理历史遗留 backup 容器。
    calls: list[str] = []

    monkeypatch.setattr(docker_ops, "stop_container_if_running", lambda *_args: calls.append("stop"))
    monkeypatch.setattr(docker_ops, "remove_container_if_exists", lambda *_args: calls.append("remove-container"))
    monkeypatch.setattr(docker_ops, "create_volume_if_missing", lambda *_args: calls.append("create-volume"))
    monkeypatch.setattr(docker_ops, "copy_volume_data", lambda *_args, **_kwargs: calls.append("copy-volume"))
    monkeypatch.setattr(docker_ops, "remove_volume_if_exists", lambda *_args: calls.append("remove-volume"))
    monkeypatch.setattr(docker_ops, "wait_for_container_ready", lambda *_args: calls.append("wait"))
    monkeypatch.setattr(docker_ops, "cleanup_stale_backup_containers", lambda *_args, **_kwargs: calls.append("cleanup-stale-backups"))

    def fake_run_step(label: str, args: list[str], **_kwargs) -> None:
        if args[1] == "compose":
            calls.append("compose-up")

    monkeypatch.setattr(docker_ops, "run_step", fake_run_step)

    docker_ops.finalize_candidate_as_formal(
        _env_values(),
        "docker",
        container_name="live-set-list-docker",
        candidate_volume_name="candidate-volume",
        old_container_name="old-container",
        old_volume_name="formal-volume",
        backup_snapshot_volume_name="snapshot-volume",
    )

    assert calls[-2:] == ["wait", "cleanup-stale-backups"]
