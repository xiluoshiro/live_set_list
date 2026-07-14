from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from recovery.backup import validate_backup_file
from recovery.common import ENV_FILE, load_env_file, run_binary_step
from recovery.docker_ops import ensure_container_ready
from recovery.restore import apply_app_database_permissions, reset_database_for_restore


REMOTE_BACKUP_COMMAND = """set -eu
sudo -n systemctl start livesetlist-backup.service
sudo -n sh -c '
  latest=$(find /var/backups/livesetlist/app/auto -maxdepth 1 -type f -name "live_statistic_auto_*.dump" -printf "%T@ %p\\n" | sort -n | tail -n 1 | cut -d" " -f2-)
  test -n "$latest"
  cat "$latest"
'"""

REMOTE_PRECHECK_COMMAND = """set -eu
sudo -n systemctl start livesetlist-backup.service
sudo -n sh -c '
  latest=$(find /var/backups/livesetlist/app/auto -maxdepth 1 -type f -name "live_statistic_auto_*.dump" -printf "%T@ %p\\n" | sort -n | tail -n 1 | cut -d" " -f2-)
  test -s "$latest"
  dd if="$latest" of=/dev/null bs=1 count=1 status=none
'"""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="从生产 VM 同步数据库并覆盖本地主库。")
    parser.add_argument("--ssh-host", required=True, help="Windows SSH 配置中的生产 VM 别名。")
    parser.add_argument("--force", action="store_true", help="确认覆盖本地 live_statistic 数据库。")
    parser.add_argument("--precheck", action="store_true", help="只验证 SSH、sudo、VM 备份 service 和备份读取权限。")
    return parser.parse_args(argv)


def resolve_ssh_command() -> str:
    ssh_command = shutil.which("ssh.exe") or shutil.which("ssh")
    if not ssh_command:
        raise SystemExit("未找到 ssh 命令；请安装 OpenSSH Client 或检查 PATH。")
    return ssh_command


def download_production_backup(ssh_host: str, destination: Path) -> None:
    """Trigger the VM backup unit and stream its newest validated dump to destination."""
    ssh_command = resolve_ssh_command()
    command = [ssh_command, "-o", "BatchMode=yes", ssh_host, REMOTE_BACKUP_COMMAND]
    print(f"[ssh] 从 {ssh_host} 生成并下载生产数据库备份", flush=True)
    with destination.open("wb") as output:
        completed = subprocess.run(command, cwd=ROOT, stdout=output, stderr=subprocess.PIPE, check=False)
    if completed.returncode == 0 and destination.stat().st_size > 0:
        return

    destination.unlink(missing_ok=True)
    stderr = completed.stderr.decode("utf-8", errors="ignore").strip()
    raise SystemExit(
        "生产数据库下载失败。SSH 别名必须可无交互登录，且远端账户需要允许 "
        "sudo -n 启动 livesetlist-backup.service 并读取备份文件。"
        + (f"\n{stderr}" if stderr else "")
    )


def precheck_ssh_environment(ssh_host: str) -> None:
    """Verify the exact remote backup and read operations without downloading a dump."""
    ssh_command = resolve_ssh_command()
    command = [ssh_command, "-o", "BatchMode=yes", ssh_host, REMOTE_PRECHECK_COMMAND]
    print(f"[ssh] 预检 {ssh_host} 的生产备份访问权限", flush=True)
    completed = subprocess.run(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if completed.returncode == 0:
        print("SSH 预检通过：可免交互启动生产备份并读取最新 dump。", flush=True)
        return

    stderr = completed.stderr.strip()
    raise SystemExit(
        "SSH 预检失败。请检查 SSH 配置、主机指纹、密钥和 sudo -n 权限。"
        + (f"\n{stderr}" if stderr else "")
    )


def stop_local_backend() -> None:
    # run_dev 已处理 Windows 上 8000 端口的进程树；恢复前复用它避免旧后端重连被 drop 的数据库。
    scripts_dir = ROOT / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    import run_dev

    if not run_dev.cleanup_stale_backend_processes():
        raise SystemExit("无法停止本地 8000 后端；为避免恢复竞态，已取消覆盖本地主库。")


def restore_local_app_database(env_values: dict[str, str], backup_path: Path) -> None:
    """Validate first, then replace the configured local application database."""
    docker_cmd = "docker"
    container_name = env_values.get("POSTGRES_CONTAINER_NAME", "live-set-list-docker")
    ensure_container_ready(docker_cmd, container_name)
    validate_backup_file(docker_cmd, container_name, backup_path)
    stop_local_backend()

    reset_database_for_restore(env_values, docker_cmd, container_name)
    postgres_user = env_values.get("POSTGRES_USER", "postgres")
    app_db_name = env_values.get("APP_DB", "live_statistic")
    completed = run_binary_step(
        "pg_restore",
        [
            docker_cmd,
            "exec",
            "-i",
            container_name,
            "pg_restore",
            "-U",
            postgres_user,
            "-d",
            app_db_name,
            "--no-owner",
            "--no-privileges",
        ],
        stdin_path=backup_path,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="ignore")
        raise SystemExit(f"本地主库恢复失败：{backup_path}\n{stderr}")

    apply_app_database_permissions(env_values, docker_cmd, container_name)
    print(f"本地主库已从生产备份恢复：{backup_path}", flush=True)


def sync_production_database(ssh_host: str) -> int:
    if not ENV_FILE.exists():
        raise SystemExit(f"未找到本地数据库环境文件：{ENV_FILE}")
    env_values = load_env_file(ENV_FILE)
    with tempfile.NamedTemporaryFile(prefix="live-set-list-production-", suffix=".dump", delete=False) as temporary_file:
        backup_path = Path(temporary_file.name)

    try:
        download_production_backup(ssh_host, backup_path)
        restore_local_app_database(env_values, backup_path)
    finally:
        backup_path.unlink(missing_ok=True)

    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.precheck:
        precheck_ssh_environment(args.ssh_host)
        return 0
    if not args.force:
        print("此操作会覆盖本地 live_statistic 数据库。确认执行请加上 --force。")
        return 1
    return sync_production_database(args.ssh_host)


if __name__ == "__main__":
    raise SystemExit(main())
