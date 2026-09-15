import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import stat

import pytest


ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = ROOT / "infra" / "production" / "livesetlist_sql_exec.py"
script_spec = importlib.util.spec_from_file_location("livesetlist_sql_exec", SCRIPT_PATH)
assert script_spec is not None and script_spec.loader is not None
livesetlist_sql_exec = importlib.util.module_from_spec(script_spec)
script_spec.loader.exec_module(livesetlist_sql_exec)


# 测试点：服务端只允许不向组用户和其他用户开放写权限的上传文件。
def test_upload_permission_check_uses_posix_write_bits() -> None:
    assert not livesetlist_sql_exec.has_unsafe_write_permissions(stat.S_IFREG | 0o600)
    assert livesetlist_sql_exec.has_unsafe_write_permissions(stat.S_IFREG | 0o620)
    assert livesetlist_sql_exec.has_unsafe_write_permissions(stat.S_IFREG | 0o602)


# 测试点：任意 SQL 权限不包含可在 psql 客户端执行系统命令的反斜杠元命令。
def test_rejects_psql_meta_commands() -> None:
    livesetlist_sql_exec.reject_psql_meta_commands(b"SELECT 1;\n")
    with pytest.raises(livesetlist_sql_exec.SqlExecError, match="meta-commands"):
        livesetlist_sql_exec.reject_psql_meta_commands(b"SELECT 1;\n  \\! id\n")


# 测试点：服务端检查固定通过生产配置构造只读 SELECT 1，不接受客户端指定数据库目标。
def test_check_uses_fixed_production_environment(tmp_path, monkeypatch) -> None:
    env_file = tmp_path / "postgres.env"
    env_file.write_text(
        "POSTGRES_CONTAINER_NAME=production-db\nPOSTGRES_USER=postgres\nAPP_DB=live_statistic\n",
        encoding="utf-8",
    )
    calls: list[list[str]] = []
    monkeypatch.setattr(livesetlist_sql_exec, "POSTGRES_ENV_PATH", env_file)
    monkeypatch.setattr(livesetlist_sql_exec, "audit", lambda *_args: None)

    def fake_run(command, **_kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(livesetlist_sql_exec.subprocess, "run", fake_run)

    assert livesetlist_sql_exec.main(["check"]) == 0
    assert calls == [[
        "docker", "exec", "-i", "production-db", "psql", "-X", "--no-psqlrc",
        "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "live_statistic", "-Atqc", "SELECT 1",
    ]]


# 测试点：apply 必须先成功备份，再把哈希匹配的 SQL 经 stdin 交给固定数据库。
def test_apply_backs_up_before_executing_validated_sql(tmp_path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    sql_file = upload_root / "change.sql"
    payload = b"BEGIN; SELECT 1; COMMIT;\n"
    sql_file.write_bytes(payload)
    checksum = hashlib.sha256(payload).hexdigest()
    calls: list[tuple[list[str], bytes | None]] = []
    monkeypatch.setattr(livesetlist_sql_exec, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(livesetlist_sql_exec, "operator_uid", lambda: os.stat(sql_file).st_uid)
    monkeypatch.setattr(livesetlist_sql_exec, "has_unsafe_write_permissions", lambda _mode: False)
    monkeypatch.setattr(livesetlist_sql_exec, "database_command", lambda *_args: ["database-command"])
    monkeypatch.setattr(livesetlist_sql_exec, "audit", lambda *_args: None)

    def fake_run(command, **kwargs):
        calls.append((command, kwargs.get("input")))
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(livesetlist_sql_exec.subprocess, "run", fake_run)

    assert livesetlist_sql_exec.main(["apply", str(sql_file), checksum]) == 0
    assert calls[0] == (["systemctl", "start", "livesetlist-backup.service"], None)
    assert calls[1] == (["database-command"], payload)


# 测试点：SQL 哈希不匹配时不得启动备份或接触数据库。
def test_apply_rejects_checksum_mismatch_before_side_effects(tmp_path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    sql_file = upload_root / "change.sql"
    sql_file.write_text("SELECT 1;", encoding="utf-8")
    monkeypatch.setattr(livesetlist_sql_exec, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(livesetlist_sql_exec, "operator_uid", lambda: os.stat(sql_file).st_uid)
    monkeypatch.setattr(livesetlist_sql_exec, "has_unsafe_write_permissions", lambda _mode: False)
    monkeypatch.setattr(livesetlist_sql_exec, "audit", lambda *_args: None)
    monkeypatch.setattr(
        livesetlist_sql_exec.subprocess,
        "run",
        lambda *_args, **_kwargs: pytest.fail("side effect before validation"),
    )

    with pytest.raises(SystemExit, match="SHA-256 does not match"):
        livesetlist_sql_exec.main(["apply", str(sql_file), "0" * 64])


# 测试点：上传目录外的文件即使哈希正确也不能由高权限入口读取或执行。
def test_apply_rejects_file_outside_upload_root(tmp_path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    sql_file = tmp_path / "outside.sql"
    payload = b"SELECT 1;"
    sql_file.write_bytes(payload)
    monkeypatch.setattr(livesetlist_sql_exec, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(livesetlist_sql_exec, "audit", lambda *_args: None)

    with pytest.raises(SystemExit, match="upload directory"):
        livesetlist_sql_exec.main(["apply", str(sql_file), hashlib.sha256(payload).hexdigest()])


# 测试点：执行前备份失败时不得把 SQL 发送给数据库。
def test_apply_stops_when_backup_fails(tmp_path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    sql_file = upload_root / "change.sql"
    payload = b"SELECT 1;"
    sql_file.write_bytes(payload)
    checksum = hashlib.sha256(payload).hexdigest()
    calls: list[list[str]] = []
    monkeypatch.setattr(livesetlist_sql_exec, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(livesetlist_sql_exec, "operator_uid", lambda: os.stat(sql_file).st_uid)
    monkeypatch.setattr(livesetlist_sql_exec, "has_unsafe_write_permissions", lambda _mode: False)
    monkeypatch.setattr(livesetlist_sql_exec, "audit", lambda *_args: None)

    def fake_run(command, **_kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 1)

    monkeypatch.setattr(livesetlist_sql_exec.subprocess, "run", fake_run)

    with pytest.raises(SystemExit, match="backup failed"):
        livesetlist_sql_exec.main(["apply", str(sql_file), checksum])
    assert calls == [["systemctl", "start", "livesetlist-backup.service"]]
