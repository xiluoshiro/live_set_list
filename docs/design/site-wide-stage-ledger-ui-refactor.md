# 全站 Stage Ledger 视觉重构方案

## 1. 文档定位

本文定义 LiveSetList 全站前端视觉重构方案。新的视觉核心来自两项已经存在的工作：

- [Live 详情页 Stage Ledger 全量重构设计](live-detail-stage-ledger.md)及当前生产组件 `StageLedgerContent`、`stage-ledger.css`。
- [首页 Live 日历改造设计](home-live-calendar.md)与 `home-live-calendar-v2` 首屏预览。

本文只定义页面结构、视觉系统、组件库边界、迁移批次与验收条件，不修改产品数据口径、权限、写入流程或 API 语义。产品需求仍由 `docs/product/` 管理。

文档状态：`PROPOSED`。

## 2. 设计解读

Design Read：这是面向演出资料查询者和站内维护者的全站重构，视觉语言为舞台运行单、档案索引与演出程序册的结合。公共端强调连续阅读和数据身份，控制台强调高密度、可核对和可恢复的操作流程。

设计参数：

| 参数 | 值 | 解释 |
|---|---:|---|
| `DESIGN_VARIANCE` | 7 | 首页和详情允许不对称构图，列表和控制台保持稳定网格 |
| `MOTION_INTENSITY` | 4 | 使用反馈和状态过渡，不做滚动劫持、视差或持续动画 |
| `VISUAL_DENSITY` | 6 | 公共页可快速扫描，详情和控制台可容纳长歌单与复杂表单 |

### 2.1 重构模式

重构范围属于 `Redesign - Overhaul`：

- 保留路由语义、数据语义、用户任务、可访问性和回归契约。
- 不保留旧页面的卡片、圆角、阴影、DOM 或 CSS class。
- 首页新首屏和生产 Stage Ledger 是双参考，不把任一静态预览的全部装饰直接复制到全站。
- Band 图标与 Band 代表色是数据资产，不作为普通图标或主题色重画。

### 2.2 两项参考的职责

| 参考 | 取用内容 | 不取用内容 |
|---|---|---|
| 新首页首屏 | 左文右搜索的不对称构图、hairline 分区、mono 元数据、4px 小圆角、数据概览、日历与当日详情联动 | 将所有内容塞入首屏、重复说明、装饰性渐变 |
| 生产 Stage Ledger | 连续有序列表、演出身份 Masthead、Band 实色轨、文字与线条层级、4px 控件、桌面检查器和移动原位展开 | 将每个页面都做成歌单页、在普通列表中滥用 Band 色轨 |
| `02-program-notes` 静态预览 | 舞台张力、长歌单极端数据、场景切换思路 | 玻璃外壳、通用大圆角、渐变主按钮、顶部场景胶囊列表 |

## 3. 页面范围与样式边界

### 3.1 当前页面面

现有 `App.tsx` 以内部 `TabKey` 和 History state 管理以下页面或状态：

- 首页。
- 演出资料与收藏视图。
- Live 详情。
- 巡演资料与巡演详情。
- Performance Group 详情。
- 数据统计。
- 全站搜索结果。
- 乐队浏览。
- 联系我们。
- 登录弹层。
- 控制台的演出、歌单、歌曲、专辑、巡演、活动组、乐队、场馆及地区维护模块。

### 3.2 样式边界

共享视觉规则使用统一主题、颜色、形状与层级令牌；页面专用样式限制在对应组件范围内。路由、缓存和草稿状态不因视觉调整而改变。

### 3.3 已知风险与防范约束

#### Ant Design 全局样式漏检

在全站入口导入第三方 reset 会影响所有页面，而 jsdom 不执行真实布局。相关边界见[全局样式覆盖缺口](../fails/frontend-global-style-coverage-gap.md)。

约束：

- 禁止在 `main.tsx` 或全站样式入口导入第三方 reset、normalize 或 base CSS。
- 新增第三方样式必须能说明作用根节点、层级和卸载边界。
- 修改全局样式入口时必须执行首页、演出资料、Live 详情和控制台的真实浏览器截图矩阵。
- 行为测试通过不能作为视觉安全结论。

#### React 列表记录身份碰撞

[React 列表 key 碰撞复盘](../fails/react-list-key-collision.md)说明同一首歌在同一歌单或差异中重复出现是有效数据。重构列表时不能把 `song_id` 当成出现记录 ID。

约束：

- 歌单、巡演差异、历史记录和控制台操作记录都以记录实例为 key。
- 回归必须包含 A -> B -> A 列表切换与重复歌曲。
- 视觉组件不得偷偷按实体 ID 去重业务允许的重复出现。

#### 色轨接缝与展开态尺寸跳变

Stage Ledger 静态预览曾出现相邻 Band 色轨白缝和展开后粗细变化。全站的数据色轨应使用固定宽度、单一内侧分隔和不改变宽度的 hover / expanded 状态。

## 4. 组件库与依赖决策

### 4.1 主方案

主方案采用三层结构：

| 层 | 选择 | 作用 |
|---|---|---|
| 视觉系统 | 项目自有 CSS 变量 + 页面作用域 CSS | 决定 Stage Ledger 的排版、颜色、线条、间距和响应式 |
| 交互原语 | 已安装的 [`radix-ui`](https://www.radix-ui.com/primitives/docs/overview/introduction) | Dialog、Collapsible、Popover、Tooltip、DropdownMenu、AlertDialog、Tabs、ToggleGroup 等复杂行为 |
| 表格逻辑 | 按需评估 [`@tanstack/react-table`](https://tanstack.com/table/latest/docs/overview) | 只提供排序、筛选、列状态、展开和分页逻辑，不提供视觉皮肤 |

Radix Primitives 官方定位就是无样式、可访问、可组合的底层组件，并允许项目完全控制 class 与 `data-state`。TanStack Table 同样是 headless 表格引擎，适合在保持 Stage Ledger DOM 和视觉的同时统一密集表格状态。

实施约束：

- 保留 `frontend/src/components/ui/` 作为唯一 Radix 薄封装入口。
- 不引入 Radix Themes，不复制其默认示例皮肤。
- TanStack Table 仅在控制台和确有排序、列显隐、行选择需求的表格中引入，不把简单公共列表改成数据网格。
- 图标建议统一为 `@phosphor-icons/react` 的 Regular 规格，Band SVG 资产保持原样。
- 第三方依赖引入时核对版本、React 18 与 Node 22.12 兼容性，再写入 `package.json`。

### 4.2 为什么不把 Ant Design 作为全站主视觉

Ant Design 当前官方定位仍是企业级 Web 应用组件库，适合中后台，并提供 ConfigProvider 主题令牌。它可以加速控制台，但不适合作为本方案的公共端视觉核心：

1. 默认组件形态会把首页、档案列表和演出流程拉向通用企业后台。
2. 为了得到 Stage Ledger 的连续内容、4px 小圆角和线性层级，需要大量覆盖 Card、Table、Collapse、Tabs 和 Form 的默认构图。
3. 仓库已有 `antd/dist/reset.css` 污染非控制台页面且未被测试发现的失败记录。
4. 全站同时保留 Radix 与 AntD 会形成两套焦点、浮层、Portal 和动效契约。

因此默认方案不安装 AntD。

### 4.3 AntD 备选边界

如果后续明确以控制台交付速度优先，可单独做 AntD 控制台试点，但必须满足：

- 仅挂载在控制台根节点。
- 不导入 `antd/dist/reset.css`。
- 只通过 `ConfigProvider` 的 token 和组件 token 映射 Stage Ledger 变量。
- 使用独立 `prefixCls`，并评估 `StyleProvider` 和 CSS `@layer` 隔离。
- 不在同一控制台子树混用 Radix Dialog、Dropdown 和 AntD Modal、Dropdown。
- 试点先覆盖一个只读表格和一个确认弹层，完成跨页截图后再决定是否扩大。
- 一旦确认采用 AntD，公共端仍不消费 AntD Card、Typography、Layout 或 Table。

## 5. 全站视觉系统

### 5.1 语义令牌

将 Stage Ledger 局部变量提升为全站语义令牌：

```css
:root {
  --lsl-canvas: ...;
  --lsl-paper: ...;
  --lsl-ink: ...;
  --lsl-heading: ...;
  --lsl-muted: ...;
  --lsl-line: ...;
  --lsl-line-strong: ...;
  --lsl-signal: ...;
  --lsl-focus: ...;
  --lsl-radius: 4px;
}
```

规则：

- 全站只有一个交互强调色。当前品牌粉可以继续作为 `--lsl-signal`，但不再作为大面积背景。
- Band 色只表达 Band 身份；状态色只表达进行中、延期、取消等真实状态。
- 浅色使用冷白纸面与近黑正文，深色使用蓝黑纸面与暖白正文。页面中途不反转主题。
- 圆角默认 4px，内容分区允许 0，圆形只用于 Band 图标、头像和明确的图标按钮。
- 阴影只用于 Portal、浮层和桌面检查器。普通区块通过留白与单侧分隔线建立层级。

### 5.2 字体与数字

- 中文、日文和正文使用系统现代无衬线栈，第一批不新增大型 CJK 网络字体。
- 日期、时间、曲目编号、计数和筛选元数据使用统一 mono 栈。
- 页面只允许一个 `h1`，标题不通过随机英文 kicker 或段落编号制造层级。
- 桌面公共页正文不低于 14px，移动端正文不低于 15px，辅助信息不低于 12px。

### 5.3 标志性元素

- `DataRail`：固定宽度的实色数据轨，用于 Band、状态或时间关系。
- `LedgerRule`：单侧 hairline 分隔，不给长列表每行同时添加上下边框。
- `RecordMeta`：mono 元数据行，最多承载 3 类事实。
- `SpectrumRule`：首页首屏可保留一次由 Band 实色段组成的细线，不使用模糊渐变。
- `Inspector`：仅在主记录需要上下文检查时形成浮层或桌面右栏。

## 6. 页面信息架构与重构方案

### 6.1 全局 Shell

目标：同一套 Shell 服务公共档案和控制台，但允许不同内容宽度。

- 顶栏 64-72px，桌面单行展示站点名、主导航、登录和主题操作。
- 移动端只保留站点名与两个图标操作，主导航进入 Radix Dialog 或自定义 Drawer。
- 页面根节点分为 `archive`、`detail`、`workbench` 三种密度，不再由每个页面重复定义容器宽度。
- 全局只加载 tokens、base、focus、shell 四类 CSS。页面 CSS 随页面组件导入并限定根节点。
- 登录状态、收藏警告和全局错误使用稳定区域，不覆盖顶栏或造成页面跳动。

### 6.2 首页

保留新首屏作为全站门面：

- 左侧是任务标题与简短说明，右侧是唯一主搜索。
- 标题下使用一次 `SpectrumRule`，其颜色来自真实 Band 色段。
- 数据概览不放四张卡，使用四列 ledger metrics 与 hairline。
- 下一场 Live 使用一条可点击记录，状态轨和 Band 图标只表达真实数据。
- Live 日历继续使用月历与当日详情联动，不把标题塞入日期格。
- “关于与反馈”降到页脚 colophon，不与搜索和日历争夺首屏优先级。

### 6.3 演出资料与收藏

页面代号：`Live Index`。

- 标题、结果数、视图切换和筛选组成一个连续工具区，不再分成多个圆角卡片。
- 桌面表格改为档案索引：日期、标题、状态、Band、来源按阅读顺序排列。
- 卡片视图改为两列或三列不等高的记录块，但不用大阴影和通用图片区。
- 移动端不渲染横向桌面表格，改为语义相同的 `MobileRecordList`。
- 收藏是同一数据集的范围条件，使用 ToggleGroup 表达，不复制第二套页面结构。
- 取消、延期和活动组条目拥有明确文字状态，颜色不是唯一线索。

### 6.4 Live 详情

页面代号：`Stage Ledger`。

- 当前生产 Stage Ledger 作为基线，不重新退回旧详情卡片和居中歌曲弹窗。
- Masthead、连续歌单、Event 出席路径、取消与延期路径保持独立。
- 桌面歌曲检查器与移动原位展开继续共用同一数据组件。
- 关联 Tour 与 Performance Group 使用链接档案，不做两张同形卡。
- 修正文档状态并补齐真实完成范围，避免设计文档继续声称“尚未实施”。

### 6.5 搜索结果

页面代号：`Index Finder`。

- 搜索框保持在页面首部并显示当前查询，不重复大型首页 Hero。
- Live、乐队、歌曲和场馆按结果类型分组，每组显示计数和连续记录。
- 有结果的组才出现；无结果、错误和加载保持相同区域高度。
- 乐队和场馆结果进入真实后续页面或筛选状态，不使用无效详情按钮。
- 移动端按组纵向排列，桌面允许 8+4 或 7+5 的非对称分栏。

### 6.6 乐队浏览

页面代号：`Band Index`。

- 保留 Band SVG 与代表色，这是现有公共端最强的数据视觉资产。
- 桌面左侧为可搜索 Band 索引，右侧为选中 Band 的 Live 年表。
- Band 索引以文字、图标和细色轨表达，不做一整面彩色按钮墙。
- 移动端先选择 Band，再显示年表；选择器关闭后焦点回到 Band 标题。
- 历史名称与阵容版本后续可接入同一索引，但不在无数据时造假。

### 6.7 巡演资料与巡演详情

页面代号：`Tour Route Ledger`。

- 巡演列表使用日期范围、场次、Band 和状态组成连续 route rows。
- 巡演详情以垂直时间脊柱组织场次，当前场和取消场使用真实状态线。
- 歌单变化使用新增、移除、顺序变化三类 diff records，不用三张同形统计卡。
- 重复歌曲按出现记录显示，React key 遵守失败复盘规则。
- 相邻场次切换不改变统计口径，A -> B -> A 后 DOM 行数稳定。

### 6.8 Performance Group 详情

页面代号：`Event Sheet`。

- 同日多场使用日程板，多日活动使用日期轴，二者不假定是巡演。
- Tour 与 Performance Group 保持并列语义，不能共用同一标题和统计模板。
- 场次采用连续记录与日界线，不使用一场一张大卡。
- 单日午场、晚场在移动端按时间顺序纵向排列，核心状态不截断。

### 6.9 数据统计

页面代号：`Archive Signals`。

- 筛选区与 Live Index 使用同一 FilterBar。
- 概览数字直接落在栅格和 hairline 上，不放四张同形统计卡。
- 年份、类型、歌曲覆盖和久未演唱使用不同的图表或列表构图，避免每节都是白卡。
- 图表文字和数值可被读屏访问，颜色只作为辅助。
- 数值来自 API，不新增装饰性百分比和假精度。

### 6.10 联系我们

页面代号：`Colophon`。

- 使用资料来源、反馈方式、隐私说明三段连续正文。
- 桌面两栏，移动端单栏。
- 不做营销 Hero、三张功能卡或虚构社区数据。
- 真实外链具有明确目标和可访问名称。

### 6.11 登录与账户操作

- 登录使用 Radix Dialog 薄封装，字段标签始终在输入框上方。
- 显示密码、提交、错误、关闭和焦点返回完整覆盖键盘行为。
- 用户菜单使用 Radix DropdownMenu，退出登录不混入普通导航按钮。
- 登录弹层与控制台确认弹层使用同一 overlay、focus 和 z-index 契约。

### 6.12 控制台

页面代号：`Production Desk`。

- 桌面采用左侧模块索引、主编辑区和按需右侧核对区。
- 8 个模块不再使用横向挤压页签；窄桌面可折叠模块索引。
- 表单采用 label、control、helper、error 的统一字段结构。
- 批量 Setlist、候选查询、确认差异和历史记录保留数据密度，避免把每行改成卡片。
- 复杂表格可按需使用 TanStack Table 统一列状态与行选择，但服务端筛选、分页和总数仍由现有 API 契约负责。
- 确认步骤在右侧检查器或 Dialog 中显示“将发生什么”，提交按钮保持唯一主操作。
- 320-720px 使用分步纵向工作流，不缩小桌面宽表格。

## 7. 共享组件边界

建议建立两层共享组件：

```text
frontend/src/components/ui/
  AlertDialog.tsx
  Collapsible.tsx
  Dialog.tsx
  DropdownMenu.tsx
  Popover.tsx
  Tabs.tsx
  ToggleGroup.tsx
  Tooltip.tsx

frontend/src/components/system/
  AppShell.tsx
  Button.tsx
  IconButton.tsx
  PageLead.tsx
  FilterBar.tsx
  Field.tsx
  ContentState.tsx
  DataRail.tsx
  LedgerTable.tsx
  MobileRecordList.tsx
  Inspector.tsx
```

边界规则：

- `ui/` 只负责 Radix 组合、Portal、焦点和 `data-state`。
- `system/` 只负责全站视觉和通用交互，不知道 Live、Tour 或 Setlist 业务。
- 业务组件负责文案、数据语义和页面布局。
- 不建立通用 `Card`、`Badge`、`Stack` 并强迫所有页面使用。
- 原生 `button`、`a`、`table`、`ol/li` 足够时，不额外包装 Radix。

## 8. CSS 架构与隔离

### 8.1 全局层

全局只允许：

- `tokens.css`
- `base.css`
- `focus.css`
- `shell.css`

这些文件必须有明确变更说明和全站截图回归。

### 8.2 页面层

- 每个页面以稳定根属性或 CSS Module 作用域隔离。
- 页面 CSS 随页面组件导入，不再由 `index.css` 一次性导入所有公共、详情和控制台样式。
- Portal 内容由 `ui/` 封装分配稳定 class 与 z-index 层。
- 迁移期旧样式以页面根节点隔离，禁止新旧规则同时匹配同一组件。

### 8.3 禁止项

- 禁止第三方全局 reset。
- 禁止通用 999px 胶囊体系。
- 禁止全页紫蓝渐变、外发光、大面积 blur 和磨砂玻璃。
- 禁止每一节都是圆角白卡。
- 禁止 hover 或 expanded 改变 Band 轨宽度。
- 禁止只依赖 jsdom 断言 CSS 安全。

## 9. 路由与页面状态

最终建议建立可刷新、可分享的路径：

| 页面 | 建议路径 |
|---|---|
| 首页 | `/` |
| 演出资料 | `/lives` |
| 收藏 | `/favorites` |
| Live 详情 | `/lives/:liveId` |
| 巡演资料 | `/tours` |
| 巡演详情 | `/tours/:tourId` |
| Performance Group | `/performance-groups/:groupId` |
| 数据统计 | `/statistics` |
| 乐队浏览 | `/bands`、`/bands/:bandId` |
| 搜索 | `/search?q=` |
| 联系我们 | `/about` |
| 控制台 | `/console/:section` |

视觉重构不应和路由库迁移混在同一批。第一阶段可以保留现有 History adapter，但每个新页面组件必须接收显式参数，不读取隐式全局 Tab 状态。若后续引入 React Router，应先核对当时稳定版对项目 Node 22.12 和 React 18 的要求，再单独迁移 URL、返回与滚动恢复。

## 10. 响应式与状态

### 10.1 断点

- `>= 1200px`：完整档案栅格、详情检查器、控制台三栏。
- `768-1199px`：两栏或单栏，检查器进入正文后方，导航保持单行或折叠。
- `< 768px`：严格单栏，横向表格改语义相同的移动记录列表。
- `320px`：核心字段、按钮和状态文字完整，无页面级横向滚动。

### 10.2 状态

每个页面必须定义：

- 初次加载。
- 局部刷新。
- 空数据。
- 404 或目标不存在。
- 网络或服务错误。
- 权限不足。
- 写入中、成功、失败和可重试。

骨架匹配最终布局，不使用全页居中 spinner。错误保持已确认的标题或上下文，但不得用空数据伪装成功。

### 10.3 动效

- 只动画 `transform` 和 `opacity`。
- 动效必须表达层级、反馈或状态变化。
- 无自动滚动、横向滚动劫持、逐行入场、无限跑马灯或装饰性脉冲。
- `prefers-reduced-motion: reduce` 下变为即时切换。

## 12. 验收矩阵

### 12.1 自动化行为

- 首页日历月份、日期选择、状态聚合和详情入口。
- 公共列表筛选、分页、视图切换、收藏和返回恢复。
- Stage Ledger 三种内容路径与逐曲展开。
- Tour / Performance Group 关系、统计和重复歌曲。
- 搜索分组、Band 选择、加载、空、错状态。
- 登录、退出、权限、CSRF 和控制台确认流程。
- 所有 Radix 封装的键盘、焦点、Portal 和 Escape 行为。

### 12.2 浏览器尺寸

| 尺寸 | 重点 |
|---|---|
| 1440x900 | 首屏层级、档案栅格、详情检查器、控制台三栏 |
| 1280x800 | 长标题、筛选和导航单行稳定性 |
| 768x1024 | 平板不出现半桌面结构 |
| 390x844 | 移动导航、记录列表、原位展开和表单 |
| 320x568 | WCAG reflow、按钮文案和核心状态不截断 |

每个尺寸至少覆盖浅色与深色、普通成功态、加载、空、错误、取消或延期状态。页面必须满足：

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth
```

### 12.3 视觉反模板

- 不使用全页紫蓝渐变、玻璃拟态和外发光。
- 不把每个区块做成独立圆角卡片。
- 不使用 999px 作为通用标签。
- 不为所有标题添加英文 kicker、编号或装饰性说明。
- 不用三张或四张同形卡表达所有页面内容。
- Band 色、状态色和交互色各自只承担其真实语义。
- 不虚构海报、演出图片、统计或验证状态制造完成度。

### 12.4 项目门禁

业务代码变更后的最终验证只使用：

```powershell
python scripts/run_checks.py functional
```

该命令通过后再执行真实浏览器矩阵。若首次因 Windows `spawn EPERM` 或沙箱进程权限失败，按仓库约定原命令重试一次，再区分环境故障与产品回归。

仅修改本文等 Markdown 时执行：

```powershell
git diff --check
```

并检查本文全部相对链接存在。

## 13. 完成定义

只有同时满足以下条件，全站视觉重构才算完成：

1. 首页、公共索引、详情族、统计、联系、账户和控制台共享同一视觉 token 与交互原语边界。
2. Stage Ledger 的连续阅读、数据色轨和小圆角语言成为全站核心，但没有把所有页面做成歌单页。
3. 新首页首屏仍是公开浏览入口，搜索、概览、下一场 Live 和日历优先级清楚。
4. 公共端与控制台没有第三方全局 reset 或不可解释的跨页 CSS 覆盖。
5. Tour、Performance Group、Event、取消、延期、重复歌曲和版本化阵容语义无损。
6. 320px、200% 缩放、键盘、读屏、reduced motion 和明暗主题通过回归。
7. functional、真实浏览器截图矩阵和控制台错误检查全部通过。
8. 旧可见实现、旧页面 CSS 和文档中的失真状态已清理，不存在双实现维护成本。
