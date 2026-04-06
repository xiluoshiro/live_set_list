# Database Notes

本目录存放当前项目与 PostgreSQL / Flyway / seed 相关的内容。

## 角色分工

- `postgres`：容器 bootstrap / 管理账号
- `live_project_owner`：业务库 owner，由 `APP_OWNER` / `APP_OWNER_PASSWORD` 指定
- `live_project_flyway`：Flyway 迁移账号
- `live_project_ro`：普通查询账号
- `live_project_super_ro`：高权限业务账号，可查询/插入/更新
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
5. 不要修改已执行过的 `V...sql`；如需修正，新增下一个版本文件

## 重建 Docker 后如何恢复测试库

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

- `test`：恢复测试库，当前已实现
- `app`：预留给业务库恢复，当前尚未实现
- `all`：预留给“恢复所有内容”，当前尚未实现
- `--force`：确认执行 `docker compose down -v`

当前 `test` 模式的安全流程是：

1. 如果当前 PostgreSQL 容器存在，先将旧容器重命名为备份容器并停止
2. 用新的候选 volume 启动新容器并恢复测试库
3. 跑 `python scripts/run_checks.py all`
4. 如果检查通过：
   - 先对旧正式 volume 做一份临时快照
   - 将候选 volume 的数据复制回固定正式 volume 名
   - 重新拉起正式容器
   - 删除旧备份容器、候选 volume 和临时快照 volume
5. 如果检查失败：
   - 删除候选容器和候选 volume
   - 将旧容器改名并启动回来

说明：

- `POSTGRES_VOLUME_NAME` 始终保持为固定正式名
- 候选 volume 名会基于这个固定正式名生成，例如 `xxx_candidate_<timestamp>`

说明：

- 这套流程可以把测试库恢复到当前项目约定的“基线状态”
- 它恢复的是 Flyway 管理的表结构和 `base_seed.sql` 中定义的固定测试数据
- 如果你想恢复“重建前测试库里当时所有临时数据”，仍然需要额外做 `pg_dump/pg_restore`

## 相关位置

- Flyway 说明：[docs/flyway.md](D:/Code/PythonCode/5%20LiveSetList/docs/flyway.md)
- Flyway 配置目录：[backend/db/flyway/README.md](D:/Code/PythonCode/5%20LiveSetList/backend/db/flyway/README.md)
- Docker PostgreSQL 配置：`infra/postgres`
- 测试 seed：`backend/db/postgres/seed/base_seed.sql`
