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
- `recovery-unit`：运行恢复脚本的 mock/命令契约测试
- `recovery-integration`：运行恢复脚本的 Docker 沙箱集成测试
- `recovery`：相当于运行 `recovery-unit + recovery-integration`，这组检查会真实操作独立 Docker 沙箱，明显更重
- `functional`：运行功能测试集，只包含 `frontend + backend`
- `full`：运行全部检查，等于 `frontend + backend + recovery`

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
