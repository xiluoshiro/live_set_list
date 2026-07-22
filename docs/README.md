# LiveSetList 文档索引

本文档是 `docs/` 的入口。当前代码、FastAPI schema、Flyway SQL 和部署现场记录始终优先于历史设计文档。

## 当前契约与状态

- [API 补充规则](api.md)：接口用途、排序、筛选、归一化和错误行为；字段结构以 OpenAPI 为准。
- [数据库角色](db-roles.md)：运行时、迁移、测试和恢复所用 PostgreSQL 角色。
- [产品需求与 TODO](product/homepage-community-database.md)：当前产品阶段、已完成能力和下一轮优先项。
- [公共 Live 与收藏 Live 统计需求](product/public-statistics.md)：当前 S1 口径、全部 / 收藏通用统计、按乐队划分的年度歌曲排行、久未演唱和后续歌曲生命周期方向。
- [巡演聚合产品需求](product/tour-aggregation.md)：巡演与单场 Live 的产品边界、用户页面、资料口径、阶段范围和验收标准。
- [活动出演成员需求](product/event-attendees.md)：活动类型的默认 Band、具体出演成员与详情展示规则。
- [Live 更新需求](product/live-update.md)：控制台编辑既有 Live 基础资料、确认差异与关系保持规则。
- [Flyway 落地说明](design/flyway.md)：仓库 migration、角色和日常迁移流程；当前仓库已到 V15。
- [生产部署设计](design/production-deployment.md)：目标架构、安全边界和未完成的运维项。
- [生产部署实录](production-deployment-runbook.md)：已执行步骤、发布流程、验收和排障；生产状态以此处的已确认记录为准。

## 当前设计

- [公共统计 S1 实现设计](design/public-statistics-s1.md)
- [巡演聚合实现设计](design/tour-aggregation.md)
- [演出活动组聚合实现设计](design/performance-group-aggregation.md)：统一支持多日 Live、单日午场 / 晚场、演出资料列表聚合和完整收藏聚合。
- [活动出演成员实现设计](design/event-attendees.md)：活动专用成员数据、计算 mode、控制台选择与详情内联 SVG 展示。
- [Live 更新实现设计](design/live-update.md)：控制台候选、完整更新接口、共用表单与审计规则。
- [公共端 UI 精修](design/public-ui-refresh.md)
- [E2E 测试设计](design/e2e.md)
- [首页阶段 1 开发设计](design/homepage-community-database-phase1.md)：历史阶段设计，当前状态以产品需求文档为准。

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
- `archive/completed-design/`：已完成方案的设计与实施历史；只用于理解背景，不作为当前 API、UI 或部署状态的唯一依据。

## 维护规则

1. API 字段变化先更新后端 schema / route，再导出或检查 OpenAPI，最后更新 `api.md` 的补充规则。
2. 数据库结构变化只新增 Flyway migration，并同步 `design/flyway.md`、相关 README 和部署记录。
3. 用户可见导航、页签或标题变化，要同步根 README、产品需求、UI 设计和 E2E 用例名称。
4. 生产状态必须区分“仓库已具备”“tag 已创建”“Actions 已通过”“VM 已验收”，不能互相替代。
5. 仅修改 Markdown 时运行 `git diff --check` 并检查本地链接；业务代码变化按仓库规则运行 `python scripts/run_checks.py functional`。
