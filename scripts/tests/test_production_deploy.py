"""Execute the deployment shell in a temporary filesystem with host commands stubbed."""

import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

import pytest

ROOT = Path(__file__).resolve().parents[2]
VERSION = "2026-09-30-001"

# No systemd, journal, network, backup, migration, or package installation is real.
MOCK_COMMAND = r'''
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

name = Path(sys.argv[0]).name
args = sys.argv[1:]
root = Path(os.environ["DEPLOY_TEST_ROOT"])
current = root / "current"
candidate = root / "releases" / "livesetlist-2026-09-30-001"
active = str(current.resolve())
failure = os.environ.get("DEPLOY_TEST_FAILURE", "")
with (root / "calls.jsonl").open("a") as log:
    log.write(json.dumps([name, args, active]) + "\n")

if name in {"python", "python3"}:
    if failure == "venv":
        sys.exit(23)
    bin_dir = Path(args[-1]) / "bin"
    bin_dir.mkdir(parents=True)
    for executable in ("python", "pip"):
        shutil.copyfile(__file__, bin_dir / executable)
        (bin_dir / executable).chmod(0o755)
elif name == "pip":
    sys.exit(24 if failure == "pip" else 0)
elif name == "install":
    if failure == "install":
        sys.exit(25)
    shutil.copyfile(args[-2], args[-1])
elif name == "systemctl":
    if "status" in args:
        print("mock backend service: failed", file=sys.stderr)
        sys.exit(3)  # A failed service normally makes status itself nonzero.
    if args == ["restart", "livesetlist-backend.service"]:
        if failure == "restart" and active == str(candidate):
            sys.exit(26)
        if os.environ.get("DEPLOY_TEST_ROLLBACK_FAILURE") == "restart" and active != str(candidate):
            sys.exit(27)
    if args == ["start", "livesetlist-backup.service"] and failure == "backup" and active == str(candidate):
        sys.exit(28)
elif name == "journalctl":
    print("mock journal: backend startup traceback", file=sys.stderr)
    sys.exit(29 if os.environ.get("DEPLOY_TEST_DIAGNOSTICS_FAILURE") else 0)
elif name == "curl":
    sys.exit(22 if failure in {"health", "signal"} else 0)
elif name == "sleep":
    if failure == "signal":
        import signal
        os.kill(os.getppid(), signal.SIGTERM)
elif name == "release-manager":
    if args[0] == "verify-deploy" and failure == "verify":
        sys.exit(30)
    if args[0] == "mark-deployed":
        if failure == "mark":
            sys.exit(31)
        (root / "deployed").write_text("yes")
elif name == "mv":
    if args[-1] == str(current):
        if failure == "switch" and active != str(candidate):
            sys.exit(32)
        if os.environ.get("DEPLOY_TEST_ROLLBACK_FAILURE") == "link" and active == str(candidate):
            sys.exit(33)
    sys.exit(subprocess.call([os.environ["DEPLOY_TEST_REAL_MV"], *args]))
'''


class DeploySandbox:
    def __init__(self, root: Path):
        self.root = root
        self.releases = root / "releases"
        self.releases.mkdir()
        self.candidate = self.releases / f"livesetlist-{VERSION}"
        self.previous = self.releases / "livesetlist-previous"
        old_bin = self.previous / "backend/.venv/bin"
        old_bin.mkdir(parents=True)
        self.current = root / "current"
        self.current.symlink_to(self.previous)
        self.bin = root / "bin"
        self.bin.mkdir()
        self.mock = self.bin / "mock-command"
        self.mock.write_text(f"#!{sys.executable}\n" + MOCK_COMMAND, encoding="utf-8")
        self.mock.chmod(0o755)
        for name in (
            "python3", "systemctl", "journalctl", "nginx", "curl", "sleep",
            "install", "chown", "mv", "release-manager",
        ):
            shutil.copyfile(self.mock, self.bin / name)
            (self.bin / name).chmod(0o755)
        shutil.copyfile(self.mock, old_bin / "python")
        (old_bin / "python").chmod(0o755)
        source = root / "source" / self.candidate.name
        (source / "backend").mkdir(parents=True)
        (source / "backend/requirements.txt").write_text("fake-package==1\n")
        units = source / "infra/production"
        units.mkdir(parents=True)
        for name in ("backend.service", "backup.service", "backup.timer"):
            (units / f"livesetlist-{name}").write_text("fake unit\n")
        archives = root / "archives"
        archives.mkdir()
        self.archive = archives / f"{self.candidate.name}.tar.gz"
        with tarfile.open(self.archive, "w:gz") as archive:
            archive.add(source, arcname=source.name)
        self.sha256 = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        systemd = root / "systemd"
        systemd.mkdir()
        self.script = root / "deploy"
        script = (ROOT / "infra/production/livesetlist-deploy").read_text()
        # Rewrite only fixed paths in the test copy; production has no env overrides.
        for original, replacement in {
            "/opt/livesetlist/releases": str(self.releases),
            "/opt/livesetlist/current": str(self.current),
            "/var/lib/livesetlist/release-archives": str(archives),
            "/usr/local/sbin/livesetlist-release-manager": str(self.bin / "release-manager"),
            "/etc/systemd/system": str(systemd),
        }.items():
            script = script.replace(original, replacement)
        self.script.write_text(script)
        self.log = root / "calls.jsonl"

    def run(self, failure="", rollback_failure="", diagnostics_failure=False):
        self.log.write_text("")
        env = {
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "DEPLOY_TEST_ROOT": str(self.root),
            "DEPLOY_TEST_REAL_MV": str(shutil.which("mv")),
            "DEPLOY_TEST_FAILURE": failure,
            "DEPLOY_TEST_ROLLBACK_FAILURE": rollback_failure,
            "DEPLOY_TEST_DIAGNOSTICS_FAILURE": "1" if diagnostics_failure else "",
        }
        return subprocess.run(
            ["bash", str(self.script), VERSION, self.sha256],
            env=env, capture_output=True, text=True, timeout=15,
        )

    def calls(self):
        import json

        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def assert_temporary_paths_removed(self):
        assert not list(self.releases.glob(".deploy.*"))
        assert not os.path.lexists(f"{self.current}.next")


@pytest.fixture
def deploy(tmp_path):
    return DeploySandbox(tmp_path)


# 测试点：健康检查耗尽时，先记录新 backend 的诊断，再回滚、清理，并可用同版本重试。
def test_health_failure_diagnoses_before_rollback_and_allows_same_version_retry(deploy):
    result = deploy.run("health", diagnostics_failure=True)
    assert result.returncode == 1
    assert "failed at wait-for-backend (exit 1)" in result.stderr
    assert "after 20 attempts" in result.stderr
    assert "mock backend service: failed" in result.stderr
    assert "mock journal: backend startup traceback" in result.stderr
    calls = deploy.calls()
    assert sum(name == "curl" for name, _, _ in calls) == 20
    journal_index = next(i for i, call in enumerate(calls) if call[0] == "journalctl")
    rollback_index = next(i for i, (name, args, active) in enumerate(calls)
                          if name == "systemctl" and args[0] == "restart" and active == str(deploy.previous))
    assert journal_index < rollback_index
    assert calls[journal_index][2] == str(deploy.candidate)
    journal_args = calls[journal_index][1]
    assert journal_args[journal_args.index("-n") + 1] == "100"
    assert "--since" in journal_args
    assert "--no-pager" in journal_args
    assert sum(name == "nginx" for name, _, _ in calls) == 2
    assert not (deploy.root / "deployed").exists()
    assert deploy.current.resolve() == deploy.previous
    assert not deploy.candidate.exists()
    assert deploy.archive.exists()
    deploy.assert_temporary_paths_removed()

    retry = deploy.run()
    assert retry.returncode == 0, retry.stderr
    assert deploy.current.resolve() == deploy.candidate
    assert deploy.candidate.is_dir()
    assert (deploy.root / "deployed").exists()
    assert not any(name == "journalctl" for name, _, _ in deploy.calls())
    deploy.assert_temporary_paths_removed()


# 测试点：切换前失败也会清理本次创建的目录，保留原版本与原始退出码。
@pytest.mark.parametrize(("failure", "status"), [("venv", 23), ("pip", 24), ("install", 25), ("switch", 32)])
def test_pre_switch_failure_cleans_only_new_release(deploy, failure, status):
    result = deploy.run(failure)
    assert result.returncode == status, result.stderr
    assert deploy.current.resolve() == deploy.previous
    assert deploy.previous.is_dir()
    assert not deploy.candidate.exists()
    assert not any(name == "journalctl" for name, _, _ in deploy.calls())
    deploy.assert_temporary_paths_removed()


# 测试点：重启失败、切换后的备份/落状态失败和 TERM 都进入同一回滚清理路径。
@pytest.mark.parametrize(("failure", "status"), [("restart", 26), ("backup", 28), ("mark", 31), ("signal", 143)])
def test_post_switch_failure_preserves_exit_status_and_rolls_back(deploy, failure, status):
    result = deploy.run(failure)
    assert result.returncode == status, result.stderr
    assert "backend diagnostics before rollback" in result.stderr
    assert deploy.current.resolve() == deploy.previous
    assert not deploy.candidate.exists()
    assert not (deploy.root / "deployed").exists()
    deploy.assert_temporary_paths_removed()


# 测试点：回滚指针或后端重启失败时保留候选目录，避免删除仍被进程使用的文件。
@pytest.mark.parametrize("rollback_failure", ["link", "restart"])
def test_incomplete_rollback_retains_candidate(deploy, rollback_failure):
    result = deploy.run("health", rollback_failure=rollback_failure)
    assert result.returncode == 1
    assert "rollback incomplete; retaining" in result.stderr
    assert deploy.candidate.is_dir()
    assert deploy.previous.is_dir()
    assert deploy.current.resolve() == (deploy.candidate if rollback_failure == "link" else deploy.previous)
    deploy.assert_temporary_paths_removed()


# 测试点：没有可回滚旧版本时，不能删除 current 指向的候选目录。
def test_no_previous_release_retains_active_candidate(deploy):
    deploy.current.unlink()
    result = deploy.run("health")
    assert result.returncode == 1
    assert "rollback incomplete; retaining" in result.stderr
    assert deploy.current.resolve() == deploy.candidate
    assert deploy.candidate.is_dir()
    deploy.assert_temporary_paths_removed()


# 测试点：既有目录、活动版本和悬空链接必须原样保留，不能据名称猜测是失败残留。
@pytest.mark.parametrize("existing", ["directory", "active", "dangling-symlink"])
def test_existing_release_is_never_removed_or_reused(deploy, existing):
    if existing == "dangling-symlink":
        deploy.candidate.symlink_to(deploy.root / "missing")
    else:
        deploy.candidate.mkdir()
        (deploy.candidate / "keep").write_text("existing release")
        if existing == "active":
            deploy.current.unlink()
            deploy.current.symlink_to(deploy.candidate)
    result = deploy.run()
    assert result.returncode == 1
    assert "release already exists" in result.stderr
    assert os.path.lexists(deploy.candidate)
    if existing != "dangling-symlink":
        assert (deploy.candidate / "keep").read_text() == "existing release"
    assert deploy.calls() == []


# 测试点：attestation/校验门失败不能启动备份或创建 release。
def test_verification_failure_has_no_deploy_side_effects(deploy):
    result = deploy.run("verify")
    assert result.returncode == 30
    assert [name for name, _, _ in deploy.calls()] == ["release-manager"]
    assert deploy.current.resolve() == deploy.previous
    assert not deploy.candidate.exists()
    deploy.assert_temporary_paths_removed()
