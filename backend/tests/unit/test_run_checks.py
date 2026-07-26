import importlib.util
from pathlib import Path


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
