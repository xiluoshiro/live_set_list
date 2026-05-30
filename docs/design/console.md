# 控制台现状与后续实现设计

本文档用于总结当前仓库内“控制台”相关代码和文档的真实状态，并给出后续推荐的落地方向。

当前结论：

- 前端控制台原型已经较完整，包含入口权限、录入表单、局部校验、mock 提交和局部测试。
- 后端 `/api/console` 已提供真实写接口，并新增只读查询接口；当前剩余主线是把前端 mock 接到真实 API。
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

### 2.3 新增 Live 的前端原型

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

- venue 查询输入框与按钮占位
- venue 选择浮层
- 前端字段必填校验
- 本地“已新增 Live 记录”展示

当前限制：

- “查询 venue” 仅保留了输入和按钮位，还没有把查询结果与“选择 venue”联动起来。
- 提交后只写入前端状态，不写数据库。

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
- “显示详细信息”弹窗仍是占位状态，尚未复用主界面的详情结构。

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

这意味着：

- 认证和收藏链路已有较稳的回归保护。
- 控制台已有局部测试，但真实写链路、后端 console 接口和完整权限闭环仍没有测试覆盖。

## 3. 当前未实现内容

结合 README、`auth-design.md` 和代码现状，控制台仍缺少以下核心部分。

### 3.1 后端 console 接口已落地，但前端尚未接线

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

### 3.3 控制台尚未接入真实 API 客户端

当前 `frontend/src/api.ts` 中还没有控制台相关接口封装。

这意味着前端控制台缺少：

- 提交 Live 的 API
- 提交 Song 的 API
- 提交 Setlist 的 API
- 查询 Song/Band/Venue 候选项的 API
- 相应的错误处理和成功态同步

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

当前控制台页面虽然是 mock，但交互结构已经足够承接第一版真实写接口。

因此推荐做法不是重写控制台，而是：

1. 保留现有 `ConsoleInsertPanel`
2. 在 `api.ts` 中新增控制台请求函数
3. 将 `submitSong / submitInsertLive / submitSetlist` 从本地状态写入改为真实请求
4. 请求成功后再决定是否保留本地历史表作为“刚提交记录”

这样改动范围更可控，也能最大化复用现有测试和交互。

### 6.2 建议的前端接线顺序

推荐按下面顺序推进：

1. 先接只读候选查询：`songs / bands / venues`
2. 再接 `新增歌曲`
3. 再接 `新增Live`
4. 最后接 `新增Setlist`

原因：

- 只读候选查询不改变数据，最适合作为第一条前端真实 API 接线。
- `新增歌曲` payload 最简单，最适合打通第一条真实写链路
- `新增Live` 次之，字段较多但结构清晰
- `新增Setlist` 最复杂，涉及多行 payload、排序和 JSON 字段，适合放在最后

### 6.3 当前 mock 到真实 API 的对应关系

现在可以直接接入真实 API 的前端位置：

- `querySongsForSetlist` / `MOCK_SONGS` -> `GET /api/console/songs`
- 新增歌曲与 setlist 的 band 选择 / `MOCK_BANDS` -> `GET /api/console/bands`
- `queryVid` / `MOCK_VENUES` -> `GET /api/console/venues`
- `submitSong` -> `POST /api/console/songs`
- `insertLive` / `submitInsertLive` -> `POST /api/console/lives`
- `submitSetlist` -> `POST /api/console/lives/{live_id}/setlist`
- setlist 详细信息弹窗 -> 可复用 `GET /api/lives/{live_id}`
- live 下拉候选 -> 可先复用 `GET /api/lives`

接线时需要注意：

- `submitSetlist` 当前把 `band_member` 和 `other_member` 处理成 JSON 字符串；后端真实接口期望对象，需要在前端请求前改成对象。
- 只读查询接口不需要 CSRF token；写接口仍必须带 `X-CSRF-Token`。

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

- 在 `frontend/src/api.ts` 新增控制台只读查询请求
- 在 `frontend/src/api.ts` 新增控制台写请求
- 用真实请求替换当前 mock 查询函数
- 用真实请求替换当前 mock 提交函数
- 补充 loading / success / failure 提示

状态：下一步。

### 阶段 3：完善控制台内部空白点

- venue 查询结果与“选择 venue”联动
- setlist 详细信息弹窗复用主界面详情结构
- 前端错误态、空态、加载态补齐

### 阶段 4：补管理员用户管理

- 创建用户
- 用户列表
- 修改角色
- 停用/启用用户

这部分应在业务录入链路稳定后再做，避免同时扩展过多后台能力。

## 8. 总结

当前控制台已经完成了“可进入、可操作、可 mock 演示”的前端阶段，也已经完成第一版“可落库、可审计、可鉴权、可查询候选项”的后端阶段。

最重要的判断是：

- 当前最大空白已经转移到前端 API 接线。
- 当前最推荐的下一步不是重写控制台，而是把已有控制台页面接到真实读写接口上。
- 在这之后，再补 venue 联动、详情复用和管理员用户管理，整体推进成本最低。
