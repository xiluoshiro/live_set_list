# 数据库角色与后端用户梳理

本文档梳理当前仓库里 PostgreSQL 角色的实际分工、权限范围，以及后端/测试/恢复流程分别使用了哪些数据库用户。

本文档描述的是“当前仓库已经落地的真实情况”，主要依据以下位置：

- [infra/postgres/.env.pg-migrate](/D:/Code/PythonCode/5%20LiveSetList/infra/postgres/.env.pg-migrate)
- [backend/db/postgres/init/010-create-flyway-role.sh](/D:/Code/PythonCode/5%20LiveSetList/backend/db/postgres/init/010-create-flyway-role.sh)
- [backend/app/db.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/db.py)
- [backend/app/auth.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/auth.py)
- [backend/app/routers/console_write.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/routers/console_write.py)
- [backend/tests/integration/conftest.py](/D:/Code/PythonCode/5%20LiveSetList/backend/tests/integration/conftest.py)
- [recovery/restore.py](/D:/Code/PythonCode/5%20LiveSetList/recovery/restore.py)
- [recovery/backup.py](/D:/Code/PythonCode/5%20LiveSetList/recovery/backup.py)

## 1. 当前角色总览

当前容器初始化脚本会创建或更新这些登录角色：

- `postgres`
- `live_project_owner`
- `live_project_flyway`
- `live_project_ro`
- `live_project_user_rw`
- `live_project_super_ro`
- `live_project_test_admin`

对应环境变量名：

| 角色 | 环境变量 |
| --- | --- |
| `postgres` | `POSTGRES_USER` / `POSTGRES_PASSWORD` |
| `live_project_owner` | `APP_OWNER` / `APP_OWNER_PASSWORD` |
| `live_project_flyway` | `FLYWAY_USER` / `FLYWAY_PASSWORD` |
| `live_project_ro` | `APP_RO_USER` / `APP_RO_PASSWORD` |
| `live_project_user_rw` | `APP_USER_RW_USER` / `APP_USER_RW_PASSWORD` |
| `live_project_super_ro` | `APP_SUPER_USER` / `APP_SUPER_PASSWORD` |
| `live_project_test_admin` | `TEST_ADMIN_USER` / `TEST_ADMIN_PASSWORD` |

当前业务库：

- 主开发库：`live_statistic`
- 测试库：`live_statistic_test`

## 2. 角色继承关系

当前初始化脚本里明确建立了两层继承：

- `GRANT live_project_owner TO live_project_flyway;`
- `GRANT live_project_flyway TO live_project_test_admin;`

这意味着：

- `live_project_flyway` 继承了 `live_project_owner`
- `live_project_test_admin` 继承了 `live_project_flyway`，也间接继承了 `live_project_owner`

需要注意：

- 角色继承不等于“新建对象的 owner 自动变成上层角色”
- 当前如果由 `live_project_flyway` 执行 `CREATE TABLE`，对象 owner 仍可能是 `live_project_flyway`
- 所以“数据库 owner 是 `live_project_owner`”和“某张表 owner 是 `live_project_owner`”不是同一件事
- 当前 CI、生产 release manager 和恢复流程会执行共享 owner 契约；上述默认行为一旦造成业务对象 owner 漂移，发布必须失败

## 3. 各角色权限范围

### 3.1 `postgres`

定位：

- 容器 bootstrap / 管理入口
- 用于创建角色、创建数据库、恢复时执行高权限管理 SQL

当前实际用途：

- 执行容器初始化脚本
- 恢复流程中执行 `DROP DATABASE` / `CREATE DATABASE`
- 恢复流程中执行权限重建 SQL

不作为后端运行时账号使用。

### 3.2 `live_project_owner`

定位：

- 项目业务库 owner

当前实际状态：

- 初始化脚本创建它时使用的是 `LOGIN` 角色，而不是 `NOLOGIN`
- `live_statistic` 和 `live_statistic_test` 这两个数据库在创建时都指定它为 owner

当前职责：

- 作为“期望的业务对象 owner”
- 在恢复流程中被用作 `CREATE DATABASE ... OWNER ...`
- 在恢复流程中被用作 `ALTER ... OWNER TO live_project_owner`

当前限制：

- 后端运行时代码没有直接使用这个账号
- 它也不保证天然拥有所有由 Flyway 新建对象的 owner 身份

### 3.3 `live_project_flyway`

定位：

- Flyway 迁移账号

数据库级权限：

- 对 `live_statistic` 有 `CONNECT`
- 对 `live_statistic_test` 有 `CONNECT`

schema 级权限：

- 对 `public` 有 `USAGE, CREATE`

角色继承：

- 被授予 `live_project_owner`

当前职责：

- Flyway CLI 连接开发库和测试库执行 migration
- 创建 `flyway_schema_history`
- 新建/修改 schema 对象

重要说明：

- 新增表如果由 Flyway 直接创建，owner 会落在 `live_project_flyway`
- migration 必须先 `SET ROLE live_project_owner` 再创建对象，或在不触碰 `flyway_schema_history` 的前提下显式调整 owner
- `backend/db/postgres/checks/ownership_contract.sql` 会在 CI、生产 migration/deploy 和恢复流程中强制验证这一点

### 3.4 `live_project_ro`

定位：

- 纯读运行时账号

数据库级权限：

- 对 `live_statistic` 有 `CONNECT`
- 对 `live_statistic_test` 有 `CONNECT`

schema 级权限：

- 对 `public` 有 `USAGE`

表级权限：

- `SELECT ON ALL TABLES IN SCHEMA public`

序列权限：

- `SELECT ON ALL SEQUENCES IN SCHEMA public`

默认权限：

- 对 `app_owner` 和 `flyway_user` 未来新建的表/序列，都预设只读权限

当前职责：

- 后端所有公开读接口的默认数据库用户

### 3.5 `live_project_user_rw`

定位：

- 前端登录用户对应的低权限业务写账号

数据库级权限：

- 对 `live_statistic` 有 `CONNECT`
- 对 `live_statistic_test` 有 `CONNECT`

schema 级权限：

- 对 `public` 有 `USAGE`

表级权限：

- `SELECT` on `public.live_attrs`
- `SELECT, INSERT, DELETE` on `public.user_live_favorites`
- `INSERT` on `public.audit_logs`

序列权限：

- `USAGE, SELECT, UPDATE` on `public.user_live_favorites_id_seq`
- `USAGE, SELECT, UPDATE` on `public.audit_logs_id_seq`

当前限制：

- 不能写 `app_users`、`auth_sessions` 等认证表
- 不能写控制台接口使用的业务表；控制台写入统一走 `live_project_super_ro`
- 不依赖默认权限扩散，只对明确授权的表生效

当前职责：

- 登录用户收藏的新增与取消收藏
- 对应“前端普通用户可触发，但仍需要服务端落库”的低风险写操作

### 3.6 `live_project_super_ro`

定位：

- 读写运行时账号

数据库级权限：

- 对 `live_statistic` 有 `CONNECT`
- 对 `live_statistic_test` 有 `CONNECT`

schema 级权限：

- 对 `public` 有 `USAGE`

表级权限：

- `SELECT ON ALL TABLES IN SCHEMA public`
- `INSERT, UPDATE ON ALL TABLES IN SCHEMA public`
- `DELETE ON public.tour_bands, public.tour_lives, public.performance_group_lives`（V13/V14，仅用于聚合关系的完整集合替换）
- `DELETE ON public.live_setlist`（V17，仅用于 Setlist 管理的完整集合替换）

序列权限：

- `USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public`

默认权限：

- 对 `app_owner` 和 `flyway_user` 未来新建的表/序列，都预设 `SELECT/INSERT/UPDATE` 及相关 sequence 权限

当前限制：

- 初始化脚本不授予全局 `DELETE`；V13/V14/V17 仅对集合替换所需的 `tour_bands`、`tour_lives`、`performance_group_lives` 和 `live_setlist` 显式授予 `DELETE`
- 也没有给它 `CREATE TABLE` / `ALTER TABLE` 这类 DDL 权限

当前职责：

- 后端认证与其他业务写操作的默认数据库用户

### 3.7 `live_project_test_admin`

定位：

- 测试库专用管理账号

数据库级权限：

- 对 `live_statistic_test` 有 `CONNECT`

schema 级权限：

- 对测试库 `public` 有 `USAGE, CREATE`

表/序列权限：

- 对测试库 `public` 下所有现有表和序列有 `ALL PRIVILEGES`

默认权限：

- 对 `app_owner` 和 `flyway_user` 在测试库未来新建的表/序列，也预设 `ALL PRIVILEGES`

角色继承：

- 被授予 `live_project_flyway`

当前职责：

- integration 测试前重置测试库
- 导入 `base_seed.sql`
- 测试库运维类操作

不会用于主开发库的应用运行时流量。

## 4. 后端实际使用了哪些数据库用户

### 4.1 运行时只读连接

入口：

- [get_db_connection()](/D:/Code/PythonCode/5%20LiveSetList/backend/app/db.py)

取值顺序：

1. `DB_USER` / `DB_PASSWORD`
2. 否则 `APP_RO_USER` / `APP_RO_PASSWORD`
3. 否则回退到 `live_project_ro`

当前实际默认用户：

- `live_project_ro`

当前使用它的后端路径：

- [health.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/routers/health.py)
  - `GET /api/health/db`
- [lives.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/routers/lives.py)
  - `GET /api/lives`
  - `GET /api/lives/{live_id}`
  - `POST /api/lives/details:batch`
- [catalog.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/routers/catalog.py)
  - 公共搜索、乐队浏览与资料库概览
- [tours.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/routers/tours.py)
  - 巡演列表、详情与统计
- [performance_groups.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/routers/performance_groups.py)
  - 统一演出投影与活动组详情
- 控制台巡演 / 活动组的候选、列表和编辑详情也使用只读连接

### 4.2 运行时读写连接

入口：

- [get_write_db_connection()](/D:/Code/PythonCode/5%20LiveSetList/backend/app/db.py)

取值顺序：

1. `DB_WRITE_USER` / `DB_WRITE_PASSWORD`
2. 否则 `APP_SUPER_USER` / `APP_SUPER_PASSWORD`
3. 否则回退到 `live_project_super_ro`

当前实际默认用户：

- `live_project_super_ro`

当前使用它的后端路径：

- [auth.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/auth.py)
  - 默认 admin 自动补齐
  - 登录校验
  - session 创建/校验/失效
  - 审计日志写入
  - 收藏 ID 查询
- [console_write.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/routers/console_write.py)
  - `POST /api/console/songs`
  - `PUT /api/console/songs/{song_id}`
  - `POST /api/console/songs:batch`
  - `POST /api/console/venues`
  - `POST /api/console/lives`
  - `POST /api/console/lives/{live_id}/setlist`
  - `PUT /api/console/lives/{live_id}/setlist`
- [console_tours.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/routers/console_tours.py)
  - 巡演候选、详情、创建和完整集合更新
- [console_performance_groups.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/routers/console_performance_groups.py)
  - 活动组列表、候选、详情、创建和完整集合更新

说明：

- 认证链路虽然包含部分读取，但因为会同时更新 session、登录时间、审计，所以统一走写连接
- 当前默认 admin 自动插入 `app_users` 时，使用的也是 `live_project_super_ro`
- 控制台写接口要求 `editor+`，并统一做 CSRF 校验；setlist 写入保持 append-only，巡演和活动组更新只删除并重建各自的关系行

### 4.3 运行时普通用户写连接

入口：

- [get_user_write_db_connection()](/D:/Code/PythonCode/5%20LiveSetList/backend/app/db.py)

取值顺序：

1. `DB_USER_RW_USER` / `DB_USER_RW_PASSWORD`
2. 否则 `APP_USER_RW_USER` / `APP_USER_RW_PASSWORD`
3. 否则回退到 `live_project_user_rw`

当前实际默认用户：

- `live_project_user_rw`

当前使用它的后端路径：

- [me.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/routers/me.py)
  - `PUT /api/me/favorites/lives/{live_id}`
  - `DELETE /api/me/favorites/lives/{live_id}`

说明：

- 这条连接只用于“登录普通用户可触发”的低风险写操作
- 当前落地场景就是收藏增删；后续如有类似等级的用户侧写入，也应优先复用这一层

### 4.4 Flyway 迁移连接

入口：

- [flyway.toml](/D:/Code/PythonCode/5%20LiveSetList/backend/db/flyway/flyway.toml)

当前配置：

- 开发库 `dev`：`live_project_flyway`
- 测试库 `test`：`live_project_flyway`

当前职责：

- 执行所有 `B...sql` / `V...sql` migration

### 4.5 integration 测试连接

入口：

- [backend/tests/integration/conftest.py](/D:/Code/PythonCode/5%20LiveSetList/backend/tests/integration/conftest.py)

当前用到 4 类用户：

- `user`
  - 默认 `live_project_ro`
  - 提供应用测试时的只读连接
- `write_user`
  - 默认 `live_project_super_ro`
  - 提供认证、session、审计等高权限业务写连接
- `user_rw_user`
  - 默认 `live_project_user_rw`
  - 提供收藏等普通用户写接口连接
- `admin_user`
  - 默认 `live_project_test_admin`
  - 用于执行 seed 和测试库重置

换句话说：

- integration 测试里的应用请求，已经拆成“只读用户 + 普通用户写连接 + 高权限写连接”
- 真正重置测试库和导入固定数据时，用的是 `live_project_test_admin`

## 5. 恢复与备份流程用了哪些用户

### 5.1 备份

入口：

- [backup.py](/D:/Code/PythonCode/5%20LiveSetList/recovery/backup.py)

当前实现：

- 用 `docker exec ... pg_dump -U POSTGRES_USER -d APP_DB`

也就是默认用：

- `postgres`

来导出主库备份。

### 5.2 测试库恢复

入口：

- [restore.py](/D:/Code/PythonCode/5%20LiveSetList/recovery/restore.py)

当前实现：

- 先跑 Flyway 到测试库
- 再用 `TEST_ADMIN_USER` 执行 `psql` 导入 `base_seed.sql`

也就是默认组合：

- Flyway：`live_project_flyway`
- seed 导入：`live_project_test_admin`

### 5.3 主库恢复

当前实现会同时使用：

- `postgres`
  - 终止连接
  - `DROP DATABASE`
  - `CREATE DATABASE`
  - 执行恢复后的权限修复 SQL
- `APP_OWNER`
  - 作为重建主库时指定的数据库 owner
- `live_project_flyway`
  - 在恢复后重新纳管 schema / 历史表权限
- `live_project_ro`
  - 作为只读权限授予目标
- `live_project_user_rw`
  - 作为普通用户收藏写权限授予目标
- `live_project_super_ro`
  - 作为认证与控制台高权限写权限授予目标

## 6. 当前最重要的注意事项

### 6.1 `live_project_owner` 不是当前后端运行时账号

当前后端运行时实际只用了：

- `live_project_ro`
- `live_project_user_rw`
- `live_project_super_ro`

没有直接用：

- `live_project_owner`

所以如果你手工切到 `live_project_owner` 发现某些新表没有预期权限，这并不等于后端运行时一定会失败。

### 6.2 新对象必须显式归属 `live_project_owner`

因为 migration 是由 `live_project_flyway` 执行的，而 PostgreSQL 默认把新对象 owner 记为执行 `CREATE` 的角色。

PostgreSQL 的默认行为意味着：

- 数据库 owner 是 `live_project_owner`
- 不代表新建表自动属于 `live_project_owner`

因此 migration 创建对象时必须 `SET ROLE live_project_owner`；共享 owner 契约会拒绝任何业务对象仍属于 `live_project_flyway` 的数据库，但明确排除并单独检查 `flyway_schema_history`。

### 6.3 `live_project_super_ro` 这个名字并不等于“只读”

虽然名字里带 `ro`，但当前它实际有：

- `SELECT`
- `INSERT`
- `UPDATE`

所以认证写入、session 管理、默认 admin upsert 都依赖它。

### 6.4 运行时写账号只获得定向 `DELETE`

初始化脚本的通用授权只有：

- `INSERT`
- `UPDATE`

没有全局授予：

- `DELETE`

V13/V14/V17 migration 仅为完整集合替换显式授予 `tour_bands`、`tour_lives`、`performance_group_lives` 和 `live_setlist` 的 `DELETE`。主实体 `tour_attrs`、`performance_group_attrs` 仍不可删除，也没有删除接口。后续新增删除型业务仍需逐表核对角色设计和权限 SQL。

## 7. 建议的阅读顺序

如果后续要继续梳理数据库权限，建议按这个顺序看：

1. [infra/postgres/.env.pg-migrate](/D:/Code/PythonCode/5%20LiveSetList/infra/postgres/.env.pg-migrate)
2. [backend/db/postgres/init/010-create-flyway-role.sh](/D:/Code/PythonCode/5%20LiveSetList/backend/db/postgres/init/010-create-flyway-role.sh)
3. [backend/app/db.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/db.py)
4. [backend/app/auth.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/auth.py)
5. [backend/app/routers/console_write.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/routers/console_write.py)
6. [backend/tests/integration/conftest.py](/D:/Code/PythonCode/5%20LiveSetList/backend/tests/integration/conftest.py)
7. [recovery/restore.py](/D:/Code/PythonCode/5%20LiveSetList/recovery/restore.py)

这样可以先看“配置了谁”，再看“授了什么权”，最后看“代码到底用谁”。
