# LiveSetList 文档索引

本文档是 `docs/` 的入口。当前代码、FastAPI schema、Flyway SQL 和部署现场记录始终优先于历史设计文档。

## 当前契约与状态

- [API 补充规则](api.md)：接口用途、排序、筛选、归一化和错误行为；字段结构以 OpenAPI 为准。
- [数据库角色](db-roles.md)：运行时、迁移、测试和恢复所用 PostgreSQL 角色。
- [产品需求与 TODO](product/homepage-community-database.md)：当前产品阶段、已完成能力和下一轮优先项。
- [公共 Live 与收藏 Live 统计需求](product/public-statistics.md)：当前 S1 口径、全部 / 收藏通用统计、按乐队划分的年度歌曲排行、久未演唱和后续歌曲生命周期方向。
- [巡演聚合产品需求](product/tour-aggregation.md)：巡演与单场 Live 的产品边界、用户页面、资料口径、阶段范围和验收标准。
- [Flyway 落地说明](design/flyway.md)：仓库 migration、角色和日常迁移流程；当前仓库已到 V23。
- [生产部署设计](design/production-deployment.md)：目标架构、安全边界和未完成的运维项。
- [生产部署实录](production-deployment-runbook.md)：已执行步骤、发布流程、验收和排障；生产状态以此处的已确认记录为准。

## 当前设计

- [全站 Stage Ledger 视觉重构方案](design/site-wide-stage-ledger-ui-refactor.md)：以演出流程和新首页首屏为双参考，定义全站视觉系统、组件库边界、页面迁移批次与视觉回归门禁。
- [首页 Live 日历改造设计](design/home-live-calendar.md)：以按月日期导航替换语义不准确的“最近收录”，并从首屏移除“个人与贡献”。
- [巡演聚合实现设计](design/tour-aggregation.md)
- [演出活动组聚合实现设计](design/performance-group-aggregation.md)：统一支持多日 Live、单日午场 / 晚场、演出资料列表聚合和完整收藏聚合。
- [乐队改名与历史阵容实现设计](design/band-name-and-lineup-history.md)：同一 Band 身份下的历史名称、不可变阵容版本、同场交接共演、逐曲出演和控制台适配。
- [Live 状态与日期阶段实现设计](archive/completed-design/live-status.md)：人工状态、按 Live 时区计算的日期阶段、正式改期历史与资料修正边界。
- [公共端 UI 精修](design/public-ui-refresh.md)
- [E2E 测试设计](design/e2e.md)

## 开发与运维

- [开发、检查与发布脚本](../scripts/README.md)
- [数据库操作](../backend/db/README.md)
- [数据库备份恢复](../recovery/README.md)
- [生产服务器模板](../infra/production/README.md)
- [前端全局样式覆盖缺口](fails/frontend-global-style-coverage-gap.md)
- [React 列表 key 碰撞复盘](fails/react-list-key-collision.md)
- [Flyway 踩坑指南](fails/flyway-pitfalls.md)

## 复盘与归档

- `fails/`：已发生问题、原因、规避方式和仍需补齐的看护能力。
- [归档索引](archive/README.md)：已完成需求、设计和视觉走查的统一入口。
- [已完成需求](archive/completed-product/)：已验收并退出活动路线图的需求历史。
- [已完成设计与走查](archive/completed-design/)：已落地方案、阶段设计和视觉验收历史；只用于理解背景，不作为当前 API、UI 或部署状态的唯一依据。

## 维护规则

1. API 字段变化先更新后端 schema / route，再导出或检查 OpenAPI，最后更新 `api.md` 的补充规则。
2. 数据库结构变化只新增 Flyway migration，并同步 `design/flyway.md`、相关 README 和部署记录。
3. 用户可见导航、页签或标题变化，要同步根 README、产品需求、UI 设计和 E2E 用例名称。
4. 生产状态必须区分“仓库已具备”“tag 已创建”“Actions 已通过”“VM 已验收”，不能互相替代。
5. 仅修改 Markdown 时运行 `git diff --check` 并检查本地链接；业务代码变化按仓库规则运行 `python scripts/run_checks.py functional`。
