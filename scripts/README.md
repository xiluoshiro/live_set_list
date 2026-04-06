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
- `backend-unit`：运行后端单元测试集
- `backend-integration`：运行后端 `mypy(app + tests) + pytest tests/integration`
- `backend`：相当于运行 `backend-unit + backend-integration`
- `recovery`：运行恢复脚本的 mock/命令契约测试
- `functional`：运行功能测试集，只包含 `frontend + backend`
- `full`：运行全部检查，等于 `frontend + backend + recovery`

## 数据库恢复

在项目根目录执行：

```powershell
python scripts/recovery_db.py <arguments> [--force]
```

当前支持：

- `test`：在当前正式容器内重建测试库结构并重新导入 seed
- `backup-app-auto`：立即生成一份主库自动备份，保留最近 5 份
- `backup-app-manual`：立即生成一份主库手动备份，保留最近 3 份
- `recovery`：从最近一份主库备份恢复业务库，恢复前会先生成一份恢复流程专用临时快照，再走候选容器验证与回滚

`--force` 的作用：

- 对 `test` 和 `recovery` 这类会修改数据库状态的操作做显式确认
- 不带 `--force` 时，脚本只会提示并退出，不会真正执行恢复动作

完整流程与测试说明见：

- [recovery/README.md](D:/Code/PythonCode/5%20LiveSetList/recovery/README.md)
