import argparse
import ast
import os
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from itertools import groupby
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter
from typing import Protocol


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
FRONTEND_DIR = ROOT / "frontend"
BACKEND_DIR = ROOT / "backend"
RECOVERY_TEST_DIR = ROOT / "recovery" / "tests"
RECOVERY_INTEGRATION_TEST_DIR = ROOT / "recovery" / "tests" / "integration"

CheckStep = tuple[str, str, list[str], Path, int]
CheckFailure = tuple[str, str, int]
TRANSIENT_ENVIRONMENT_MARKERS = (
    "[WinError 10055]",
    "由于系统缓冲区空间不足或队列已满",
)
TRANSIENT_ENVIRONMENT_RETRIES = 3
BACKEND_UNIT_WORKERS = 2


class CompletedProcessLike(Protocol):
    returncode: int
    stdout: str | None


def npm_command() -> str:
    return shutil.which("npm") or ("npm.cmd" if os.name == "nt" else "npm")


def backend_python() -> Path:
    if os.name == "nt":
        return BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    return BACKEND_DIR / ".venv" / "bin" / "python"


def _run_captured_step(args: list[str], cwd: Path, env: dict[str, str] | None = None) -> CompletedProcessLike:
    return subprocess.run(
        args,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def _is_transient_environment_failure(output: str) -> bool:
    return any(marker in output for marker in TRANSIENT_ENVIRONMENT_MARKERS)


def run_step(
    label: str,
    args: list[str],
    cwd: Path,
    retries: int = 0,
    transient_environment_retries: int = 0,
    log: list[str] | None = None,
    env: dict[str, str] | None = None,
) -> int:
    def report(message: str) -> None:
        if log is None:
            print(message, flush=True)
        else:
            log.append(message)

    attempt = 1
    generic_retries_remaining = retries
    environment_retries_remaining = transient_environment_retries
    while True:
        show_attempt = retries > 0 or transient_environment_retries > 0
        total_attempts = 1 + retries + transient_environment_retries
        suffix = f" (attempt {attempt}/{total_attempts})" if show_attempt else ""
        report(f"[{label}] {' '.join(args)}{suffix}")
        if transient_environment_retries > 0:
            completed = _run_captured_step(args, cwd, env=env)
            output = completed.stdout or ""
            if output:
                report(output.rstrip("\n"))
        else:
            completed = subprocess.run(args, cwd=cwd, env=env)
            output = ""
        if completed.returncode == 0:
            return 0
        if environment_retries_remaining > 0 and _is_transient_environment_failure(output):
            environment_retries_remaining -= 1
            attempt += 1
            report("检测到可重试的环境错误；仅重跑当前测试分组，不能将其作为通过或交付理由。")
            continue
        if generic_retries_remaining > 0:
            generic_retries_remaining -= 1
            attempt += 1
            report(f"命令失败，准备重试。退出码: {completed.returncode}")
            continue
        return completed.returncode


def build_backend_steps(mode: str = "all") -> tuple[list[CheckStep], list[CheckFailure]]:
    steps: list[CheckStep] = []
    failures: list[CheckFailure] = []
    if not BACKEND_DIR.exists():
        print("backend 目录不存在。")
        failures.append(("backend", "目录检查", 1))
        return steps, failures

    python_path = backend_python()
    if not python_path.exists():
        print("未找到 backend/.venv 的 Python。请先在 backend 目录创建并安装依赖。")
        failures.append(("backend", "Python 环境检查", 1))
        return steps, failures

    if mode in {"unit", "all"}:
        steps.append(("backend", "mypy", [str(python_path), "-m", "mypy", "--config-file", "mypy.ini"], BACKEND_DIR, 0))
        unit_test_dir = BACKEND_DIR / "tests" / "unit"
        unit_test_files = sorted(unit_test_dir.glob("test_*.py"))
        if not unit_test_files:
            print("backend/tests/unit 中没有测试文件。")
            failures.append(("backend", "unit 测试文件检查", 1))
        for test_file in unit_test_files:
            relative_test_file = test_file.relative_to(BACKEND_DIR)
            steps.append(
                (
                    "backend",
                    f"pytest {relative_test_file.as_posix()}",
                    [str(python_path), "-m", "pytest", "-s", str(relative_test_file), "-q", "-p", "no:cacheprovider"],
                    BACKEND_DIR,
                    0,
                )
            )

    if mode in {"integration", "all"}:
        if mode == "integration":
            steps.append(("backend", "mypy", [str(python_path), "-m", "mypy", "--config-file", "mypy.ini"], BACKEND_DIR, 0))
        integration_test_dir = BACKEND_DIR / "tests" / "integration"
        integration_test_files = sorted(integration_test_dir.glob("test_*.py"))
        if not integration_test_files:
            print("backend/tests/integration 中没有测试文件。")
            failures.append(("backend", "integration 测试文件检查", 1))
        for test_file in integration_test_files:
            relative_test_file = test_file.relative_to(BACKEND_DIR)
            steps.append(
                (
                    "backend",
                    f"pytest {relative_test_file.as_posix()}",
                    [str(python_path), "-m", "pytest", "-s", str(relative_test_file), "-q"],
                    BACKEND_DIR,
                    0,
                )
            )
    return steps, failures


def build_scripts_steps() -> tuple[list[CheckStep], list[CheckFailure]]:
    test_dir = SCRIPTS_DIR / "tests"
    test_files = sorted(test_dir.glob("test_*.py"))
    if not test_files:
        return [], [("scripts", "scripts/tests 测试文件检查", 1)]
    python_path = backend_python()
    if not python_path.exists():
        return [], [("scripts", "Python 环境检查", 1)]
    return [
        ("scripts", "mypy", [str(python_path), "-m", "mypy", "--config-file", "scripts/mypy.ini"], ROOT, 0),
        ("scripts", "pytest scripts/tests", [str(python_path), "-m", "pytest", str(test_dir), "-q"], ROOT, 0),
    ], []


def run_scripts_check_steps() -> list[CheckFailure]:
    failures = run_scripts_syntax_steps()
    steps, setup_failures = build_scripts_steps()
    failures.extend(setup_failures)
    failures.extend(run_check_steps(steps))
    return failures


def build_recovery_steps(mode: str = "unit") -> tuple[list[CheckStep], list[CheckFailure]]:
    steps: list[CheckStep] = []
    failures: list[CheckFailure] = []
    if not RECOVERY_TEST_DIR.exists():
        print("recovery/tests 目录不存在。")
        failures.append(("recovery", "目录检查", 1))
        return steps, failures

    python_path = backend_python()
    if not python_path.exists():
        print("未找到 backend/.venv 的 Python。请先在 backend 目录创建并安装依赖。")
        failures.append(("recovery", "Python 环境检查", 1))
        return steps, failures

    if mode in {"unit", "all"}:
        steps.append(
            (
                "recovery",
                "pytest recovery/tests (unit+contract)",
                [
                    str(python_path),
                    "-m",
                    "pytest",
                    str((RECOVERY_TEST_DIR / "test_recovery_unit.py").relative_to(ROOT)),
                    str((RECOVERY_TEST_DIR / "test_recovery_contract.py").relative_to(ROOT)),
                    "-q",
                ],
                ROOT,
                0,
            )
        )
    if mode in {"integration", "all"}:
        if not RECOVERY_INTEGRATION_TEST_DIR.exists():
            print("recovery/tests/integration 目录不存在。")
            failures.append(("recovery-integration", "目录检查", 1))
            return steps, failures
        steps.append(
            (
                "recovery-integration",
                "pytest recovery/tests/integration",
                [str(python_path), "-m", "pytest", str(RECOVERY_INTEGRATION_TEST_DIR.relative_to(ROOT)), "-q"],
                ROOT,
                0,
            )
        )
    return steps, failures


def build_frontend_steps() -> tuple[list[CheckStep], list[CheckFailure]]:
    steps: list[CheckStep] = []
    failures: list[CheckFailure] = []
    if not FRONTEND_DIR.exists():
        print("frontend 目录不存在。")
        failures.append(("frontend", "目录检查", 1))
        return steps, failures

    steps.extend(
        [
            ("frontend", "typecheck", [npm_command(), "run", "typecheck"], FRONTEND_DIR, 0),
            ("frontend", "test", [npm_command(), "run", "test"], FRONTEND_DIR, 0),
        ]
    )
    return steps, failures


def run_check_steps(steps: list[CheckStep]) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    for label, step_name, command, cwd, retries in steps:
        code = run_step(label, command, cwd, retries=retries)
        if code != 0:
            print(f"{label} 检查失败：{step_name}，退出码: {code}", flush=True)
            failures.append((label, step_name, code))
    return failures


def restore_test_seed_after_integration() -> CheckFailure | None:
    python_path = backend_python()
    restore_script = SCRIPTS_DIR / "internal" / "restore_test_seed.py"
    code = run_step(
        "backend",
        [str(python_path), str(restore_script.relative_to(ROOT))],
        ROOT,
    )
    if code != 0:
        print(f"backend 检查失败：restore test seed，退出码: {code}", flush=True)
        return ("backend", "restore test seed", code)
    return None


def _run_backend_unit_file(step: CheckStep) -> tuple[int, list[str]]:
    label, name, command, cwd, retries = step
    log: list[str] = []
    started = perf_counter()
    try:
        with TemporaryDirectory(prefix="livesetlist-unit-") as temp_dir:
            env = os.environ.copy()
            env["APP_LOG_FILE"] = str(Path(temp_dir) / "app.log")
            isolated_command = [*command, "--basetemp", str(Path(temp_dir) / "pytest")]
            code = run_step(
                label, isolated_command, cwd, retries=retries,
                transient_environment_retries=TRANSIENT_ENVIRONMENT_RETRIES, log=log, env=env,
            )
    except OSError as exc:
        log.append(f"{label} 执行或清理失败 {name}: {exc}")
        code = 1
    log.append(f"[{label}] {name}: exit {code}, {perf_counter() - started:.2f}s")
    return code, log


def run_backend_unit_steps(steps: list[CheckStep], workers: int) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    started = perf_counter()
    print(f"[backend] unit: {len(steps)} files, max workers={workers}", flush=True)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(_run_backend_unit_file, step): step for step in steps}
        for future in as_completed(futures):
            label, name, _command, _cwd, _retries = futures[future]
            code, log = future.result()
            print("\n".join(log), flush=True)
            if code != 0:
                failures.append((label, name, code))
    print(f"[backend] unit completed in {perf_counter() - started:.2f}s", flush=True)
    return sorted(failures)


def run_backend_check_steps(
    steps: list[CheckStep], workers: int = BACKEND_UNIT_WORKERS,
) -> list[CheckFailure]:
    if workers < 1:
        raise ValueError("backend workers must be >= 1")
    failures: list[CheckFailure] = []
    ran_integration = False
    # Each non-unit stage is a barrier: mypy finishes first, integration starts after all unit files.
    for is_unit, group in groupby(
        steps, key=lambda step: step[0] == "backend" and step[1].startswith("pytest tests/unit/"),
    ):
        if is_unit:
            failures.extend(run_backend_unit_steps(list(group), workers))
            continue
        for label, step_name, command, cwd, retries in group:
            is_integration = label == "backend" and step_name.startswith("pytest tests/integration/")
            ran_integration |= is_integration
            code = run_step(
                label, command, cwd, retries=retries,
                transient_environment_retries=TRANSIENT_ENVIRONMENT_RETRIES if is_integration else 0,
            )
            if code != 0:
                print(f"{label} 检查失败：{step_name}，退出码: {code}", flush=True)
                failures.append((label, step_name, code))
    if ran_integration:
        restore_failure = restore_test_seed_after_integration()
        if restore_failure is not None:
            failures.append(restore_failure)
    return failures


def run_scripts_syntax_steps() -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    if not SCRIPTS_DIR.exists():
        print("scripts 目录不存在。")
        return [("scripts", "目录检查", 1)]

    script_paths = sorted(SCRIPTS_DIR.glob("*.py"))
    for script_path in script_paths:
        relative_path = script_path.relative_to(ROOT)
        print(f"[scripts] syntax {relative_path}", flush=True)
        try:
            ast.parse(script_path.read_text(encoding="utf-8"), filename=str(script_path))
        except SyntaxError as exc:
            print(f"{relative_path} 语法错误：{exc.msg} ({exc.lineno}:{exc.offset})", flush=True)
            failures.append(("scripts", f"syntax {relative_path}", 1))
    return failures


def print_summary(target: str, failures: list[CheckFailure]) -> int:
    if not failures:
        if target == "backend-unit":
            print("后端检查完成：backend-unit 全部通过。")
        elif target == "backend-integration":
            print("后端检查完成：backend-integration 全部通过。")
        elif target == "backend":
            print("后端检查完成：backend-unit + backend-integration 全部通过。")
        elif target == "recovery-unit":
            print("恢复脚本检查完成：recovery-unit 全部通过。")
        elif target == "recovery-integration":
            print("恢复脚本检查完成：Docker 沙箱集成测试全部通过。")
        elif target == "recovery":
            print("恢复脚本检查完成：recovery-unit + recovery-integration 全部通过。")
        elif target == "frontend":
            print("前端检查完成：typecheck + test 全部通过。")
        elif target == "scripts":
            print("脚本检查完成：scripts 语法 + mypy + tests 全部通过。")
        elif target == "functional":
            print("功能检查完成：scripts + frontend + backend + recovery-unit 全部通过。")
        elif target == "full":
            print("全量检查完成：scripts + frontend + backend + recovery 全部通过。")
        else:
            print("检查全部通过。")
        return 0

    print("检查完成：存在失败项。")
    for label, step_name, code in failures:
        print(f"- {label} / {step_name} 失败，退出码: {code}")
    return 1


def run_backend_checks(workers: int = BACKEND_UNIT_WORKERS) -> int:
    steps, failures = build_backend_steps(mode="all")
    failures.extend(run_backend_check_steps(steps, workers=workers))
    return print_summary("backend", failures)


def run_backend_unit_checks(workers: int = BACKEND_UNIT_WORKERS) -> int:
    steps, failures = build_backend_steps(mode="unit")
    failures.extend(run_backend_check_steps(steps, workers=workers))
    return print_summary("backend-unit", failures)


def run_backend_integration_checks(workers: int = BACKEND_UNIT_WORKERS) -> int:
    steps, failures = build_backend_steps(mode="integration")
    failures.extend(run_backend_check_steps(steps, workers=workers))
    return print_summary("backend-integration", failures)


def run_frontend_checks() -> int:
    steps, failures = build_frontend_steps()
    failures.extend(run_check_steps(steps))
    return print_summary("frontend", failures)


def run_scripts_checks() -> int:
    failures = run_scripts_check_steps()
    return print_summary("scripts", failures)


def run_recovery_checks() -> int:
    steps, failures = build_recovery_steps(mode="unit")
    failures.extend(run_check_steps(steps))
    return print_summary("recovery-unit", failures)


def run_recovery_integration_checks() -> int:
    steps, failures = build_recovery_steps(mode="integration")
    failures.extend(run_check_steps(steps))
    return print_summary("recovery-integration", failures)


def run_recovery_all_checks() -> int:
    steps, failures = build_recovery_steps(mode="all")
    failures.extend(run_check_steps(steps))
    return print_summary("recovery", failures)


def run_functional_checks(workers: int = BACKEND_UNIT_WORKERS) -> int:
    failures: list[CheckFailure] = []
    backend_steps, backend_failures = build_backend_steps(mode="all")
    frontend_steps, frontend_failures = build_frontend_steps()
    recovery_steps, recovery_failures = build_recovery_steps(mode="unit")
    failures.extend(run_scripts_check_steps())
    failures.extend(backend_failures)
    failures.extend(run_backend_check_steps(backend_steps, workers=workers))
    failures.extend(frontend_failures)
    failures.extend(run_check_steps(frontend_steps))
    failures.extend(recovery_failures)
    failures.extend(run_check_steps(recovery_steps))
    return print_summary("functional", failures)


def run_full_checks(workers: int = BACKEND_UNIT_WORKERS) -> int:
    failures: list[CheckFailure] = []
    backend_steps, backend_failures = build_backend_steps(mode="all")
    frontend_steps, frontend_failures = build_frontend_steps()
    recovery_steps, recovery_failures = build_recovery_steps(mode="all")
    failures.extend(run_scripts_check_steps())
    failures.extend(backend_failures)
    failures.extend(run_backend_check_steps(backend_steps, workers=workers))
    failures.extend(frontend_failures)
    failures.extend(run_check_steps(frontend_steps))
    failures.extend(recovery_failures)
    failures.extend(run_check_steps(recovery_steps))
    return print_summary("full", failures)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run project checks.")
    parser.add_argument(
        "target",
        choices=[
            "frontend",
            "backend",
            "backend-unit",
            "backend-integration",
            "recovery-unit",
            "recovery-integration",
            "recovery",
            "scripts",
            "functional",
            "full",
        ],
        help="Check target: frontend / backend / backend-unit / backend-integration / recovery-unit / recovery-integration / recovery / scripts / functional / full.",
    )
    parser.add_argument(
        "--backend-workers", type=int, default=BACKEND_UNIT_WORKERS,
        help="Maximum concurrent backend unit files (default: 2; use 1 for serial execution).",
    )
    args = parser.parse_args()
    if args.backend_workers < 1:
        parser.error("--backend-workers must be >= 1")
    return args


def main() -> int:
    args = parse_args()
    if args.target == "backend":
        return run_backend_checks(workers=args.backend_workers)
    if args.target == "backend-unit":
        return run_backend_unit_checks(workers=args.backend_workers)
    if args.target == "backend-integration":
        return run_backend_integration_checks(workers=args.backend_workers)
    if args.target == "recovery-unit":
        return run_recovery_checks()
    if args.target == "recovery-integration":
        return run_recovery_integration_checks()
    if args.target == "recovery":
        return run_recovery_all_checks()
    if args.target == "frontend":
        return run_frontend_checks()
    if args.target == "scripts":
        return run_scripts_checks()
    if args.target == "functional":
        return run_functional_checks(workers=args.backend_workers)
    if args.target == "full":
        return run_full_checks(workers=args.backend_workers)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
