import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
RUN_DEV_PATH = ROOT / "scripts" / "run_dev.py"
run_dev_spec = importlib.util.spec_from_file_location("run_dev", RUN_DEV_PATH)
assert run_dev_spec is not None and run_dev_spec.loader is not None
run_dev = importlib.util.module_from_spec(run_dev_spec)
run_dev_spec.loader.exec_module(run_dev)


# 测试点：Windows 只有 npm.exe 时，开发服务使用实际可执行路径启动前端。
def test_frontend_command_uses_discovered_npm_executable(monkeypatch, tmp_path):
    npm_executable = tmp_path / "npm.exe"
    npm_executable.write_bytes(b"")
    monkeypatch.setattr(run_dev.shutil, "which", lambda name: str(npm_executable) if name == "npm" else None)

    assert run_dev.build_frontend_command() == [str(npm_executable), "run", "dev"]


# 测试点：未找到 npm 时，不应启动后端并遗留孤儿进程。
def test_missing_npm_stops_before_backend_launch(monkeypatch, capsys):
    def unexpected(*_args, **_kwargs):
        raise AssertionError("npm 缺失时不应检查容器或启动后端")

    monkeypatch.setattr(run_dev, "build_frontend_command", lambda: None)
    monkeypatch.setattr(run_dev, "ensure_postgres_container_running", unexpected)
    monkeypatch.setattr(run_dev.subprocess, "Popen", unexpected)

    assert run_dev.main([]) == 1
    assert "未找到 npm 可执行文件" in capsys.readouterr().out


# 测试点：前端创建进程失败时，已启动的后端必须被关闭。
def test_frontend_launch_failure_terminates_backend(monkeypatch, capsys):
    backend_proc = object()
    launched = []
    terminated = []

    def fake_popen(*_args, **_kwargs):
        launched.append(True)
        if len(launched) == 2:
            raise FileNotFoundError("npm not found")
        return backend_proc

    monkeypatch.setattr(run_dev, "build_frontend_command", lambda: ["npm.exe", "run", "dev"])
    monkeypatch.setattr(run_dev, "ensure_postgres_container_running", lambda: True)
    monkeypatch.setattr(run_dev, "cleanup_stale_backend_processes", lambda: True)
    monkeypatch.setattr(run_dev.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(run_dev, "terminate_process", terminated.append)

    assert run_dev.main([]) == 1
    assert len(launched) == 2
    assert terminated == [backend_proc]
    assert "正在关闭已启动的后端" in capsys.readouterr().out
