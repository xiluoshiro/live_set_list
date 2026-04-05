# Flyway Scaffold

本目录用于存放当前项目的 Flyway 配置、baseline 与后续版本化 SQL。

建议使用方式：

1. 先阅读 [docs/flyway.md](D:/Code/PythonCode/5%20LiveSetList/docs/flyway.md)
2. 本地可直接使用 `flyway.toml` 连接 Docker 迁移目标库
3. 如需提交模板或切换环境，再参考 `flyway.toml.example`
4. 项目根目录提供 `docker-compose.pg-migrate.yml` 用于启动本地 PostgreSQL 18.3 迁移目标库
5. 当前默认先操作测试库 `live_statistic_test`
6. 将结构变更写入 `sql/V...sql`

修改表结构时：

1. 先在 pgAdmin 中试验 SQL
2. 将正式变更写入新的 `sql/V...sql`
3. 运行：

```powershell
flyway -configFiles=backend/db/flyway/flyway.toml validate
flyway -configFiles=backend/db/flyway/flyway.toml migrate
```

4. 验证接口与页面
5. 不要修改已执行过的 `V...sql`

目录说明：

- `flyway.toml`
  - 本地 Docker 迁移目标库配置
- `flyway.toml.example`
  - Flyway 项目配置模板
- `sql/B1__baseline_schema.sql`
  - 当前 baseline migration
- `../postgres/init/010-create-flyway-role.sh`
  - PostgreSQL 容器初始化时创建 Flyway 登录角色并授予 schema 权限
