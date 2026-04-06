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
- `app`：从最近一份主库备份恢复业务库，当前已实现
- `all`：当前与 `app` 等价，恢复主库时会一并重建测试库
- `backup-app-auto`：生成自动备份，保留最近 5 份
- `backup-app-manual`：生成手动备份，保留最近 3 份
- `--force`：确认执行恢复类操作

说明：

- `test` 模式会保留当前主库，只在现有正式容器内把测试库恢复到项目约定的“基线状态”
- 它恢复的是 Flyway 管理的表结构和 `base_seed.sql` 中定义的固定测试数据
- 如果你想恢复“重建前测试库里当时所有临时数据”，仍然需要额外做 `pg_dump/pg_restore`

## 备份与恢复主库

主库备份目录当前固定为：

- `C:\Users\xiluo\OneDrive - stu.jiangnan.edu.cn\Backup\live-set-list-docker`

其中：

- 自动备份：`app/auto`
- 手动备份：`app/manual`

常用命令：

```powershell
python scripts/recovery_db.py backup-app-auto
python scripts/recovery_db.py backup-app-manual
python scripts/recovery_db.py app --force
```

当前 `app` / `all` 模式的恢复流程是：

1. 读取自动备份和手动备份，选择最近一份作为恢复源
2. 弹出确认提示
3. 先对当前主库再补一份手动备份，保留恢复前最后状态
4. 将当前正式容器重命名为备份容器，并用候选 volume 拉起新容器
5. 在候选容器中用 `pg_restore` 恢复主库
6. 对主库执行 `flyway info + validate`，如果存在 `Pending` 再执行 `migrate`
7. 在候选容器中重建测试库并重新导入 seed
8. 跑 `python scripts/run_checks.py all`
9. 如果检查通过：
   - 脚本会暂停，等待人工确认候选容器状态
10. 人工确认后：
   - 将候选 volume 的数据复制回固定正式 volume 名并重新拉起正式容器
11. 如果检查失败，或人工确认阶段取消：
   - 删除候选容器和候选 volume
   - 将旧容器改名并启动回来

补充说明：

- 正式 volume 当前通过 Compose 的 `external` 模式接入，避免恢复/转正时反复出现“volume 已存在但不是由 Compose 创建”的警告

## 相关位置

- Flyway 说明：[docs/flyway.md](D:/Code/PythonCode/5%20LiveSetList/docs/flyway.md)
- Flyway 配置目录：[backend/db/flyway/README.md](D:/Code/PythonCode/5%20LiveSetList/backend/db/flyway/README.md)
- Docker PostgreSQL 配置：`infra/postgres`
- 测试 seed：`backend/db/postgres/seed/base_seed.sql`
