# Venue 自身 IANA 时区回填（2026-09-18）

## 当前可执行文件

按顺序提交以下两个纯 SQL 文件。两者均自带 `BEGIN;` 和 `COMMIT;`，成功即提交，不需要修改末尾语句、传入 psql 变量或使用元命令。执行器须遇错停止；仓库远端执行器已设置 `ON_ERROR_STOP=1` 并在执行前备份。

1. [01：补齐 Venue 自身时区](../../backfill/2026-09-18-01__backfill_venue_own_timezones.sql)：只将 153 个已核对场地的空时区写为候选 IANA；相同值跳过，冲突值拒绝。不会改修订号、核验时间、Live 或名称历史。
2. [02：清理旧地理修订元数据](../../backfill/2026-09-18-02__correct_initial_geography_revisions.sql)：将上述实体场地及未公布场地 32 的旧位置数字恢复为兼容值 1，清空这些场地的 venue 来源 Live 的来源修订。若存在旧错误回填产生的修订 3，依据目标库自身的匹配审计恢复核验时间；修订 2 只清理旧数字，不改核验时间。

两份文件均可重复执行，已达到目标状态的行不更新、不重复写审计。01 已正确回填而 02 尚未完成时，可继续执行 02。

不再校验本地 Flyway 历史指纹、执行时间、执行账号或整表固定行数。目标场地按已核对 ID、实体类型及坐标确认；只保留实际冲突检查，并在同一事务内比较执行前后数据，保证没有越界修改。真实冲突或缺失必要的修订 3 审计仍会拒绝整笔事务；不改写 Flyway 历史。

[候选 CSV](venue-timezone-candidates-2026-09-18.csv) 是核对附件，SQL 已内嵌所需候选，不读取 CSV。原先的 old_revision/new_revision 列记录错误方案，已移除。

## 当前文件 SHA-256

- `2026-09-18-01__backfill_venue_own_timezones.sql`：`4682D617D8A773125D3D85C23B35245635F81746AA7FAB6C642B5E806878D063`
- `2026-09-18-02__correct_initial_geography_revisions.sql`：`010D4B20C09D6A774D1BFBF8214F0379CF6FB6F13CCFE59F6B42508C5B9CE804`

## 历史执行与当前验证边界

本地已完成 153 个实体场地 IANA 回填，并完成 154 个 Venue、578 条 Live 的伪修订纠正，详见 [纠正记录](venue-revision-correction-2026-09-18.md)。最早执行版本错误递增修订，随后由本地纠正恢复；当前 01 已直接遵守“不增修订”规则，不重演旧错误。

此前默认 ROLLBACK、使用 psql 提交变量、绑定本地整表指纹的说明全部作废。旧执行文件 SHA-256 `AB98108DAA930242310FCE7A7A397904D5FD6989E21CB7086AC77C0F3C1800D9` 仅用于历史追溯，不代表当前文件。

此次改版不连接或执行远端库，不重新写本地主库；可执行文件的实际提交、幂等和冲突回滚由 PostgreSQL 测试库集成测试验证。不能将测试库通过表述为远端已执行。

改版验证已通过：`test_venue_timezone_backfill_sql.py` 的 5 项 PostgreSQL 集成用例实际执行原 SQL，覆盖 COMMIT 生效、重复执行不重复写入、冲突整笔回滚以及本库修订 3 审计恢复；完整 `python scripts/run_checks.py functional` 退出码为 0。
