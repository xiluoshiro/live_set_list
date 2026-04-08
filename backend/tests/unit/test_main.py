import asyncio
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.main import app, log_api_requests


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
