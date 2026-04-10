# Flyway 踩坑指南

本文档记录 2026-04-11 这轮 Flyway owner 收口问题的定位过程、根因结论和后续规避方式。

适用范围：

- [V3__align_public_object_owners.sql](/D:/Code/PythonCode/5%20LiveSetList/backend/db/flyway/sql/V3__align_public_object_owners.sql) 一类的“调整 owner / 权限 / schema 管理权”迁移
- 使用 `live_project_flyway` 执行 migration，并由 Flyway 自身维护 `public.flyway_schema_history` 的场景

## 1. 现象概览

这轮问题表面上看是：

- `flyway migrate` 长时间无输出，像是“卡死”
- `flyway info` 在异常状态下也会表现得很慢
- 超时后可能留下残留 `java` 进程，进一步干扰下一次排查

实际定位后确认：

- 不是 `public` 下对象太多导致遍历慢
- 不是 PostgreSQL 本身性能瓶颈
- 主因是 **Flyway 在执行迁移时，脚本试图修改 `flyway_schema_history` 的 owner / 权限，和 Flyway 自己持有的元数据锁发生冲突**

## 2. 按严重等级分类

### `P0` 严重阻塞：在 Flyway migration 中改 `flyway_schema_history` 的 owner 或权限

风险级别：

- 会直接导致迁移长时间阻塞
- 如果没有 `lock_timeout`，表现上接近“无限卡死”

本轮实际触发方式：

- 早期版本的 `V3` 使用了 `REASSIGN OWNED BY live_project_flyway TO live_project_owner`
- 该语句会把 `live_project_flyway` 拥有的对象一并纳入处理
- `public.flyway_schema_history` 正好也属于 Flyway 自己管理的对象

并发锁现场：

- Flyway 一个元数据会话持有 `flyway_schema_history` 的 `AccessShareLock`
- 迁移执行会话在 `REASSIGN OWNED` 中申请该表的 `AccessExclusiveLock`
- 后者被前者阻塞，迁移停住

本轮抓到的核心现场：

- `pid=1291`
  - `usename = live_project_flyway`
  - `state = idle in transaction`
  - 持有 `flyway_schema_history` 的 `AccessShareLock`
- `pid=1292`
  - `usename = live_project_flyway`
  - 执行 `REASSIGN OWNED BY live_project_flyway TO live_project_owner`
  - 等待 `flyway_schema_history` 的 `AccessExclusiveLock`
  - `blocking_pids = {1291}`

结论：

- **不要在 Flyway 自己执行的 migration 里改 `flyway_schema_history` 的 owner**
- **不要在 Flyway 自己执行的 migration 里对 `flyway_schema_history` 做额外 `GRANT`**
- **不要使用会隐式覆盖 `flyway_schema_history` 的 `REASSIGN OWNED BY live_project_flyway`**

### `P1` 高风险：以为 `SET ROLE live_project_owner` 后就能改所有业务对象 owner

风险级别：

- 迁移不会卡死，但会直接失败

本轮实际触发方式：

- 中间版本的 `V3` 先 `SET ROLE live_project_owner`
- 然后尝试 `ALTER TABLE ... OWNER TO live_project_owner`

失败原因：

- 当前 `public` 下多数对象实际 owner 是 `live_project_flyway`
- 在 PostgreSQL 中，能否 `ALTER ... OWNER` 取决于当前执行角色是否是对象 owner 或具备足够高权限
- 单纯 `SET ROLE live_project_owner`，并不会自动让当前会话拥有 `live_project_flyway` 创建对象的 owner 身份

实际报错表现：

- `ERROR: must be owner of table song_list`

结论：

- 如果对象当前由 `live_project_flyway` 创建并持有 owner，迁移时应由 `live_project_flyway` 自己把对象转给 `live_project_owner`
- `SET ROLE live_project_owner` 只适合处理它本来就有权限接手的库级 / schema 级动作，例如：
  - `ALTER SCHEMA public OWNER TO live_project_owner`

### `P1` 高风险：超时或中断后遗留 Flyway / Java 进程，导致后续判断失真

风险级别：

- 不一定是新的数据库问题
- 但会让后续 `info` / `migrate` 看起来仍然像“继续卡住”

本轮实际现象：

- 超时后存在残留 `java` 进程
- 在 kill 掉残留进程之前，很难判断是数据库锁还在，还是旧 Flyway 进程没有退出

结论：

- 每次迁移超时后，先检查并清理残留 `java` / Flyway 进程
- 再重新做一轮干净的 `flyway info` 或 `flyway migrate`

### `P2` 中风险：把“对象遍历很多”误判为根因

风险级别：

- 不会直接导致事故扩大
- 但会把排查方向带偏

本轮实际情况：

- `public` 下对象量很小
  - 10 张表
  - 7 个序列
  - 21 个索引
  - 0 个 routine
  - 0 个自定义 type

结论：

- 这类规模远不足以解释长时间卡死
- 如果 `migrate` 卡在 owner 调整语句上，应优先看锁，而不是先怀疑对象数量

### `P2` 中风险：只看 Flyway 输出，不看 PostgreSQL 锁现场

风险级别：

- 容易得到模糊结论，例如“可能是网络问题”或“可能是 Flyway bug”

本轮有效的定位手段：

- 并行开两个会话
- 会话 1：执行 `flyway migrate`
- 会话 2：采样
  - `pg_stat_activity`
  - `pg_locks`
  - `pg_blocking_pids(...)`

结论：

- 遇到“迁移卡住”时，数据库侧锁采样几乎是必须动作
- 光看 CLI 是否还在转圈，不足以判断根因

## 3. 根因回溯

本轮问题经历了三个关键判断阶段：

1. 初步怀疑 `REASSIGN OWNED BY` 遍历对象过多
2. 直接连接测试库查看 `pg_stat_activity` / `pg_locks`
3. 通过双会话并发采样确认锁冲突对象就是 `flyway_schema_history`

最终根因可以收敛成两条：

- **直接根因**：`REASSIGN OWNED BY live_project_flyway TO live_project_owner` 试图改动 `flyway_schema_history`，与 Flyway 自己的元数据锁冲突
- **次级根因**：迁移脚本最初把“Flyway 管理对象”和“业务对象”混在一起处理，没有把 `flyway_schema_history` 视为特殊对象

## 4. 最终修复方案

当前已经验证通过的安全修复方式如下：

1. 从 migration 中移除：
   - `REASSIGN OWNED BY live_project_flyway TO live_project_owner`
   - 针对 `flyway_schema_history` 的 `GRANT`
2. 显式排除 `flyway_schema_history`
3. 分两层处理：
   - `SET ROLE live_project_owner` 只处理 `public schema` owner
   - `RESET ROLE` 后，由 `live_project_flyway` 把自己拥有的业务对象逐个 `ALTER ... OWNER TO live_project_owner`

当前 [V3__align_public_object_owners.sql](/D:/Code/PythonCode/5%20LiveSetList/backend/db/flyway/sql/V3__align_public_object_owners.sql) 就是按这个思路收口的。

## 5. 安全写法建议

以后只要是 Flyway migration，涉及 owner / 权限调整，建议遵守下面几条：

1. 永远不要在 migration 中处理 `flyway_schema_history`
2. 不要对 `live_project_flyway` 做全量 `REASSIGN OWNED`
3. 只处理 `public` 下明确列举或明确过滤后的业务对象
4. `schema owner` 和 `object owner` 分开处理
5. 一旦迁移超过预期时间，立即用数据库视角看锁，不要只盯着 Flyway 命令行

## 6. 推荐排查流程

当以后再次出现“Flyway 卡住”时，推荐直接按这个顺序处理：

1. 查看是否有残留 `java` / Flyway 进程
2. 查询 `pg_stat_activity`
3. 查询 `pg_locks`
4. 对可疑 PID 使用 `pg_blocking_pids(...)`
5. 如果锁指向 `flyway_schema_history`
   - 优先检查 migration 是否碰到了 Flyway 元数据表
6. 修脚本时优先采用“显式排除 + 明确遍历业务对象”的方式

## 7. 一句话结论

这次问题最核心的教训是：

- **Flyway 自己管理的 `flyway_schema_history` 不能和业务表一起做 owner / 权限收口**
- **一旦把它纳入 `REASSIGN OWNED` 或额外 `GRANT`，就很容易和 Flyway 自己的元数据锁打架，表现成迁移卡死**
