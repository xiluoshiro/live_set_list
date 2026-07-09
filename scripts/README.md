# Script Notes

本目录存放项目根级别的辅助脚本。

## 一键启动

在项目根目录执行：

```powershell
python scripts/run_dev.py
```

如果希望本次启动的后端连接测试库：

```powershell
python scripts/run_dev.py --test-db
```

`--test-db` 只会影响本次后端进程，不会修改 `.env` 文件，也不会改变前端请求地址。

- 默认启动：后端连接 `APP_DB`，当前通常是 `live_statistic`
- `--test-db`：后端连接 `TEST_DB_NAME`，默认值为 `live_statistic_test`
- 脚本会给后端进程显式注入 `DB_HOST`、`DB_PORT`、`POSTGRES_HOST`、`POSTGRES_PORT`、`DB_NAME`、`APP_DB` 和运行时 DB 用户别名，避免当前 shell 中残留的测试库环境变量污染本次启动

或：

```powershell
.\start-dev.bat
```

启动前会检查 PostgreSQL Docker 容器；若容器存在但未运行则自动拉起，若容器不存在则直接报错退出。启动后端前会清理 8000 端口上残留的旧后端进程，避免 uvicorn reload 子进程继续连接旧数据库。

如果 8000 端口上的旧后端无法清理，且端口仍不可绑定，脚本会停止启动，而不是继续拉起一个新后端。这可以避免“启动日志显示生产库，但浏览器实际命中旧测试库后端”的问题。

按 `Ctrl+C` 可同时关闭前后端，并清理本次启动的进程树。

## 一键检查

在项目根目录执行：

```powershell
python scripts/run_checks.py <arguments>
```

- `frontend`：只运行前端 `typecheck + test`
- `scripts`：只运行 `scripts/*.py` 语法检查，不写入 `__pycache__`
- `backend-unit`：运行后端单元测试集
- `backend-integration`：运行后端 `mypy(app + tests) + pytest tests/integration`
- `backend`：相当于运行 `backend-unit + backend-integration`
- `recovery-unit`：运行恢复脚本的 mock/命令契约测试
- `recovery-integration`：运行恢复脚本的 Docker 沙箱集成测试
- `recovery`：相当于运行 `recovery-unit + recovery-integration`，这组检查会真实操作独立 Docker 沙箱，明显更重
- `functional`：运行功能测试集，包含 `scripts + frontend + backend`
- `full`：运行全部检查，等于 `scripts + frontend + backend + recovery`

后端 integration 测试结束后，`run_checks.py` 会调用内部脚本 `scripts/internal/restore_test_seed.py`，重新导入测试库 seed，并按 `infra/auth/.env.auth` 恢复默认 admin，避免测试执行污染手工联调用的测试库状态。

## 导出 OpenAPI

在项目根目录执行：

```powershell
python scripts/export_openapi.py
```

说明：

- 当前脚本会从 FastAPI 应用运行时生成 OpenAPI
- 导出结果写入 [docs/openapi.json](D:/Code/PythonCode/5%20LiveSetList/docs/openapi.json)

## 数据库恢复

在项目根目录执行：

```powershell
python scripts/recovery_db.py <arguments> [--force]
```

当前支持：

- `test`：在当前正式容器内 drop/create 测试库，重新执行 Flyway migrate，并重新导入 seed
- `backup-app-auto`：立即生成一份主库自动备份，保留最近 5 份，并执行一次最小恢复 SQL 行数校验；自动备份还会对比最近几份自动备份的行数，异常偏低时直接判失败
- `backup-app-manual`：立即生成一份主库手动备份，保留最近 3 份，并执行一次最小恢复 SQL 行数校验
- `recovery`：从最近一份主库备份恢复业务库，恢复前会先生成一份恢复流程专用临时快照，再走候选容器验证与回滚

`--force` 的作用：

- 对 `test` 和 `recovery` 这类会修改数据库状态的操作做显式确认
- 不带 `--force` 时，脚本只会提示并退出，不会真正执行恢复动作

完整流程与测试说明见：

- [recovery/README.md](D:/Code/PythonCode/5%20LiveSetList/recovery/README.md)

## Windows 定时任务

可直接挂 `scripts/backup_app_auto.ps1` 到 Windows Task Scheduler。

- 脚本会调用 `python scripts/recovery_db.py backup-app-auto`
- 结束后会提取最后一条摘要，发送一条 Windows 系统通知
- 若希望看到通知，任务需要运行在当前已登录用户会话中；如果任务配置成“无论用户是否登录都运行”，通常拿不到桌面通知
