"""Run the production-shaped local stack: FastAPI without reload plus the built frontend.

Intended for the Windows host behind the Cloudflare tunnel: the backend serves
``/api`` on 127.0.0.1:8000 and ``scripts/serve_frontend.py`` serves
``frontend/dist`` on the port the tunnel points at (default ``::1:5173``).
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import run_dev  # noqa: E402


def build_backend_command() -> list[str]:
    if os.name == "nt":
        python_exe = run_dev.BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    else:
        python_exe = run_dev.BACKEND_DIR / ".venv" / "bin" / "python"
    executable = str(python_exe) if python_exe.exists() else sys.executable
    return [
        executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        run_dev.BACKEND_HOST,
        "--port",
        str(run_dev.BACKEND_PORT),
    ]


def build_frontend_command(host: str, port: int, dist: Path) -> list[str]:
    return [
        sys.executable,
        str(SCRIPTS_DIR / "serve_frontend.py"),
        "--host",
        host,
        "--port",
        str(port),
        "--dist",
        str(dist),
    ]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="启动生产形态的本地服务（FastAPI + 构建产物）。")
    parser.add_argument("--host", default="::1", help="前端监听地址，默认 ::1。")
    parser.add_argument("--port", type=int, default=5173, help="前端监听端口，默认 5173。")
    parser.add_argument("--dist", default=str(run_dev.ROOT / "frontend" / "dist"), help="构建产物目录。")
    return parser.parse_args(argv)


def wait_for_postgres(attempts: int = 12, delay_seconds: float = 10.0) -> bool:
    """Wait for Docker/PostgreSQL after logon, when both may still be starting."""
    for attempt in range(attempts):
        if run_dev.ensure_postgres_container_running():
            return True
        if attempt + 1 < attempts:
            time.sleep(delay_seconds)
    return False


def cleanup_stale_frontend_processes(port: int) -> bool:
    """Take over the tunnel port: stop whatever still listens there, like run_dev does for 8000."""
    pids = run_dev.find_listening_pids(port)
    if not pids:
        return True

    print(f"检测到 {port} 端口已有服务，正在清理：{', '.join(str(pid) for pid in sorted(pids))}")
    for pid in sorted(pids):
        run_dev.kill_process_tree(pid, force=True)

    for _ in range(10):
        time.sleep(0.5)
        if not run_dev.find_listening_pids(port):
            return True

    remaining = ', '.join(str(pid) for pid in sorted(run_dev.find_listening_pids(port)))
    print(f"警告：{port} 端口仍被占用：{remaining}")
    return False


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    dist = Path(args.dist)
    if not (dist / "index.html").is_file():
        print(f"未找到构建产物：{dist / 'index.html'}，请先在 frontend 执行 npm run build。")
        return 1
    if not cleanup_stale_frontend_processes(args.port):
        return 1
    if not wait_for_postgres():
        return 1
    if not run_dev.cleanup_stale_backend_processes():
        return 1

    backend_command = build_backend_command()
    frontend_command = build_frontend_command(args.host, args.port, dist)
    backend_env = run_dev.build_backend_env(use_test_db=False)
    print(f"[backend] {' '.join(backend_command)}")
    print(f"[frontend] {' '.join(frontend_command)}")
    print("启动中... 按 Ctrl+C 可一起关闭。")

    try:
        backend_proc = subprocess.Popen(
            backend_command,
            cwd=run_dev.BACKEND_DIR,
            env=backend_env,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
    except OSError as exc:
        print(f"启动后端失败：{exc}")
        return 1
    try:
        frontend_proc = subprocess.Popen(frontend_command, cwd=run_dev.ROOT)
    except OSError as exc:
        print(f"启动前端失败：{exc}；正在关闭已启动的后端。")
        run_dev.terminate_process(backend_proc)
        return 1

    try:
        while True:
            if backend_proc.poll() is not None:
                print("后端已退出，正在关闭前端...")
                run_dev.terminate_process(frontend_proc)
                return backend_proc.returncode or 0
            if frontend_proc.poll() is not None:
                print("前端已退出，正在关闭后端...")
                run_dev.terminate_process(backend_proc)
                return frontend_proc.returncode or 0
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n收到 Ctrl+C，正在关闭前后端...")
        run_dev.terminate_process(backend_proc)
        run_dev.terminate_process(frontend_proc)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
