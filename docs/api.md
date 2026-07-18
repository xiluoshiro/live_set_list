# LiveSetList API 补充说明

本文档不再作为接口字段与响应结构的唯一真相源。  
当前 API 契约请优先以 FastAPI 自动生成文档为准：

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- OpenAPI JSON: `http://localhost:8000/openapi.json`
- 仓库内也可通过 `python scripts/export_openapi.py` 导出到 `docs/openapi.json`（该文件是生成物，未生成时不会存在）

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
- `POST /api/me/favorites/lives:batch`
  - 批量收藏或取消收藏 Live，要求登录态与 CSRF
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
- `GET /api/catalog/tours`
  - 公共巡演聚合列表，匿名可用
- `GET /api/catalog/tours/{tour_id}`
  - 公共巡演详情和已收录场次，匿名可用
- `GET /api/catalog/search`
  - 公共资料库搜索，匿名可用，按 Live、乐队 / 艺人、歌曲、场地分组返回结果
- `GET /api/catalog/bands`
  - 公共乐队浏览列表，匿名可用
- `GET /api/catalog/bands/{band_id}/lives`
  - 按乐队浏览相关 Live，匿名可用，登录时会附带收藏状态
- `GET /api/catalog/stats`
  - 首页和筛选器使用的 Live / 乐队 / 歌曲 / 场地总数、最新 Live 日期与可用年份
- `GET /api/catalog/statistics`
  - 公共统计页接口；统一支持全部 / 当前用户收藏范围，以及年份、乐队和 Live 类型筛选
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
- `GET /api/console/tours/live-candidates`
  - `editor+` 按 Live 标题或 ID 分页查询巡演场次候选，并返回场地和当前巡演归属
- `POST /api/console/tours`
  - `editor+` 在一个事务中创建巡演及完整乐队、场次关系
- `PUT /api/console/tours/{tour_id}`
  - `editor+` 更新巡演，并以请求中的乐队和场次作为完整目标集合替换现有关系

说明：
- 全量路径、请求参数、响应 schema 请直接查看自动文档
- 控制台写接口都要求有效登录态、`editor+` 角色和 `X-CSRF-Token`
- `GET /api/catalog/statistics?scope=favorites` 要求登录，但不接收 `user_id`，只统计当前 session 用户的收藏

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
- `without_setlist=true` 时，仅返回尚无 `live_setlist` 数据的 Live；控制台“新增 Setlist”候选使用该筛选
- `q` 会 trim；空字符串等同于未传，最大长度为 `255`，匹配 Live 标题、场地、歌曲、乐队名和乐队缩写
- `year` 范围为 `1900..2100`
- `live_type` 只允许 `oneman`、`taiban`、`multi_act`、`festival`、`event`、`other`
- Live 列表项、收藏列表项、乐队 Live、catalog 搜索 Live、单详情和批量详情都会返回 `tour`；未归入巡演时为 `null`，已归入时为 `{tour_id, tour_title}`
- `band_id` 必须大于等于 `1`；有 setlist 时按 `live_setlist.band_member` 判断，无 setlist 时按 `live_attrs.default_band_ids` 判断
- `sort` 只允许 `date_desc` 或 `date_asc`，默认 `date_desc`
- 多个筛选条件按 AND 组合；文本值使用参数绑定并转义 `%`、`_`、`\`
- 当请求页码超过最后一页时，后端会自动钳制到最后一页
- `bands` 在 Live 存在任意 setlist 行时来自 `live_setlist.band_member` 聚合；仅在完全没有 setlist 行时回退到 `live_attrs.default_band_ids`
- 一旦存在任意 setlist 行，即使无法聚合出有效乐队，也不会再回退 `default_band_ids`
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
- `comments` 由详情行规则生成：`live_setlist.is_short = true` 时包含 `"短版"`，`song_list.is_cover = true` 时包含 `"翻唱"`
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
- 支持与 `GET /api/lives` 相同的 `q/year/live_type/band_id/sort` 参数，筛选发生在收藏分页之前
- `items[].is_favorite` 恒为 `true`
- 取消收藏后，该接口会立即反映最新结果

#### 4.1 `POST /api/me/favorites/lives:batch`

- 该接口要求已登录，并校验 `X-CSRF-Token`
- `action` 只允许 `favorite` 或 `unfavorite`
- `live_ids` 接受 `1..100` 个正整数；后端去重并保留首次出现顺序
- 操作幂等：已经处于目标状态的 ID 进入 `noop_live_ids`
- 实际发生变化的 ID 进入 `applied_live_ids`，不存在的 Live 进入 `not_found_live_ids`
- `requested_count` 是服务端去重后的请求数量
- 每次批量操作写入一条汇总审计日志

### 5. 公共 catalog 接口

`GET /api/catalog/search`、`GET /api/catalog/bands`、`GET /api/catalog/bands/{band_id}/lives`、`GET /api/catalog/tours`、`GET /api/catalog/tours/{tour_id}`、`GET /api/catalog/stats`、`GET /api/catalog/statistics?scope=all` 用于匿名可访问的公共资料库搜索、浏览与统计。

- 上述公共读取默认不要求登录；只有 `GET /api/catalog/statistics?scope=favorites` 要求当前 session 已登录。
- 登录用户访问搜索结果或乐队 Live 列表时，Live 项的 `is_favorite` 会按当前用户收藏计算；匿名请求统一返回 `false`。
- `GET /api/catalog/search`
  - `q` 会 trim，空字符串返回 `400`
  - `q` 最大长度为 `255`
  - `limit` 范围是 `1..20`，默认 `8`
  - 文本查询使用 `ILIKE`，并转义 `%`、`_`、`\`
  - Live 分组会匹配 Live 标题、场地名、歌曲名、乐队名和乐队缩写
  - 乐队分组匹配 `band_name` 或 `band_abbr`
  - 歌曲分组匹配 `song_name`
  - 场地分组匹配 `venue`
  - Live 结果按 `live_date DESC, id DESC` 排序
  - 乐队、歌曲、场地分组优先按关联 Live 数降序排序
- `GET /api/catalog/bands`
  - `limit` 范围是 `1..100`，默认 `20`
  - 当前只返回 `band_attrs.id > 0` 的乐队
  - `live_count` 按 `live_setlist.band_member` 中的乐队名匹配统计
  - 当前公共乐队浏览统计不使用 `live_attrs.default_band_ids` 回退；该字段只影响通用 Live 列表、收藏列表及其 `band_id` 筛选
  - 当前列表按 `band_attrs.id` 排序
- `GET /api/catalog/bands/{band_id}/lives`
  - `band_id` 必须大于等于 `1`
  - `page_size` 当前只允许 `15` 或 `20`
  - 页码超过最后一页时会自动钳制到最后一页
  - 未找到乐队时返回 `404`
  - Live 结果按 `live_date DESC, id DESC` 排序
- `GET /api/catalog/tours`
  - `page_size` 当前只允许 `15` 或 `20`，超过最后一页会钳制到最后一页
  - `q` 匹配巡演名称、场次标签和关联 Live 标题，并转义 `%`、`_`、`\`
  - `year` 表示至少一场已收录 Live 位于该年份；跨年巡演可以命中多个年份
  - `band_id` 只匹配 `tour_bands` 中显式维护的巡演乐队，不从 setlist 推断
  - 默认按已收录场次的最晚日期倒序；升序按最早日期排序
  - 只返回至少关联一场 Live 的巡演，日期范围和 `collected_live_count` 均由当前关联实时聚合
- `GET /api/catalog/tours/{tour_id}`
  - 场次按 `tour_lives.stop_order` 返回
  - `has_setlist` 只表示是否至少存在一行 setlist，不加载 setlist 明细
  - 登录用户的场次带当前用户 `is_favorite`；匿名统一为 `false`
  - 页面文案应使用“已收录 N 场”，不能把当前关联数描述成官方总场数
- `GET /api/catalog/stats`
  - `years` 返回数据库实际存在的 Live 年份，按降序排列
  - 前端年份筛选只显示年份本身，不显示命中数量
- `GET /api/catalog/statistics`
  - `scope` 只允许 `all` 或 `favorites`，默认 `all`；`favorites` 要求当前 session 已登录，不接受外部 `user_id`
  - 可选筛选为 `year`、`live_type`、`band_id`；`limit` 范围为 `5..50`，默认 `10`，只限制已选乐队时的歌曲 Top N 和久未演唱列表
  - 全部 / 收藏只改变候选 Live 集合，概览、年份分布、类型分布和歌曲聚合共用同一查询口径
  - 有 setlist 时按 `live_setlist.band_member` 判断实际参与乐队；完全没有 setlist 时才回退 `live_attrs.default_band_ids`
  - `overview.song_count` 按 `(实际演唱乐队, song_id)` 去重；同一歌曲被多支乐队演唱时会形成多个乐队歌曲项
  - `top_songs.band_id / band_name` 表示该次统计中的实际演唱乐队，不表示 `song_list.band_id` 中的歌曲目录归属
  - 未指定 `band_id` 时，先在每支乐队内部按出现 Live 数、setlist 条目数、歌名和 `song_id` 排名，只返回每队第 1 名，最终按 `band_id` 升序
  - 指定 `band_id` 时，返回该乐队 Top N，按出现 Live 数、setlist 条目数、歌名和 `song_id` 排序
  - `stale_songs` 只在指定乐队时计算；歌曲至少出现于 2 场候选 Live，并返回距该乐队最近候选 Live 的天数及此后缺席场次
  - `live_types.key` 返回稳定 code；中文名称由前端唯一的 `LIVE_TYPE_LABELS` 字典格式化，其中 `multi_act` 显示为“拼盘”

### 6. 控制台 lookup 接口

`GET /api/console/songs`、`GET /api/console/bands`、`GET /api/console/venues` 用于控制台录入候选查询。

- 三个接口都要求 `editor+`
- `q` 会 trim；空字符串等同于默认候选列表
- `limit` 范围是 `1..100`，默认 `20`
- 文本查询使用 `ILIKE`，并转义 `%`、`_`、`\`
- 歌曲查询会额外按 `config/song_lookup_punctuation_groups.json` 对常见等价标点做查询归一化，并把名称精确匹配结果排在前面，再按 `song_name, id` 排序
- 乐队查询匹配 `band_name` 或 `band_abbr`
- 场地查询匹配 `venue`

### 7. 控制台写接口

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
  - `default_band_ids` 可选，最多 100 项；后端要求每项为已存在的正数 `band_attrs.id`，并去重、升序后写入
  - `default_band_ids` 只在该 Live 尚无任何 setlist 行时作为列表 Band 使用
  - 成功响应会原样返回后端已经验证并保存的 `default_band_ids`
- `POST /api/console/lives/{live_id}/setlist`
  - 要求目标 Live 存在
  - 如果目标 Live 已有任何 setlist 行，返回 `409`
  - 请求体内 `absolute_order` 不能重复
  - 所有 `song_id` 都必须存在
  - `band_member` 至少需要包含一个非空乐队和成员列表
  - 后端按 `absolute_order` 升序写入
- `POST /api/console/tours`、`PUT /api/console/tours/{tour_id}`
  - `band_ids` 要求 1~100 个已存在且不重复的正数 ID，请求顺序即展示顺序
  - `stops` 要求 1~500 项，`live_id` 与 `stop_order` 分别不得重复
  - 所有关联 Live 必须存在；Live 已属于其他巡演时返回 `409`，detail 包含冲突的 `live_id / tour_id / tour_title`
  - 创建与完整替换都在单一事务中完成，并写一条 `tour_create` 或 `tour_update` 汇总审计日志
  - 第一版不提供删除巡演接口

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
