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
python scripts/recovery_db.py test --force
```

当前支持：

- `test`：恢复测试库，当前已实现
- `app`：预留给业务库恢复，当前尚未实现
- `all`：预留给“恢复所有内容”，当前尚未实现
