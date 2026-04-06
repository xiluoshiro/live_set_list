import argparse
import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT / "frontend"
BACKEND_DIR = ROOT / "backend"
RECOVERY_TEST_DIR = ROOT / "recovery" / "tests"

CheckStep = tuple[str, str, list[str], Path, int]
CheckFailure = tuple[str, str, int]


def npm_command() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def backend_python() -> Path:
    if os.name == "nt":
        return BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    return BACKEND_DIR / ".venv" / "bin" / "python"


def run_step(label: str, args: list[str], cwd: Path, retries: int = 0) -> int:
    for attempt in range(1, retries + 2):
        suffix = f" (attempt {attempt}/{retries + 1})" if retries > 0 else ""
        print(f"[{label}] {' '.join(args)}{suffix}", flush=True)
        completed = subprocess.run(args, cwd=cwd)
        if completed.returncode == 0:
            return 0
        if attempt <= retries:
            print(f"命令失败，准备重试。退出码: {completed.returncode}", flush=True)
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
        steps.extend(
            [
                ("backend", "mypy", [str(python_path), "-m", "mypy", "--config-file", "mypy.ini"], BACKEND_DIR, 0),
                ("backend", "pytest tests/unit", [str(python_path), "-m", "pytest", "tests/unit", "-q"], BACKEND_DIR, 0),
            ]
        )

    if mode in {"integration", "all"}:
        if mode == "integration":
            steps.append(("backend", "mypy", [str(python_path), "-m", "mypy", "--config-file", "mypy.ini"], BACKEND_DIR, 0))
        steps.append(
            (
                "backend",
                "pytest tests/integration",
                [str(python_path), "-m", "pytest", "tests/integration", "-q"],
                BACKEND_DIR,
                0,
            )
        )
    return steps, failures


def build_recovery_steps() -> tuple[list[CheckStep], list[CheckFailure]]:
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

    steps.append(
        (
            "recovery",
            "pytest recovery/tests",
            [str(python_path), "-m", "pytest", str(RECOVERY_TEST_DIR.relative_to(ROOT)), "-q"],
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
            ("frontend", "test", [npm_command(), "run", "test"], FRONTEND_DIR, 1),
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


def print_summary(target: str, failures: list[CheckFailure]) -> int:
    if not failures:
        if target == "backend-unit":
            print("后端检查完成：backend-unit 全部通过。")
        elif target == "backend-integration":
            print("后端检查完成：backend-integration 全部通过。")
        elif target == "backend":
            print("后端检查完成：backend-unit + backend-integration 全部通过。")
        elif target == "recovery":
            print("恢复脚本检查完成：pytest recovery/tests 全部通过。")
        elif target == "frontend":
            print("前端检查完成：typecheck + test 全部通过。")
        elif target == "functional":
            print("功能检查完成：frontend + backend 全部通过。")
        elif target == "full":
            print("全量检查完成：frontend + backend + recovery 全部通过。")
        else:
            print("检查全部通过。")
        return 0

    print("检查完成：存在失败项。")
    for label, step_name, code in failures:
        print(f"- {label} / {step_name} 失败，退出码: {code}")
    return 1


def run_backend_checks() -> int:
    steps, failures = build_backend_steps(mode="all")
    failures.extend(run_check_steps(steps))
    return print_summary("backend", failures)


def run_backend_unit_checks() -> int:
    steps, failures = build_backend_steps(mode="unit")
    failures.extend(run_check_steps(steps))
    return print_summary("backend-unit", failures)


def run_backend_integration_checks() -> int:
    steps, failures = build_backend_steps(mode="integration")
    failures.extend(run_check_steps(steps))
    return print_summary("backend-integration", failures)


def run_frontend_checks() -> int:
    steps, failures = build_frontend_steps()
    failures.extend(run_check_steps(steps))
    return print_summary("frontend", failures)


def run_recovery_checks() -> int:
    steps, failures = build_recovery_steps()
    failures.extend(run_check_steps(steps))
    return print_summary("recovery", failures)


def run_functional_checks() -> int:
    failures: list[CheckFailure] = []
    backend_steps, backend_failures = build_backend_steps(mode="all")
    frontend_steps, frontend_failures = build_frontend_steps()
    failures.extend(backend_failures)
    failures.extend(run_check_steps(backend_steps))
    failures.extend(frontend_failures)
    failures.extend(run_check_steps(frontend_steps))
    return print_summary("functional", failures)


def run_full_checks() -> int:
    failures: list[CheckFailure] = []
    backend_steps, backend_failures = build_backend_steps(mode="all")
    frontend_steps, frontend_failures = build_frontend_steps()
    recovery_steps, recovery_failures = build_recovery_steps()
    failures.extend(backend_failures)
    failures.extend(run_check_steps(backend_steps))
    failures.extend(frontend_failures)
    failures.extend(run_check_steps(frontend_steps))
    failures.extend(recovery_failures)
    failures.extend(run_check_steps(recovery_steps))
    return print_summary("full", failures)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run project checks.")
    parser.add_argument(
        "target",
        choices=["frontend", "backend", "backend-unit", "backend-integration", "recovery", "functional", "full"],
        help="Check target: frontend / backend / backend-unit / backend-integration / recovery / functional / full.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.target == "backend":
        return run_backend_checks()
    if args.target == "backend-unit":
        return run_backend_unit_checks()
    if args.target == "backend-integration":
        return run_backend_integration_checks()
    if args.target == "recovery":
        return run_recovery_checks()
    if args.target == "frontend":
        return run_frontend_checks()
    if args.target == "functional":
        return run_functional_checks()
    if args.target == "full":
        return run_full_checks()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
