import importlib.util
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[3]
RUN_CHECKS_PATH = ROOT / "scripts" / "run_checks.py"
run_checks_spec = importlib.util.spec_from_file_location("run_checks", RUN_CHECKS_PATH)
assert run_checks_spec is not None and run_checks_spec.loader is not None
run_checks = importlib.util.module_from_spec(run_checks_spec)
run_checks_spec.loader.exec_module(run_checks)


# 测试点：functional 门禁必须执行轻量 recovery-unit，避免恢复权限契约脱离发布检查。
def test_functional_checks_include_recovery_unit(monkeypatch):
    recovery_modes: list[str] = []
    executed_steps: list[str] = []

    monkeypatch.setattr(run_checks, "run_scripts_syntax_steps", lambda: [])
    monkeypatch.setattr(run_checks, "build_backend_steps", lambda mode: ([], []))
    monkeypatch.setattr(run_checks, "run_backend_check_steps", lambda _steps: [])
    monkeypatch.setattr(run_checks, "build_frontend_steps", lambda: ([], []))

    def fake_build_recovery_steps(mode: str):
        recovery_modes.append(mode)
        return (
            [
                (
                    "recovery",
                    "pytest recovery/tests (unit+contract)",
                    [],
                    ROOT,
                    0,
                )
            ],
            [],
        )

    def fake_run_check_steps(steps):
        executed_steps.extend(step_name for _label, step_name, _command, _cwd, _retries in steps)
        return []

    monkeypatch.setattr(run_checks, "build_recovery_steps", fake_build_recovery_steps)
    monkeypatch.setattr(run_checks, "run_check_steps", fake_run_check_steps)

    assert run_checks.run_functional_checks() == 0
    assert recovery_modes == ["unit"]
    assert executed_steps == ["pytest recovery/tests (unit+contract)"]


# 测试点：后端集成测试必须按文件启动独立 Python 进程，避免长进程累积 TestClient socket 资源。
def test_backend_integration_steps_are_split_by_test_file(monkeypatch, tmp_path):
    backend_dir = tmp_path / "backend"
    integration_dir = backend_dir / "tests" / "integration"
    integration_dir.mkdir(parents=True)
    (integration_dir / "test_beta.py").write_text("", encoding="utf-8")
    (integration_dir / "test_alpha.py").write_text("", encoding="utf-8")
    python_path = backend_dir / ".venv" / ("Scripts/python.exe" if run_checks.os.name == "nt" else "bin/python")
    python_path.parent.mkdir(parents=True)
    python_path.write_text("", encoding="utf-8")

    monkeypatch.setattr(run_checks, "BACKEND_DIR", backend_dir)

    steps, failures = run_checks.build_backend_steps(mode="integration")

    assert failures == []
    assert [step_name for _label, step_name, _command, _cwd, _retries in steps] == [
        "mypy",
        "pytest tests/integration/test_alpha.py",
        "pytest tests/integration/test_beta.py",
    ]


# 测试点：后端单元测试也必须按文件启动独立进程，避免大量 TestClient 用例共享同一 socket 生命周期。
def test_backend_unit_steps_are_split_by_test_file(monkeypatch, tmp_path):
    backend_dir = tmp_path / "backend"
    unit_dir = backend_dir / "tests" / "unit"
    unit_dir.mkdir(parents=True)
    (unit_dir / "test_beta.py").write_text("", encoding="utf-8")
    (unit_dir / "test_alpha.py").write_text("", encoding="utf-8")
    python_path = backend_dir / ".venv" / ("Scripts/python.exe" if run_checks.os.name == "nt" else "bin/python")
    python_path.parent.mkdir(parents=True)
    python_path.write_text("", encoding="utf-8")

    monkeypatch.setattr(run_checks, "BACKEND_DIR", backend_dir)

    steps, failures = run_checks.build_backend_steps(mode="unit")

    assert failures == []
    assert [step_name for _label, step_name, _command, _cwd, _retries in steps] == [
        "mypy",
        "pytest tests/unit/test_alpha.py",
        "pytest tests/unit/test_beta.py",
    ]


# 测试点：已识别的 Windows 10055 偶发错误只重跑当前分组，直到下一次有效通过。
def test_run_step_retries_known_transient_environment_failure(monkeypatch, capsys):
    outcomes = iter(
        [
            SimpleNamespace(returncode=1, stdout="OSError: [WinError 10055] socketpair failed\n"),
            SimpleNamespace(returncode=0, stdout="1 passed\n"),
        ]
    )
    calls: list[list[str]] = []

    def fake_run(args, **_kwargs):
        calls.append(args)
        return next(outcomes)

    monkeypatch.setattr(run_checks.subprocess, "run", fake_run)

    assert run_checks.run_step(
        "backend",
        ["python", "-m", "pytest", "tests/integration/test_catalog_api.py"],
        ROOT,
        transient_environment_retries=3,
    ) == 0
    assert len(calls) == 2
    assert "不能将其作为通过或交付理由" in capsys.readouterr().out


# 测试点：普通断言失败不得套用环境重跑规则或被伪装成偶发错误。
def test_run_step_does_not_retry_assertion_failure(monkeypatch, capsys):
    calls: list[list[str]] = []

    def fake_run(args, **_kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=1, stdout="FAILED test_example - AssertionError\n")

    monkeypatch.setattr(run_checks.subprocess, "run", fake_run)

    assert run_checks.run_step(
        "backend",
        ["python", "-m", "pytest", "tests/integration/test_catalog_api.py"],
        ROOT,
        transient_environment_retries=3,
    ) == 1
    assert len(calls) == 1
    assert "FAILED test_example" in capsys.readouterr().out


# 测试点：分文件 backend 测试都启用环境白名单重试，且 integration 结束后只还原一次 seed。
def test_backend_integration_groups_restore_seed_once(monkeypatch):
    steps = [
        ("backend", "pytest tests/unit/test_unit.py", ["pytest", "unit"], ROOT, 0),
        ("backend", "pytest tests/integration/test_alpha.py", ["pytest", "alpha"], ROOT, 0),
        ("backend", "pytest tests/integration/test_beta.py", ["pytest", "beta"], ROOT, 0),
    ]
    retry_budgets: list[int] = []
    restore_calls: list[bool] = []

    def fake_run_step(_label, _command, _cwd, retries=0, transient_environment_retries=0):
        assert retries == 0
        retry_budgets.append(transient_environment_retries)
        return 0

    def fake_restore():
        restore_calls.append(True)
        return None

    monkeypatch.setattr(run_checks, "run_step", fake_run_step)
    monkeypatch.setattr(run_checks, "restore_test_seed_after_integration", fake_restore)

    assert run_checks.run_backend_check_steps(steps) == []
    assert retry_budgets == [run_checks.TRANSIENT_ENVIRONMENT_RETRIES] * 3
    assert restore_calls == [True]
