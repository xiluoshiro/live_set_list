import asyncio
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.main import app, create_app, log_api_requests


def test_request_logging_middleware_logs_completed_request():
    # 测试点：每次 API 请求完成后都会记录一条 access log，便于排查链路。
    with patch("app.main.logger.info") as logger_info:
        client = TestClient(app)
        response = client.get("/?source=test")

    assert response.status_code == 200
    logger_info.assert_called_once()
    assert logger_info.call_args.args[0].startswith("request completed")
    assert logger_info.call_args.args[1] == "GET"
    assert logger_info.call_args.args[2] == "/"
    assert logger_info.call_args.args[3] == "source=test"
    assert logger_info.call_args.args[4] == 200
    assert isinstance(logger_info.call_args.args[5], float)
    assert logger_info.call_args.args[6] != "-"


def test_request_logging_middleware_logs_failed_request_and_reraises():
    # 测试点：call_next 抛异常时应记录 request failed 日志，并继续抛出异常。
    request = Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "path": "/_boom",
            "raw_path": b"/_boom",
            "query_string": b"source=test",
            "headers": [],
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
            "scheme": "http",
        }
    )

    async def call_next(_request):
        raise RuntimeError("boom")

    with patch("app.main.logger.exception") as logger_exception:
        with pytest.raises(RuntimeError, match="boom"):
            asyncio.run(log_api_requests(request, call_next))

    logger_exception.assert_called_once()
    assert logger_exception.call_args.args[0].startswith("request failed")
    assert logger_exception.call_args.args[1] == "GET"
    assert logger_exception.call_args.args[2] == "/_boom"
    assert logger_exception.call_args.args[3] == "source=test"
    assert isinstance(logger_exception.call_args.args[4], float)
    assert logger_exception.call_args.args[5] == "127.0.0.1"


def test_create_app_uses_cors_allow_origins_from_env():
    # 测试点：生产域名 allowlist 应由环境变量驱动，避免继续写死本地开发端口。
    with patch.dict(
        "os.environ",
        {
            "CORS_ALLOW_ORIGINS": "https://example.com, https://admin.example.com",
            "APP_ENV": "development",
        },
        clear=False,
    ):
        client = TestClient(create_app())
        response = client.options(
            "/api/health/db",
            headers={
                "Origin": "https://example.com",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.headers["access-control-allow-origin"] == "https://example.com"


def test_create_app_disables_openapi_docs_in_production():
    # 测试点：生产环境不应默认暴露 Swagger、ReDoc 或 OpenAPI JSON。
    with patch.dict(
        "os.environ",
        {"APP_ENV": "production", "AUTH_COOKIE_SECURE": "true"},
        clear=False,
    ):
        client = TestClient(create_app())

    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_create_app_requires_secure_cookie_in_production():
    # 测试点：生产环境必须启用 Secure cookie，避免公网 session 走明文连接。
    with patch.dict(
        "os.environ",
        {"APP_ENV": "production", "AUTH_COOKIE_SECURE": "false"},
        clear=False,
    ):
        with pytest.raises(RuntimeError, match="AUTH_COOKIE_SECURE=true"):
            create_app()
