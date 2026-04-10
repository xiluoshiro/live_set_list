import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path


LOG_DIR = Path(__file__).resolve().parents[1] / "logs"
LOG_FILE = LOG_DIR / "app.log"
DEFAULT_LOG_LEVEL = "INFO"
_LOGGING_CONFIGURED = False


def setup_logging() -> None:
    global _LOGGING_CONFIGURED
    root_logger = logging.getLogger()
    if _LOGGING_CONFIGURED:
        return

    log_level_name = os.getenv("APP_LOG_LEVEL", DEFAULT_LOG_LEVEL).upper()
    log_level = getattr(logging, log_level_name, logging.INFO)
    formatter = logging.Formatter(
        fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # 启动时确保日志目录存在，避免首次写文件时失败。
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    root_logger.handlers.clear()
    root_logger.setLevel(log_level)
    root_logger.addHandler(console_handler)

    # 只读或受限环境下允许退回控制台日志，避免测试因文件句柄权限失败。
    try:
        file_handler = RotatingFileHandler(
            LOG_FILE,
            maxBytes=1_048_576,
            backupCount=3,
            encoding="utf-8",
        )
    except OSError:
        root_logger.warning("file logging disabled because %s is not writable", LOG_FILE)
    else:
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)

    _LOGGING_CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    setup_logging()
    return logging.getLogger(name)
