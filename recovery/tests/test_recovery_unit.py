from __future__ import annotations

from argparse import Namespace
from datetime import datetime
from pathlib import Path

from recovery import backup, core


def _touch_dump(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"dump")


def test_build_backup_path_routes_snapshot_to_dedicated_directory(tmp_path, monkeypatch) -> None:
    # 测试点：恢复流程临时快照应落到独立目录，不能混入自动/手动备份。
    auto_dir = tmp_path / "auto"
    manual_dir = tmp_path / "manual"
    snapshot_dir = tmp_path / "snapshot"
    monkeypatch.setattr(backup, "AUTO_BACKUP_DIR", auto_dir)
    monkeypatch.setattr(backup, "MANUAL_BACKUP_DIR", manual_dir)
    monkeypatch.setattr(backup, "RECOVERY_SNAPSHOT_DIR", snapshot_dir)

    backup_path = backup.build_backup_path("snapshot")

    assert backup_path.parent == snapshot_dir
    assert backup_path.name.startswith("live_statistic_snapshot_")


def test_list_backup_files_sorts_by_embedded_timestamp_not_lexicographic(tmp_path, monkeypatch) -> None:
    # 测试点：最近备份选择应按文件名中的时间戳排序，而不是简单按名字典序。
    auto_dir = tmp_path / "auto"
    manual_dir = tmp_path / "manual"
    snapshot_dir = tmp_path / "snapshot"
    monkeypatch.setattr(backup, "AUTO_BACKUP_DIR", auto_dir)
    monkeypatch.setattr(backup, "MANUAL_BACKUP_DIR", manual_dir)
    monkeypatch.setattr(backup, "RECOVERY_SNAPSHOT_DIR", snapshot_dir)

    older = manual_dir / "live_statistic_manual_20260406_090000.dump"
    newer = auto_dir / "live_statistic_auto_20260406_220000.dump"
    invalid = auto_dir / "live_statistic_manual_latest.dump"
    _touch_dump(older)
    _touch_dump(newer)
    _touch_dump(invalid)

    backups = backup.list_backup_files()

    assert backups[0] == newer
    assert backups[1] == older
    assert backups[-1] == invalid


def test_prune_old_backups_keeps_auto_and_manual_separately(tmp_path, monkeypatch) -> None:
    # 测试点：自动备份和手动备份的保留策略应分别生效，且不影响临时快照目录。
    auto_dir = tmp_path / "auto"
    manual_dir = tmp_path / "manual"
    snapshot_dir = tmp_path / "snapshot"
    monkeypatch.setattr(backup, "AUTO_BACKUP_DIR", auto_dir)
    monkeypatch.setattr(backup, "MANUAL_BACKUP_DIR", manual_dir)
    monkeypatch.setattr(backup, "RECOVERY_SNAPSHOT_DIR", snapshot_dir)
    monkeypatch.setattr(backup, "AUTO_BACKUP_KEEP", 5)
    monkeypatch.setattr(backup, "MANUAL_BACKUP_KEEP", 3)

    for idx in range(7):
        _touch_dump(auto_dir / f"live_statistic_auto_20260406_0{idx}0000.dump")
    for idx in range(5):
        _touch_dump(manual_dir / f"live_statistic_manual_20260406_1{idx}0000.dump")
    _touch_dump(snapshot_dir / "live_statistic_snapshot_20260406_235959.dump")

    backup.prune_old_backups("auto")
    backup.prune_old_backups("manual")

    assert len(list(auto_dir.glob("*.dump"))) == 5
    assert len(list(manual_dir.glob("*.dump"))) == 3
    assert len(list(snapshot_dir.glob("*.dump"))) == 1


def test_get_backup_timestamp_returns_min_for_invalid_name(tmp_path) -> None:
    # 测试点：异常命名的备份文件不应干扰正常备份排序。
    invalid_path = tmp_path / "invalid.dump"

    assert backup.get_backup_timestamp(invalid_path) == datetime.min


def test_main_requires_force_for_destructive_targets(tmp_path, monkeypatch, capsys) -> None:
    # 测试点：破坏性恢复入口未带 --force 时，只提示退出，不真正执行。
    env_file = tmp_path / ".env.pg-migrate"
    compose_file = tmp_path / "docker-compose.yml"
    flyway_config = tmp_path / "flyway.toml"
    seed_file = tmp_path / "seed.sql"
    for path in (env_file, compose_file, flyway_config, seed_file):
        path.write_text("placeholder", encoding="utf-8")

    monkeypatch.setattr(core, "ENV_FILE", env_file)
    monkeypatch.setattr(core, "COMPOSE_FILE", compose_file)
    monkeypatch.setattr(core, "FLYWAY_CONFIG", flyway_config)
    monkeypatch.setattr(core, "SEED_SQL", seed_file)
    monkeypatch.setattr(core, "parse_args", lambda: Namespace(target="recovery", force=False))
    monkeypatch.setattr(core, "load_env_file", lambda _path: {"POSTGRES_CONTAINER_NAME": "live-set-list-docker"})

    exit_code = core.main()

    captured = capsys.readouterr()
    assert exit_code == 1
    assert "--force" in captured.out


def test_main_allows_backup_without_force(tmp_path, monkeypatch) -> None:
    # 测试点：普通备份入口不依赖 --force，应可直接执行。
    env_file = tmp_path / ".env.pg-migrate"
    compose_file = tmp_path / "docker-compose.yml"
    flyway_config = tmp_path / "flyway.toml"
    seed_file = tmp_path / "seed.sql"
    for path in (env_file, compose_file, flyway_config, seed_file):
        path.write_text("placeholder", encoding="utf-8")

    monkeypatch.setattr(core, "ENV_FILE", env_file)
    monkeypatch.setattr(core, "COMPOSE_FILE", compose_file)
    monkeypatch.setattr(core, "FLYWAY_CONFIG", flyway_config)
    monkeypatch.setattr(core, "SEED_SQL", seed_file)
    monkeypatch.setattr(core, "parse_args", lambda: Namespace(target="backup-app-manual", force=False))
    monkeypatch.setattr(core, "load_env_file", lambda _path: {"POSTGRES_CONTAINER_NAME": "live-set-list-docker"})

    calls: list[tuple[str, str]] = []

    def fake_create_app_backup(env_values: dict[str, str], docker_cmd: str, *, kind: str, container_name: str | None = None) -> Path:
        calls.append((docker_cmd, kind))
        return Path("backup.dump")

    monkeypatch.setattr(core, "create_app_backup", fake_create_app_backup)

    exit_code = core.main()

    assert exit_code == 0
    assert calls == [("docker", "manual")]


def test_main_test_target_stays_in_place_and_never_touches_candidate_recovery(tmp_path, monkeypatch) -> None:
    # 测试点：test 目标只应重建测试库，不能进入主库候选恢复链路。
    env_file = tmp_path / ".env.pg-migrate"
    compose_file = tmp_path / "docker-compose.yml"
    flyway_config = tmp_path / "flyway.toml"
    seed_file = tmp_path / "seed.sql"
    for path in (env_file, compose_file, flyway_config, seed_file):
        path.write_text("placeholder", encoding="utf-8")

    monkeypatch.setattr(core, "ENV_FILE", env_file)
    monkeypatch.setattr(core, "COMPOSE_FILE", compose_file)
    monkeypatch.setattr(core, "FLYWAY_CONFIG", flyway_config)
    monkeypatch.setattr(core, "SEED_SQL", seed_file)
    monkeypatch.setattr(core, "parse_args", lambda: Namespace(target="test", force=True))
    monkeypatch.setattr(core, "load_env_file", lambda _path: {"POSTGRES_CONTAINER_NAME": "live-set-list-docker"})

    calls: list[str] = []
    monkeypatch.setattr(core, "recover_test_database_in_place", lambda *_args: calls.append("recover-test") or 0)
    monkeypatch.setattr(core, "prepare_candidate_database", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("should not prepare candidate database")))
    monkeypatch.setattr(core, "recover_main_database", lambda *_args: (_ for _ in ()).throw(AssertionError("should not enter main recovery flow")))

    exit_code = core.main()

    assert exit_code == 0
    assert calls == ["recover-test"]
