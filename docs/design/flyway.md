# Flyway 落地说明

本文档描述当前仓库已经落地的 Flyway / PostgreSQL 迁移方案，以及后续推荐的使用方式。

当前状态：

- 已引入 Flyway 配置、基线脚本与后续版本化迁移
- 已准备本地 PostgreSQL 18.3 容器作为迁移目标库
- `B1__baseline_schema.sql` 是当前 baseline
- `live_statistic` 与 `live_statistic_test` 都应通过同一套 Flyway migration 管理
- 当前仓库内版本化迁移已到 `V9__require_live_type_on_live_attrs.sql`

## 1. 日常推荐流程

推荐按下面的顺序使用：

1. 在 pgAdmin 中试验 SQL
2. 确认结构变化后，整理成新的 `V...sql`
3. 提交 Git
4. 在测试库上执行 `flyway validate`
5. 在测试库上执行 `flyway migrate`
6. 跑后端集成测试 / 接口验证
7. 验证通过后，再对开发库执行同一套迁移

## 2. 当前后端实际依赖的表

基于当前后端代码，实际读写路径依赖如下：

### `GET /api/health/db`

- 不依赖业务表
- 仅执行 `select 1;`

### `GET /api/lives`

- `live_attrs`
- `live_setlist`
- `band_attrs`

### `GET /api/lives/{live_id}`

- `live_attrs`
- `live_setlist`
- `band_attrs`
- `song_list`
- `venue_list`

### `POST /api/lives/details:batch`

- `live_attrs`
- `live_setlist`
- `band_attrs`
- `song_list`
- `venue_list`

### 认证与收藏接口

- `app_users`
- `auth_sessions`
- `audit_logs`
- `user_live_favorites`

### 控制台 lookup / 写接口

- `song_list`
- `band_attrs`
- `venue_list`
- `live_attrs`
- `live_setlist`
- `audit_logs`

## 3. 作为基线纳管的对象范围

### 最小集合

如果只从“当前后端查询路径”考虑，最小集合是：

- `public.live_attrs`
- `public.live_setlist`
- `public.band_attrs`
- `public.song_list`
- `public.venue_list`

### 推荐集合

当前库表数量不多，推荐直接导出整个 `public` schema 的结构，而不是只导出上述 5 张表。

原因：

- 当前表数不多，维护全量 schema 成本低
- 避免后续出现“新增依赖对象没进基线”的问题
- 索引、约束、序列、默认值更容易保持一致
- 后续如果增加写接口，不必频繁调整导出清单

结论：

- “最小导出集合”适合临时核对
- “整个 `public` schema”适合作为长期 Flyway baseline

## 4. 当前仓库内的 Flyway / PostgreSQL 结构

当前仓库建议并已基本落地如下结构：

```text
infra/
  postgres/
    docker-compose.pg-migrate.yml
    .env.pg-migrate
    .env.pg-migrate.example
backend/
  db/
    flyway/
      flyway.toml
      flyway.toml.example
      README.md
      sql/
        B1__baseline_schema.sql
        V2__add_auth_framework.sql
        V3__align_public_object_owners.sql
        V4__grant_delete_on_user_live_favorites.sql
        V5__grant_favorite_permissions_to_user_rw.sql
        V6__grant_select_on_user_live_favorites_to_user_rw.sql
        V7__reserve_console_setlist_delete_grant_slot.sql
        V8__add_nullable_live_type_to_live_attrs.sql
        V9__require_live_type_on_live_attrs.sql
      scripts/
    postgres/
      init/
        010-create-flyway-role.sh
```

说明：

- `backend/db/flyway/flyway.toml`
  - 本地实际使用的 Flyway 配置
  - 当前默认环境为 `test`
  - 已加入 `.gitignore`
- `backend/db/flyway/flyway.toml.example`
  - 示例配置，不包含真实密码
- `backend/db/flyway/sql/B1__baseline_schema.sql`
  - 当前 baseline 脚本
  - 已准备完成，作为版本 `1` 保留
- `backend/db/flyway/sql/V2__...` 到 `V9__...`
  - 当前已经落地的认证、收藏、权限、控制台与 `live_type` 版本化迁移
- `infra/postgres/docker-compose.pg-migrate.yml`
  - 本地 PostgreSQL 18.3 迁移目标库容器配置
- `infra/postgres/.env.pg-migrate`
  - 本地 Docker PostgreSQL 环境变量
  - 包含 owner / flyway / app / test admin 角色配置
  - 其中 `POSTGRES_USER/POSTGRES_DB` 用于容器 bootstrap，`APP_DB/APP_OWNER/APP_OWNER_PASSWORD` 用于项目业务库
- `backend/db/postgres/init/010-create-flyway-role.sh`
  - 容器首次初始化时创建 / 更新 Flyway / app 账号
  - 会创建 `live_statistic_test`
  - 会授予测试库连接权限与相应 schema/table/sequence 权限

## 5. 当前容器化方案

### 5.1 当前目标

当前 Flyway 已同时接管两套库：

- 测试库：`live_statistic_test`
- 主开发库：`live_statistic`

约定：

- 默认环境仍然是 `test`
- 日常结构变更先在测试库执行 `validate + migrate`
- 测试与联调通过后，再对主开发库执行同一版本迁移

### 5.2 PostgreSQL 18 镜像的挂载注意事项

当前容器镜像使用：

- `postgres:18.3-trixie`

对于 PostgreSQL 18 官方镜像，数据卷应挂到：

- `/var/lib/postgresql`

不推荐继续挂到：

- `/var/lib/postgresql/data`

否则容器可能在初始化后报错并反复重启。

当前 [`docker-compose.pg-migrate.yml`](D:/Code/PythonCode/5%20LiveSetList/infra/postgres/docker-compose.pg-migrate.yml) 已按 PostgreSQL 18 的要求修正。

## 6. Flyway 配置与使用方式

### 6.1 为什么 Flyway 配置里是 JDBC URL

虽然当前项目后端运行时使用的是 `psycopg2`，但 Flyway 本身是独立的 Java migration 工具。

因此：

- 后端应用连接数据库时，使用 `psycopg2`
- Flyway CLI / Flyway Desktop 连接数据库时，使用 JDBC URL

两者并不冲突：

- `psycopg2`：应用运行时查询与写入
- Flyway：数据库结构版本迁移

### 6.2 当前默认环境

当前本地实际配置见：

- [flyway.toml](D:/Code/PythonCode/5%20LiveSetList/backend/db/flyway/flyway.toml)

当前默认环境是：

- `test`

对应测试库：

- `jdbc:postgresql://localhost:15432/live_statistic_test`

开发库配置保留在同一个文件中，当前已完成 baseline 接管，但默认命令仍指向测试库。

### 6.3 当前推荐命令

查看测试库状态：

```powershell
flyway -configFiles=backend/db/flyway/flyway.toml info
```

测试连通性：

```powershell
flyway -configFiles=backend/db/flyway/flyway.toml testConnection
```

执行迁移：

```powershell
flyway -configFiles=backend/db/flyway/flyway.toml migrate
```

### 6.4 当前仓库迁移状态

仓库当前状态：

- baseline 文件为 `B1__baseline_schema.sql`
- 当前最新 migration 文件为 `V9__require_live_type_on_live_attrs.sql`
- 目标库执行 `flyway migrate` 后，应应用 `B1` 以及 `V2` 到 `V9`
- `public.flyway_schema_history` 由 Flyway 自动维护，不应在业务 migration 中改 owner 或额外授权

因此：

- 结构变更应继续通过 Flyway 纳管
- 后续新增数据库结构变化时，应在当前最大版本号之后继续追加新的 `V<n>__...sql`

## 7. Flyway 使用的 PostgreSQL 用户权限

### 推荐角色模型

推荐使用：

- 登录账号：`live_project_flyway`
- 对象 owner：`live_project_owner`

当前本地容器内已经按这个思路工作：

- `postgres` 负责容器 bootstrap 与管理入口
- `live_project_owner` 负责业务数据库拥有权
- `live_project_flyway` 负责 Flyway 连接与迁移
- `live_project_ro` 负责普通查询
- `live_project_user_rw` 负责低风险用户侧写入，当前用于收藏增删
- `live_project_super_ro` 负责查询、插入、更新
- `live_project_test_admin` 负责测试库重置与 seed，不授予主库访问权限

### 最低建议权限

如果 Flyway 负责对已有数据库做迁移，至少需要：

- 数据库级：
  - `CONNECT`
- schema 级：
  - `USAGE`
  - `CREATE`
- 对 Flyway 历史表所在 schema：
  - 能创建并读写 `flyway_schema_history`
- 对受管理对象：
  - 最稳妥方式是成为 owner，或继承 owner 角色

### 当前本地测试库实际最少落地权限

当前本地测试库至少已具备：

- `GRANT CONNECT ON DATABASE live_statistic_test TO live_project_flyway;`
- `GRANT USAGE, CREATE ON SCHEMA public TO live_project_flyway;`
- `GRANT CONNECT ON DATABASE live_statistic_test TO live_project_ro;`
- `GRANT CONNECT ON DATABASE live_statistic_test TO live_project_super_ro;`
- `GRANT CONNECT ON DATABASE live_statistic_test TO live_project_test_admin;`
- `GRANT live_project_flyway TO live_project_test_admin;`

这足以让 Flyway 在空测试库上建立 schema history 表并执行 baseline。

### 如果后续让 Flyway 自己创建数据库

额外需要：

- `CREATEDB`

当前方案里，数据库创建仍由 owner / 初始化脚本负责，Flyway 不直接创建数据库。

## 8. 权限 SQL 示例

下面给的是推荐范式，不是唯一方案：

```sql
CREATE ROLE live_project_owner NOLOGIN;

CREATE ROLE live_project_flyway
LOGIN
PASSWORD 'replace_me';

GRANT live_project_owner TO live_project_flyway;

GRANT CONNECT ON DATABASE live_statistic TO live_project_flyway;
GRANT CONNECT ON DATABASE live_statistic_test TO live_project_flyway;

GRANT USAGE, CREATE ON SCHEMA public TO live_project_flyway;
```

如果现有对象已经存在，建议把受 Flyway 管理的对象 owner 统一到 `live_project_owner`，例如：

```sql
ALTER SCHEMA public OWNER TO live_project_owner;

ALTER TABLE public.live_attrs OWNER TO live_project_owner;
ALTER TABLE public.live_setlist OWNER TO live_project_owner;
ALTER TABLE public.band_attrs OWNER TO live_project_owner;
ALTER TABLE public.song_list OWNER TO live_project_owner;
ALTER TABLE public.venue_list OWNER TO live_project_owner;
```

如果未来希望让 Flyway 自己创建数据库：

```sql
ALTER ROLE live_project_flyway CREATEDB;
```

## 9. 当前容易漏掉的点

- baseline 中若使用数据库函数作为默认值，例如 `gen_random_uuid()`，应确认目标 PostgreSQL 环境支持
- 不要修改已执行过的 `V...sql`
  - 修正应新增下一个版本文件
- 测试库应通过 Flyway 重建，而不是手工点 pgAdmin 同步
- 如果 `infra/postgres/.env.pg-migrate` 中的数据库密码变更，而容器已初始化完成，需要同步更新数据库角色密码
  - 否则 Flyway 会出现密码认证失败
- PostgreSQL 18 容器的数据卷挂载路径应使用 `/var/lib/postgresql`
