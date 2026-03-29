import os
import signal
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"


def build_backend_command() -> list[str]:
    if os.name == "nt":
        python_exe = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    else:
        python_exe = BACKEND_DIR / ".venv" / "bin" / "python"

    if python_exe.exists():
        return [str(python_exe), "-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"]
    return [sys.executable, "-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"]


def build_frontend_command() -> list[str]:
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
    return [npm_cmd, "run", "dev"]


def terminate_process(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            proc.send_signal(signal.CTRL_BREAK_EVENT)
            time.sleep(0.5)
            if proc.poll() is None:
                proc.terminate()
        else:
            proc.terminate()
    except Exception:
        proc.terminate()


def main() -> int:
    if not BACKEND_DIR.exists() or not FRONTEND_DIR.exists():
        print("backend 或 frontend 目录不存在，请先生成项目骨架。")
        return 1

    backend_cmd = build_backend_command()
    frontend_cmd = build_frontend_command()

    print(f"[backend] {' '.join(backend_cmd)}")
    print(f"[frontend] {' '.join(frontend_cmd)}")
    print("启动中... 按 Ctrl+C 可一起关闭前后端。")

    backend_proc = subprocess.Popen(
        backend_cmd,
        cwd=BACKEND_DIR,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )
    frontend_proc = subprocess.Popen(
        frontend_cmd,
        cwd=FRONTEND_DIR,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )

    try:
        while True:
            if backend_proc.poll() is not None:
                print("后端已退出，正在关闭前端...")
                terminate_process(frontend_proc)
                return backend_proc.returncode or 0
            if frontend_proc.poll() is not None:
                print("前端已退出，正在关闭后端...")
                terminate_process(backend_proc)
                return frontend_proc.returncode or 0
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n收到 Ctrl+C，正在关闭前后端...")
        terminate_process(backend_proc)
        terminate_process(frontend_proc)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
