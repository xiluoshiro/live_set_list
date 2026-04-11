# Database Notes

本目录存放当前项目与 PostgreSQL / Flyway / seed 相关的内容。

## 角色分工

- `postgres`：容器 bootstrap / 管理账号
- `live_project_owner`：业务库 owner，由 `APP_OWNER` / `APP_OWNER_PASSWORD` 指定
- `live_project_flyway`：Flyway 迁移账号
- `live_project_ro`：普通查询账号
- `live_project_user_rw`：前端普通用户写账号，只授予指定表写权限，当前用于收藏
- `live_project_super_ro`：高权限业务账号，可查询/插入/更新，当前用于认证与后续控制台写接口
- `live_project_test_admin`：测试库专用管理账号，用于 integration 的重置与 seed

## 修改表结构时怎么做

1. 先在 pgAdmin 中试验 SQL
2. 将正式变更整理成新的 `backend/db/flyway/sql/V...sql`
3. 先对测试库执行 Flyway：

```powershell
flyway -configFiles=backend/db/flyway/flyway.toml validate
flyway -configFiles=backend/db/flyway/flyway.toml migrate
```

4. 跑后端/前端检查，确认接口与页面正常
   建议优先运行：

```powershell
python scripts/run_checks.py functional
```

5. 不要修改已执行过的 `V...sql`；如需修正，新增下一个版本文件

## 恢复测试库

当前测试库 `live_statistic_test` 的恢复分成 3 层：

1. Docker 初始化脚本负责创建角色和数据库
2. Flyway 负责恢复表结构
3. `base_seed.sql` 负责恢复基础测试数据

按当前仓库配置，推荐顺序如下：

1. 启动或重建 PostgreSQL 容器：

```powershell
docker compose --env-file infra/postgres/.env.pg-migrate -f infra/postgres/docker-compose.pg-migrate.yml up -d
```

2. 对测试库执行结构迁移：

```powershell
flyway -configFiles=backend/db/flyway/flyway.toml migrate
```

3. 如需手工恢复基础测试数据，导入 seed：

```powershell
docker exec -i live-set-list-docker psql -U live_project_test_admin -d live_statistic_test < backend/db/postgres/seed/base_seed.sql
```

4. 或者直接运行集成测试；integration 用例会在每条测试前自动导入同一份 seed：

```powershell
python scripts/run_checks.py backend-integration
```

5. 如果希望一条命令执行“重建 Docker + Flyway migrate + 导入 seed”，可以在项目根目录运行：

```powershell
python scripts/recovery_db.py test --force
```

可选参数：

- `test`：在当前正式容器内重建测试库
- `recovery`：从最近一份主库备份恢复业务库，当前已实现
- `backup-app-auto`：生成自动备份，保留最近 5 份
- `backup-app-manual`：生成手动备份，保留最近 3 份
- `--force`：确认执行恢复类操作

说明：

- `test` 模式会保留当前主库，只在现有正式容器内把测试库恢复到项目约定的“基线状态”
- 它恢复的是 Flyway 管理的表结构和 `base_seed.sql` 中定义的固定测试数据
- 如果你想恢复“重建前测试库里当时所有临时数据”，仍然需要额外做 `pg_dump/pg_restore`

## 备份与恢复主库

常用命令：

```powershell
python scripts/recovery_db.py backup-app-auto
python scripts/recovery_db.py backup-app-manual
python scripts/recovery_db.py recovery --force
```

完整备份目录、候选恢复流程和测试说明见：

- [recovery/README.md](D:/Code/PythonCode/5%20LiveSetList/recovery/README.md)

如果只想验证 recovery 的真实 Docker 沙箱行为，可以运行：

```powershell
python scripts/run_checks.py recovery-integration
```

如果想把 recovery 的轻量测试和 Docker 沙箱测试一起跑完，可以运行：

```powershell
python scripts/run_checks.py recovery
```

## 相关位置

- Flyway 说明：[docs/flyway.md](D:/Code/PythonCode/5%20LiveSetList/docs/flyway.md)
- Flyway 踩坑指南：[docs/fails/flyway-pitfalls.md](D:/Code/PythonCode/5%20LiveSetList/docs/fails/flyway-pitfalls.md)
- 数据库角色与后端用户梳理：[docs/db-roles.md](D:/Code/PythonCode/5%20LiveSetList/docs/db-roles.md)
- Flyway 配置目录：[backend/db/flyway/README.md](D:/Code/PythonCode/5%20LiveSetList/backend/db/flyway/README.md)
- Docker PostgreSQL 配置：`infra/postgres`
- 测试 seed：`backend/db/postgres/seed/base_seed.sql`
