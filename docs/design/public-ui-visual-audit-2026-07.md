# 公共端视觉走查报告（2026-07）

## 1. 文档定位

本文是基于**真实浏览器渲染**的公共端视觉走查报告，配合 [公共端 UI 精修与易用性改造设计](public-ui-refresh.md)（下称"精修设计"）使用：

- 精修设计是目标方案；本文记录 2026-07-24 以 `http://localhost:5173/` 为基线的实际渲染状态，以及 2026-07-25 完成修正后的复核结果。
- 本文的"修改范围"一节给出每个问题对应的文件清单，既是实施分解，也是最终变更索引。
- 第 4 节保留发现时的原始问题描述；F1–F20 已全部完成，当前状态与验证证据见 6.1。

## 2. 走查方法与覆盖范围

- 工具：真实浏览器会话，会话内完成视口切换、主题切换、页面导航、DOM/计算样式检查与截图。
- 视口：基线截图使用 1440×900；完成后按 1280×720、768×1024、390×844 三档重新验收。
- 主题：桌面浅色 / 深色均复核，平板与手机以浅色复核。
- 页面：首页、演出资料（卡片 + 表格视图）、巡演资料、数据统计、乐队浏览、联系我们、Live 详情（独立页）、移动端汉堡抽屉。
- 补充：对 `frontend/src/styles/` 全部 14 个 CSS 文件和关键组件做了静态走查；部分问题（如未定义的 CSS 变量）只能从代码确认，截图中标注为"静态确认"。
- 证据截图存档于 [assets/visual-audit-2026-07/](assets/visual-audit-2026-07/)。

## 3. 已验证的良好现状（保留，不改动）

以下经截图确认，是当前 UI 的成熟部分，后续精修应保留：

1. **主题系统**：CSS 变量双主题令牌完整，深色下粉色链接（`#ff6f9f`）对比度良好，顶栏、卡片、表格在深色下无破版。
2. **乐队浏览页的视觉语言**：乐队按钮使用各队代表色浅色背景 + 右侧 SVG 图案（[band-browse-good.png](assets/visual-audit-2026-07/band-browse-good.png)）。这是全站最有辨识度的设计，`frontend/public/icons/Band_*.svg` 是核心视觉资产，**任何图标统一工作不得涉及该目录**。
3. **数据统计页**：概览四卡数字层级清晰，年份分布条形图与数值对齐良好。
4. **移动端抽屉导航**：六项入口完整、当前页高亮（粉色左边条 + 浅粉底），可正常关闭（[mobile-drawer-good.png](assets/visual-audit-2026-07/mobile-drawer-good.png)）。
5. **演出资料筛选工具栏**：关键词 / 年份 / 类型 / 乐队 / 排序 + 全部 / 仅收藏范围切换，桌面与移动端布局均可用；移动端"筛选"折叠交互已落地。
6. **可访问名覆盖较好的部分**：主题切换（"当前跟随系统（夜间），单击锁定夜间模式"）、菜单（"打开页面菜单"）、导航（`主导航` landmark）均有明确可访问名。

## 4. 新发现问题清单（F1–F20 已于 2026-07-24/25 落地，详见 6.1；本节保留原始问题描述作为记录）

### P0 — 真实缺陷（含布局 bug）

| # | 问题 | 证据 | 位置 |
|---|------|------|------|
| F1 | **演出资料表格视图：多日活动日期溢出并与标题列文字重叠**。日期列固定 `width:110px; white-space:nowrap`，而多日范围（如 `2026-07-18 ~ 2026-07-19`）约 150px，固定布局下文本直接压到"Live 名称"列上 | [live-table-date-overlap.png](assets/visual-audit-2026-07/live-table-date-overlap.png) | `frontend/src/styles/live-table.css`（`.table-with-fav` / `.table-no-fav` 的第 1/2 列宽度规则） |
| F2 | `--danger-text` 被引用但从未定义，统计页错误状态不会显示红色，静默失效（静态确认） | — | `frontend/src/styles/statistics.css:25`，应改为已定义的 `var(--accent-danger)` |
| F3 | **移动端顶栏下方残留一条几像素高的横向导航条**，视觉上像脏污；且 `layout.css` 使用 `800px` 断点，与精修设计 6.1 规定的 `900/720/620` 断点体系不一致 | [mobile-home-metrics-stack.png](assets/visual-audit-2026-07/mobile-home-metrics-stack.png) 顶部 | `frontend/src/styles/layout.css:351`（`@media (max-width: 800px)` 未隐藏 `.tabs`）；精修设计 7.1 要求移动端隐藏横向主导航、统一走抽屉 |
| F4 | 分页"上一页"禁用态为淡粉底 + 白字，对比度不足，禁用状态几乎不可读（静态确认：`button:disabled` 仅降透明度，粉色底仍在） | — | `frontend/src/styles/layout.css:320`（`.pager button`）与 `base.css:21`（全局 `button:disabled` 规则） |

### P1 — 精修设计已规划但未落地（截图确认）

| # | 问题 | 精修设计对应条目 |
|---|------|------|
| F5 | 首页指标仍为 3 卡且 `350 / 90` 合并显示歌曲/场地；"最近更新"实际是最新 Live 日期，命名误导 | 3.2 / 7.2（应拆 4 卡并改名"最新 Live 日期"） |
| F6 | 移动端指标卡单列纵向堆叠，3 张高卡拉长首屏 | 3.1 / 7.2（手机应固定两列） |
| F7 | 首页首屏标题仍为站点名，未改为任务导向的"查找 Live、曲目与出演记录"；搜索按钮为灰色次要样式，不是首屏主操作 | 7.2 |
| F8 | 详情页元数据日期/开场/开演靠左、场地/类型甩到最右，分散两端；"返回"仍是危险色关闭式 `✕` | 3.1 / 3.4 / 7.6（应改为左箭头 + 返回语义、元数据响应式网格） |
| F9 | 浅色各页大面积粉色背景渐变，粉色同时承担背景、链接、按钮、选中态，主次偏弱 | 5.1（基础背景改中性浅灰蓝 `#f7f8fc`，粉色收敛为点缀） |
| F10 | 视图切换（卡片/表格）是 PageTitle 右侧的单个 30×28px 字符图标按钮（`▦` / `☷`），发现性差，移动端同样不明显 | 7.3 工具栏统一时可一并处理 |

### P1 — 一致性与可访问性（静态确认为主）

| # | 问题 | 位置 |
|---|------|------|
| F11 | 登录输入框 `:focus-visible` 光环是蓝色 `rgba(91,124,250,0.2)`，与全站粉色 accent 脱节；`.primary-btn:hover` 硬编码 `#d41558`，未走令牌 | `frontend/src/styles/auth.css:271-275`、`auth.css:45-47` |
| F12 | `.modal.login-modal` 同一组规则重复定义在两处 | `frontend/src/styles/detail-modal.css:25-34` 与 `auth.css:155-164` |
| F13 | 全局 `:focus-visible` 只覆盖少数控件（顶栏图标钮、回到顶部、范围切换、登录输入）；tab 按钮、表格行内按钮、星标、卡片、分页按钮均无可见焦点态 | `frontend/src/styles/*.css`；精修设计 6.3 已要求统一焦点环 |
| F14 | 卡片来源链接可访问名仅为 `🔗`，读屏用户无法理解指向 | `frontend/src/App.tsx`（卡片/表格行的 `url-icon-link`）；精修设计 3.5 已登记 |
| F15 | 头像色板 6 个硬编码蓝紫色与品牌粉无关联 | `frontend/src/App.tsx:181`（`USER_AVATAR_COLORS`） |

### P2 — 精修候选（方向性建议）

| # | 建议 | 说明 |
|---|------|------|
| F16 | Live 类型标签色彩化 | 专场 / 拼盘 / 音乐节 / 多日活动目前全是灰色小字；可借鉴乐队浏览的"数据驱动色彩"语言，用克制的底色 chip 区分类型，提高列表扫描效率 |
| F17 | 按钮与形状令牌收敛 | 按钮实现 6 套以上（`.primary-btn` / `.pager button` / `.home-search-row button` / `.catalog-pager button` / `.console-submit-btn` / `.console-ghost-btn` 等），圆角 4–14px 共 9 种；按精修设计 6.2 锁 12px 卡片 / 8px 控件 / 全圆角胶囊三档 |
| F18 | 加载与空态结构化 | 目前加载中是纯文本"加载中..."，空态是纯文本一句话；建议骨架屏（匹配最终布局）+ 结构化空态 |
| F19 | 克制的动效层 | 全站仅 1 个 keyframes；建议补 `:active` 按压反馈与视图切换淡入，并同步补 `@media (prefers-reduced-motion: reduce)` CSS 守卫（目前只有 JS 侧处理） |
| F20 | z-index 标尺 | 现值散布 1–10000（顶栏 20 / 抽屉 60 / 浮层 80-90 / toast 10000），建议收敛为 5 档令牌 |

### 范围声明（明确不做）

- `frontend/public/icons/Band_*.svg`（12 个乐队 SVG）是数据级视觉资产，不在任何"图标统一"范围内。
- 图标统一采用精修设计 5.4 既定的"本地 React SVG 组件"路线，**不引入第三方 UI 库或图标库**（本文撤回早期口头建议过的 Phosphor 方案，以精修设计为准）。
- 控制台只消费共享令牌，不参与结构重做（精修设计 13 非目标）。

## 5. 修改范围与文件映射

| 涉及文件 | 关联问题 | 改动性质 |
|----------|----------|----------|
| `frontend/src/styles/live-table.css` | F1、F10、F16、F17、F19 | CSS：列宽/溢出策略、分段视图切换、类型 chip、形状令牌、视图淡入 |
| `frontend/src/styles/statistics.css` | F2 | CSS：变量名修正（1 行） |
| `frontend/src/styles/layout.css` | F3、F4、F13、F20 | CSS：移动端隐藏 `.tabs`、断点对齐 900/720/620、禁用态、焦点环、z-index |
| `frontend/src/styles/auth.css` | F11、F12 | CSS：focus 环改 accent 系、hover 入令牌、删除重复块 |
| `frontend/src/styles/detail-modal.css` | F8、F12、F17、F20 | CSS：详情网格、删除重复块、形状与层级令牌 |
| `frontend/src/styles/theme.css` | F9、F11、F17、F20 | 令牌：中性背景、accent-hover、圆角/焦点/z-index 令牌 |
| `frontend/src/styles/base.css` | F4、F9、F13、F18、F19 | CSS：中性页面背景、全局 disabled/focus、内容状态、动效与低动效守卫 |
| `frontend/src/styles/home-dashboard.css` | F5、F6、F7 | CSS：指标 4 卡、移动两列、首屏主操作 |
| `frontend/src/styles/detail-page.css`、`detail-modal.css` | F8 | CSS：返回按钮样式、元数据网格 |
| `frontend/src/components/HomeDashboard.tsx` | F5、F7 | 结构：指标拆分、文案改名、搜索主按钮 |
| `frontend/src/components/LiveDetailContent.tsx` 等详情组件 | F8、F14 | 结构：返回语义、元数据、外链可访问名 |
| `frontend/src/App.tsx` | F10、F14、F15、F16、F18 | 结构：分段视图切换、类型徽章、结构化表格状态、外链 `aria-label`、头像色板 |
| `frontend/src/components/ContentState.tsx` | F18 | 新增：按 rows/cards/statistics/detail 匹配最终布局的骨架、空态与错误态 |
| `frontend/src/components/LiveTypeBadge.tsx` | F16 | 新增：Live 类型到克制色调的统一映射 |
| `frontend/src/components/ViewModeToggle.tsx` | F10 | 新增：明确展示"卡片 / 表格"及当前状态的分段控件 |
| `frontend/src/components/LiveCardGrid.tsx`、`TourCardGrid.tsx` | F13、F14、F16、F18 | 结构：卡片主入口改真实按钮，详情/收藏/来源操作分离 |
| `frontend/src/components/HomeDashboard.tsx`、`CatalogPanels.tsx`、`StatisticsPanel.tsx`、详情与巡演组件 | F18 | 结构：接入统一加载、空态、错误态 |
| `frontend/src/styles/catalog.css`、`home-dashboard.css`、`statistics.css`、`detail-page.css`、`tour-archive.css` | F17、F20 | CSS：公共端卡片/控件/胶囊形状与局部层级收敛 |

控制台专用样式 `console-admin.css` 不参与公共端结构和层级收敛；其 80–90/10000 层级仍按控制台自身语义保留。

## 6. 实施批次

1. **第一批（纯 CSS、低风险）**：F1、F2、F3、F4、F11、F12。均为局部样式修复，不触碰组件结构。
2. **第二批（令牌 + 首页/详情结构）**：F5–F9、F13–F15。与精修设计阶段 A 合并实施。
3. **第三批（精修增强）**：F10、F16–F20，并补足 F9/F13 的完整语义。

每批完成后按仓库约定执行：

```powershell
python scripts/run_checks.py functional
```

**注意**：Vitest/jsdom 无法发现 CSS 与视觉回归（见 [前端全局样式覆盖缺口](../fails/frontend-global-style-coverage-gap.md)）。每批样式改动必须在浏览器按第 2 节的视口矩阵人工复核：桌面浅/深色 + 390×844，至少覆盖首页、演出资料（两种视图）、详情、乐队浏览。

## 6.1 落地进度（截至 2026-07-25）

> 本节追踪第 4 节问题清单的落地情况；第 4 节保留原始问题描述作为记录。

### 第一批（纯 CSS、低风险）— ✅ 已落地（2026-07-24）

F1、F2、F3、F4、F11、F12 全部完成：

- **F1** `live-table.css` 日期列 `110px/nowrap` → `140px/normal`，多日范围在列内换行 2 行，不再压到标题列。
- **F2** `statistics.css` `var(--danger-text)`（未定义）→ `var(--accent-danger)`。
- **F3** `layout.css` 断点 `800px`→`720px`（对齐精修设计 6.1）；移动端 `.tabs { display:none }`，统一走抽屉。
- **F4** `layout.css` 新增 `.pager button:disabled`（中性 chip 底 + muted 字 + `opacity:1`），不动 `base.css` 全局 `button:disabled`。
- **F11** `theme.css` `:root` 新增 `--accent-primary-hover:#d41558`（两主题同值）；`auth.css` `.primary-btn:hover` 入令牌、登录输入框 focus 环 `rgba(91,124,250,0.2)`→`rgba(243,24,100,0.2)`。
- **F12** 删除 `auth.css` 重复的 `.modal.login-modal` 基础块，保留 `detail-modal.css` 版本（带注释，特异性已覆盖通用 `.modal`）。

### 第二批（令牌 + 首页/详情结构）— ✅ 已落地（2026-07-24/25）

F5、F6、F7、F8、F9、F10、F13、F14、F15 全部完成：

- **F5** `HomeDashboard.tsx` 3 卡→4 卡（Live/乐队/歌曲/场地，stats 已含 `band_count` 无需改 API）；`latest_live_date` 从"最近更新"卡改为概览下方独立"最新 Live 日期"行。
- **F6** `home-dashboard.css` `.home-metrics` 4 列；≤900px 与 ≤620px 固定 2 列。
- **F7** 首屏标题 `BanG Dream! Live 资料库`→`查找 Live、曲目与出演记录`（品牌名保留顶栏 `site-title`）；`.home-search-row button` 由灰次样式改主操作（粉底白字 + hover 用 `--accent-primary-hover`）。
- **F8** `LiveDetailPage`/`PerformanceGroupDetailPage`/`TourDetailPage` 三处返回按钮 `✕`→`←`、去危险色；`detail-modal.css` `.detail-meta-line` flex→响应式 grid（`auto-fit minmax(140px,1fr)`），去掉 `.detail-inline-item-venue` 的 `margin-left:auto` 分散。返回按钮最终样式见下方"复盘与微调"。
- **F9** 页面底色改为中性 `--bg-body:#f7f8fc`，品牌粉仅以低透明度径向光晕点缀；深色对应 `#121b2d` + 低透明度光晕。
- **F10** 单个字符图标按钮改为带 `role="group"` 的"卡片 / 表格"分段控件，两项同时可见，并以 `aria-pressed` 暴露当前状态。
- **F13** `base.css` 提供全局 accent 焦点环及 focus ring 令牌；Live/活动组/巡演卡片主入口由 `<article onClick>` 改为真实 `<button>`，详情、收藏和来源链接成为相互独立的键盘操作目标。
- **F14** `App.tsx` 表格行 `url-icon-link`、`LiveCardGrid`、`TourCardGrid` 三处 🔗 补 `aria-label="打开《{标题}》的资料来源"`。
- **F15** `App.tsx` `USER_AVATAR_COLORS` 6 个蓝紫色改品牌粉色系（`#f31864/#d41558/#ff6f9f` + 紫/绿/橙互补）。

### 复盘与微调（2026-07-25）

- **F8 返回按钮显眼度**：第二批初版将返回按钮改为中性灰，浏览器复核时反馈"太不显眼"。调整为**白底 + 粉色描边 + 粉色 `←` 箭头**（`detail-page.css` `.detail-back-btn`：`border/color: var(--accent-primary); background: var(--surface-1)`，hover 浅粉底）。比中性灰明显，但仍是"返回"语义——非危险色、非实心粉，避免与主按钮混淆。
- **查询卡片风格统一（新发现，不在原 F 清单）**：演出资料与巡演资料已共用 `.list-filter-panel`（白底 `--surface-1`、10px 圆角、16px padding），仅数据统计 `.statistics-controls` 风格不一致（原浅蓝底 `--surface-2`、8px、14px）。已将 `statistics.css` 的 `.statistics-controls`（background→`--surface-1`、border-radius→10px、padding→16px、gap→12px）与其 `select`（border→`--border-strong`、border-radius→8px）对齐为演出资料风格。

### 第三批（精修增强）— ✅ 已落地（2026-07-25）

F16–F20 全部完成：

- **F16** 新增 `LiveTypeBadge`，专场、拼盘/对邦、音乐节、活动、多日活动和其他分别使用 rose/purple/teal/amber/blue/neutral 克制底色；卡片、表格和统计维度统一复用。
- **F17** `theme.css` 新增 `--radius-card:12px`、`--radius-control:8px`、`--radius-pill:999px`，公共端主要卡片、控件、标签和弹层均改用三档令牌；圆形图标/头像继续保留 `50%`，控制台专用样式不改。
- **F18** 新增 `ContentState`，按 rows/cards/statistics/detail 四种最终布局输出骨架，并统一 loading/empty/error 的标题、说明、`role` 与播报语义；已覆盖首页最近收录、演出资料、巡演、统计、详情、搜索和乐队浏览。
- **F19** 增加通用按压反馈、卡片/表格切换 180ms 淡入和骨架 shimmer；所有动画与过渡均受 `prefers-reduced-motion: reduce` 守卫约束。
- **F20** 公共端新增 base/sticky/dropdown/drawer/popover 五档层级令牌（1/20/30/60/120），顶栏、用户菜单、移动抽屉、详情弹层与浮动 popover 已接入；控制台专用高层级不纳入本次范围。

### 校验状态

- 2026-07-25 最终执行 `python scripts/run_checks.py functional`：scripts 语法检查、前后端 mypy/typecheck、后端单元测试 **214 passed**、后端集成测试 **95 passed**、前端 **276 passed**，全部通过。沙箱内 Vitest/esbuild 首次启动出现环境性 `spawn EPERM`，按仓库约定以相同命令提权重试后通过。
- 真实浏览器复核：
  - **1280×720 浅色/深色**：首页、卡片、表格、类型 chip 和主题令牌渲染正常；页面无横向溢出，桌面表格容器也无需横向滚动。
  - **768×1024 浅色**：页面无横向溢出；表格宽 1090px，在 703px 容器内独立横向滚动，不影响页面；筛选区按两级栅格重排。
  - **390×844 浅色**：页面无横向溢出；主导航隐藏、抽屉可用（drawer 60 > sticky 20）；卡片单列宽 351px，统计概览两列；详情元数据两列，返回按钮可访问名为"返回"。
- jsdom 仍不能发现 CSS 视觉回归，因此上述浏览器矩阵是本轮完成判定的必要证据；后续修改仍应保留同等复核。

## 7. 附录：走查截图

| 文件 | 内容 |
|------|------|
| [live-table-date-overlap.png](assets/visual-audit-2026-07/live-table-date-overlap.png) | F1：表格日期列溢出重叠 |
| [mobile-home-metrics-stack.png](assets/visual-audit-2026-07/mobile-home-metrics-stack.png) | F3 / F6：移动端导航残留条、指标单列 |
| [detail-page-meta.png](assets/visual-audit-2026-07/detail-page-meta.png) | F8：详情页元数据分散、关闭式返回 |
| [tour-cards.png](assets/visual-audit-2026-07/tour-cards.png) | 巡演资料卡片视图（参考基线） |
| [band-browse-good.png](assets/visual-audit-2026-07/band-browse-good.png) | 正面案例：乐队浏览数据色 + SVG 图案 |
| [mobile-drawer-good.png](assets/visual-audit-2026-07/mobile-drawer-good.png) | 正面案例：移动端抽屉导航 |
