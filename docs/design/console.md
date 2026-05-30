# 控制台现状与后续实现设计

本文档用于总结当前仓库内“控制台”相关代码和文档的真实状态，并给出后续推荐的落地方向。

当前结论：

- 前端控制台已经从纯 mock 进入“部分真实 API 接线”阶段：只读候选、venue 新增、Live 新增和 setlist 详情弹窗已接真实接口。
- 后端 `/api/console` 已提供真实写接口和只读查询接口；当前剩余主线是把“新增歌曲”和“新增 Setlist 提交”继续接到真实写 API。
- 认证、session、CSRF、默认管理账号、收藏接口和数据库运行时账号拆分已经落地，可作为控制台真实录入链路的基础。

## 0. 本次只读查询 API 设计方案

本次只读查询接口服务于当前控制台前端的 mock 数据替换，优先覆盖 `MOCK_SONGS / MOCK_BANDS / MOCK_VENUES` 三类候选数据。

设计原则：

- 统一挂在 `/api/console` 下，和写接口保持同一业务边界。
- 只允许 `editor+` 调用，避免绕过前端入口后直接枚举控制台候选数据。
- 使用 GET 安全方法，不要求 CSRF；CSRF 仍只用于写接口。
- 使用只读数据库连接 `get_db_connection()`，不产生审计日志、不修改数据。
- 支持 `q` 关键字和 `limit` 限制，`limit` 范围为 `1..100`，避免前端误传导致一次性返回过多数据。

已实现接口：

- `GET /api/console/songs?q=&limit=`
  - 用途：替代 setlist 里的“查询歌曲”和 `MOCK_SONGS`。
  - 返回：`song_id / song_name / band_id / cover`。
- `GET /api/console/bands?q=&limit=`
  - 用途：替代新增歌曲、setlist 成员选择里的 `MOCK_BANDS`。
  - 返回：`band_id / band_name / band_abbr / band_members`。
- `GET /api/console/venues?q=&limit=`
  - 用途：替代新增 Live 里的“查询 venue”和 `MOCK_VENUES`。
  - 返回：`venue_id / venue_name`。

暂不新增 console 专属 live 查询接口：

- Live 列表可先复用已有 `GET /api/lives`。
- Live 详情弹窗可先复用已有 `GET /api/lives/{live_id}`。
- 如果后续控制台需要“只看可编辑 live / 按日期精确查 live / 返回更轻量字段”，再补 `GET /api/console/lives`。

## 1. 目标

控制台的目标不是单纯“把一个前端页面做出来”，而是形成完整的后台录入链路：

1. `editor+` 用户可进入控制台并执行业务录入。
2. 控制台提交的数据进入真实后端接口，而不是只停留在前端内存态。
3. 后端对写操作执行角色校验、参数校验、CSRF 校验和审计日志记录。
4. 前后端权限模型与数据库运行时账号分工保持一致。

## 2. 当前已实现内容

### 2.1 前端控制台入口与角色可见性

- 前端已实现 `viewer / editor / admin` 的可见性分级。
- “控制台”页签仅对已登录且角色达到 `editor+` 的用户显示。
- 即使通过开发者工具强行把前端状态切到 `console`，状态层也会立即回退，避免低权限用户误入。

这部分已经满足阶段 D1 的目标，即“控制台入口按 `editor+` 做前端拦截”。

### 2.2 控制台页面结构

当前控制台前端包含 3 个录入模式：

- `新增Live`
- `新增Setlist`
- `新增歌曲`

其中默认进入 `新增Setlist` 视图。

### 2.3 新增 Live 的前端实现

`新增Live` 已具备以下表单字段和交互：

- `live_date`
- `live_title`
- `type`
- `url`
- `opening_time`
- `start_time`
- `timezone`
- `venue_id`

同时已经具备：

- venue 查询输入框与真实候选查询
- venue 快捷新增，调用 `POST /api/console/venues`
- venue 选择浮层，候选按 `venue_id` 升序展示
- 前端字段必填校验
- 提交新增 Live，调用 `POST /api/console/lives`
- 使用后端返回的数据库自增 `live_id` 更新“已新增 Live 记录”和 live 候选
- `timezone` 默认值为 `+09:00`
- `live_date` 仍使用浏览器原生日期控件，并限制最小日期为 `2015-01-01`

当前限制：

- 新增 Live 成功后当前只追加到前端当前页候选，不会主动刷新 `GET /api/lives` 分页总数。
- 原生日期控件的月份/年份滚动体验由浏览器控制，前端只能通过 `min` 等标准属性做有限约束。

### 2.4 新增 Setlist 的前端原型

`新增Setlist` 是当前控制台中完成度最高的部分，已经具备：

- 选择 `live_id`
- 动态增删 setlist 行
- 输入 `song_name`
- 通过“查询歌曲”把歌曲名映射到 `sid`
- 自动计算 `abs / seg / sub`
- `is_short` 勾选
- `band_member` 选择器
- `other_member` 编辑器
- mock 提交后的历史记录和预览表

当前限制：

- 提交的 setlist 只会在前端本地形成 payload 和预览，不会调用真实后端接口。
- “显示详细信息”弹窗已复用 `GET /api/lives/{live_id}` 和主界面的详情表格。

### 2.5 新增歌曲的前端原型

`新增歌曲` 已具备：

- `song_name`
- `band_id`
- `cover`
- band 选择浮层
- 前端必填校验
- mock 提交后的本地历史记录

当前限制：

- 提交后只更新前端内存中的 mock 列表，不写数据库。

### 2.6 已落地的后端基础能力

以下后端能力已经落地，可直接作为前端真实接线和后续管理能力的基础：

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- HttpOnly session cookie
- CSRF token 校验
- 默认 admin 自动补齐
- `viewer / editor / admin` 角色模型
- `require_role(...)` 依赖函数
- 收藏相关真实写接口
- 审计日志写入能力
- 控制台真实写接口
- 控制台只读候选查询接口
- 数据库运行时连接拆分为：
  - `live_project_ro`
  - `live_project_user_rw`
  - `live_project_super_ro`

其中控制台只读查询使用 `live_project_ro`，控制台写接口使用高权限写连接并记录审计日志。

### 2.7 已有测试覆盖

当前自动化测试已经覆盖：

- 后端认证单元测试
- 后端认证集成测试
- 后端收藏接口集成测试
- 后端控制台写接口集成测试
- 后端控制台只读查询接口集成测试
- 前端登录态恢复与收藏切换
- 前端控制台入口权限显示
- 控制台局部组件渲染与最小 mock 提交路径
- 前端控制台只读候选查询接线
- 前端 venue 新增真实 API 接线
- 前端 Live 新增真实 API 接线，并验证使用后端返回的 `live_id`
- setlist 批量粘贴解析、详情弹窗和关键交互

这意味着：

- 认证和收藏链路已有较稳的回归保护。
- 控制台已有读接口、venue 写入和 Live 写入的前端回归保护；新增歌曲与新增 Setlist 的真实写链路仍待补前端测试。

## 3. 当前未实现内容

结合 README、`auth-design.md` 和代码现状，控制台仍缺少以下核心部分。

### 3.1 后端 console 接口已落地，前端已完成部分接线

当前后端只注册了以下路由：

- `/api/health`
- `/api/lives`
- `/api/auth`
- `/api/me`
- `/api/console`

当前已经落地的控制台写接口包括：

- `POST /api/console/songs`
- `POST /api/console/lives`
- `POST /api/console/lives/{live_id}/setlist`

当前已经落地的控制台只读查询接口包括：

- `GET /api/console/songs`
- `GET /api/console/bands`
- `GET /api/console/venues`

### 3.2 后端角色控制已覆盖 console 接口

当前“控制台权限”已经不再只停留在前端可见性控制上。

后端 console 写接口和只读查询接口都已经使用 `require_role("editor")`，因此：

- `viewer` 直接请求 console 接口会被拒绝。
- `editor` 可以执行业务录入和候选查询。
- 默认管理账号拥有 `editor` 的全部能力。

后续仍需要补的是用户管理能力，而不是 console 录入接口本身的角色闭环。

### 3.3 控制台已部分接入真实 API 客户端

当前 `frontend/src/api.ts` 已经包含部分控制台接口封装。

已接入：

- 查询 Song/Band/Venue 候选项的 API
- 新增 Venue 的 API
- 新增 Live 的 API
- 相应的基础错误处理和成功态同步

仍缺少：

- 提交 Song 的 API 接线
- 提交 Setlist 的 API 接线
- 写接口 loading 态与防重复提交
- 更细的错误展示，例如字段级错误和冲突错误

### 3.4 前端错误处理仍不完整

当前控制台已有前端局部必填校验，后端也已经提供 schema 校验、业务约束校验和明确错误码。

剩余风险主要在前端接线后如何展示用户可读错误，例如：

- `song_name` 重复时如何处理
- `live_id` 不存在时如何处理
- setlist 中 `song_id` 非法时如何处理
- 查询候选项为空时如何提示
- 网络失败或 session 失效时如何引导重新登录

### 3.5 管理员用户管理能力尚未开始

README 已把“管理员创建用户与用户管理能力”列为待办。

这部分目前还没有：

- 管理员创建用户接口
- 用户列表/详情接口
- 修改角色接口
- 启停用户接口
- 前端管理页面

因此当前 `admin` 的意义主要还停留在默认管理员账号和未来扩展位上。

## 4. 推荐的权限边界

为了避免后续接口一上来就把所有写能力都堆给 `admin`，建议继续沿用现有角色分层：

- `viewer`
  - 可浏览
  - 可使用收藏
  - 不可访问控制台写接口
- `editor`
  - 可进入控制台
  - 可新增歌曲
  - 可新增 Live
  - 可向指定 live 追加 setlist 行
  - 不可执行用户管理
- `admin`
  - 拥有 `editor` 的全部能力
  - 可执行用户管理
  - 可处理后续更敏感的后台维护能力

这与当前前端“控制台对 `editor+` 开放”的实现保持一致，也和文档里对 `admin` 后续扩展的定位一致。

## 5. 已实现的后端接口边界

### 5.1 `POST /api/console/songs`

用途：

- 新增歌曲基础信息

请求字段：

- `song_name`
- `band_id`
- `cover`

校验：

- 仅 `editor+`
- 必须登录
- 必须通过 CSRF
- `song_name` 非空
- `band_id` 必须存在

审计：

- `action = song_create`
- `resource_type = song`
- `resource_id = 新 song_id`

### 5.2 `POST /api/console/lives`

用途：

- 新增 Live 基础信息

请求字段：

- `live_date`
- `live_title`
- `type`
- `url`
- `opening_time`
- `start_time`
- `timezone`
- `venue_id`

校验：

- 仅 `editor+`
- `venue_id` 必须存在
- 时间字段格式合法
- 必填字段完整

审计：

- `action = live_create`
- `resource_type = live`
- `resource_id = 新 live_id`

### 5.3 `POST /api/console/lives/{live_id}/setlist`

用途：

- 对指定 Live 追加新的 setlist 行
- 明确只插入，不删除、不覆盖已有行

请求字段：

- `setlist_rows`

每一行至少包含：

- `song_id`
- `absolute_order`
- `segment_type`
- `sub_order`
- `is_short`
- `band_member`
- `other_member`

校验：

- 仅 `editor+`
- `live_id` 必须存在
- `song_id` 必须存在
- 顺序字段合法
- `absolute_order` 不得与当前 live 里已有行冲突
- `band_member / other_member` JSON 结构合法

审计：

- `action = live_setlist_append`
- `resource_type = live`
- `resource_id = live_id`

### 5.4 `GET /api/console/songs`

用途：

- 查询控制台可选择的歌曲候选。
- 支持按 `song_name` 模糊搜索。

查询参数：

- `q`：可选关键词，空值表示默认候选。
- `limit`：可选返回数量，范围 `1..100`，默认 `20`。

返回字段：

- `song_id`
- `song_name`
- `band_id`
- `cover`

### 5.5 `GET /api/console/bands`

用途：

- 查询控制台可选择的乐队候选。
- 支持按 `band_name` 或 `band_abbr` 模糊搜索。
- 为 setlist 成员选择器返回 `band_members`。

查询参数：

- `q`：可选关键词，空值表示默认候选。
- `limit`：可选返回数量，范围 `1..100`，默认 `20`。

返回字段：

- `band_id`
- `band_name`
- `band_abbr`
- `band_members`

### 5.6 `GET /api/console/venues`

用途：

- 查询控制台可选择的场地候选。
- 支持按 `venue` 模糊搜索。

查询参数：

- `q`：可选关键词，空值表示默认候选。
- `limit`：可选返回数量，范围 `1..100`，默认 `20`。

返回字段：

- `venue_id`
- `venue_name`

## 6. 推荐的前端接线方式

### 6.1 先保持现有控制台 UI，不立即重做结构

当前控制台页面虽然仍保留部分 mock 提交流程，但交互结构已经足够承接第一版真实写接口。

因此推荐做法不是重写控制台，而是：

1. 保留现有 `ConsoleInsertPanel`
2. 在 `api.ts` 中继续补齐控制台请求函数
3. 将尚未接线的 `submitSong / submitSetlist` 从本地状态写入改为真实请求
4. 请求成功后再决定是否保留本地历史表作为“刚提交记录”

这样改动范围更可控，也能最大化复用现有测试和交互。

### 6.2 建议的前端接线顺序

推荐按下面顺序推进：

1. 已完成：只读候选查询 `songs / bands / venues`
2. 已完成：`新增Live`
3. 下一步：`新增歌曲`
4. 最后接：`新增Setlist`

原因：

- 只读候选查询不改变数据，最适合作为第一条前端真实 API 接线。
- `新增Live` 已经打通真实写链路，并使用后端返回的数据库自增 `live_id`
- `新增歌曲` payload 最简单，适合作为下一条真实写链路
- `新增Setlist` 最复杂，涉及多行 payload、排序和 JSON 字段，适合放在最后

### 6.3 当前 mock 到真实 API 的对应关系

当前 mock 到真实 API 的接线状态：

- 已接：`querySongsForSetlist` / `MOCK_SONGS` -> `GET /api/console/songs`
- 已接：新增歌曲与 setlist 的 band 选择 / `MOCK_BANDS` -> `GET /api/console/bands`
- 已接：`queryVid` / `MOCK_VENUES` -> `GET /api/console/venues`
- 已接：venue 快捷插入 -> `POST /api/console/venues`
- 已接：`insertLive` / `submitInsertLive` -> `POST /api/console/lives`
- 已接：setlist 详细信息弹窗 -> `GET /api/lives/{live_id}`
- 已接：live 下拉候选 -> `GET /api/lives`
- 待接：`submitSong` -> `POST /api/console/songs`
- 待接：`submitSetlist` -> `POST /api/console/lives/{live_id}/setlist`

接线时需要注意：

- `submitSetlist` 当前把 `band_member` 和 `other_member` 处理成 JSON 字符串；后端真实接口期望对象，需要在前端请求前改成对象。
- 只读查询接口不需要 CSRF token；写接口仍必须带 `X-CSRF-Token`。
- `POST /api/console/lives` 请求体不包含 `live_id`；前端必须使用后端返回的 `live_id`，避免再次出现 mock id 与数据库序列不一致。

### 6.4 新增 Setlist 批量粘贴解析设计

目标：

- 支持用户把活动官网/公告中的 setlist 文本一次性粘贴到控制台。
- 前端解析后自动拆解到“新增Setlist”的现有表格字段。
- 解析只更新前端草稿，不直接写库；最终仍由用户点击“提交插入”触发真实写接口。
- 解析层优先使用成熟 parser SDK 或 parser generator，不手写大段字符串解析逻辑。

技术选型建议：

- 首选方案：前端使用 `Peggy` 这类 JavaScript parser generator，把 setlist 文本格式定义为 grammar，并在构建阶段生成可被 React 组件直接 import 的 parser。
- 备选方案：如果希望解析逻辑集中在后端，可使用 Python 的 `Lark`，新增只读解析接口，例如 `POST /api/console/setlist/parse-preview`，由后端返回草稿和 warning。
- 暂不推荐方案：在 React 组件里直接手写多段正则、逐行状态机和特殊分支。这样短期快，但后续支持更多官网格式时会很脆。

推荐选择：

- 第一版建议放在前端，用 `Peggy` 生成 parser。
- 原因是批量粘贴解析只生成前端草稿，不写库，也不需要服务端事务；前端解析可以即时预览，失败定位也更贴近用户输入。
- parser 只负责把文本解析成结构化 AST；band 匹配、`from` 归属、`band_id=0` 排除等业务语义仍放在一层独立 mapper 中处理。
- 如果后续多个客户端都需要同一套解析能力，再迁移为 Python `Lark` 后端接口。

入口设计：

- 在“新增Setlist”区域增加“批量粘贴 Setlist”折叠面板。
- 面板内包含多行文本框、`解析预览`、`应用到表格`、`清空`。
- `解析预览` 只生成草稿和 warning，不覆盖当前表格。
- `应用到表格` 才替换当前 `setlistRows`。
- 应用后不自动提交，也不自动新增歌曲；用户继续使用现有“查询歌曲”按钮解析 `song_id`。

输入格式：

```text
＜Roselia×戸山香澄 from Poppin'Party＞

M1. BLACK SHOUT

<Roselia>

M2. Requiem for Fate

EN1. BRAVE JEWEL
```

解析规则：

- 空行忽略。
- 支持半角尖括号 `<...>` 与全角尖括号 `＜...＞`。
- 尖括号行表示“演出者上下文”，作用于后续歌曲行，直到遇到下一条尖括号行。
- 歌曲行格式为 `M1. song_name` / `EN1. song_name` / `SP1. song_name`。
- 歌曲行、演出者行、空行和未知行由 parser grammar 识别，不在 React 组件中手写逐行正则。
- `song_name` 取序号点号后的文本，保留原始大小写和符号。
- `song_id` 初始为空，继续由 `GET /api/console/songs` 的“查询歌曲”流程填充。

建议 grammar 产物：

- `performer_context`：尖括号中的原始演出者文本，以及输入行号。
- `song_entry`：`segment_type`、`segment_order`、`song_name`、输入行号。
- `unknown_line`：无法识别但非空的原始文本和行号。
- `blank_line`：通常不进入最终 AST，除非后续需要做更精细的错误提示。

建议前端文件边界：

- `frontend/src/components/console/setlistParser/setlist.peggy`：语法定义。
- `frontend/src/components/console/setlistParser/generatedParser.ts`：由 `Peggy` 生成，不手改。
- `frontend/src/components/console/setlistParser/mapParsedSetlist.ts`：把 AST 映射到 `SetlistDraftRow`。
- `frontend/src/components/console/setlistParser/types.ts`：AST、warning 和 preview 类型。

依赖与构建：

- 新增 `peggy` 作为前端开发依赖。
- 新增生成脚本，例如 `npm run generate:setlist-parser`。
- `npm run build` 或 `run_checks.py frontend` 前应确保生成文件是最新的。
- 如果团队不希望提交生成文件，也可以在前端构建前自动生成；但为了减少本地环境差异，第一版更建议提交生成后的 parser 文件。

字段映射：

- `song_name`：歌曲行中的曲名。
- `song_id`：解析阶段置空。
- `segment_start_type`：每个段落的第一首填 `M / EN / SP`，同段后续歌曲填空。
- `is_short`：第一版默认 `false`，后续可再识别 `short / 短版 / TV size`。
- `band_member`：来自当前尖括号上下文中可匹配到有效 band 的 token。
- `other_member`：来自无法归属到有效 band 的 token。

演出者 token 拆解：

- 尖括号内容先按 `×` 拆分。
- 每个 token trim 后单独判断。
- 先用当前已加载的 `GET /api/console/bands` 候选做 band 匹配。
- band 匹配字段优先级：`band_name` 精确匹配、`band_abbr` 精确匹配；后续如需要再加别名表。
- 匹配到的 band 必须满足 `band_id > 0`，`band_id = 0` 视为无效占位，不可写入 `band_member`。

`from` token 归属规则：

- 对 `戸山香澄 from Poppin'Party` 这类 token，不应直接落入 `other_member`。
- 先解析为 `member_name = 戸山香澄`、`source_band = Poppin'Party`。
- 再用 `source_band` 去当前 band 候选中查找有效 band，且要求 `band_id > 0`。
- 如果找到有效 band：
  - 如果该 band 的 `band_members` 包含 `戸山香澄`，则写入 `band_member[source_band] = ["戸山香澄"]`。
  - 如果该 band 的 `band_members` 不包含 `戸山香澄`，仍优先归入该 band，但给 warning：`成员不在 band_members 中，请人工确认`。
  - 如果当前行同一个 band 已经因为 `Poppin'Party` token 被整团选中，则保留整团成员，不再缩窄为单人。
- 如果找不到有效 band，或匹配到的 band `id = 0`：
  - 才落入 `other_member`，建议为 `{ member_key: source_band, member_value: member_name }`。

示例映射：

```text
＜Roselia×戸山香澄 from Poppin'Party＞
M1. BLACK SHOUT
```

在已加载 band 中存在有效 `Roselia` 与 `Poppin'Party` 时：

```json
{
  "song_name": "BLACK SHOUT",
  "segment_start_type": "M",
  "band_member": {
    "Roselia": ["Roselia 的全部成员"],
    "Poppin'Party": ["戸山香澄"]
  },
  "other_member": []
}
```

如果 `Poppin'Party` 不存在或只有 `band_id = 0`：

```json
{
  "song_name": "BLACK SHOUT",
  "segment_start_type": "M",
  "band_member": {
    "Roselia": ["Roselia 的全部成员"]
  },
  "other_member": [
    {
      "member_key": "Poppin'Party",
      "member_value": "戸山香澄"
    }
  ]
}
```

warning 设计：

- 未识别行：展示原始行号和文本。
- 歌曲行没有演出者上下文：提示该行 `band_member` 为空。
- 演出者 token 无法匹配有效 band：提示将落入 `other_member`。
- `from` token 的成员不在 `band_members` 中：提示人工确认。
- 曲序跳号或重复：只提示，不阻断解析。
- 段落编号不从 1 开始：只提示，不阻断解析。

推荐实现顺序：

1. 引入 `Peggy`，先用 grammar 生成 parser，避免手写解析器。
2. 新增 `mapParsedSetlist(ast, bands): ParseSetlistResult`，只负责业务映射，不负责文本语法解析。
3. 给 parser 和 mapper 分别补单元测试，重点覆盖全角尖括号、`M/EN/SP`、`×`、`from`、`band_id=0`、未知 band、曲序跳号。
4. 在 `LiveInsertTab` 增加批量粘贴面板和预览结果。
5. `应用到表格` 时替换 `setlistRows`，并重置 `didSongLookup=false`。
6. 复用现有“查询歌曲”按钮填充 `song_id`。

后端化备选设计：

- 如果选择 Python `Lark`，可新增 `POST /api/console/setlist/parse-preview`。
- 该接口应使用 `editor+` 权限，但不需要 CSRF，因为它是只读预览，不写库。
- 请求包含 `raw_text`，可选包含前端已加载的 band 候选版本；后端也可以直接复用 `GET /api/console/bands` 的查询逻辑加载 band。
- 响应返回 `rows`、`warnings` 和 `unrecognized_lines`。
- 即使走后端解析，最终插入仍必须由 `POST /api/console/lives/{live_id}/setlist` 完成，避免“解析预览”产生任何数据污染。

参考：

- `Peggy`：JavaScript parser generator，适合在前端构建阶段生成浏览器可用 parser。
- `Lark`：Python parsing library，适合未来把解析预览收敛到后端服务。

## 7. 推荐实施顺序

### 阶段 1：把后端写接口骨架补齐

- 新增 `/api/console` router
- 注册到 `FastAPI`
- 为 3 个接口接入：
  - 登录校验
  - `require_role("editor")`
  - `assert_valid_csrf(...)`
  - 基础 schema 校验
  - 审计日志

状态：已完成。

### 阶段 1.5：补齐后端只读候选查询

- `GET /api/console/songs`
- `GET /api/console/bands`
- `GET /api/console/venues`
- `editor+` 权限校验
- `q / limit` 查询参数
- 只读数据库连接

状态：已完成。

### 阶段 2：接通前端真实 API 链路

- 已在 `frontend/src/api.ts` 新增控制台只读查询请求
- 已在 `frontend/src/api.ts` 新增 venue / Live 写请求
- 已用真实请求替换当前候选查询函数
- 已用真实请求替换 venue 快捷新增和 Live 新增提交
- 待用真实请求替换新增歌曲提交
- 待用真实请求替换新增 Setlist 提交
- 补充 loading / success / failure 提示

状态：进行中。

### 阶段 3：完善控制台内部空白点

- 已完成 venue 查询结果与“选择 venue”联动
- 已完成 setlist 详细信息弹窗复用主界面详情结构
- 已完成新增 Live 默认 `timezone = +09:00`
- 已完成 `live_date` 原生日期输入最小值限制为 `2015-01-01`
- 已完成删除末行时的全局顶部 toast 告警
- 前端错误态、空态、加载态补齐

### 阶段 4：补管理员用户管理

- 创建用户
- 用户列表
- 修改角色
- 停用/启用用户

这部分应在业务录入链路稳定后再做，避免同时扩展过多后台能力。

## 8. 总结

当前控制台已经完成了“可进入、可操作、可查询候选、可新增 venue、可新增 Live”的前端阶段，也已经完成第一版“可落库、可审计、可鉴权、可查询候选项”的后端阶段。

最重要的判断是：

- 当前最大空白已经收敛到新增歌曲与新增 Setlist 的真实写接口接线。
- 当前最推荐的下一步不是重写控制台，而是继续在已有控制台页面上接 `POST /api/console/songs`。
- 在新增歌曲稳定后，再接 `POST /api/console/lives/{live_id}/setlist`，最后补管理员用户管理，整体推进成本最低。
