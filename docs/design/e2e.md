# E2E 测试选型与设计思路

本文档用于记录当前项目引入端到端测试的推荐方向。它不描述已经落地的实现，而是给后续实现提供框架选型、环境隔离、用例选择和接入方式。

当前结论：

- 推荐使用 Playwright 作为 E2E 框架。
- E2E 应放在仓库根目录下，作为全栈测试，而不是前端单元测试的一部分。
- E2E 不应复用手工联调用的 `live_statistic_test`，应使用独立的 E2E 数据库。
- 第一批 E2E 只覆盖跨层状态一致性链路，不追求大面积 UI 覆盖。
- 初期应新增独立检查目标，例如 `python scripts/run_checks.py e2e`，暂不默认塞进 `functional`。

## 1. 为什么需要 E2E

当前测试分层已经覆盖了大量局部逻辑：

- 后端 unit 测路由逻辑、异常映射和 SQL 调用行为。
- 后端 integration 测真实 PostgreSQL 下的接口行为。
- 前端 Vitest + Testing Library 测组件状态、API 包装、缓存和交互逻辑。

但这些测试仍然难以提前发现“前端缓存 + 后端列表 SQL + 控制台本地状态 + 页签切换”组合出来的问题。

例如“新增 Live 后切换页面再回到新增 Setlist，该 Live 消失”这类问题，真实链路包含：

1. 浏览器先进入演出资料页，形成列表缓存或页面快照。
2. 用户进入控制台新增 Live。
3. 后端写入 `live_attrs`，但可能还没有 `live_setlist`。
4. 前端控制台本地候选列表临时插入新 Live。
5. 用户切回演出资料页，再切回新增 Setlist。
6. 页面重新读取列表或命中旧缓存，新 Live 可能被旧数据覆盖。

这不是单个函数的行为，而是全栈状态流转问题。E2E 的价值正在这里：用真实浏览器跑用户路径，观察最终页面是否符合业务预期。

### 1.1 已修复的 CSRF 竞态根因

控制台“批量插入歌曲”曾出现确认提交后插入失败，后端 access log 显示 `POST /api/console/songs:batch` 返回 403，而同一时刻只读歌曲查询仍为 200。根因不是批量插入 payload 字段错误，也不是数据库写入失败，而是 `/api/auth/me` 曾经会覆盖 session 唯一的 `csrf_token_hash`。同一页面内的请求去重只能处理 React StrictMode 或并发恢复，无法覆盖共享 cookie 的多个标签页；后打开的标签页会使原控制台持有的 token 变旧。

当前后端会保留同一 session 已签发的全部 CSRF token hash，直到 session 过期或注销；`/api/auth/me` 签发新 token 时不再废掉其他标签页的 token。E2E 回归应使用两个标签页共享同一 session：标签页 A 进入控制台，标签页 B 恢复登录态后，标签页 A 继续执行“批量插入歌曲 -> 确认提交”，并断言写接口成功。

## 2. 框架选型

推荐 Playwright。

### 2.1 Playwright

优势：

- 与 Vite + React 项目配合自然。
- 能覆盖真实浏览器行为，包括 cookie、session、表单、下拉、页签切换和网络请求。
- 支持在测试前启动多个 web server，适合前后端分离项目。
- 支持 Windows 本地运行。
- 调试能力较好，失败时可保留 trace、截图、video。
- 对多浏览器支持完整，后续可以扩展到 Chromium、Firefox、WebKit。

适用范围：

- 关键业务链路。
- 跨前后端状态一致性。
- 登录、权限、CSRF、缓存失效、页面跳转。
- 少量高价值回归场景。

### 2.2 Cypress

Cypress 也能完成大部分浏览器测试，但当前项目更适合 Playwright：

- Playwright 对多进程服务启动和跨浏览器支持更直接。
- Playwright 的 trace 与 CI 工件保存更适合定位全栈失败。
- Playwright 对前后端分离、本地多服务启动的配置更轻。

### 2.3 Vitest Browser Mode

Vitest Browser Mode 更像“浏览器里的组件测试”。它适合补强前端真实 DOM 和 CSS 行为，但不是本项目 E2E 首选：

- 它不天然负责后端服务、数据库 seed、登录态、全链路生命周期。
- 它更适合替代或补充 jsdom，不适合做完整业务流程验收。

### 2.4 Selenium

不推荐作为首选。它能力足够，但配置和调试成本更高，对本项目没有明显收益。

## 3. 目录与脚本结构

推荐新增根目录级 E2E 目录：

```text
e2e/
  playwright.config.ts
  tests/
    console-live-create.spec.ts
  fixtures/
    auth.ts
    db.ts
```

推荐新增脚本入口：

```text
scripts/
  run_e2e.py
```

分工建议：

- `e2e/playwright.config.ts`：Playwright 自身配置、baseURL、trace/screenshot/video 策略。
- `e2e/tests/**`：测试用例。
- `e2e/fixtures/**`：登录、页面导航、测试数据辅助函数。
- `scripts/run_e2e.py`：准备数据库、启动后端、启动前端、运行 Playwright、清理环境。

不建议把所有环境准备逻辑塞进 `playwright.config.ts`。数据库准备、Flyway、seed、服务进程管理更适合放在 Python 脚本里，和当前项目脚本体系保持一致。

## 4. 数据库隔离策略

E2E 不应使用手工联调用的 `live_statistic_test`。

原因：

- 手工联调和自动测试共享数据库，会互相污染状态。
- E2E 会创建 session、audit、收藏、控制台写入数据，结束后必须清理。
- 如果测试失败中断，共享测试库会留下半成品状态。

推荐使用独立数据库：

```text
live_statistic_e2e
```

初期可以使用固定 E2E 库，每次运行前重建：

1. 确保 PostgreSQL Docker 容器运行。
2. drop/create `live_statistic_e2e`。
3. 对 `live_statistic_e2e` 执行 Flyway migrate。
4. 导入 `backend/db/postgres/seed/base_seed.sql`。
5. 按 `infra/auth/.env.auth` bootstrap 默认 admin。
6. 启动后端时注入 `DB_NAME=live_statistic_e2e`。
7. 测试结束后 drop 或再次导入 seed。

后续如果需要并发 E2E，可升级为临时库：

```text
live_statistic_e2e_<pid>
```

临时库隔离最好，但实现更复杂。第一阶段使用固定 E2E 库即可。

## 5. 服务启动策略

E2E 需要三个运行对象：

- PostgreSQL Docker 容器。
- 后端 FastAPI，连接 E2E DB。
- 前端 Vite dev server。

推荐由 `scripts/run_e2e.py` 统一编排：

1. 检查 Docker 容器是否存在并运行。
2. 准备 E2E DB。
3. 启动后端：

```powershell
DB_NAME=live_statistic_e2e
python -m uvicorn app.main:app --port 8000
```

4. 启动前端：

```powershell
npm run dev
```

5. 等待 `/api/health/db` 和前端地址可访问。
6. 执行：

```powershell
npx playwright test
```

7. 关闭前后端进程。
8. 清理或还原 E2E DB。

端口建议初期沿用：

- 后端：`http://localhost:8000`
- 前端：`http://localhost:5173`

如果担心和开发服务冲突，可以改为 E2E 专用端口，例如后端 `18000`、前端 `15173`。当前前端 API base URL 已支持 `VITE_API_BASE_URL` 覆盖，也可以通过 Vite dev proxy 继续沿用同源 `/api`。

## 6. 用例选择原则

E2E 用例应少而关键，不应复制所有 unit/integration 覆盖面。

优先选择以下类型：

- 跨前后端状态流转。
- 依赖真实登录、cookie、CSRF 的路径。
- 前端缓存和后端写入共同影响结果的路径。
- 用户切页、刷新、重新进入后仍应保持一致的路径。
- 曾经出现过真实回归的问题。

暂不优先做：

- 单个输入框校验。
- 纯展示样式。
- 后端异常映射。
- 已经由 unit/integration 稳定覆盖的 SQL 细节。
- 大量列表分页排列组合。

## 7. 第一批推荐用例

### 7.1 控制台新增 Live 后跨页签仍可见

这是第一优先级用例。

目标：看护“新增 Live 写入成功，但列表缓存/SQL 过滤/页签切换导致页面消失”的完整链路。

步骤：

1. 登录默认 admin。
2. 进入“演出资料”，记录当前总数。
3. 切到“控制台”。
4. 进入“新增Live”。
5. 选择 seed 中已有 venue。
6. 在“默认 Band”浮动多选下拉中选择一个 seed 乐队。
7. 填写唯一标题，例如 `E2E Live <timestamp>`。
8. 点击“提交插入”。
9. 断言出现“已新增Live #...”，并取得 live_id。
10. 切到“新增Setlist”。
11. 断言 live 下拉候选包含新 live。
12. 断言 live 候选总数比初始总数多 1。
13. 切到“演出资料”。
14. 断言新 live 出现在列表里，且尚无 setlist 时显示所选默认 Band 图标。
15. 再切回“控制台 -> 新增Setlist”。
16. 断言新 live 仍在候选里。

可提前发现的问题：

- 后端 `/api/lives` 使用 inner join 过滤无 setlist 的 live。
- `createConsoleLive` 成功后没有清理 `getLives` 缓存。
- App 页快照未失效。
- 控制台本地 `livePagination.total` 未更新。
- 页签切换后服务端旧数据覆盖本地新数据。
- V12 `default_band_ids` 没有写入，或无 setlist Live 的列表回退失效。

### 7.2 新增 Live 后追加 Setlist，详情可见

目标：看护写入 Live 和追加 Setlist 两个控制台写接口的连续链路。

步骤：

1. 登录 admin。
2. 新增 Live。
3. 切到新增 Setlist。
4. 给该 live 追加一行 seed 中已有 song。
5. 点击“显示详细信息”。
6. 断言详情中出现追加的歌曲。
7. 切到演出资料，打开该 live 详情。
8. 断言详情仍能看到该 setlist。

可提前发现的问题：

- append setlist 后 detail cache 未失效。
- 控制台详情和主页详情口径不一致。
- CSRF/session 在连续写操作中失效。

### 7.3 权限边界

目标：看护控制台只对 `editor+` 可见。

步骤：

1. 以 viewer 登录。
2. 断言没有“控制台”页签。
3. 直接访问或尝试触发控制台写 API 时，断言失败。
4. 以 admin 登录。
5. 断言“控制台”页签可见。

这条可以第二阶段再做，因为前后端已有较多权限测试，E2E 只需要覆盖关键 happy path 和一个边界即可。

### 7.4 收藏跨页签一致性

目标：看护乐观收藏、服务端收藏列表、演出资料星标状态的一致性。

步骤：

1. 登录 admin。
2. 在演出资料收藏一个 live。
3. 在演出资料把范围切换为“仅收藏”。
4. 断言该 live 出现。
5. 把范围切回“全部”。
6. 断言星标仍为收藏状态。

这条优先级低于控制台写链路，因为当前收藏已有较完整的前端和后端测试。

### 7.5 活动组在全部与收藏范围中的投影一致性

目标：看护聚合必须发生在服务端完整候选集上，不能退化为前端当前页临时合并。

步骤：

1. 以包含多日或午场 / 晚场 fixture 的测试库启动应用。
2. 进入“演出资料”，断言活动组只显示一张聚合卡片，组内 Live 不再作为同级卡片重复出现。
3. 使用只命中部分子 Live 的关键词或组合筛选，断言活动组拆为实际命中的普通 Live；清除筛选后重新聚合。
4. 直接搜索活动组名称，断言仍显示完整活动组项。
5. 打开活动组，断言“演出资料”在桌面导航和移动抽屉中保持选中。
6. 断言公演入口按日期、开演时间、Live ID 排序，只显示短标题；切换后仍能看到选中 Live 自身的日期、时间和 setlist。
7. 若选中 Live 属于巡演，断言可从组内详情进入巡演资料。
8. 收藏组内全部 Live 后切换“仅收藏”，断言显示一个活动组项。
9. 取消其中一场收藏并重新进入“仅收藏”，断言活动组退化为仍收藏的单场 Live，组名搜索也不带出未收藏场次。

可提前发现的问题：

- 聚合只处理当前分页，导致同组 Live 分散或重复。
- 收藏变化后统一演出投影未失效。
- 活动组详情错误地清除“演出资料”导航高亮。
- 场次使用字符串时间或本地数组顺序排序，午场 / 晚场颠倒。

### 7.6 巡演列表、详情与反向入口

目标：看护巡演资料与单场 Live / 活动组之间的双向导航，以及列表和详情的统一视觉顺序。

步骤：

1. 进入“巡演资料”，断言筛选框之后依次出现总计 / 分页和详情卡片。
2. 打开巡演，断言“已收录日期”“场次详情 / 巡演统计”和公演短标题导航按稳定顺序出现。
3. 切换公演，断言页内渲染对应 Live 详情，不跳回“演出资料”。
4. 打开“巡演统计”，断言显式指定乐队的巡演只展示该乐队 Setlist 产生的统计。
5. 从普通 Live 或活动组内 Live 的巡演入口进入详情，再使用浏览器返回，断言原筛选、分页、选中 Live 和导航域恢复。

公共搜索的巡演实体分组当前尚未实现，因此不应把“搜索返回巡演”写成现有 E2E 通过条件；待接口和 UI 落地时再补充该用例。

## 8. 断言策略

E2E 断言应优先使用用户可见结果：

- 页签是否可见。
- 表格是否包含指定 live title。
- 下拉是否包含指定 live id/title。
- toast 或提示文案是否出现。
- 分页总数是否变化。
- 独立详情视图是否包含指定歌曲。

尽量少直接查数据库。数据库查询可以用于测试前准备或测试后清理，但用例主体应通过 UI 观察结果。否则 E2E 会退化成“浏览器启动版 integration”。

必要时可以通过 API 辅助：

- 登录前清空 session。
- 测试结束时清理特定前缀数据。
- 读取当前 seed 状态。

但第一批用例建议全程走 UI，确保真实用户路径被覆盖。

## 9. 测试数据命名

E2E 新增数据应使用唯一且可识别的标题：

```text
E2E Live 20260531-001122
```

原则：

- 使用 `E2E` 前缀，方便排查。
- 包含时间戳或随机短 id，避免重复运行冲突。
- 不依赖固定自增 id。
- 断言时优先用标题查找，再读取页面上的 id。

不要写死“下一个 live_id 是 42”这类断言。seed 增减会改变 sequence，写死 id 会让测试脆弱。

## 10. 接入 run_checks 的建议

建议新增检查目标：

```powershell
python scripts/run_checks.py e2e
```

初期不要默认并入 `functional`：

- E2E 需要浏览器依赖。
- E2E 会启动服务，占用端口。
- E2E 比 unit/integration 更慢。
- E2E 失败时定位成本更高。

后续稳定后可以考虑：

- `functional` 仍保持快速检查。
- `full` 增加 E2E。
- 或新增 `full-with-e2e`，由用户手动触发。

推荐阶段：

1. 第一阶段：只提供 `scripts/run_e2e.py` 和 `run_checks.py e2e`。
2. 第二阶段：CI 或本地定期任务运行 E2E。
3. 第三阶段：E2E 稳定后再决定是否纳入 `full`。

## 11. 失败产物

Playwright 应开启失败产物，方便定位：

- trace：失败时保留。
- screenshot：失败时保留。
- video：可选，初期建议失败时保留。

产物目录建议：

```text
test-results/
playwright-report/
```

这些目录应加入 `.gitignore`。

## 12. 分阶段落地路线

第一阶段目标：证明 E2E 能稳定跑通一个核心链路。

- 引入 Playwright。
- 增加 `e2e/playwright.config.ts`。
- 增加 `scripts/run_e2e.py`。
- 准备独立 `live_statistic_e2e`。
- 实现“控制台新增 Live 后跨页签仍可见”一条用例。
- 增加 `run_checks.py e2e`。

第二阶段目标：覆盖控制台主要写链路。

- 增加“新增 Live 后追加 Setlist，详情可见”。
- 增加失败 trace 保存说明。
- 评估是否需要 E2E 专用端口。

第三阶段目标：稳定纳入工程流程。

- E2E 接入 CI 或本地一键检查。
- 根据运行时长决定是否加入 `full`。
- 保持 E2E 用例少量、高价值、可维护。

## 13. 当前推荐结论

当前项目最值得立刻补的 E2E 不是广泛 UI 覆盖，而是“控制台新增 Live 后跨页签仍可见”这一条。

它精准覆盖最近暴露的问题组合：

- 后端列表查询是否包含无 setlist 的 Live。
- 前端写入后是否清理列表缓存。
- App 层页快照是否失效。
- 控制台本地分页是否同步。
- 切页签后新数据是否仍可见。

这条用例一旦稳定，就能作为后续 E2E 基础设施是否可靠的试金石。
