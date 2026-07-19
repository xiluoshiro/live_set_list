import importlib.util
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = ROOT / "scripts" / "sync_production_db.py"
script_spec = importlib.util.spec_from_file_location("sync_production_db", SCRIPT_PATH)
assert script_spec is not None and script_spec.loader is not None
sync_production_db = importlib.util.module_from_spec(script_spec)
script_spec.loader.exec_module(sync_production_db)


# 测试点：生产同步只能通过 root-owned 导出入口执行 check/dump，不能重新放开远端任意 shell。
def test_remote_commands_use_restricted_export_entrypoint() -> None:
    assert sync_production_db.REMOTE_BACKUP_COMMAND == (
        "sudo -n /usr/local/sbin/livesetlist-sync-export dump"
    )
    assert sync_production_db.REMOTE_PRECHECK_COMMAND == (
        "sudo -n /usr/local/sbin/livesetlist-sync-export check"
    )


# 测试点：远端 SSH 备份失败时必须删除不完整 dump，且不进入本地恢复流程。
def test_download_production_backup_removes_partial_file_on_ssh_failure(tmp_path, monkeypatch) -> None:
    destination = tmp_path / "production.dump"
    monkeypatch.setattr(sync_production_db, "resolve_ssh_command", lambda: "ssh")
    monkeypatch.setattr(
        sync_production_db.subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(args=[], returncode=1, stderr=b"sudo denied"),
    )

    with pytest.raises(SystemExit, match="生产数据库下载失败"):
        sync_production_db.download_production_backup("production", destination)

    assert not destination.exists()


# 测试点：SSH 预检必须调用受限入口的 check 模式验证备份生成与 dump 读取权限。
def test_precheck_ssh_environment_checks_remote_backup_access(monkeypatch) -> None:
    recorded_commands: list[list[str]] = []
    monkeypatch.setattr(sync_production_db, "resolve_ssh_command", lambda: "ssh")

    def fake_run(command, **_kwargs):
        recorded_commands.append(command)
        return subprocess.CompletedProcess(args=command, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(sync_production_db.subprocess, "run", fake_run)

    sync_production_db.precheck_ssh_environment("production")

    assert recorded_commands[0][:4] == ["ssh", "-o", "BatchMode=yes", "production"]
    assert recorded_commands[0][4] == "sudo -n /usr/local/sbin/livesetlist-sync-export check"


# 测试点：dump 校验失败时不得 drop 本地主库。
def test_restore_local_app_database_validates_before_reset(tmp_path, monkeypatch) -> None:
    backup_path = tmp_path / "production.dump"
    backup_path.write_bytes(b"dump")
    reset_calls: list[str] = []
    monkeypatch.setattr(sync_production_db, "ensure_container_ready", lambda *_args: None)
    monkeypatch.setattr(sync_production_db, "validate_backup_file", lambda *_args: (_ for _ in ()).throw(SystemExit("invalid dump")))
    monkeypatch.setattr(sync_production_db, "reset_database_for_restore", lambda *_args: reset_calls.append("reset"))

    with pytest.raises(SystemExit, match="invalid dump"):
        sync_production_db.restore_local_app_database({}, backup_path)

    assert reset_calls == []


# 测试点：有效 dump 应以无 owner/权限参数恢复并重新回灌本地运行时权限。
def test_restore_local_app_database_restores_and_reapplies_permissions(tmp_path, monkeypatch) -> None:
    backup_path = tmp_path / "production.dump"
    backup_path.write_bytes(b"dump")
    steps: list[str] = []
    restore_args: list[str] = []
    env_values = {"POSTGRES_CONTAINER_NAME": "local-postgres", "POSTGRES_USER": "postgres", "APP_DB": "live_statistic"}
    monkeypatch.setattr(sync_production_db, "ensure_container_ready", lambda *_args: steps.append("ready"))
    monkeypatch.setattr(sync_production_db, "validate_backup_file", lambda *_args: steps.append("validate"))
    monkeypatch.setattr(sync_production_db, "stop_local_backend", lambda: steps.append("stop-backend"))
    monkeypatch.setattr(sync_production_db, "reset_database_for_restore", lambda *_args: steps.append("reset"))

    def fake_restore(_label, args, **_kwargs):
        restore_args.extend(args)
        return subprocess.CompletedProcess(args=args, returncode=0, stdout=b"", stderr=b"")

    monkeypatch.setattr(sync_production_db, "run_binary_step", fake_restore)
    monkeypatch.setattr(sync_production_db, "apply_app_database_permissions", lambda *_args: steps.append("permissions"))

    sync_production_db.restore_local_app_database(env_values, backup_path)

    assert steps == ["ready", "validate", "stop-backend", "reset", "permissions"]
    assert "--no-owner" in restore_args
    assert "--no-privileges" in restore_args


# 测试点：同步流程只恢复数据库，不负责启动本地开发服务。
def test_sync_production_database_does_not_launch_dev_server(tmp_path, monkeypatch) -> None:
    env_file = tmp_path / ".env.pg-migrate"
    env_file.write_text("APP_DB=live_statistic\n", encoding="utf-8")
    calls: list[str] = []
    monkeypatch.setattr(sync_production_db, "ENV_FILE", env_file)
    monkeypatch.setattr(sync_production_db, "download_production_backup", lambda _host, path: path.write_bytes(b"dump"))
    monkeypatch.setattr(sync_production_db, "restore_local_app_database", lambda *_args: calls.append("restore"))

    assert sync_production_db.sync_production_database("production") == 0
    assert calls == ["restore"]
