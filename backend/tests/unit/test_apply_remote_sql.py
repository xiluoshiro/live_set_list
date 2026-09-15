import importlib.util
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = ROOT / "scripts" / "apply_remote_sql.py"
script_spec = importlib.util.spec_from_file_location("apply_remote_sql", SCRIPT_PATH)
assert script_spec is not None and script_spec.loader is not None
apply_remote_sql = importlib.util.module_from_spec(script_spec)
script_spec.loader.exec_module(apply_remote_sql)


# 测试点：缺少明确确认时，即使 SQL 文件有效也不访问远端。
def test_main_requires_force_before_remote_access(tmp_path, monkeypatch) -> None:
    sql_file = tmp_path / "change.sql"
    sql_file.write_text("SELECT 1;", encoding="utf-8")
    monkeypatch.setattr(apply_remote_sql, "apply_remote_sql", lambda *_args: pytest.fail("remote access"))

    assert apply_remote_sql.main([str(sql_file), "--ssh-host", "production"]) == 1


# 测试点：预检要求本地 SQL 文件且不需要 --force，只上传探针并运行只读 SELECT 1。
def test_precheck_probes_transfer_and_database_without_business_sql(tmp_path, monkeypatch) -> None:
    sql_file = tmp_path / "change.sql"
    sql_file.write_text("DELETE FROM important_table;", encoding="utf-8")
    calls: list[list[str]] = []
    monkeypatch.setattr(apply_remote_sql, "resolve_command", lambda name: name)
    monkeypatch.setattr(apply_remote_sql, "apply_remote_sql", lambda *_args: pytest.fail("business SQL executed"))

    def fake_run(command, **_kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(apply_remote_sql.subprocess, "run", fake_run)

    assert apply_remote_sql.main([str(sql_file), "--ssh-host", "production", "--precheck"]) == 0
    assert calls[0][-1].startswith(
        "mkdir -m 700 -- /home/livesetlist-sql/uploads/livesetlist-sql-precheck-"
    )
    assert calls[1][0] == "scp"
    assert calls[1][-1].endswith("/probe.txt")
    assert "sha256sum --check --status" in calls[2][-1]
    assert "sudo -n /usr/local/sbin/livesetlist-sql-exec check" in calls[2][-1]
    assert "DELETE" not in calls[2][-1]
    assert calls[3][-1].startswith("rm -f --")

    assert all(str(sql_file) not in " ".join(command) for command in calls)


# 测试点：预检缺少或找不到 SQL 文件时，在任何远端访问前就失败。
def test_precheck_requires_existing_sql_file(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(apply_remote_sql, "precheck_remote_environment", lambda *_args: pytest.fail("remote access"))

    with pytest.raises(SystemExit):
        apply_remote_sql.main(["--ssh-host", "production", "--precheck"])
    with pytest.raises(SystemExit, match="SQL 文件不存在"):
        apply_remote_sql.main([str(tmp_path / "missing.sql"), "--ssh-host", "production", "--precheck"])


# 测试点：预检探针上传失败时不得尝试数据库命令，且要清理远端暂存目录。
def test_precheck_failed_scp_does_not_probe_database(tmp_path, monkeypatch) -> None:
    sql_file = tmp_path / "change.sql"
    sql_file.write_text("SELECT 1;", encoding="utf-8")
    calls: list[list[str]] = []
    monkeypatch.setattr(apply_remote_sql, "resolve_command", lambda name: name)

    def fake_run(command, **_kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 1 if command[0] == "scp" else 0)

    monkeypatch.setattr(apply_remote_sql.subprocess, "run", fake_run)

    with pytest.raises(SystemExit, match="SCP 预检失败"):
        apply_remote_sql.main([str(sql_file), "--ssh-host", "production", "--precheck"])
    assert len(calls) == 3
    assert calls[2][-1].startswith("rm -f --")


# 测试点：预检数据库探测失败必须返回失败，不能误报环境可用。
def test_precheck_failed_database_probe(tmp_path, monkeypatch) -> None:
    sql_file = tmp_path / "change.sql"
    sql_file.write_text("SELECT 1;", encoding="utf-8")
    calls: list[list[str]] = []
    monkeypatch.setattr(apply_remote_sql, "resolve_command", lambda name: name)

    def fake_run(command, **_kwargs):
        calls.append(command)
        failed = "livesetlist-sql-exec check" in command[-1]
        return subprocess.CompletedProcess(command, 1 if failed else 0)

    monkeypatch.setattr(apply_remote_sql.subprocess, "run", fake_run)

    with pytest.raises(SystemExit, match="远端预检失败"):
        apply_remote_sql.main([str(sql_file), "--ssh-host", "production", "--precheck"])
    assert len(calls) == 4
    assert calls[3][-1].startswith("rm -f --")


# 测试点：SSH 参数中的 shell 字符在上传前就被拒绝。
def test_rejects_unsafe_remote_arguments(tmp_path) -> None:
    sql_file = tmp_path / "change.sql"
    sql_file.write_text("SELECT 1;", encoding="utf-8")
    argv = [str(sql_file), "--ssh-host", "prod; touch bad", "--force"]

    with pytest.raises(SystemExit):
        apply_remote_sql.main(argv)


# 测试点：上传后必须校验文件内容并用 ON_ERROR_STOP 执行，最后清理临时文件。
def test_upload_verify_execute_and_cleanup(tmp_path, monkeypatch) -> None:
    sql_file = tmp_path / "change.sql"
    sql_file.write_text("SELECT 1;", encoding="utf-8")
    calls: list[list[str]] = []
    monkeypatch.setattr(apply_remote_sql, "resolve_command", lambda name: name)

    def fake_run(command, **_kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(apply_remote_sql.subprocess, "run", fake_run)

    assert apply_remote_sql.main([str(sql_file), "--ssh-host", "production", "--force"]) == 0
    assert calls[0][-1].startswith("mkdir -m 700 -- /home/livesetlist-sql/uploads/livesetlist-sql-")
    assert calls[1][0] == "scp"
    assert "sha256sum --check --status" in calls[2][-1]
    assert "sudo -n /usr/local/sbin/livesetlist-sql-exec apply" in calls[2][-1]
    assert calls[3][-1].startswith("rm -f -- /home/livesetlist-sql/uploads/livesetlist-sql-")
    assert "rmdir -- /home/livesetlist-sql/uploads/livesetlist-sql-" in calls[3][-1]


# 测试点：SCP 失败时不能调用远端 psql，但仍应清理可能残留的半成品文件。
def test_failed_upload_never_executes_sql(tmp_path, monkeypatch) -> None:
    sql_file = tmp_path / "change.sql"
    sql_file.write_text("SELECT 1;", encoding="utf-8")
    calls: list[list[str]] = []
    monkeypatch.setattr(apply_remote_sql, "resolve_command", lambda name: name)

    def fake_run(command, **_kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 1 if command[0] == "scp" else 0)

    monkeypatch.setattr(apply_remote_sql.subprocess, "run", fake_run)

    with pytest.raises(SystemExit, match="SQL 上传失败"):
        apply_remote_sql.main([str(sql_file), "--ssh-host", "production", "--force"])
    assert len(calls) == 3
    assert calls[2][-1].startswith("rm -f --")


# 测试点：远端数据库执行失败时必须返回失败并清理已上传的 SQL 文件。
def test_failed_remote_execution_cleans_up(tmp_path, monkeypatch) -> None:
    sql_file = tmp_path / "change.sql"
    sql_file.write_text("SELECT 1;", encoding="utf-8")
    calls: list[list[str]] = []
    monkeypatch.setattr(apply_remote_sql, "resolve_command", lambda name: name)

    def fake_run(command, **_kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 1 if "sha256sum --check" in command[-1] else 0)

    monkeypatch.setattr(apply_remote_sql.subprocess, "run", fake_run)

    with pytest.raises(SystemExit, match="校验或执行失败"):
        apply_remote_sql.main([str(sql_file), "--ssh-host", "production", "--force"])
    assert len(calls) == 4
    assert calls[3][-1].startswith("rm -f --")
