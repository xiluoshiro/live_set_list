from unittest.mock import MagicMock, patch

from psycopg2 import Error

from app.main import app
from fastapi.testclient import TestClient


def _build_connection_mock(fetchone_value):
    conn = MagicMock()
    cursor = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = fetchone_value
    return conn, cursor


def test_db_healthcheck_success_returns_1():
    conn, cursor = _build_connection_mock((1,))

    with patch("app.routers.health.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/health/db")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "result": 1}
    cursor.execute.assert_called_once_with("select 1;")


def test_db_healthcheck_returns_none_when_no_row():
    conn, _ = _build_connection_mock(None)

    with patch("app.routers.health.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/health/db")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "result": None}


def test_db_healthcheck_db_error_returns_500():
    # 测试点：数据库异常时既返回 500，也会写一条服务端异常日志。
    with patch("app.routers.health.logger.exception") as logger_exception, patch(
        "app.routers.health.get_db_connection", side_effect=Error("db down")
    ):
        client = TestClient(app)
        response = client.get("/api/health/db")

    assert response.status_code == 500
    assert "Database error" in response.json()["detail"]
    logger_exception.assert_called_once()
    assert logger_exception.call_args.args[0].startswith("db healthcheck failed")
    assert logger_exception.call_args.args[1] == "Error"


def test_db_healthcheck_uses_connection_and_cursor_context():
    conn, _ = _build_connection_mock((1,))

    with patch("app.routers.health.get_db_connection", return_value=conn):
        client = TestClient(app)
        response = client.get("/api/health/db")

    assert response.status_code == 200
    conn.__enter__.assert_called_once()
    conn.cursor.assert_called_once()
    conn.cursor.return_value.__enter__.assert_called_once()
