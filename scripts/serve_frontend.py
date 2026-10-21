"""Serve the built frontend for the Cloudflare tunnel.

Serves ``frontend/dist`` with SPA fallback, asset caching headers, and an ``/api``
reverse proxy to the local FastAPI process. This is the Windows-local equivalent of
the Nginx rules in ``infra/production/nginx.livesetlist.conf.template``.
"""

from __future__ import annotations

import argparse
import http.client
import http.server
import mimetypes
import posixpath
import socket
import sys
import urllib.parse
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
ROOT = SCRIPTS_DIR.parent
DEFAULT_DIST = ROOT / "frontend" / "dist"
DEFAULT_API_TARGET = "http://127.0.0.1:8000"

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
}

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}

CONTENT_TYPE_OVERRIDES = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
}


class FrontendServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        address: tuple[str, int],
        *,
        dist_dir: Path,
        api_target: str,
        address_family: int = socket.AF_INET,
    ) -> None:
        self.address_family = address_family
        self.dist_dir = dist_dir.resolve()
        self.api_target = api_target
        super().__init__(address, FrontendRequestHandler)


class FrontendRequestHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LiveSetListFrontend/1.0"

    server: FrontendServer

    def do_GET(self) -> None:
        self._serve(send_body=True)

    def do_HEAD(self) -> None:
        self._serve(send_body=False)

    def do_POST(self) -> None:
        self._proxy()

    def do_PUT(self) -> None:
        self._proxy()

    def do_PATCH(self) -> None:
        self._proxy()

    def do_DELETE(self) -> None:
        self._proxy()

    def do_OPTIONS(self) -> None:
        self._proxy()

    def _serve(self, *, send_body: bool) -> None:
        if self.path.startswith("/api/"):
            self._proxy()
            return
        request_path = urllib.parse.urlsplit(self.path).path
        resolved = self._resolve(request_path)
        if resolved is None:
            self._send_status(404, send_body=send_body)
            return
        try:
            payload = resolved.read_bytes()
        except OSError:
            self._send_status(404, send_body=send_body)
            return
        self.send_response(200)
        self.send_header("Content-Type", self._content_type(resolved))
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", self._cache_control(request_path))
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)
        self.end_headers()
        if send_body:
            self.wfile.write(payload)

    def _resolve(self, request_path: str) -> Path | None:
        root = self.server.dist_dir
        relative = posixpath.normpath(request_path).lstrip("/")
        candidate = (root / relative).resolve() if relative else root
        if candidate != root and root not in candidate.parents:
            return None
        if candidate.is_dir():
            candidate = candidate / "index.html"
        if candidate.is_file():
            return candidate
        # SPA fallback: extensionless paths are client-side routes.
        if "." not in posixpath.basename(request_path):
            index = root / "index.html"
            return index if index.is_file() else None
        return None

    def _proxy(self) -> None:
        target = urllib.parse.urlsplit(self.server.api_target)
        host = target.hostname or "127.0.0.1"
        port = target.port or 80
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length > 0 else None
        forwarded: dict[str, str] = {
            name: value
            for name, value in self.headers.items()
            if name.lower() not in HOP_BY_HOP_HEADERS
            and name.lower() not in {"host", "accept-encoding", "content-length"}
        }
        forwarded["Host"] = target.netloc
        if body is not None:
            forwarded["Content-Length"] = str(len(body))
        connection = http.client.HTTPConnection(host, port, timeout=30)
        try:
            connection.request(self.command, self.path, body=body, headers=forwarded)
            response = connection.getresponse()
            payload = response.read()
        except OSError:
            self._send_status(502, send_body=True)
            return
        finally:
            connection.close()
        self.send_response(response.status)
        for name, value in response.getheaders():
            if name.lower() in HOP_BY_HOP_HEADERS or name.lower() in {"content-length", "content-encoding"}:
                continue
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(payload)))
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def _send_status(self, code: int, *, send_body: bool) -> None:
        reason = http.server.BaseHTTPRequestHandler.responses[code][0]
        payload = f"{code} {reason}\n".encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if send_body:
            self.wfile.write(payload)

    def _content_type(self, path: Path) -> str:
        override = CONTENT_TYPE_OVERRIDES.get(path.suffix.lower())
        if override is not None:
            return override
        guessed, _ = mimetypes.guess_type(path.name)
        return guessed or "application/octet-stream"

    def _cache_control(self, request_path: str) -> str:
        if request_path.startswith("/assets/"):
            return "public, max-age=31536000, immutable"
        if request_path.startswith("/icons/"):
            return "public, max-age=86400"
        return "no-cache"

    def log_message(self, format: str, *args: object) -> None:
        # pythonw.exe runs without console streams: sys.stderr is None there.
        stream = sys.stderr
        if stream is None:
            return
        try:
            stream.write(f"[frontend] {self.address_string()} {format % args}\n")
        except (OSError, ValueError):
            return


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="托管 frontend/dist 并转发 /api。")
    parser.add_argument("--host", default="::1", help="监听地址，默认 ::1。")
    parser.add_argument("--port", type=int, default=5173, help="监听端口，默认 5173。")
    parser.add_argument("--dist", default=str(DEFAULT_DIST), help="构建产物目录。")
    parser.add_argument("--api-target", default=DEFAULT_API_TARGET, help="FastAPI 地址。")
    return parser.parse_args(argv)


def build_server(argv: list[str] | None = None) -> FrontendServer:
    args = parse_args(argv)
    dist_dir = Path(args.dist)
    if not (dist_dir / "index.html").is_file():
        raise SystemExit(f"未找到构建产物：{dist_dir / 'index.html'}，请先在 frontend 执行 npm run build。")
    family = socket.AF_INET6 if ":" in args.host else socket.AF_INET
    return FrontendServer(
        (args.host, args.port),
        dist_dir=dist_dir,
        api_target=args.api_target,
        address_family=family,
    )


def main(argv: list[str] | None = None) -> int:
    server = build_server(argv)
    family = "ipv6" if server.address_family == socket.AF_INET6 else "ipv4"
    print(f"[frontend] serving {server.dist_dir} at {family} port {server.server_address[1]} -> {server.api_target}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[frontend] 已停止。")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
