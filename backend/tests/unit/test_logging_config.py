import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path
from unittest.mock import MagicMock, patch

import app.logging_config as logging_config


def test_setup_logging_is_idempotent():
    # 测试点：重复调用 setup_logging 不应重复挂载 handler。
    root_logger = MagicMock()
    root_logger.handlers = []
    console_handler = MagicMock()
    file_handler = MagicMock()
    fake_log_file = MagicMock()

    with patch("app.logging_config._LOGGING_CONFIGURED", False), patch(
        "app.logging_config.log_file_path", return_value=fake_log_file
    ), patch(
        "app.logging_config.logging.getLogger", return_value=root_logger
    ), patch(
        "app.logging_config.logging.StreamHandler", return_value=console_handler
    ) as stream_handler_ctor, patch(
        "app.logging_config.RotatingFileHandler", return_value=file_handler
    ) as file_handler_ctor:
        logging_config.setup_logging()
        logging_config.setup_logging()

    assert stream_handler_ctor.call_count == 1
    assert file_handler_ctor.call_count == 1
    assert root_logger.addHandler.call_count == 2
    fake_log_file.parent.mkdir.assert_called_once_with(parents=True, exist_ok=True)


def test_setup_logging_app_log_level_valid_and_invalid():
    # 测试点：APP_LOG_LEVEL 合法值生效，非法值回退 INFO。
    cases = [
        ("ERROR", logging.ERROR),
        ("NOT_A_LEVEL", logging.INFO),
    ]

    for level_name, expected_level in cases:
        root_logger = MagicMock()
        root_logger.handlers = []
        console_handler = MagicMock()
        file_handler = MagicMock()
        fake_log_file = MagicMock()

        with patch.dict(os.environ, {"APP_LOG_LEVEL": level_name}, clear=False), patch(
            "app.logging_config._LOGGING_CONFIGURED", False
        ), patch("app.logging_config.log_file_path", return_value=fake_log_file), patch(
            "app.logging_config.logging.getLogger", return_value=root_logger
        ), patch(
            "app.logging_config.logging.StreamHandler", return_value=console_handler
        ), patch(
            "app.logging_config.RotatingFileHandler", return_value=file_handler
        ):
            logging_config.setup_logging()

        root_logger.setLevel.assert_called_once_with(expected_level)


# 测试点：文件日志保留中文内容，达到容量上限时自动归档并继续写入当前文件。
def test_setup_logging_writes_unicode_and_rotates_files(tmp_path, monkeypatch):
    root_logger = logging.Logger("rotation-test")
    log_file = tmp_path / "logs" / "app.log"
    monkeypatch.setenv("APP_LOG_LEVEL", "INFO")
    monkeypatch.setattr(logging_config, "_LOGGING_CONFIGURED", False)
    monkeypatch.setattr(logging_config, "log_file_path", lambda: log_file)
    monkeypatch.setattr(logging_config.logging, "getLogger", lambda: root_logger)

    try:
        logging_config.setup_logging()
        file_handler = next(
            handler for handler in root_logger.handlers
            if isinstance(handler, RotatingFileHandler)
        )
        assert file_handler.maxBytes > 0
        assert file_handler.backupCount > 0
        root_logger.info("归档前的场馆日志")
        assert "归档前的场馆日志" in log_file.read_text(encoding="utf-8")

        # 控制触发边界，避免测试生成生产容量的日志文件。
        file_handler.maxBytes = log_file.stat().st_size + 1
        root_logger.info("归档后的新日志")

        current = log_file.read_text(encoding="utf-8")
        assert "归档后的新日志" in current
        assert "归档前的场馆日志" not in current
        archives = list(log_file.parent.glob("app.log.*"))
        assert len(archives) == 1
        assert "归档前的场馆日志" in archives[0].read_text(encoding="utf-8")
    finally:
        for handler in root_logger.handlers:
            handler.close()


def test_log_file_path_uses_app_log_file_env(tmp_path, monkeypatch):
    # 测试点：生产环境应能把后端日志写到发布目录外的固定日志路径。
    log_file = tmp_path / "production" / "app.log"
    monkeypatch.setenv("APP_LOG_FILE", str(log_file))

    assert logging_config.log_file_path() == Path(log_file)
