# LiveSetList API 补充说明

本文档不再作为接口字段与响应结构的唯一真相源。  
当前 API 契约请优先以 FastAPI 自动生成文档为准：

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- OpenAPI JSON: `http://localhost:8000/openapi.json`
- 仓库内也可通过 `python scripts/export_openapi.py` 导出到 [docs/openapi.json](D:/Code/PythonCode/5%20LiveSetList/docs/openapi.json)

本文档只保留自动文档之外更有价值的补充信息，例如：

- 接口用途总览
- 白盒实现下的重要业务规则
- 排序、去重、归一化等返回规则
- 当前错误处理方式的说明

## API 速览

- `GET /`
  - 服务根路由，用于确认后端服务已启动
- `GET /api/health/db`
  - 数据库健康检查
- `POST /api/auth/login`
  - 用户登录，写入 session cookie 并返回用户信息与 CSRF Token
- `GET /api/auth/me`
  - 获取当前登录态，已登录时返回用户信息、CSRF Token 和收藏 ID 列表
- `POST /api/auth/logout`
  - 退出当前登录态并使 session 失效
- `GET /api/me/favorites/lives`
  - 获取当前登录用户的收藏分页列表
- `PUT /api/me/favorites/lives/{live_id}`
  - 收藏指定 live
- `DELETE /api/me/favorites/lives/{live_id}`
  - 取消收藏指定 live
- `GET /api/lives`
  - Live 列表分页查询
- `GET /api/lives/{live_id}`
  - 单条 Live 详情查询
- `POST /api/lives/details:batch`
  - 批量详情预读接口
- `GET /api/console/songs`
  - `editor+` 查询控制台歌曲候选
- `GET /api/console/bands`
  - `editor+` 查询控制台乐队与成员候选
- `GET /api/console/venues`
  - `editor+` 查询控制台场地候选
- `POST /api/console/songs`
  - `editor+` 新增单首歌曲
- `POST /api/console/songs:batch`
  - 批量新增歌曲，一次写入多条，单项冲突不影响其他项继续写入
- `POST /api/console/venues`
  - `editor+` 新增场地
- `POST /api/console/lives`
  - `editor+` 新增 Live；`live_type` 必填，值为稳定 code
- `POST /api/console/lives/{live_id}/setlist`
  - `editor+` 向指定 Live 追加 setlist 行；当前是 append-only，不修改既有 setlist

说明：
- 全量路径、请求参数、响应 schema 请直接查看自动文档
- 控制台写接口都要求有效登录态、`editor+` 角色和 `X-CSRF-Token`

## 自动文档中已覆盖的内容

以下内容现在应优先查看 `/docs` 或 `/redoc`：

- 路径与方法
- 查询参数 / 路径参数 / 请求体
- 成功响应结构
- 常见错误状态码
- schema 字段类型

## 补充规则

### 1. `GET /api/lives`

自动文档能看到字段结构，但以下规则更值得额外说明：

- `page_size` 当前只允许 `15` 或 `20`
- 当请求页码超过最后一页时，后端会自动钳制到最后一页
- `bands` 来自 `live_setlist.band_member` 中聚合出的乐队 ID
- `bands` 会去重并按升序返回
- `url` 当前来自 `live_attrs.url`
- `is_favorite` 会按当前登录用户的 `user_live_favorites` 计算；匿名请求统一返回 `false`

### 2. `GET /api/lives/{live_id}`

自动文档能看到详情结构，但这些行为不会自然体现在 OpenAPI schema 中：

- `detail_rows` 实际按数据库中的 `absolute_order` 返回，不按 `row_id` 字典序排序
- `band_names` 会先去重，再按 `bands` 中的 `band_id` 顺序排列
- 无法映射到 `band_id` 的乐队名称排在 `band_names` 末尾
- `band_members` 优先按 `band_id` 升序排列，无法映射到 `band_id` 的项目排在后面
- `band_members[].present_count = present_members.length`
- `band_members[].total_count` 来自 `band_attrs.band_members` 的数据库查询结果
- `band_members[].is_full = present_count >= total_count`
- `other_members` 会统一归一化为 `{key, value: string[]}`
- `other_members` 的 `value` 允许源数据是数组、单个字符串、JSON 字符串数组、JSON 字符串字面量
- `other_members` 最终按 `key` 升序排列
- `comments` 当前仅在 `is_short = true` 时返回 `["短版"]`
- `is_favorite` 会按当前登录用户的 `user_live_favorites` 计算；匿名请求统一返回 `false`

### 3. `POST /api/lives/details:batch`

这个接口的 schema 很直观，但业务行为有几个点需要补充：

- `live_ids` 会先去重并保留原始请求顺序
- 允许部分成功
- 未命中的 ID 会进入 `missing_live_ids`
- `items` 按去重后的请求顺序返回，而不是数据库自然顺序
- `missing_live_ids` 也按去重后的请求顺序返回
- `items` 中的单项结构与 `GET /api/lives/{live_id}` 一致

### 4. `GET /api/me/favorites/lives`

自动文档能看到字段结构，但以下规则更值得额外说明：

- 该接口要求已登录
- 返回结构与 `GET /api/lives` 保持一致
- `items[].is_favorite` 恒为 `true`
- 取消收藏后，该接口会立即反映最新结果

### 5. 控制台 lookup 接口

`GET /api/console/songs`、`GET /api/console/bands`、`GET /api/console/venues` 用于控制台录入候选查询。

- 三个接口都要求 `editor+`
- `q` 会 trim；空字符串等同于默认候选列表
- `limit` 范围是 `1..100`，默认 `20`
- 文本查询使用 `ILIKE`，并转义 `%`、`_`、`\`
- 歌曲查询会把名称精确匹配结果排在前面，再按 `song_name, id` 排序
- 乐队查询匹配 `band_name` 或 `band_abbr`
- 场地查询匹配 `venue`

### 6. 控制台写接口

当前控制台已接入真实写接口，统一使用 `get_write_db_connection()`，并写入 `audit_logs`。

- 所有写接口都要求 `editor+` 和有效 CSRF header
- `POST /api/console/songs`
  - 要求 `band_id` 已存在
  - 歌曲唯一键冲突返回 `409`
- `POST /api/console/songs:batch`
  - 最多一次提交 100 首
  - 单项 band 不存在或歌曲冲突会跳过该项，不回滚其他成功项
  - `ok` 只有在全部请求项都成功创建时才为 `true`
- `POST /api/console/venues`
  - 写入 `venue_list(venue)`，`id` 由 sequence 生成
- `POST /api/console/lives`
  - 要求 `venue_id` 已存在
  - `opening_time` / `start_time` 接受 `HH:mm` 或 `HH:mm:ss`，并与 `timezone` 组合成带时区时间
  - `live_type` 必填，只允许 `oneman`、`taiban`、`multi_act`、`festival`、`event`、`other`
- `POST /api/console/lives/{live_id}/setlist`
  - 要求目标 Live 存在
  - 如果目标 Live 已有任何 setlist 行，返回 `409`
  - 请求体内 `absolute_order` 不能重复
  - 所有 `song_id` 都必须存在
  - `band_member` 至少需要包含一个非空乐队和成员列表
  - 后端按 `absolute_order` 升序写入

## 错误处理说明

当前实现没有自定义统一错误包装，仍以 FastAPI 默认错误结构为主。

常见情况：

- `400`
  - 参数错误
- `404`
  - 资源不存在
- `422`
  - 请求体验证失败
- `500`
  - 数据库或服务内部错误
- `504`
  - 数据库连接超时或查询超时

说明：
- `400/404/500/504` 当前通常返回 `{"detail": "..."}` 这种字符串结构
- auth 相关接口在 `401/403` 下通常返回 `{"detail": {"code": "...", "message": "..."}}`
- `422` 当前通常返回 FastAPI / Pydantic 默认的数组型校验错误结构

## 维护建议

后续若接口发生变化，建议按以下顺序维护：

1. 先修改后端 schema / route metadata
2. 以自动生成的 OpenAPI 文档作为主契约
3. 若有必要，再更新本文档中的补充规则

这样可以减少“手写 Markdown 文档”和“实际代码行为”之间的漂移。
