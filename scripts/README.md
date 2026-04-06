# Script Notes

本目录存放项目根级别的辅助脚本。

## 一键启动

在项目根目录执行：

```powershell
python scripts/run_dev.py
```

或：

```powershell
.\start-dev.bat
```

启动前会检查 PostgreSQL Docker 容器；若容器存在但未运行则自动拉起，若容器不存在则直接报错退出。

按 `Ctrl+C` 可同时关闭前后端。

## 一键检查

在项目根目录执行：

```powershell
python scripts/run_checks.py <arguments>
```

- `frontend`：只运行前端 `typecheck + test`
- `backend-unit`：运行后端 `mypy(app + tests) + pytest tests/unit`
- `backend-integration`：运行后端 `mypy(app + tests) + pytest tests/integration`
- `backend`：运行后端 `mypy(app + tests) + pytest tests/unit + pytest tests/integration`
- `all`：先运行后端完整检查，再运行前端 `typecheck + test`

## 数据库恢复

在项目根目录执行：

```powershell
python scripts/recovery_db.py <arguments> [--force]
```

当前支持：

- `test`：在当前正式容器内重建测试库结构并重新导入 seed
- `backup-app-auto`：立即生成一份主库自动备份，保留最近 5 份
- `backup-app-manual`：立即生成一份主库手动备份，保留最近 3 份
- `recovery`：从最近一份主库备份恢复业务库，恢复前会先补一份手动备份，再走候选容器验证与回滚

`--force` 的作用：

- 对 `test` 和 `recovery` 这类会修改数据库状态的操作做显式确认
- 不带 `--force` 时，脚本只会提示并退出，不会真正执行恢复动作

主库备份目录当前固定为：

- `C:\Users\xiluo\OneDrive - stu.jiangnan.edu.cn\Backup\live-set-list-docker`

`recovery` 的最终流程是：

1. 选择最近一份主库备份
2. 恢复前先生成一份“恢复流程专用临时快照”，不混入手动备份目录
3. 在候选容器中恢复主库、重建测试库并运行 `python scripts/run_checks.py all`
4. 如果检查失败，自动回滚到旧容器，并删除这次恢复的临时快照
5. 如果检查通过，脚本会暂停，等待人工确认候选容器状态
6. 人工确认后再转正；如果此时取消，也会回滚到旧容器并删除临时快照
