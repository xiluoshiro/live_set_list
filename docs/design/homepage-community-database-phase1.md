# 社区 Live 数据库首页阶段 1 开发设计

## 对应需求

需求文档：[docs/product/homepage-community-database.md](D:/Code/PythonCode/5%20LiveSetList/docs/product/homepage-community-database.md)

本文只描述阶段 1“首页壳与信息架构”的开发设计和实现边界。产品定位、用户视角、阶段路线和 TODO 仍由需求文档维护。

## 实现后状态

阶段 1 已落地，且后续已经继续推进到公共搜索、乐队浏览和全宽应用框架：

- `TabKey` 当前为 `"home" | "favorites" | "all" | "console" | "search" | "browse" | "about"`。
- 默认视图为 `"home"`。
- 首页搜索已不再是阶段 1 设计里的“搜索壳”，而是接入 `GET /api/catalog/search` 的真实公共搜索入口。
- 乐队浏览已接入 `GET /api/catalog/bands` 和 `GET /api/catalog/bands/{band_id}/lives`。
- 顶部导航已从居中卡片内导航调整为全宽置顶条，并提供右侧侧边栏菜单。
- 页面外层已取消居中框，首页、资料库、控制台等主内容直接占满视口宽度。
- 样式入口已统一到 `frontend/src/styles/index.css`，旧的 `frontend/src/styles.css` 已移除。

因此，本文后续章节保留为阶段 1 的设计背景和回归参考；当前实现状态与剩余 TODO 以 [docs/product/homepage-community-database.md](D:/Code/PythonCode/5%20LiveSetList/docs/product/homepage-community-database.md) 为准。

## 当前实现背景

当前前端入口集中在 `frontend/src/App.tsx`：

- 阶段 1 实施前，`TabKey` 为 `"favorites" | "all" | "console"`。
- 阶段 1 实施前，默认 tab 是 `"all"`。
- 列表加载、收藏页会话对账、详情预读、批量收藏和控制台权限都依赖 `tab` 状态。
- Live 详情弹窗通过 `activeRow` 和 `getLiveDetail()` 维护。
- `editor+` 控制台通过 `canUseConsoleFeatures` 做 UI 入口和状态兜底。

阶段 1 的核心原则：新增首页视图，但不破坏现有列表、收藏、详情和控制台状态机。

## 最终开发边界

阶段 1 只改前端首页结构和必要测试，不新增后端接口、不改数据库、不调整认证和收藏 API。

必须保持：

- `GET /api/lives` 的现有调用方式。
- `GET /api/lives/{live_id}` 的详情弹窗行为。
- `GET /api/me/favorites/lives` 的收藏页加载行为。
- 登录弹窗、登录态恢复、退出登录。
- 收藏、取消收藏、批量收藏。
- `editor+` 控制台入口和权限兜底。

允许调整：

- `TabKey` 增加 `"home"`。
- 默认 tab 从 `"all"` 改为 `"home"`。
- 新增首页组件和样式文件。
- 新增首页专用的最近 Live 数据状态。
- 更新前端测试以覆盖默认首页和入口跳转。

不允许在阶段 1 做：

- 新增搜索 API。
- 把搜索框做成真实跨实体搜索。
- 新增统计 API。
- 新增关注、推荐、审核、最近编辑流。
- 修改后端 schema、迁移或 DB seed。
- 重写控制台录入面板。

## 推荐文件拆分

优先把首页视图拆出 `App.tsx`，避免主文件继续膨胀。

建议新增：

- `frontend/src/components/HomeDashboard.tsx`
- `frontend/src/styles/home-dashboard.css`
- `frontend/src/components/__tests__/HomeDashboard.test.tsx`，仅在组件逻辑足够独立时新增

建议修改：

- `frontend/src/App.tsx`
- `frontend/src/styles/index.css`
- `frontend/src/__tests__/App.test.tsx`
- 可能涉及收藏或权限行为时，同步检查 `frontend/src/__tests__/App.favorite-optimistic-sync.test.tsx`

如果首页组件只负责展示，测试可以优先放在 `App.test.tsx` 中覆盖完整行为，不强制新增组件测试文件。

## 状态设计

新增 tab：

```ts
type TabKey = "home" | "favorites" | "all" | "console";
type ListTabKey = "favorites" | "all";
```

现有列表快照 key 应只接受 `ListTabKey`，避免首页误用列表缓存：

```ts
function buildListSnapshotKey(tab: ListTabKey, page: number, pageSize: 15 | 20): string;
```

列表加载开关应从“不是 console 就加载”改成“只有列表 tab 才加载”：

```ts
const listEnabled = (tab === "all" || tab === "favorites") && !auth.isLoading;
```

首页最近 Live 使用独立状态，避免污染 `items/page/serverTotal`：

- `homeRecentRows`
- `homeLiveTotal`
- `homeLoading`
- `homeError`

首页最近 Live 只请求第一页：

```ts
getLives(1, 15)
```

如果后续发现第一页排序不是“最新”，阶段 1 不在前端修正排序口径，应留到阶段 2 或后端接口设计处理。

## 交互设计

默认进入：

- 应用加载完成后默认停留在首页。
- 登录成功后仍建议回到首页，而不是强制跳到全部内容；除非登录是由收藏或受限入口触发。
- 退出登录后保留在首页或回到首页，避免落在受限视图。

导航：

- 首页
- 全部内容
- 我的收藏，仅登录后展示或点击后触发登录，两种都可接受；为了沿用现有逻辑，阶段 1 可继续仅登录后展示。
- 控制台，仅 `editor+` 展示。

首页动作：

- “查看全部 Live”切到 `"all"`，并把页码设为 1。
- 最近 Live 标题点击复用 `setActiveRow(row)` 打开现有详情弹窗。
- 未登录 CTA 点击打开现有 `LoginDialog`。
- 登录用户“查看我的收藏”切到 `"favorites"`。
- `editor+` 用户“进入控制台”切到 `"console"`。

搜索入口：

- 第一阶段只做 UI 壳。
- 输入框可以禁用提交，或提交后提示“搜索功能后续补充”。
- 不应出现“支持全局搜索”的完成态文案。

## 视觉与布局边界

首页应像数据库入口，不做营销页。

建议结构：

1. 顶部公共 header：保留登录 / 用户菜单 / 主题切换。
2. 首页引导区：站点名称、数据库定位说明、搜索壳。
3. 概览区：Live 总数 + 后续统计占位或低调说明。
4. 最近 Live：紧凑列表，展示日期、Live 名称、乐队图标。
5. 个人 / 贡献入口：按登录态和角色显示收藏入口、登录入口、控制台入口。

样式要求：

- 不使用大幅营销 hero。
- 不使用无法承载真实数据的装饰性卡片堆叠。
- 保持当前表格工具的可读性和信息密度。
- 移动端不能让搜索区、概览区和最近 Live 互相挤压。
- 样式限定在 `.home-dashboard` 命名空间下，不改全局 reset。

## 数据流

首页加载：

1. `auth` 仍由现有 `AuthProvider` 恢复。
2. 首页独立调用 `getLives(1, 15)`。
3. 用响应中的 `pagination.total` 作为 Live 总数。
4. 用响应中的 `items` 渲染最近 Live。
5. 最近 Live 点击后沿用现有详情加载逻辑。

列表加载：

1. 只有 `tab === "all"` 或 `tab === "favorites"` 时触发。
2. 全部内容继续调用 `getLives(page, pageSize)`。
3. 我的收藏继续调用 `getMyFavoriteLives(page, pageSize)`。
4. 现有页快照和收藏缓存逻辑继续保留。

控制台：

1. 只有 `tab === "console"` 且 `canUseConsoleFeatures` 时渲染。
2. 写入成功后继续调用 `handleConsoleLiveDataChanged()`。
3. 如首页最近 Live 已加载，控制台写入后也应清理或刷新首页最近 Live，避免首页摘要陈旧。

## 测试方案

阶段 1 修改 `frontend/src/**` 后，必须补充或更新前端测试，并最终运行：

```powershell
python scripts/run_checks.py functional
```

推荐测试点：

- 默认渲染首页，而不是全部内容表格。
- 首页展示数据库定位说明。
- 首页展示最近 Live 和 Live 总数。
- 点击最近 Live 能打开详情弹窗。
- 点击“查看全部 Live”进入全部内容并保留分页列表行为。
- 未登录时不展示我的收藏 tab，或点击收藏入口会打开登录弹窗。
- 登录后能看到我的收藏入口，并可进入收藏页。
- editor 用户能看到控制台入口并进入控制台。
- viewer 或匿名用户不能进入控制台。
- 首页搜索壳不会触发不存在的后端请求。

测试文件如果新增或修改，应按项目约定在测试附近保留简短 test point 注释，说明该用例守护的行为或回归点。

## 开发顺序

1. 拆分类型和状态边界
   - 增加 `"home"`。
   - 引入 `ListTabKey`。
   - 修正 `listEnabled` 和列表快照 key 类型。

2. 新增首页数据状态
   - 增加首页最近 Live 加载 effect。
   - 首页数据与列表分页状态分离。
   - 首页错误、空数据、加载态独立处理。

3. 新增首页组件
   - 把首页展示与动作回调封装到 `HomeDashboard`。
   - 通过 props 传入最近 Live、总数、登录态、权限态和动作回调。

4. 调整渲染分支
   - `home` 渲染首页。
   - `all/favorites` 渲染现有表格。
   - `console` 渲染现有控制台。

5. 调整导航和登录后行为
   - 默认 tab 改为 `home`。
   - 登录成功后回到 `home`，除非该登录由受限动作触发。
   - 受限 tab 的权限兜底保持有效。

6. 更新测试
   - 先更新默认首页断言。
   - 再补首页入口、详情、权限相关回归。

7. 运行验证
   - 从仓库根目录运行 `python scripts/run_checks.py functional`。
   - 若失败，按失败范围修正，不用单项测试替代最终验证。

## 风险与规避

- 风险：新增 `home` 后，现有 `buildListSnapshotKey`、列表加载和详情预读误把首页当列表页。
  - 规避：引入 `ListTabKey`，所有列表相关函数只接受 `"all" | "favorites"`。
- 风险：首页复用 `items` 导致分页列表和最近 Live 互相覆盖。
  - 规避：首页使用独立 `homeRecentRows`。
- 风险：登录成功后总是跳到全部内容，首页默认入口被绕过。
  - 规避：普通登录成功回首页；由收藏或控制台触发的登录可再按具体动作处理。
- 风险：搜索壳让用户以为搜索已可用。
  - 规避：文案明确为“搜索能力建设中”或只提供不可提交的输入 UI。
- 风险：首页引入新的全局样式影响表格和控制台。
  - 规避：样式限定在 `.home-dashboard` 命名空间下，不改全局 reset。
