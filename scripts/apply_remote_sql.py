from __future__ import annotations

import argparse
import hashlib
import re
import shlex
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path


REMOTE_DIRECTORY = "/home/livesetlist-sql/uploads"
REMOTE_EXEC_COMMAND = "/usr/local/sbin/livesetlist-sql-exec"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="上传本地 SQL 文件并在远端 PostgreSQL 容器中执行。")
    parser.add_argument("sql_file", type=Path, help="要执行的本地 SQL 文件；预检也必须提供。")
    parser.add_argument("--ssh-host", required=True, help="livesetlist-sql 运维账户的 SSH 配置别名或 user@host。")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--force", action="store_true", help="确认在远端数据库执行 SQL。")
    mode.add_argument("--precheck", action="store_true", help="检查本地文件、SSH、SCP 和受限 SQL 执行入口。")
    return parser.parse_args(argv)


def validate_args(args: argparse.Namespace) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@-]*", args.ssh_host):
        raise SystemExit("SSH 主机只能是普通别名或 user@host，不能包含路径、空格或 shell 字符。")
    sql_file = args.sql_file.resolve()
    if not sql_file.is_file():
        raise SystemExit(f"SQL 文件不存在：{sql_file}")
    if not args.precheck and sql_file.stat().st_size == 0:
        raise SystemExit(f"SQL 文件为空：{sql_file}")
    return sql_file


def resolve_command(name: str) -> str:
    command = shutil.which(f"{name}.exe") or shutil.which(name)
    if not command:
        raise SystemExit(f"未找到 {name} 命令；请安装 OpenSSH Client 或检查 PATH。")
    return command


def cleanup_remote_file(ssh_prefix: list[str], remote_file: str, remote_directory: str) -> None:
    cleanup_command = f"rm -f -- {shlex.quote(remote_file)} && rmdir -- {shlex.quote(remote_directory)}"
    cleanup = subprocess.run([*ssh_prefix, cleanup_command], check=False)
    if cleanup.returncode != 0:
        print(f"警告：远端临时文件清理失败：{remote_file}", flush=True)


def precheck_remote_environment(args: argparse.Namespace) -> int:
    ssh = resolve_command("ssh")
    scp = resolve_command("scp")
    ssh_prefix = [ssh, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", args.ssh_host]
    remote_directory = f"{REMOTE_DIRECTORY}/livesetlist-sql-precheck-{uuid.uuid4().hex}"
    remote_file = f"{remote_directory}/probe.txt"
    print(f"[precheck] 检查 {args.ssh_host} 的受限 SQL 执行入口", flush=True)
    with tempfile.TemporaryDirectory(prefix="livesetlist-sql-precheck-") as local_directory:
        probe = Path(local_directory) / "probe.txt"
        probe.write_bytes(b"livesetlist-sql-precheck\n")
        checksum = hashlib.sha256(probe.read_bytes()).hexdigest()
        if subprocess.run([*ssh_prefix, f"mkdir -m 700 -- {shlex.quote(remote_directory)}"], check=False).returncode != 0:
            raise SystemExit("SSH 预检失败：无法建立远端私有临时目录。")
        try:
            scp_command = [
                scp, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
                str(probe), f"{args.ssh_host}:{remote_file}",
            ]
            if subprocess.run(scp_command, check=False).returncode != 0:
                raise SystemExit("SCP 预检失败：无法上传探针文件。")
            verify = f"printf '%s  %s\\n' {shlex.quote(checksum)} {shlex.quote(remote_file)} | sha256sum --check --status"
            remote_check = shlex.join(["sudo", "-n", REMOTE_EXEC_COMMAND, "check"])
            if subprocess.run([*ssh_prefix, f"{verify} && {remote_check}"], check=False).returncode != 0:
                raise SystemExit("远端预检失败：探针校验、sudo 执行入口或数据库连接不可用。")
        finally:
            cleanup_remote_file(ssh_prefix, remote_file, remote_directory)
    print("远端预检通过；未上传或执行业务 SQL。", flush=True)
    return 0


def apply_remote_sql(args: argparse.Namespace, sql_file: Path) -> int:
    ssh = resolve_command("ssh")
    scp = resolve_command("scp")
    remote_directory = f"{REMOTE_DIRECTORY}/livesetlist-sql-{uuid.uuid4().hex}"
    remote_file = f"{remote_directory}/input.sql"
    ssh_prefix = [ssh, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", args.ssh_host]
    scp_command = [
        scp, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
        str(sql_file), f"{args.ssh_host}:{remote_file}",
    ]
    digest = hashlib.sha256()
    with sql_file.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    checksum = digest.hexdigest()
    verify = f"printf '%s  %s\\n' {shlex.quote(checksum)} {shlex.quote(remote_file)} | sha256sum --check --status"
    remote_apply = shlex.join([
        "sudo", "-n", REMOTE_EXEC_COMMAND, "apply", remote_file, checksum,
    ])
    execute = f"{verify} && {remote_apply}"

    print(f"[scp] 上传 {sql_file} 到 {args.ssh_host}:{remote_file}", flush=True)
    if subprocess.run([*ssh_prefix, f"mkdir -m 700 -- {shlex.quote(remote_directory)}"], check=False).returncode != 0:
        raise SystemExit("无法建立远端私有临时目录；未上传或执行 SQL。")
    try:
        if subprocess.run(scp_command, check=False).returncode != 0:
            raise SystemExit("SQL 上传失败；未执行远端 SQL。")
        print(f"[ssh] 通过受限入口在 {args.ssh_host} 执行 SQL", flush=True)
        if subprocess.run([*ssh_prefix, execute], check=False).returncode != 0:
            raise SystemExit("远端 SQL 校验或执行失败；请检查远端输出和数据库状态。")
        print("远端 SQL 执行成功。", flush=True)
        return 0
    finally:
        cleanup_remote_file(ssh_prefix, remote_file, remote_directory)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    sql_file = validate_args(args)
    if args.precheck:
        print(f"[precheck] 本地 SQL 文件存在：{sql_file}", flush=True)
        return precheck_remote_environment(args)
    if not args.force:
        print(f"将上传并通过受限入口执行 {sql_file} 到 {args.ssh_host}；确认后请加 --force。")
        return 1
    return apply_remote_sql(args, sql_file)


if __name__ == "__main__":
    raise SystemExit(main())
