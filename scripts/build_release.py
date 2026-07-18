import argparse
import os
import subprocess
import tarfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / "dist-release"
FRONTEND_DIR = ROOT / "frontend"

RELEASE_DIRS = [
    "backend/app",
    "backend/db/flyway",
    "backend/db/postgres/checks",
    "backend/db/postgres/init",
    "config",
    "frontend/dist",
    "infra/production",
    "recovery",
]

RELEASE_FILES = [
    "backend/requirements.txt",
    "scripts/recovery_db.py",
    "README.md",
]

EXCLUDED_PARTS = {
    ".agents",
    ".codex",
    ".git",
    ".mypy_cache",
    ".mypy_cache_run_checks",
    ".opencode",
    ".pytest_cache",
    ".runtime",
    ".venv",
    "__pycache__",
    "dist-release",
    "logs",
    "node_modules",
    "old",
}

SENSITIVE_FILE_NAMES = {
    "flyway.toml",
}


def _is_runtime_env_file(path: Path) -> bool:
    name = path.name.lower()
    if name.endswith(".example"):
        return False
    return (
        name == ".env"
        or name.startswith(".env.")
        or name.endswith(".env")
        or ".env." in name
        or name.startswith("env.")
    )


def _has_excluded_part(path: Path) -> bool:
    if len(path.parts) >= 2 and path.parts[0] == "recovery" and path.parts[1] == "tests":
        return True
    if path.name.lower() in SENSITIVE_FILE_NAMES or _is_runtime_env_file(path):
        return True
    return any(part in EXCLUDED_PARTS for part in path.parts)


def iter_release_paths() -> list[Path]:
    paths: list[Path] = []
    for directory_name in RELEASE_DIRS:
        directory = ROOT / directory_name
        if not directory.exists():
            raise SystemExit(f"release source directory does not exist: {directory_name}")
        paths.extend(path for path in directory.rglob("*") if path.is_file())
    for file_name in RELEASE_FILES:
        file_path = ROOT / file_name
        if not file_path.exists():
            raise SystemExit(f"release source file does not exist: {file_name}")
        paths.append(file_path)
    return sorted({path for path in paths if not _has_excluded_part(path.relative_to(ROOT))})


def build_frontend() -> None:
    npm_command = "npm.cmd" if os.name == "nt" else "npm"
    try:
        subprocess.run([npm_command, "run", "build"], cwd=FRONTEND_DIR, check=True)
    except FileNotFoundError as exc:
        raise SystemExit(f"npm command not found: {npm_command}") from exc
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"frontend production build failed, exit code: {exc.returncode}") from exc


def build_release_archive(version: str, output_dir: Path = DEFAULT_OUTPUT_DIR) -> Path:
    build_frontend()
    output_dir.mkdir(parents=True, exist_ok=True)
    archive_path = output_dir / f"livesetlist-{version}.tar.gz"
    with tarfile.open(archive_path, "w:gz") as archive:
        for path in iter_release_paths():
            archive.add(path, arcname=Path(f"livesetlist-{version}") / path.relative_to(ROOT))
    return archive_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a production release archive from a strict whitelist.")
    parser.add_argument("--version", required=True, help="Release version label, for example 2026-07-10-001.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory that receives the .tar.gz.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    archive_path = build_release_archive(args.version, Path(args.output_dir))
    print(f"release archive created: {archive_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
