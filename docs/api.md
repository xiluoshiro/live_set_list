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
  - 取消 Live 不可新增收藏；批量新增时归入 `noop_live_ids`
- `PUT /api/me/favorites/lives/{live_id}`
  - 收藏指定 live
  - 目标已取消时返回 `409`
- `DELETE /api/me/favorites/lives/{live_id}`
  - 取消收藏指定 live
- `GET /api/lives`
  - Live 列表分页查询
- `GET /api/lives/{live_id}`
  - 单条 Live 详情查询
- `POST /api/lives/details:batch`
  - 批量详情预读接口
- `GET /api/catalog/performances`
  - “演出资料”统一分页投影，混合返回独立 Live 与至少两场的演出活动组；支持全部 / 当前用户收藏范围
- `GET /api/catalog/performance-groups/{group_id}`
  - 公共活动组详情、自动排序子 Live 与逐场收藏状态，匿名可用
- `GET /api/catalog/tours`
  - 公共巡演聚合列表，匿名可用
- `GET /api/catalog/tours/{tour_id}`
  - 公共巡演详情和已收录场次，匿名可用
- `GET /api/catalog/tours/{tour_id}/statistics`
  - 公共巡演 Setlist 覆盖与相邻场次变化统计，匿名可用；显式指定参与乐队时仅统计指定乐队
- `GET /api/catalog/tours/{tour_id}/statistics/comparison`
  - 按需比较同一巡演内任意两场已有 Setlist 的场次，匿名可用
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
  - `editor+` 查询控制台歌曲候选，支持按归属 Band 筛选
- `GET /api/console/bands`
  - `editor+` 查询控制台乐队与成员候选
- `POST /api/console/bands`
  - `editor+` 从常规或特殊编号段新增 Band，并原子建立当前名称与 V1 阵容历史
- `GET /api/console/bands/{band_id}/history`
  - `editor+` 查询当前投影、历史名称、不可变阵容版本、成员差异与引用 Live
- `POST /api/console/bands/{band_id}/name-versions`
  - `editor+` 追加一个当前名称版本；服务端自动闭合原开放版本并同步稳定 Band 名称投影
- `POST /api/console/bands/{band_id}/lineup-versions`
  - `editor+` 追加不可变阵容版本；服务端锁定开放版本、自动闭合有效期和分配版本号，可绑定一场已关联该 Band 的交接 Live
- `GET /api/console/bands/{band_id}/transition-live-candidates`
  - `editor+` 按日期查询该 Band 可绑定的既有交接 Live；最终保存显式 `live_id`
- `GET /api/console/venues`
  - `editor+` 查询控制台场地候选
- `GET /api/console/lives`
  - `editor+` 按标题或 ID 分页查询全部可编辑 Live，并可用 `live_type`、`has_setlist` 筛选
- `GET /api/console/lives/{live_id}`
  - `editor+` 获取 Live 基础资料、Venue、默认 Band 和计算后的活动出演成员
- `POST /api/console/songs`
  - `editor+` 新增单首歌曲
- `PUT /api/console/songs/{song_id}`
  - `editor+` 更新歌曲名称、归属 Band 和翻唱属性
- `POST /api/console/songs:batch`
  - 批量新增歌曲，一次写入多条，单项冲突不影响其他项继续写入
- `POST /api/console/venues`
  - `editor+` 新增场地
- `POST /api/console/lives`
  - `editor+` 新增 Live；`live_type` 必填，值为稳定 code
- `PUT /api/console/lives/{live_id}`
  - `editor+` 完整更新 Live 基础资料，不修改 Setlist、巡演、活动组或收藏关系
- `POST /api/console/lives/{live_id}/setlist`
  - `editor+` 为尚无 Setlist 的 Live 新增完整行集合
- `GET /api/console/lives/{live_id}/setlist`
  - `editor+` 获取 Setlist 管理所需的原始行、song_id、顺序与成员 JSON
- `PUT /api/console/lives/{live_id}/setlist`
  - `editor+` 以请求中的完整行集替换指定 Live 的既有 Setlist
- `GET /api/console/tours/live-candidates`
  - `editor+` 按 Live 标题或 ID 分页查询尚未关联任何巡演的场次候选，并返回场地
- `GET /api/console/tours/{tour_id}`
  - `editor+` 获取巡演标题、显式参与乐队和完整场次关系，供控制台编辑
- `POST /api/console/tours`
  - `editor+` 在一个事务中创建巡演及完整乐队、场次关系
- `PUT /api/console/tours/{tour_id}`
  - `editor+` 更新巡演，并以请求中的乐队和场次作为完整目标集合替换现有关系
- `GET /api/console/performance-groups`
  - `editor+` 获取全部可编辑活动组，按名称和 ID 排序
- `GET /api/console/performance-groups/live-candidates`
  - `editor+` 查询尚未关联任何活动组的 Live 候选
- `GET /api/console/performance-groups/{group_id}`
  - `editor+` 获取活动组编辑数据和规范顺序场次
- `POST /api/console/performance-groups`
  - `editor+` 创建活动组及完整 Live 关系
- `PUT /api/console/performance-groups/{group_id}`
  - `editor+` 完整替换活动组名称与 Live 关系

说明：
- 全量路径、请求参数、响应 schema 请直接查看自动文档
- 控制台写接口都要求有效登录态、`editor+` 角色和 `X-CSRF-Token`
- `GET /api/auth/me` 会为当前 session 签发新的 CSRF Token；同一 session 已签发的 token 在 session 过期或注销前都有效，避免多个标签页互相使 token 失效
- `GET /api/catalog/statistics?scope=favorites` 与 `GET /api/catalog/performances?scope=favorites` 都要求登录，且不接收 `user_id`，只使用当前 session 用户的收藏

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
- `without_setlist=true` 时，仅返回状态非“已取消”且尚无 `live_setlist` 数据的 Live，并在数据库分页前优先排列非 `event` 类型；控制台“新增 Setlist”候选使用该筛选
- `q` 会 trim；空字符串等同于未传，最大长度为 `255`，匹配 Live 标题、场地、歌曲、乐队名和乐队缩写
- `year` 范围为 `1900..2100`
- `live_type` 只允许 `oneman`、`taiban`、`multi_act`、`festival`、`event`、`other`
- Live 列表项、收藏列表项、乐队 Live、catalog 搜索 Live、单详情和批量详情都会返回 `tour` 与 `performance_group` 反向引用；未归属时为 `null`，已归属时分别返回 `{tour_id, tour_title}` 与 `{group_id, group_title}`
- 所有公开 Live 列表项都会返回人工状态 `event_status`、按 Live 当地日期计算的 `date_phase`，以及是否存在正式改期历史的 `was_rescheduled`
- `band_id` 必须大于等于 `1`；有 Setlist 时按版本化逐曲出演关系判断，无 Setlist 时按 `live_attrs.default_band_ids` 判断
- `sort` 只允许 `date_desc` 或 `date_asc`，默认 `date_desc`
- 多个筛选条件按 AND 组合；文本值使用参数绑定并转义 `%`、`_`、`\`
- 当请求页码超过最后一页时，后端会自动钳制到最后一页
- `bands` 在 Live 存在任意 Setlist 行时来自 `live_setlist_band_performances` 聚合；仅在完全没有 Setlist 行时回退到 `live_attrs.default_band_ids`
- 一旦存在任意 setlist 行，即使无法聚合出有效乐队，也不会再回退 `default_band_ids`
- `bands` 会去重并按升序返回
- `url` 当前来自 `live_attrs.url`
- `is_favorite` 会按当前登录用户的 `user_live_favorites` 计算；匿名请求统一返回 `false`

### 2. `GET /api/lives/{live_id}`

自动文档能看到详情结构，但这些行为不会自然体现在 OpenAPI schema 中：

- `detail_rows` 实际按数据库中的 `absolute_order` 返回，不按 `row_id` 字典序排序
- `detail_rows[].setlist_id` 是稳定的 `live_setlist` UUID，用于关联逐曲出演和前端交互；`row_id` 仍是 `segment_type + sub_order` 展示编号，同一 Live 中允许重复
- `band_names` 会先去重，再按 `bands` 中的 `band_id` 顺序排列
- 无法映射到 `band_id` 的乐队名称排在 `band_names` 末尾
- `band_members` 优先按 `band_id` 升序排列，无法映射到 `band_id` 的项目排在后面
- `band_members[].present_count = present_members.length`
- 详情只读取持久化的 Live 阵容上下文、逐曲阵容用法和实际出演成员，不再从旧成员 JSON 反推历史阵容
- `lineup_usage` 为 `base|next|handover`；`lineup_version` 是本场基础版本，交接场还会返回 `next_lineup_version`
- `handover` 行额外返回 `handover_baseline=base|next`，明确旧阵容或新阵容是满员判断的正式基准；其他模式返回 `null`
- `attendance_status` 为 `full|full_plus|partial|unknown`，由预期成员集合与实际出演成员集合比较得到
- `expected_count`、`missing_members` 和 `extra_members` 分别表达预期人数、缺席成员和额外出演；额外出演类别为 `former|incoming|guest|support`
- `total_count` 是 `expected_count` 的兼容别名；`is_full` 仅在 `full` 或 `full_plus` 时为 `true`，新前端以 `attendance_status` 为准
- 缺少可信版本关系时返回 `attendance_status=unknown`、`expected_count=0`，不会再用默认五人或当前阵容误判满员
- `other_members` 会统一归一化为 `{key, value: string[]}`
- `other_members` 的 `value` 允许源数据是数组、单个字符串、JSON 字符串数组、JSON 字符串字面量
- `other_members` 最终按 `key` 升序排列
- `comments` 由详情行规则生成：`live_setlist.is_short = true` 时包含 `"短版"`；`song_list.is_cover = true` 或歌曲目录归属 Band 不在实际演唱乐队中时包含 `"翻唱"`
- `cover_band` 只在后端根据“歌曲目录归属 Band 不属于实际演唱乐队”推导翻唱时返回该归属 Band；歌曲自身 `is_cover=true` 的手工标签不返回 `cover_band`
- `is_favorite` 会按当前登录用户的 `user_live_favorites` 计算；匿名请求统一返回 `false`
- 无 Setlist 时，单条与批量详情的 `bands/band_names` 会回退 `default_band_ids`，与列表有效 Band 规则一致
- `event_attendees` 只在 `live_type=event` 时返回内容；每项包含 `band_id/band_name/mode/members`
- `mode=full|partial` 不持久化；按固化基础阵容做成员集合比较，新建活动上下文统一使用当前开放阵容
- 详情返回 `event_status/date_phase/status_note/was_rescheduled`；`schedule_history` 只包含正式改期前的快照，前端仅展示实际变化的标题、日期、时间或场地，不包含资料修正

### 3. `POST /api/lives/details:batch`

这个接口的 schema 很直观，但业务行为有几个点需要补充：

- `live_ids` 会先去重并保留原始请求顺序
- 每条详情与单条接口共用相同的版本化成员和到场状态计算
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

`GET /api/catalog/search`、`GET /api/catalog/bands`、`GET /api/catalog/bands/{band_id}/lives`、`GET /api/catalog/performances`、`GET /api/catalog/performance-groups/{group_id}`、`GET /api/catalog/tours`、`GET /api/catalog/tours/{tour_id}`、`GET /api/catalog/tours/{tour_id}/statistics`、`GET /api/catalog/tours/{tour_id}/statistics/comparison`、`GET /api/catalog/stats`、`GET /api/catalog/statistics?scope=all` 用于匿名可访问的公共资料库搜索、浏览与统计。

- 上述公共读取默认不要求登录；`GET /api/catalog/statistics?scope=favorites` 与 `GET /api/catalog/performances?scope=favorites` 要求当前 session 已登录。
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
  - 乐队结果额外返回当前开放阵容的 `band_members`；`live_count` 与 Live 列表统一读取 `effective_live_bands`
- `GET /api/catalog/bands`
  - `limit` 范围是 `1..100`，默认 `20`
  - 当前只返回 `band_attrs.id > 0` 的乐队
  - 返回默认成员目录 `band_members`
  - `live_count` 与 Live 列表使用同一 `effective_live_bands` 规则
  - 当前列表按 `band_attrs.id` 排序
- `GET /api/catalog/bands/{band_id}/lives`
  - `band_id` 必须大于等于 `1`
  - `page_size` 当前只允许 `15` 或 `20`
  - 页码超过最后一页时会自动钳制到最后一页
  - 未找到乐队时返回 `404`
  - `band` 返回 `band_members`；页面可展示该乐队的默认成员目录
  - Live 匹配与 `live_count` 使用同一 `effective_live_bands` 规则
  - Live 结果按 `live_date DESC, id DESC` 排序
- `GET /api/catalog/performances`
  - `scope` 只允许 `all` 或 `favorites`，默认 `all`；`favorites` 要求当前 session 已登录
  - 支持 `q/year/live_type/band_id/sort`，含义与演出资料现有筛选一致；全部场次命中或关键词直接命中组名时返回完整组，只有部分场次命中时逐场返回
  - 服务端先生成独立 Live / 完整活动组 / 部分命中单场的联合投影，再 count 和分页，禁止前端按当前页临时合并
  - `scope=all` 中，无筛选、全部场次命中或组名命中时返回一个 `kind=performance_group`；其他部分命中返回带活动组反向引用的 `kind=live`
  - `scope=favorites` 中，组内全部 Live 已收藏且满足完整组展示规则时返回组项；部分收藏时仅返回实际命中的已收藏子 Live，组名命中也不会带出未收藏场次
  - 活动组因 Live 删除只剩一场时不再作为有效组，剩余 Live 自动恢复为独立 `kind=live` 项
  - 默认倒序使用完整组 `end_date` / 单场 Live 日期及对应开演时间，升序使用完整组 `start_date` / 单场 Live 日期及对应开演时间；只有日期和开演时间都相同时才以实体 ID 保持稳定
- `GET /api/catalog/performance-groups/{group_id}`
  - 只对至少两场的有效活动组返回详情；不存在或无效组返回 `404`
  - 子 Live 按 `live_date ASC, start_time ASC, live_id ASC` 返回
  - 返回动态 `day_count/live_count/display_type`、参与乐队、场地和每场 Live 的当前用户收藏状态
  - 活动组本身没有收藏字段；前端在详情中继续逐场收藏
- `GET /api/catalog/tours`
  - `page_size` 当前只允许 `15` 或 `20`，超过最后一页会钳制到最后一页
  - `q` 匹配巡演名称、场次标签和关联 Live 标题，并转义 `%`、`_`、`\`
  - `year` 表示至少一场已收录 Live 位于该年份；跨年巡演可以命中多个年份
  - `band_id` 在巡演显式维护 `tour_bands` 时匹配该集合；未显式指定时，回退到各场 Live 的有效乐队
  - 默认按最后一场的日期、开演时间倒序；升序按第一场的日期、开演时间排序；ID 仅作完全同时间的稳定兜底
  - 只返回至少关联一场 Live 的巡演，日期范围和 `collected_live_count` 均由当前关联实时聚合
- `GET /api/catalog/tours/{tour_id}`
  - 场次保持活动组连续；同日起始时含取消场次的活动组块优先，块内同日取消场次也优先于正常场次；`stop_order` 是服务端按公共展示顺序生成的连续值
  - `url` 取日期最早场次的 Live URL，`description` 当前固定为 `null`
  - `tour_bands` 为空时，`bands` 从全部场次的有效 Live 乐队动态聚合并按 Band ID 排序
  - `has_setlist` 只表示是否至少存在一行 setlist，不加载 setlist 明细
  - 登录用户的场次带当前用户 `is_favorite`；匿名统一为 `false`
  - 页面文案应使用“已收录 N 场”，不能把当前关联数描述成官方总场数
- `GET /api/catalog/tours/{tour_id}/statistics`
  - 返回巡演覆盖、歌曲状态和未取消且有可纳入 Setlist 的相邻场次差异；中间的取消或无 Setlist 场次不会截断前后有效场次
  - 显式指定 `tour_bands` 时只统计命中指定乐队的 Setlist；未指定时统计全部 Setlist
- `GET /api/catalog/tours/{tour_id}/statistics/comparison`
  - 必填查询参数为 `from_live_id` 与 `to_live_id`，两者必须不同且大于等于 1
  - 两场都必须属于该巡演、未取消且存在可纳入统计的 Setlist；否则返回 `422`
  - 成功时返回与相邻场次 `transitions[]` 单项相同的差异结构，不改变默认相邻比较结果
- `GET /api/catalog/stats`
  - 返回 `band_count/song_count/venue_count/latest_live_date/years`
  - `years` 返回数据库实际存在的 Live 年份，按降序排列
  - 前端年份筛选只显示年份本身，不显示命中数量
- `GET /api/catalog/statistics`
  - `scope` 只允许 `all` 或 `favorites`，默认 `all`；`favorites` 要求当前 session 已登录，不接受外部 `user_id`
  - 可选筛选为 `year`、`live_type`、`band_id`；`limit` 范围为 `5..50`，默认 `10`，只限制已选乐队时的歌曲 Top N 和久未演唱列表
  - 全部 / 收藏只改变候选 Live 集合，概览、年份分布、类型分布和歌曲聚合共用同一查询口径
  - 按 `effective_live_bands` 判断实际参与乐队；该视图仅在完全没有 Setlist 时回退 `live_attrs.default_band_ids`
  - `overview.song_count` 按 `(实际演唱乐队, song_id)` 去重；同一歌曲被多支乐队演唱时会形成多个乐队歌曲项
  - `top_songs.band_id / band_name` 表示该次统计中的实际演唱乐队，不表示 `song_list.band_id` 中的歌曲目录归属
  - 未指定 `band_id` 时，先在每支乐队内部按出现 Live 数、setlist 条目数、歌名和 `song_id` 排名，只返回每队第 1 名，最终按 `band_id` 升序
  - 指定 `band_id` 时，返回该乐队 Top N，按出现 Live 数、setlist 条目数、歌名和 `song_id` 排序
  - `stale_songs` 只在指定乐队时计算；只演唱过 1 场的歌曲也会纳入，并返回全部歌曲中最久未演唱的前 `limit` 首
  - `stale_songs_by_kind.original / cover` 分别独立排序并各自返回前 `limit` 首，前端对应“原创 / 翻唱”页签；三组窗口相互独立，不要求原创与翻唱数量之和等于全部
  - 每项通过 `is_cover` 标识原创/翻唱，并返回距该乐队最近候选 Live 的天数及此后缺席场次
  - `live_types.key` 返回稳定 code；中文名称由前端唯一的 `LIVE_TYPE_LABELS` 字典格式化，其中 `multi_act` 显示为“拼盘”

### 6. 控制台 lookup 接口

`GET /api/console/songs`、`GET /api/console/bands`、`GET /api/console/venues` 用于控制台录入候选查询。

- 三个接口都要求 `editor+`
- `q` 会 trim；空字符串等同于默认候选列表
- `limit` 范围是 `1..100`，默认 `20`
- 歌曲接口额外支持 `page`（默认 `1`）和可选 `band_id`（归属 Band，可与 `q` 组合），并返回 `page / page_size / total / total_pages`；超出末页时收敛到最后一页
- 文本查询使用 `ILIKE`，并转义 `%`、`_`、`\`
- 歌曲查询仅从名称开头向右匹配，不匹配名称中段或末段；同时按 `config/song_lookup_punctuation_groups.json` 对常见等价标点做查询归一化，并忽略这些标点前后的空白。含内部等价标点的拉丁词与相邻日文之间的空白也会忽略，普通词间空格仍参与匹配。名称精确匹配结果排在前面，再按 `song_name, id` 排序
- 乐队查询匹配 `band_name` 或 `band_abbr`
- 场地查询匹配 `venue`

### 7. 控制台写接口

当前控制台已接入真实写接口，统一使用 `get_write_db_connection()`，并写入 `audit_logs`。

- 所有写接口都要求 `editor+` 和有效 CSRF header
- `POST /api/console/songs`
  - 要求 `band_id` 已存在
  - 歌曲唯一键冲突返回 `409`
- `POST /api/console/bands`
  - 请求使用 `id_range=regular|special` 选择编号段，不接受手工 Band ID
  - `regular` 从 `1..99` 内现有最大 ID 继续递增；`special` 从 `101+` 内现有最大 ID 继续递增；两段不复用空洞、不互相溢出，`100` 永久保留
  - ID 分配在 transaction advisory lock 内完成；常规段已到 `99` 时返回 `409`
  - `band_name` 会 trim，并拒绝与当前或历史名称忽略大小写后的重复；`band_abbr` 可空且不要求唯一
  - `members` 要求 `1..100` 个去空白后的非空、不重复名称；`valid_from` 可空
  - 单一事务写入 `band_attrs`、当前名称版本、V1 阵容及成员，并记录 `band_create` 审计；任一步失败均整体回滚
  - `band_id > 100` 只表示选择了特殊编号段；歌曲、Live、Tour、统计、筛选和历史版本仍与其他正数 Band 使用相同逻辑
- 乐队历史写接口
  - 历史名称与阵容版本只读；旧资料初始化、回填预检、impact 和原地修正入口已移除
  - `POST /api/console/bands/{band_id}/lineup-versions` 只接受标签、成员、变化类型、生效日、备注和可空 `transition_live_id`
  - 服务端锁定 Band 与唯一开放阵容，自动设置旧版 `valid_to`、下一 `version_no` 和直接前驱；失败时整体回滚
  - `addition/removal/replacement` 可绑定一场已关联该 Band 的交接 Live；`correction` 是追加式资料修正，禁止绑定交接
  - `GET /api/console/bands/{band_id}/transition-live-candidates?live_date=...` 按日期返回已关联且未取消的候选
- `PUT /api/console/songs/{song_id}`
  - 与新增歌曲共用字段契约；目标歌曲或 Band 不存在返回 `404`
  - 成功后写 `song_update` 审计
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
  - 新选择的默认 Band 一律固化唯一当前开放名称与阵容；已经存在的历史上下文保持不变
  - 成功响应返回后端已经验证并保存的 `default_band_ids` 与 `band_lineup_contexts`
  - `event_attendees` 只允许活动类型提交；每项 Band 必须属于 `default_band_ids`，成员按已固化基础阵容校验，未固化版本的兼容请求才回退当前成员目录
  - `event_attendees[].members` 始终保存完整名单；响应额外返回计算得到的 `mode=partial|full`
  - `event_status` 可为 `scheduled/postponed/cancelled`；`status_note` 仅在延期或取消时保留
- `GET /api/console/lives`
  - 候选包含有无 Setlist 的全部 Live，按 `live_date DESC, live_id DESC` 排序
  - `q` 同时支持标题模糊匹配和精确 Live ID
  - `live_type` 可选值为 `oneman`、`taiban`、`multi_act`、`festival`、`event`、`other`，与 `q` 按 AND 组合
  - `has_setlist=true|false` 可按是否已有 Setlist 筛选，与其他条件按 AND 组合
  - `event_status` 可按人工状态精确筛选；候选同时返回 `event_status/date_phase`
- `GET /api/console/lives/{live_id}`
  - 返回完整可编辑字段、`timezone`、默认 Band 的 `band_lineup_contexts` 和正式改期 `schedule_history`；活动出演成员的 `mode` 仍为计算值
- `PUT /api/console/lives/{live_id}`
  - 基本字段与新增 Live 共用契约，不接受出演成员 `mode`；排期变化时额外要求 `schedule_change_kind=correction|reschedule`
  - `reschedule` 会保存更新前的日期、开场、开演和 Venue 快照，`correction` 不写公开排期历史
  - 正式改期可附 `schedule_change_note`；没有排期字段变化时不得提交改期类型
  - `status_note` 只在 `postponed/cancelled` 时保存，并显示在公开详情状态栏；`scheduled` 请求中的空白或遗留说明会归一化为 `null`
  - 使用行锁并在单一事务中校验、更新；无实际变化时不写审计日志
  - 有变化时写 `live_update` 审计，payload 记录变化字段的前后值
  - 不修改 `live_setlist`、`tour_lives`、`performance_group_lives` 或收藏关系
- `POST /api/console/lives/{live_id}/setlist`
  - 要求目标 Live 存在
  - 如果目标 Live 已有任何 setlist 行，返回 `409`
  - 请求体内 `absolute_order` 不能重复
  - 所有 `song_id` 都必须存在
  - 请求不再接受 `band_member`；逐行必须提交稳定 `band_id` 的 `band_performances`
  - 普通新行由服务端补齐当前开放上下文；只有版本创建时绑定的交接 Live 可使用直接后继上下文
  - `band_performances[].lineup_usage` 为 `base|next|handover`；`handover` 必须额外提交 `handover_baseline=base|next`，其他模式禁止携带该字段
  - 实际出演 `members` 必须非空且不得重复；后端根据正式基准计算 `former|incoming|guest`，不接受前端提交满员状态
  - 新行只写版本化出演关系；V26 已物理删除 `live_setlist.band_member`
  - 后端按 `absolute_order` 升序写入
- `GET /api/console/lives/{live_id}/setlist`
  - 返回 Live 级 `band_lineup_contexts` 和完整可编辑行；行内 `band_member` 仅为从版本化出演关系生成的界面投影，不对应数据库旧列，真源为 `band_performances`
- `PUT /api/console/lives/{live_id}/setlist`
  - 与新增 Setlist 共用行字段和校验；请求集合至少保留一行
  - 在单一事务内锁定 Live、校验全部歌曲和版本关系、替换完整行集合并写 `live_setlist_update` 审计
- `POST /api/console/tours`、`PUT /api/console/tours/{tour_id}`
  - `band_ids` 可为空，最多 100 个已存在且不重复的正数 ID；后端按 Band ID 排序
  - `band_ids` 非空时，每个 Band 必须至少出现在一场所选 Live 中；为空时数据库关系保持空集合
  - 取消场次校验参与乐队时，会合并该 Live 的 Setlist 乐队与 `default_band_ids`
  - `stops` 要求 1~500 项且 `live_id` 不得重复；不接收人工 `stop_order`
  - 服务端按关联 Live 的 `live_date ASC, start_time ASC, live_id ASC` 生成连续 `stop_order`
  - 所有关联 Live 必须存在；Live 已属于其他巡演时返回 `409`，detail 包含冲突的 `live_id / tour_id / tour_title`
  - 创建与完整替换都在单一事务中完成，并写一条 `tour_create` 或 `tour_update` 汇总审计日志
  - 第一版不提供删除巡演接口
- `GET /api/console/tours/live-candidates`
  - 只返回尚未出现在 `tour_lives` 中的 Live；已被任意巡演占用的场次在数据库分页前排除
  - 候选包含 `start_time`，并按 `live_date DESC, start_time DESC, live_id DESC` 分页
- `GET /api/console/tours/{tour_id}`
  - 返回显式 `band_ids` 与完整 stops，按 `live_date ASC, start_time ASC, live_id ASC` 排序；`stop_label` 作为兼容字段返回，但当前控制台不展示或维护
- `GET /api/console/performance-groups`
  - 返回全部活动组的 `group_id/group_title`，按 `group_title ASC, group_id ASC` 排序；控制台不再从公共分页列表截取可编辑实体
- `GET /api/console/performance-groups/live-candidates`
  - 支持标题或精确 Live ID 查询；已出现在 `performance_group_lives` 的 Live 在 count 和分页前直接排除
  - 候选包含 `start_time`，供控制台按日期、开演时间和 ID 自动排序
- `GET /api/console/performance-groups/{group_id}`
  - 返回完整现有关系，按 `live_date ASC, start_time ASC, live_id ASC` 排序
- `POST /api/console/performance-groups`、`PUT /api/console/performance-groups/{group_id}`
  - `group_title` trim 后必须非空且最长 255；`live_ids` 要求 2~500 个存在且不重复的正整数
  - 一场 Live 最多属于一个活动组；更新允许保留当前组成员，不能接管其他组成员，冲突返回 `409`
  - 服务端不信任请求数组顺序，按 Live 日期、开演时间和 ID 生成关系写入、响应与审计中的 `ordered_live_ids`
  - 更新使用完整目标集合替换，并与 `performance_group_create/performance_group_update` 审计写入处于同一事务
  - 第一版不提供活动组删除、合并或拆分接口

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
