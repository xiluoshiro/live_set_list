import logging
import os
from unittest.mock import MagicMock, patch

import app.logging_config as logging_config


def test_setup_logging_is_idempotent():
    # 测试点：重复调用 setup_logging 不应重复挂载 handler。
    root_logger = MagicMock()
    root_logger.handlers = []
    console_handler = MagicMock()
    file_handler = MagicMock()
    fake_log_dir = MagicMock()
    fake_log_file = MagicMock()

    with patch("app.logging_config._LOGGING_CONFIGURED", False), patch(
        "app.logging_config.LOG_DIR", fake_log_dir
    ), patch("app.logging_config.LOG_FILE", fake_log_file), patch(
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
    fake_log_dir.mkdir.assert_called_once_with(parents=True, exist_ok=True)


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
        fake_log_dir = MagicMock()

        with patch.dict(os.environ, {"APP_LOG_LEVEL": level_name}, clear=False), patch(
            "app.logging_config._LOGGING_CONFIGURED", False
        ), patch("app.logging_config.LOG_DIR", fake_log_dir), patch(
            "app.logging_config.logging.getLogger", return_value=root_logger
        ), patch(
            "app.logging_config.logging.StreamHandler", return_value=console_handler
        ), patch(
            "app.logging_config.RotatingFileHandler", return_value=file_handler
        ):
            logging_config.setup_logging()

        root_logger.setLevel.assert_called_once_with(expected_level)


def test_setup_logging_file_handler_rotation_config():
    # 测试点：RotatingFileHandler 的参数应为 1MB、3份、UTF-8。
    root_logger = MagicMock()
    root_logger.handlers = []
    console_handler = MagicMock()
    file_handler = MagicMock()
    fake_log_dir = MagicMock()
    fake_log_file = MagicMock()

    with patch("app.logging_config._LOGGING_CONFIGURED", False), patch(
        "app.logging_config.LOG_DIR", fake_log_dir
    ), patch("app.logging_config.LOG_FILE", fake_log_file), patch(
        "app.logging_config.logging.getLogger", return_value=root_logger
    ), patch(
        "app.logging_config.logging.StreamHandler", return_value=console_handler
    ), patch(
        "app.logging_config.RotatingFileHandler", return_value=file_handler
    ) as file_handler_ctor:
        logging_config.setup_logging()

    file_handler_ctor.assert_called_once_with(
        fake_log_file,
        maxBytes=1_048_576,
        backupCount=3,
        encoding="utf-8",
    )
