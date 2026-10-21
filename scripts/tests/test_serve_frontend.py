import http.client
import http.server
import importlib.util
import json
import threading
from pathlib import Path
from typing import Any, Iterator

import pytest

ROOT = Path(__file__).resolve().parents[2]
SERVE_FRONTEND_PATH = ROOT / "scripts" / "serve_frontend.py"
serve_frontend_spec = importlib.util.spec_from_file_location("serve_frontend", SERVE_FRONTEND_PATH)
assert serve_frontend_spec is not None and serve_frontend_spec.loader is not None
serve_frontend = importlib.util.module_from_spec(serve_frontend_spec)
serve_frontend_spec.loader.exec_module(serve_frontend)


class EchoApiHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        payload = json.dumps({"path": self.path, "method": self.command}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:
        return


def build_dist(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "icons").mkdir()
    (dist / "index.html").write_text("<html>app</html>", encoding="utf-8")
    (dist / "assets" / "app-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (dist / "icons" / "band.svg").write_text("<svg/>", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("outside dist", encoding="utf-8")
    return dist


def request(server: Any, path: str, method: str = "GET") -> tuple[int, dict[str, str], bytes]:
    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=10)
    connection.request(method, path)
    response = connection.getresponse()
    body = response.read()
    headers = {name.lower(): value for name, value in response.getheaders()}
    connection.close()
    return response.status, headers, body


@pytest.fixture()
def frontend(tmp_path: Path) -> Iterator[tuple[Any, Path]]:
    dist = build_dist(tmp_path)
    api_server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), EchoApiHandler)
    api_thread = threading.Thread(target=api_server.serve_forever, daemon=True)
    api_thread.start()
    server = serve_frontend.FrontendServer(
        ("127.0.0.1", 0),
        dist_dir=dist,
        api_target=f"http://127.0.0.1:{api_server.server_address[1]}",
    )
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    try:
        yield server, dist
    finally:
        server.shutdown()
        server.server_close()
        api_server.shutdown()
        api_server.server_close()


# 测试点：无扩展名的前端路由回退到 index.html，且 HTML 不被长期缓存。
def test_spa_route_falls_back_to_index(frontend: tuple[Any, Path]) -> None:
    server, _ = frontend

    status, headers, body = request(server, "/tours/2026/summer")

    assert status == 200
    assert body == b"<html>app</html>"
    assert headers["content-type"].startswith("text/html")
    assert headers["cache-control"] == "no-cache"


# 测试点：带哈希的 /assets 资源可长期缓存，避免每次访问都回源验证。
def test_hashed_assets_are_immutable(frontend: tuple[Any, Path]) -> None:
    server, _ = frontend

    status, headers, body = request(server, "/assets/app-abc123.js")

    assert status == 200
    assert body == b"console.log(1)"
    assert headers["content-type"] == "text/javascript; charset=utf-8"
    assert headers["cache-control"] == "public, max-age=31536000, immutable"


# 测试点：越出构建目录的请求不会读到 dist 之外的文件。
def test_path_traversal_outside_dist_is_rejected(frontend: tuple[Any, Path]) -> None:
    server, _ = frontend

    status, _, body = request(server, "/../secret.txt")

    assert status == 404
    assert b"outside dist" not in body


# 测试点：缺失的静态文件返回 404，不会被 SPA 回退成首页。
def test_missing_asset_returns_404(frontend: tuple[Any, Path]) -> None:
    server, _ = frontend

    status, _, _ = request(server, "/assets/missing.js")

    assert status == 404


# 测试点：/api 请求连同查询串转发到 FastAPI，并把响应原样返回。
def test_api_requests_are_proxied(frontend: tuple[Any, Path]) -> None:
    server, _ = frontend

    status, headers, body = request(server, "/api/catalog/tours?page=2")

    assert status == 200
    assert headers["content-type"] == "application/json"
    assert json.loads(body.decode("utf-8")) == {"path": "/api/catalog/tours?page=2", "method": "GET"}


# 测试点：HEAD 返回与 GET 一致的内容长度，但不发送正文。
def test_head_returns_headers_without_body(frontend: tuple[Any, Path]) -> None:
    server, _ = frontend

    status, headers, body = request(server, "/assets/app-abc123.js", method="HEAD")

    assert status == 200
    assert headers["content-length"] == str(len(b"console.log(1)"))
    assert body == b""


# 测试点：没有控制台流（pythonw）时，访问日志不会让请求失败。
def test_request_survives_missing_stderr(frontend: tuple[Any, Path], monkeypatch: pytest.MonkeyPatch) -> None:
    server, _ = frontend
    monkeypatch.setattr(serve_frontend.sys, "stderr", None)

    status, _, body = request(server, "/assets/app-abc123.js")

    assert status == 200
    assert body == b"console.log(1)"
