import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUN_PROD_PATH = ROOT / "scripts" / "run_prod.py"
run_prod_spec = importlib.util.spec_from_file_location("run_prod", RUN_PROD_PATH)
assert run_prod_spec is not None and run_prod_spec.loader is not None
run_prod = importlib.util.module_from_spec(run_prod_spec)
run_prod_spec.loader.exec_module(run_prod)


# 测试点：生产启动不使用 uvicorn --reload，避免线上服务被文件变更重启。
def test_backend_command_runs_without_reload():
    command = run_prod.build_backend_command()

    assert "--reload" not in command
    assert command[-4:] == ["--host", "127.0.0.1", "--port", "8000"]


# 测试点：前端进程指向构建产物静态服务，并带上隧道使用的监听地址。
def test_frontend_command_serves_dist_on_tunnel_port(tmp_path: Path):
    command = run_prod.build_frontend_command("::1", 5173, tmp_path)

    assert command[1].endswith("serve_frontend.py")
    assert command[command.index("--host") + 1] == "::1"
    assert command[command.index("--port") + 1] == "5173"
    assert command[command.index("--dist") + 1] == str(tmp_path)


# 测试点：登录后 Docker 尚未就绪时，启动流程会等待重试而不是直接失败。
def test_wait_for_postgres_retries_until_ready(monkeypatch):
    results = iter([False, False, True])
    calls = []
    monkeypatch.setattr(
        run_prod.run_dev,
        "ensure_postgres_container_running",
        lambda: calls.append(1) or next(results) is True,
    )
    monkeypatch.setattr(run_prod.time, "sleep", lambda _seconds: None)

    assert run_prod.wait_for_postgres() is True
    assert len(calls) == 3


# 测试点：数据库始终不可用时按失败退出，不继续启动服务。
def test_wait_for_postgres_gives_up(monkeypatch):
    monkeypatch.setattr(run_prod.run_dev, "ensure_postgres_container_running", lambda: False)
    monkeypatch.setattr(run_prod.time, "sleep", lambda _seconds: None)

    assert run_prod.wait_for_postgres() is False


# 测试点：隧道端口已有旧服务时先清理再启动，实现与 run_dev 一致的热接管。
def test_cleanup_stale_frontend_processes_stops_listener(monkeypatch):
    listening = iter([{111}, set()])
    killed = []
    monkeypatch.setattr(run_prod.run_dev, "find_listening_pids", lambda _port: next(listening))
    monkeypatch.setattr(run_prod.run_dev, "kill_process_tree", lambda pid, force: killed.append((pid, force)))
    monkeypatch.setattr(run_prod.time, "sleep", lambda _seconds: None)

    assert run_prod.cleanup_stale_frontend_processes(5173) is True
    assert killed == [(111, True)]


# 测试点：旧服务无法停止时启动失败，避免两个实例争用隧道端口。
def test_cleanup_stale_frontend_processes_fails_when_port_stays_busy(monkeypatch, capsys):
    monkeypatch.setattr(run_prod.run_dev, "find_listening_pids", lambda _port: {111})
    monkeypatch.setattr(run_prod.run_dev, "kill_process_tree", lambda _pid, force: None)
    monkeypatch.setattr(run_prod.time, "sleep", lambda _seconds: None)

    assert run_prod.cleanup_stale_frontend_processes(5173) is False
    assert "仍被占用" in capsys.readouterr().out


# 测试点：端口清理失败时直接退出，不启动新的后端与前端。
def test_main_stops_when_frontend_cleanup_fails(monkeypatch, tmp_path, capsys):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("app", encoding="utf-8")

    def unexpected(*_args, **_kwargs):
        raise AssertionError("端口无法清理时不应启动进程")

    monkeypatch.setattr(run_prod, "cleanup_stale_frontend_processes", lambda _port: False)
    monkeypatch.setattr(run_prod, "wait_for_postgres", unexpected)
    monkeypatch.setattr(run_prod.subprocess, "Popen", unexpected)

    assert run_prod.main(["--dist", str(dist)]) == 1


# 测试点：缺少构建产物时直接失败，不检查容器也不启动任何进程。
def test_missing_dist_fails_before_launch(monkeypatch, tmp_path, capsys):
    def unexpected(*_args, **_kwargs):
        raise AssertionError("缺少构建产物时不应检查容器或启动进程")

    monkeypatch.setattr(run_prod.run_dev, "ensure_postgres_container_running", unexpected)
    monkeypatch.setattr(run_prod.subprocess, "Popen", unexpected)

    assert run_prod.main(["--dist", str(tmp_path)]) == 1
    assert "未找到构建产物" in capsys.readouterr().out
