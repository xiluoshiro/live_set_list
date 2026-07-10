import argparse
import os
import signal
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

from dotenv import dotenv_values


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"
PG_ENV_PATH = ROOT / "infra" / "postgres" / ".env.pg-migrate"
BACKEND_PORT = 8000
BACKEND_HOST = "127.0.0.1"
DEV_API_PROXY_TARGET = f"http://{BACKEND_HOST}:{BACKEND_PORT}"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="启动本地后端与前端开发服务。")
    parser.add_argument(
        "--test-db",
        action="store_true",
        help="仅后端进程连接测试库；默认使用 TEST_DB_NAME 或 live_statistic_test。",
    )
    return parser.parse_args(argv)


def build_backend_command() -> list[str]:
    if os.name == "nt":
        python_exe = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    else:
        python_exe = BACKEND_DIR / ".venv" / "bin" / "python"

    if python_exe.exists():
        return [str(python_exe), "-m", "uvicorn", "app.main:app", "--reload", "--host", BACKEND_HOST, "--port", str(BACKEND_PORT)]
    return [sys.executable, "-m", "uvicorn", "app.main:app", "--reload", "--host", BACKEND_HOST, "--port", str(BACKEND_PORT)]


def build_frontend_command() -> list[str]:
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
    return [npm_cmd, "run", "dev"]


def get_postgres_container_name() -> str:
    env_values = dotenv_values(PG_ENV_PATH)
    container_name = str(env_values.get("POSTGRES_CONTAINER_NAME", "")).strip()
    return container_name


def get_test_db_name() -> str:
    env_values = dotenv_values(PG_ENV_PATH)
    return str(os.getenv("TEST_DB_NAME") or env_values.get("TEST_DB_NAME") or "live_statistic_test")


def get_app_db_name() -> str:
    env_values = dotenv_values(PG_ENV_PATH)
    return str(env_values.get("APP_DB") or "live_statistic")


def set_backend_env_value(
    backend_env: dict[str, str],
    env_values: dict[str, str | None],
    target_name: str,
    source_name: str,
    default: str | None = None,
) -> None:
    value = env_values.get(source_name) or default
    if value is not None:
        backend_env[target_name] = str(value)


def build_backend_env(*, use_test_db: bool) -> dict[str, str]:
    backend_env = os.environ.copy()
    env_values = dotenv_values(PG_ENV_PATH)
    db_name = get_test_db_name() if use_test_db else get_app_db_name()
    backend_env["DB_NAME"] = db_name
    backend_env["APP_DB"] = db_name
    set_backend_env_value(backend_env, env_values, "DB_HOST", "POSTGRES_HOST", "localhost")
    set_backend_env_value(backend_env, env_values, "POSTGRES_HOST", "POSTGRES_HOST", "localhost")
    set_backend_env_value(backend_env, env_values, "DB_PORT", "POSTGRES_PORT", "5432")
    set_backend_env_value(backend_env, env_values, "POSTGRES_PORT", "POSTGRES_PORT", "5432")
    set_backend_env_value(backend_env, env_values, "DB_USER", "APP_RO_USER")
    set_backend_env_value(backend_env, env_values, "DB_PASSWORD", "APP_RO_PASSWORD")
    set_backend_env_value(backend_env, env_values, "DB_WRITE_USER", "APP_SUPER_USER")
    set_backend_env_value(backend_env, env_values, "DB_WRITE_PASSWORD", "APP_SUPER_PASSWORD")
    set_backend_env_value(backend_env, env_values, "DB_USER_RW_USER", "APP_USER_RW_USER")
    set_backend_env_value(backend_env, env_values, "DB_USER_RW_PASSWORD", "APP_USER_RW_PASSWORD")
    return backend_env


def build_frontend_env() -> dict[str, str]:
    """Pin Vite's local API proxy to the same IPv4 loopback address as Uvicorn."""
    frontend_env = os.environ.copy()
    frontend_env["VITE_DEV_API_PROXY_TARGET"] = DEV_API_PROXY_TARGET
    return frontend_env


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, check=False)


def can_bind_backend_port() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", BACKEND_PORT))
        except OSError:
            return False
    return True


def _pid_exists(pid: int) -> bool:
    result = run_command(["tasklist", "/FI", f"PID eq {pid}", "/NH"])
    if result.returncode != 0:
        return False
    return str(pid) in result.stdout


def _get_child_pids(parent_pid: int) -> set[int]:
    result = run_command(["wmic", "process", "where", f"ParentProcessId={parent_pid}", "get", "ProcessId"])
    if result.returncode != 0:
        return set()
    pids: set[int] = set()
    for line in result.stdout.splitlines():
        stripped = line.strip()
        if not stripped or stripped == "ProcessId":
            continue
        try:
            pid = int(stripped)
        except ValueError:
            continue
        if pid != os.getpid() and pid > 0:
            pids.add(pid)
    return pids


def _netstat_listening_pids(port: int) -> set[int]:
    result = run_command(["netstat", "-ano", "-p", "TCP"])
    if result.returncode != 0:
        return set()

    pids: set[int] = set()
    port_suffix = f":{port}"
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[0].upper() != "TCP":
            continue
        local_address = parts[1]
        state = parts[3].upper()
        pid_text = parts[4]
        if state != "LISTENING" or not local_address.endswith(port_suffix):
            continue
        try:
            pid = int(pid_text)
        except ValueError:
            continue
        if pid == os.getpid():
            continue
        if _pid_exists(pid):
            pids.add(pid)
        else:
            pids.update(_get_child_pids(pid))
    return pids


def _lsof_listening_pids(port: int) -> set[int]:
    lsof_cmd = shutil.which("lsof")
    if not lsof_cmd:
        return set()
    result = run_command([lsof_cmd, "-ti", f"tcp:{port}", "-sTCP:LISTEN"])
    if result.returncode != 0:
        return set()

    pids: set[int] = set()
    for line in result.stdout.splitlines():
        try:
            pid = int(line.strip())
        except ValueError:
            continue
        if pid != os.getpid():
            pids.add(pid)
    return pids


def find_listening_pids(port: int) -> set[int]:
    if os.name == "nt":
        return _netstat_listening_pids(port)
    return _lsof_listening_pids(port)


def kill_process_tree(pid: int, *, force: bool) -> bool:
    if pid <= 0 or pid == os.getpid():
        return True
    if os.name == "nt":
        command = ["taskkill", "/PID", str(pid), "/T"]
        if force:
            command.append("/F")
        result = run_command(command)
        if result.returncode != 0:
            message = result.stderr.strip() or result.stdout.strip() or f"exit code {result.returncode}"
            print(f"清理进程 {pid} 失败：{message}")
            return False
        return True

    signal_to_send = signal.SIGKILL if force else signal.SIGTERM
    try:
        os.kill(pid, signal_to_send)
    except ProcessLookupError:
        return True
    except PermissionError as exc:
        print(f"清理进程 {pid} 失败：{exc}")
        return False
    return True


def cleanup_stale_backend_processes() -> bool:
    pids = find_listening_pids(BACKEND_PORT)
    if not pids:
        return True

    print(f"检测到 {BACKEND_PORT} 端口已有后端进程，正在清理：{', '.join(str(pid) for pid in sorted(pids))}")
    for pid in sorted(pids):
        kill_process_tree(pid, force=True)

    remaining_pids: set[int] = set()
    for _ in range(5):
        time.sleep(0.5)
        remaining_pids = find_listening_pids(BACKEND_PORT)
        if not remaining_pids:
            break

    if remaining_pids:
        if can_bind_backend_port():
            print(
                f"{BACKEND_PORT} 端口已可用，忽略 netstat 残留 PID："
                f"{', '.join(str(pid) for pid in sorted(remaining_pids))}"
            )
            return True
        print(f"警告：{BACKEND_PORT} 端口仍被占用：{', '.join(str(pid) for pid in sorted(remaining_pids))}")
        return False
    return True


def resolve_docker_command() -> str | None:
    if os.name == "nt":
        return shutil.which("docker.cmd") or shutil.which("docker.exe") or shutil.which("docker")
    return shutil.which("docker")


def ensure_postgres_container_running() -> bool:
    container_name = get_postgres_container_name()
    if not container_name:
        print(f"未在 {PG_ENV_PATH} 中找到 POSTGRES_CONTAINER_NAME，无法检查 PostgreSQL 容器。")
        return False

    docker_cmd = resolve_docker_command()
    if not docker_cmd:
        print("未找到 docker 可执行文件。")
        print("请确认 Docker Desktop 已安装，并且当前终端环境变量 PATH 能访问 docker。")
        return False

    exists_result = run_command(
        [docker_cmd, "ps", "-a", "--filter", f"name=^{container_name}$", "--format", "{{.Names}}"]
    )
    if exists_result.returncode != 0:
        print("检查 PostgreSQL 容器失败：")
        print(exists_result.stderr.strip() or exists_result.stdout.strip())
        return False

    if container_name not in exists_result.stdout.splitlines():
        print(f"未找到 PostgreSQL 容器：{container_name}")
        print("请先确认 Docker 容器已创建，再重新执行启动脚本。")
        return False

    running_result = run_command([docker_cmd, "inspect", "-f", "{{.State.Running}}", container_name])
    if running_result.returncode != 0:
        print("读取 PostgreSQL 容器状态失败：")
        print(running_result.stderr.strip() or running_result.stdout.strip())
        return False

    if running_result.stdout.strip().lower() == "true":
        return True

    print(f"PostgreSQL 容器未启动，正在拉起：{container_name}")
    start_result = run_command([docker_cmd, "start", container_name])
    if start_result.returncode != 0:
        print("拉起 PostgreSQL 容器失败：")
        print(start_result.stderr.strip() or start_result.stdout.strip())
        return False

    return True


def terminate_process(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        kill_process_tree(proc.pid, force=True)
        return
    try:
        if os.name == "nt":
            proc.send_signal(signal.CTRL_BREAK_EVENT)
            time.sleep(0.5)
            if proc.poll() is None:
                kill_process_tree(proc.pid, force=True)
        else:
            proc.terminate()
            time.sleep(0.5)
            if proc.poll() is None:
                kill_process_tree(proc.pid, force=True)
    except Exception:
        kill_process_tree(proc.pid, force=True)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not BACKEND_DIR.exists() or not FRONTEND_DIR.exists():
        print("backend 或 frontend 目录不存在，请先生成项目骨架。")
        return 1
    if not ensure_postgres_container_running():
        return 1

    if not cleanup_stale_backend_processes():
        return 1

    backend_cmd = build_backend_command()
    frontend_cmd = build_frontend_command()
    backend_env = build_backend_env(use_test_db=args.test_db)
    frontend_env = build_frontend_env()

    print(f"[backend] {' '.join(backend_cmd)}")
    if args.test_db:
        print(
            f"[backend] DB_HOST={backend_env['DB_HOST']} DB_PORT={backend_env['DB_PORT']} "
            f"DB_NAME={backend_env['DB_NAME']} APP_DB={backend_env['APP_DB']}（测试库，仅注入后端进程）"
        )
    else:
        print(
            f"[backend] DB_HOST={backend_env['DB_HOST']} DB_PORT={backend_env['DB_PORT']} "
            f"DB_NAME={backend_env['DB_NAME']} APP_DB={backend_env['APP_DB']}（生产库，仅注入后端进程）"
        )
    print(f"[frontend] {' '.join(frontend_cmd)} VITE_DEV_API_PROXY_TARGET={DEV_API_PROXY_TARGET}")
    print("启动中... 按 Ctrl+C 可一起关闭前后端。")

    backend_proc = subprocess.Popen(
        backend_cmd,
        cwd=BACKEND_DIR,
        env=backend_env,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )
    frontend_proc = subprocess.Popen(
        frontend_cmd,
        cwd=FRONTEND_DIR,
        env=frontend_env,
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
