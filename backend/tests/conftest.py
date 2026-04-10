import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("APP_LOG_LEVEL", "CRITICAL")

from app.main import app


@pytest.fixture
def test_client():
    return TestClient(app)
