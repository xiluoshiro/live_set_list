from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


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
