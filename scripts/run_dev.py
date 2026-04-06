import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from dotenv import dotenv_values


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"
PG_ENV_PATH = ROOT / "infra" / "postgres" / ".env.pg-migrate"


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


def get_postgres_container_name() -> str:
    env_values = dotenv_values(PG_ENV_PATH)
    container_name = str(env_values.get("POSTGRES_CONTAINER_NAME", "")).strip()
    return container_name


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, check=False)


def ensure_postgres_container_running() -> bool:
    container_name = get_postgres_container_name()
    if not container_name:
        print(f"未在 {PG_ENV_PATH} 中找到 POSTGRES_CONTAINER_NAME，无法检查 PostgreSQL 容器。")
        return False

    exists_result = run_command(
        ["docker", "ps", "-a", "--filter", f"name=^{container_name}$", "--format", "{{.Names}}"]
    )
    if exists_result.returncode != 0:
        print("检查 PostgreSQL 容器失败：")
        print(exists_result.stderr.strip() or exists_result.stdout.strip())
        return False

    if container_name not in exists_result.stdout.splitlines():
        print(f"未找到 PostgreSQL 容器：{container_name}")
        print("请先确认 Docker 容器已创建，再重新执行启动脚本。")
        return False

    running_result = run_command(["docker", "inspect", "-f", "{{.State.Running}}", container_name])
    if running_result.returncode != 0:
        print("读取 PostgreSQL 容器状态失败：")
        print(running_result.stderr.strip() or running_result.stdout.strip())
        return False

    if running_result.stdout.strip().lower() == "true":
        return True

    print(f"PostgreSQL 容器未启动，正在拉起：{container_name}")
    start_result = run_command(["docker", "start", container_name])
    if start_result.returncode != 0:
        print("拉起 PostgreSQL 容器失败：")
        print(start_result.stderr.strip() or start_result.stdout.strip())
        return False

    return True


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
    if not ensure_postgres_container_running():
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
