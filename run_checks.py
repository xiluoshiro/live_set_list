import argparse
import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT / "frontend"
BACKEND_DIR = ROOT / "backend"


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


def run_backend_checks() -> int:
    if not BACKEND_DIR.exists():
        print("backend 目录不存在。")
        return 1

    python_path = backend_python()
    if not python_path.exists():
        print("未找到 backend/.venv 的 Python。请先在 backend 目录创建并安装依赖。")
        return 1

    steps: list[tuple[list[str], int]] = [
        ([str(python_path), "-m", "mypy", "--config-file", "mypy.ini"], 0),
        ([str(python_path), "-m", "pytest", "tests/unit", "-q"], 0),
    ]

    for step, retries in steps:
        code = run_step("backend", step, BACKEND_DIR, retries=retries)
        if code != 0:
            print(f"命令失败，退出码: {code}")
            return code

    print("后端检查完成：mypy + pytest tests/unit 全部通过。")
    return 0


def run_frontend_checks() -> int:
    if not FRONTEND_DIR.exists():
        print("frontend 目录不存在。")
        return 1

    steps: list[tuple[list[str], int]] = [
        ([npm_command(), "run", "typecheck"], 0),
        ([npm_command(), "run", "test"], 1),
    ]

    for step, retries in steps:
        code = run_step("frontend", step, FRONTEND_DIR, retries=retries)
        if code != 0:
            print(f"命令失败，退出码: {code}")
            return code

    print("前端检查完成：typecheck + test 全部通过。")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run project checks.")
    parser.add_argument(
        "target",
        choices=["frontend", "backend", "all"],
        help="Check target: frontend / backend / all.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.target == "backend":
        return run_backend_checks()
    if args.target == "frontend":
        return run_frontend_checks()
    if args.target == "all":
        backend_code = run_backend_checks()
        if backend_code != 0:
            return backend_code
        return run_frontend_checks()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
