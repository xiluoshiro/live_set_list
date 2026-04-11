import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
DOCS_DIR = ROOT / "docs"
OUTPUT_PATH = DOCS_DIR / "openapi.json"


def backend_python() -> Path:
    if os.name == "nt":
        return BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    return BACKEND_DIR / ".venv" / "bin" / "python"


def ensure_backend_python() -> int | None:
    python_path = backend_python()
    if not python_path.exists():
        return None
    if Path(sys.executable).resolve() == python_path.resolve():
        return None
    completed = subprocess.run([str(python_path), str(Path(__file__).resolve())], check=False)
    return completed.returncode


def ensure_backend_on_sys_path() -> None:
    backend_path = str(BACKEND_DIR)
    if backend_path not in sys.path:
        sys.path.insert(0, backend_path)


def main() -> int:
    delegated_code = ensure_backend_python()
    if delegated_code is not None:
        return delegated_code

    ensure_backend_on_sys_path()
    os.chdir(BACKEND_DIR)

    from app.main import app

    spec = app.openapi()
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"OpenAPI exported to: {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
