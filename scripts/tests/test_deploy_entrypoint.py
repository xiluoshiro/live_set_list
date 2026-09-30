import os
from pathlib import Path
import shutil
import subprocess

import pytest


DEPLOY_SCRIPT = Path(__file__).resolve().parents[2] / "infra" / "production" / "livesetlist-deploy"


def run_deploy_functions(tmp_path: Path, commands: str) -> subprocess.CompletedProcess[str]:
    if os.name == "nt":
        git = shutil.which("git")
        assert git is not None, "Git for Windows is required for the deployment shell tests"
        bash = Path(git).resolve().parents[1] / "bin" / "bash.exe"
    else:
        executable = shutil.which("bash")
        assert executable is not None, "Bash is required for the deployment shell tests"
        bash = Path(executable)
    return subprocess.run(
        [str(bash), "-c", 'source "$1"\nfixture_root=$(cd "$2" && pwd)\n' + commands,
         "deploy-test", DEPLOY_SCRIPT.as_posix(), tmp_path.as_posix()],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=15,
    )


# 测试点：同一进程仍在启动时，即使机器很慢也继续探测；用虚拟时间推进，不实际等待。
def test_backend_health_wait_allows_slow_startup(tmp_path: Path):
    result = run_deploy_functions(tmp_path, '''
SECONDS=0
poll=0
systemctl() {
  printf '%s\\n' ActiveState=active SubState=running MainPID=42 NRestarts=0 InvocationID=first
}
sleep() { poll=$((poll + 1)); SECONDS=$((SECONDS + 3600)); }
curl() { [ "$poll" -ge 2 ]; }
wait_for_backend
printf '%s' "$SECONDS" > "$fixture_root/elapsed"
''')

    assert result.returncode == 0, result.stderr
    assert int((tmp_path / "elapsed").read_text(encoding="utf-8")) >= 7200


# 测试点：服务已经就绪时应立即完成检查，不额外等待一个完整启动窗口。
def test_backend_health_wait_returns_as_soon_as_ready(tmp_path: Path):
    result = run_deploy_functions(tmp_path, '''
systemctl() {
  printf '%s\\n' ActiveState=active SubState=running MainPID=42 NRestarts=0 InvocationID=first
}
curl() { return 0; }
sleep() { echo "unexpected wait" >&2; return 97; }
wait_for_backend
''')

    assert result.returncode == 0, result.stderr
    assert "unexpected wait" not in result.stderr


# 测试点：服务停止、失败或进入自动重启时直接失败，不继续等待健康接口。
@pytest.mark.parametrize("state", ["failed/failed", "inactive/dead", "deactivating/stop", "activating/auto-restart"])
def test_backend_health_wait_stops_when_service_fails(tmp_path: Path, state: str):
    active, substate = state.split("/")
    result = run_deploy_functions(tmp_path, f'''
systemctl() {{
  printf '%s\\n' ActiveState={active} SubState={substate} MainPID=0 NRestarts=0 InvocationID=first
}}
curl() {{ echo "unexpected probe" >&2; return 0; }}
sleep() {{ echo "unexpected wait" >&2; return 97; }}
wait_for_backend
''')

    assert result.returncode == 1, result.stderr
    assert "unexpected probe" not in result.stderr
    assert "unexpected wait" not in result.stderr


# 测试点：探测间隙发生进程退出或重启，也要识别失败，不能把另一个进程当作原启动成功。
@pytest.mark.parametrize("change", ["MainPID=43", "NRestarts=1", "InvocationID=second"])
def test_backend_health_wait_rejects_replaced_process(tmp_path: Path, change: str):
    result = run_deploy_functions(tmp_path, f'''
poll=0
systemctl() {{
  printf '%s\\n' ActiveState=active SubState=running MainPID=42 NRestarts=0 InvocationID=first
  if [ "$poll" -gt 0 ]; then printf '%s\\n' {change}; fi
}}
curl() {{
  if [ "$poll" -gt 0 ]; then echo "unexpected probe after restart" >&2; return 0; fi
  return 7
}}
sleep() {{ poll=$((poll + 1)); }}
wait_for_backend
''')

    assert result.returncode == 1, result.stderr
    assert "exited or restarted" in result.stderr
    assert "unexpected probe" not in result.stderr


# 测试点：无法查询服务状态时保留失败，不能仅凭端口响应认定部署成功。
def test_backend_health_wait_requires_service_state(tmp_path: Path):
    result = run_deploy_functions(tmp_path, '''
systemctl() { return 1; }
curl() { return 0; }
sleep() { echo "unexpected wait" >&2; return 97; }
wait_for_backend
''')

    assert result.returncode == 1, result.stderr
    assert "cannot read backend service state" in result.stderr
    assert "unexpected wait" not in result.stderr


# 测试点：失败版本的残留目录应完整保留到独立位置，让同一版本可以重新解压且不修改当前应用。
def test_retry_preserves_inactive_release_and_frees_its_destination(tmp_path: Path):
    current = tmp_path / "current"
    current.mkdir()
    (current / "running.txt").write_text("active app", encoding="utf-8")
    candidate = tmp_path / "candidate"
    candidate.mkdir()
    (candidate / "failure.txt").write_text("failed app evidence", encoding="utf-8")

    result = run_deploy_functions(tmp_path, 'preserve_failed_release "$fixture_root/candidate" "$fixture_root/current"')

    assert result.returncode == 0, result.stderr
    assert not candidate.exists()
    preserved = list(tmp_path.glob(".failed-*/candidate/failure.txt"))
    assert len(preserved) == 1
    assert preserved[0].read_text(encoding="utf-8") == "failed app evidence"
    assert (current / "running.txt").read_text(encoding="utf-8") == "active app"


# 测试点：重试必须拒绝移动当前运行版本、未知当前版本或异常的非目录路径。
@pytest.mark.parametrize("case", ["active", "unknown-current", "not-directory"])
def test_retry_refuses_to_move_an_unsafe_release(tmp_path: Path, case: str):
    candidate = tmp_path / "candidate"
    current = tmp_path / "current"
    if case == "not-directory":
        candidate.write_text("keep this file", encoding="utf-8")
    else:
        candidate.mkdir()
        (candidate / "keep.txt").write_text("keep this release", encoding="utf-8")
    if case != "unknown-current":
        current.mkdir()
    current_argument = "candidate" if case == "active" else "current"

    result = run_deploy_functions(
        tmp_path, f'preserve_failed_release "$fixture_root/candidate" "$fixture_root/{current_argument}"',
    )

    assert result.returncode == 1, result.stderr
    assert candidate.exists()
    preserved_file = candidate if case == "not-directory" else candidate / "keep.txt"
    assert preserved_file.read_text(encoding="utf-8").startswith("keep this")
    assert not list(tmp_path.glob(".failed-*"))


# 测试点：首次部署没有旧目录时不创建失败目录，也不要求尚未用到的当前版本路径。
def test_fresh_release_does_not_need_quarantine(tmp_path: Path):
    result = run_deploy_functions(tmp_path, 'preserve_failed_release "$fixture_root/candidate" "$fixture_root/current"')

    assert result.returncode == 0, result.stderr
    assert list(tmp_path.iterdir()) == []


# 测试点：失败状态查询返回非零时仍须输出服务日志；日志读取失败也不能阻止后续回滚。
@pytest.mark.parametrize("journal_status", [0, 1])
def test_failure_diagnostics_continue_after_status_errors(tmp_path: Path, journal_status: int):
    result = run_deploy_functions(tmp_path, f'''
systemctl() {{ echo "fixture service failed"; return 3; }}
journalctl() {{ echo "fixture startup traceback"; return {journal_status}; }}
print_backend_diagnostics 100
echo "rollback can continue"
''')

    assert result.returncode == 0, result.stderr
    assert "fixture service failed" in result.stderr
    assert "fixture startup traceback" in result.stderr
    assert "rollback can continue" in result.stdout
