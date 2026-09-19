import importlib.util
from pathlib import Path
from types import SimpleNamespace
from threading import Barrier, Lock

import pytest


ROOT = Path(__file__).resolve().parents[2]
RUN_CHECKS_PATH = ROOT / "scripts" / "run_checks.py"
run_checks_spec = importlib.util.spec_from_file_location("run_checks", RUN_CHECKS_PATH)
assert run_checks_spec is not None and run_checks_spec.loader is not None
run_checks = importlib.util.module_from_spec(run_checks_spec)
run_checks_spec.loader.exec_module(run_checks)


# 测试点：前端使用系统找到的 npm，且不对普通断言失败进行无条件重试。
def test_frontend_steps_use_discovered_npm_executable(monkeypatch, tmp_path):
    npm_executable = tmp_path / "npm.exe"
    npm_executable.write_bytes(b"")
    monkeypatch.setattr(run_checks.shutil, "which", lambda name: str(npm_executable) if name == "npm" else None)
    monkeypatch.setattr(run_checks, "FRONTEND_DIR", tmp_path)

    steps, failures = run_checks.build_frontend_steps()

    assert failures == []
    assert all(retries == 0 for _label, _name, _command, _cwd, retries in steps)
    assert [command[0] for _label, _step_name, command, _cwd, _retries in steps] == [
        str(npm_executable), str(npm_executable),
    ]


# 测试点：functional/full 同时执行独立 scripts 组及各自 recovery 模式，脚本失败必须传播。
@pytest.mark.parametrize(("target", "recovery_mode"), [("functional", "unit"), ("full", "all")])
@pytest.mark.parametrize("scripts_failed", [False, True], ids=["success", "scripts-failure"])
def test_combined_checks_include_scripts_and_recovery(monkeypatch, target, recovery_mode, scripts_failed):
    recovery_modes: list[str] = []
    executed_steps: list[str] = []

    scripts_calls = []
    def fake_scripts():
        scripts_calls.append(True)
        return [("scripts", "pytest scripts/tests", 1)] if scripts_failed else []
    monkeypatch.setattr(run_checks, "run_scripts_check_steps", fake_scripts)
    monkeypatch.setattr(run_checks, "build_backend_steps", lambda mode: ([], []))
    monkeypatch.setattr(run_checks, "run_backend_check_steps", lambda _steps, **_kwargs: [])
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

    assert getattr(run_checks, f"run_{target}_checks")() == int(scripts_failed)
    assert scripts_calls == [True]
    assert recovery_modes == [recovery_mode]
    assert executed_steps == ["pytest recovery/tests (unit+contract)"]


# 测试点：unit 与 integration 各自按文件创建独立 Python 进程，且保留 mypy 和排序后的文件清单。
@pytest.mark.parametrize("mode", ["unit", "integration"])
def test_backend_steps_are_split_by_test_file(monkeypatch, tmp_path, mode):
    backend_dir = tmp_path / "backend"
    test_dir = backend_dir / "tests" / mode
    test_dir.mkdir(parents=True)
    (test_dir / "test_beta.py").write_text("", encoding="utf-8")
    (test_dir / "test_alpha.py").write_text("", encoding="utf-8")
    python_path = backend_dir / ".venv" / ("Scripts/python.exe" if run_checks.os.name == "nt" else "bin/python")
    python_path.parent.mkdir(parents=True)
    python_path.write_text("", encoding="utf-8")
    monkeypatch.setattr(run_checks, "BACKEND_DIR", backend_dir)

    steps, failures = run_checks.build_backend_steps(mode=mode)

    assert failures == []
    assert [step_name for _label, step_name, _command, _cwd, _retries in steps] == [
        "mypy", f"pytest tests/{mode}/test_alpha.py", f"pytest tests/{mode}/test_beta.py",
    ]
    for step, filename in zip(steps[1:], ("test_alpha.py", "test_beta.py")):
        _label, _name, command, cwd, retries = step
        expected = [str(python_path), "-m", "pytest", "-s", str(Path("tests") / mode / filename), "-q"]
        if mode == "unit":
            expected.extend(["-p", "no:cacheprovider"])
        assert command == expected
        assert cwd == backend_dir
        assert retries == 0


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

    def fake_run_step(_label, _command, _cwd, retries=0, transient_environment_retries=0, **_kwargs):
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


# 测试点：scripts 按目录收集任意新测试，backend 只收集自身测试目录。
def test_script_tests_belong_only_to_scripts_group(monkeypatch, tmp_path):
    scripts_dir = tmp_path / "scripts"
    scripts_tests = scripts_dir / "tests"
    backend_dir = tmp_path / "backend"
    backend_tests = backend_dir / "tests" / "unit"
    scripts_tests.mkdir(parents=True)
    backend_tests.mkdir(parents=True)
    for name in ("test_new_tool.py", "test_another_tool.py"):
        (scripts_tests / name).write_text("def test_ok(): pass", encoding="utf-8")
    (backend_tests / "test_endpoint.py").write_text("def test_ok(): pass", encoding="utf-8")
    python_path = backend_dir / ".venv" / ("Scripts/python.exe" if run_checks.os.name == "nt" else "bin/python")
    python_path.parent.mkdir(parents=True)
    python_path.touch()
    monkeypatch.setattr(run_checks, "ROOT", tmp_path)
    monkeypatch.setattr(run_checks, "SCRIPTS_DIR", scripts_dir)
    monkeypatch.setattr(run_checks, "BACKEND_DIR", backend_dir)

    steps, failures = run_checks.build_scripts_steps()
    assert failures == []
    pytest_commands = [command for _, _, command, _, _ in steps if "pytest" in command]
    assert len(pytest_commands) == 1
    assert str(scripts_tests) in pytest_commands[0]
    backend_steps, failures = run_checks.build_backend_steps("unit")
    assert failures == []
    collected = [Path(command[command.index("pytest") + 2]) for _, _, command, _, _ in backend_steps if "pytest" in command]
    assert collected == [Path("tests/unit/test_endpoint.py")]


# 测试点：scripts 入口执行语法及测试步骤，任何一步失败均影响总退出码。
@pytest.mark.parametrize("failure_stage", [None, "syntax", "tests"])
def test_scripts_target_runs_syntax_and_tests(monkeypatch, failure_stage):
    calls = []
    def syntax():
        calls.append("syntax")
        return [("scripts", "syntax", 1)] if failure_stage == "syntax" else []
    steps = [("scripts", "pytest scripts/tests", [], ROOT, 0)]
    def execute(actual):
        assert actual == steps
        calls.append("tests")
        return [("scripts", "tests", 1)] if failure_stage == "tests" else []
    monkeypatch.setattr(run_checks, "run_scripts_syntax_steps", syntax)
    monkeypatch.setattr(run_checks, "build_scripts_steps", lambda: (steps, []))
    monkeypatch.setattr(run_checks, "run_check_steps", execute)
    assert run_checks.run_scripts_checks() == int(failure_stage is not None)
    assert calls == ["syntax", "tests"]


# 测试点：两个 unit 文件确实并行且不超上限，失败汇总不阻断其余文件，integration 和 seed 等待 unit 完成。
@pytest.mark.parametrize("launch_error", [False, True], ids=["test-failure", "launch-failure"])
def test_backend_unit_concurrency_preserves_stage_barriers(monkeypatch, capsys, launch_error):
    barrier = Barrier(2, timeout=5)
    lock = Lock()
    active = 0
    peak = 0
    completed = []
    serial_stages = []
    temp_paths = []
    original_log_env = run_checks.os.environ.get("APP_LOG_FILE")
    steps = [("backend", "mypy", ["mypy"], ROOT, 0)] + [
        ("backend", f"pytest tests/unit/{name}.py", [name], ROOT, 0)
        for name in ("alpha", "beta", "gamma")
    ] + [
        ("backend", f"pytest tests/integration/{name}.py", [name], ROOT, 0)
        for name in ("integration-a", "integration-b")
    ]

    def fake_run(_label, command, _cwd, retries=0, transient_environment_retries=0, log=None, env=None):
        nonlocal active, peak
        name = command[0]
        assert retries == 0
        if name == "mypy":
            assert active == 0 and completed == []
            assert transient_environment_retries == 0
            serial_stages.append(name)
            return 0
        assert transient_environment_retries == run_checks.TRANSIENT_ENVIRONMENT_RETRIES
        if name.startswith("integration"):
            assert active == 0 and set(completed) == {"alpha", "beta", "gamma"}
            serial_stages.append(name)
            return 0
        assert serial_stages == ["mypy"]
        assert command[-2] == "--basetemp"
        assert Path(env["APP_LOG_FILE"]).parent == Path(command[-1]).parent
        assert run_checks.os.environ.get("APP_LOG_FILE") == original_log_env
        with lock:
            temp_paths.append(Path(command[-1]).parent)
            active += 1
            peak = max(peak, active)
        try:
            if name in {"alpha", "beta"}:
                barrier.wait()
            log.append(f"output-{name}")
            if name == "beta" and launch_error:
                raise OSError("cannot launch beta")
            return 1 if name == "beta" else 0
        finally:
            with lock:
                active -= 1
                completed.append(name)

    def restore():
        assert serial_stages == ["mypy", "integration-a", "integration-b"]
        serial_stages.append("seed")
        return None

    monkeypatch.setattr(run_checks, "run_step", fake_run)
    monkeypatch.setattr(run_checks, "restore_test_seed_after_integration", restore)
    assert run_checks.run_backend_check_steps(steps, workers=2) == [
        ("backend", "pytest tests/unit/beta.py", 1),
    ]
    assert peak == 2
    assert len(set(temp_paths)) == 3
    assert all(not path.exists() for path in temp_paths)
    assert serial_stages == ["mypy", "integration-a", "integration-b", "seed"]
    output = capsys.readouterr().out
    for name in ("alpha", "beta", "gamma"):
        assert f"output-{name}" in output
    if launch_error:
        assert "cannot launch beta" in output


# 测试点：workers=1 时文件严格串行执行，unit-only 不触发 seed 恢复。
def test_backend_unit_serial_fallback(monkeypatch):
    seen = []
    def fake_run(_label, command, _cwd, **_kwargs):
        seen.append(command[0])
        return 0
    monkeypatch.setattr(run_checks, "run_step", fake_run)
    monkeypatch.setattr(run_checks, "restore_test_seed_after_integration", lambda: pytest.fail("unexpected seed"))
    steps = [("backend", f"pytest tests/unit/{name}.py", [name], ROOT, 0) for name in ("a", "b")]
    assert run_checks.run_backend_check_steps(steps, workers=1) == []
    assert seen == ["a", "b"]


# 测试点：并发参数默认 2、接受串行模式，并拒绝零或负数。
@pytest.mark.parametrize("value", [None, "1", "4", "0", "-1"])
def test_backend_worker_argument(monkeypatch, value):
    argv = ["run_checks.py", "backend-unit"]
    if value is not None:
        argv += ["--backend-workers", value]
    monkeypatch.setattr("sys.argv", argv)
    if value in {"0", "-1"}:
        with pytest.raises(SystemExit) as exc:
            run_checks.parse_args()
        assert exc.value.code == 2
    else:
        assert run_checks.parse_args().backend_workers == (2 if value is None else int(value))
