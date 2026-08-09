import pytest

from tests import integration_lock


class FakeCursor:
    def __init__(self, connection: "FakeConnection") -> None:
        self.connection = connection

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, query: str, params: tuple[int, int]) -> None:
        self.connection.executed.append((query, params))

    def fetchone(self) -> tuple[bool]:
        return (self.connection.results.pop(0),)


class FakeConnection:
    def __init__(self, results: list[bool]) -> None:
        self.results = results
        self.executed: list[tuple[str, tuple[int, int]]] = []

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)


# 测试点：测试库锁被占用时应等待并只提示一次，释放后继续当前检查。
def test_acquire_integration_db_lock_waits_until_available(monkeypatch: pytest.MonkeyPatch) -> None:
    connection = FakeConnection([False, True])
    waits: list[str] = []
    sleeps: list[float] = []
    monkeypatch.setattr(integration_lock.time, "sleep", sleeps.append)

    integration_lock.acquire_integration_db_lock(
        connection,
        timeout_seconds=1,
        poll_seconds=0.05,
        on_wait=waits.append,
    )

    assert len(connection.executed) == 2
    assert waits == ["检测到另一轮 integration/seed 正在使用测试库，等待独占锁释放……"]
    assert sleeps == [0.05]


# 测试点：测试库锁长期未释放时应明确失败，避免第二轮检查无限挂起。
def test_acquire_integration_db_lock_times_out() -> None:
    connection = FakeConnection([False])

    with pytest.raises(TimeoutError, match="可能仍有另一轮 pytest/run_checks 在运行"):
        integration_lock.acquire_integration_db_lock(connection, timeout_seconds=0)


# 测试点：集成测试结束时应主动释放同一把 advisory lock。
def test_release_integration_db_lock_uses_shared_key() -> None:
    connection = FakeConnection([True])

    assert integration_lock.release_integration_db_lock(connection) is True
    assert connection.executed[0][1] == integration_lock.INTEGRATION_DB_ADVISORY_LOCK_KEY
