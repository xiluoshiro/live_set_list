# LiveSetList API 文档

本文档基于当前后端实现与测试用例整理，描述的是“已经实现并对外暴露的行为”，而不是仅有的设计草案。

## API 速览

- [`GET /`](#1-服务根路由)
- [`GET /api/health/db`](#2-数据库健康检查)
- [`GET /api/lives`](#3-获取-live-列表)
- [`GET /api/lives/{live_id}`](#4-获取单条-live-详情)
- [`POST /api/lives/details:batch`](#5-批量获取-live-详情)

## 基础信息

- Base URL: `http://localhost:8000`
- Content-Type: `application/json`
- 当前后端为 FastAPI 服务
- 当前已配置允许前端 `http://localhost:5173` 跨域访问

## 1. 服务根路由

`GET /`

### 说明

用于确认后端服务本身已启动，不访问数据库。

### 200 Response

```json
{
  "message": "LiveSetList backend is running"
}
```

## 2. 数据库健康检查

`GET /api/health/db`

### 说明

用于确认数据库可连接。后端会建立数据库连接并执行：

```sql
select 1;
```

### 200 Response

```json
{
  "ok": true,
  "result": 1
}
```

说明：
- 若 SQL 正常执行但未取到行，`result` 可能为 `null`
- 当前实现只检查“是否能连上并执行简单语句”，不检查业务表状态

### 错误行为

- 数据库异常时返回 `500`
- 当前错误结构为 FastAPI 默认格式，例如：

```json
{
  "detail": "Database error: db down"
}
```

## 3. 获取 Live 列表

`GET /api/lives`

### 查询参数

- `page` (number, optional)
  - 页码，从 `1` 开始
  - 默认值：`1`
  - 约束：必须 `>= 1`
- `page_size` (number, optional)
  - 每页条数
  - 默认值：`20`
  - 允许值：`15` 或 `20`

### 请求示例

`GET /api/lives?page=1&page_size=20`

### 实现逻辑

后端会：

1. 校验 `page_size` 是否为 `15` 或 `20`
2. 基于 `live_attrs + live_setlist + band_attrs` 聚合出列表总数
3. 按 `live_date DESC, id DESC` 查询当前页
4. 从 `live_setlist.band_member` 的 JSONB key 中抽取乐队名，再映射为 `band_id`
5. 返回列表项与分页信息

### 200 Response

```json
{
  "items": [
    {
      "live_id": 123,
      "live_date": "2026-03-28",
      "live_title": "示例 Live 名称",
      "bands": [1, 2, 3],
      "url": null
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 47,
    "total_pages": 3
  }
}
```

### 字段说明

- `live_id`: Live 主键 ID
- `live_date`: Live 日期
- `live_title`: Live 标题
- `bands`: 从明细中聚合出的乐队 ID 列表，去重后按升序返回
- `url`: 当前实现固定返回 `null`，尚未真正从数据库读取链接字段

### 分页行为

- 当 `total = 0` 时，固定返回：
  - `page = 1`
  - `total_pages = 1`
- 当请求页码超过最后一页时，后端会自动钳制到最后一页
  - 例如请求 `page=99`，若实际只有 2 页，则返回的 `pagination.page` 为 `2`

### 常见错误

- `400`: `page_size` 非法
- `500`: 数据库一般错误
- `504`: 数据库连接超时或查询超时

## 4. 获取单条 Live 详情

`GET /api/lives/{live_id}`

### 路径参数

- `live_id` (number, required)
  - Live 主键 ID
  - 必须 `>= 1`

### 实现逻辑

后端会分两步查询并做白盒格式化：

1. 查询头部信息
   - `live_id`
   - `live_date`
   - `live_title`
   - `venue`
   - `opening_time`
   - `start_time`
   - `bands`
   - `band_names`
   - `url`
2. 查询曲目行明细
   - 基于 `live_setlist + song_list`
   - 按 `absolute_order` 排序
3. 解析 `band_member` / `other_member` JSON 字段
4. 组装前端所需结构，并补充一些派生字段

### 200 Response

```json
{
  "live_id": 123,
  "live_date": "2026-03-28",
  "live_title": "示例 Live 名称",
  "venue": "K-Arena Yokohama",
  "opening_time": "17:00",
  "start_time": "18:00",
  "bands": [1, 2, 3],
  "band_names": ["Poppin'Party", "Afterglow", "Roselia"],
  "url": "https://example.com/live/123",
  "detail_rows": [
    {
      "row_id": "M1",
      "song_name": "春日序曲",
      "band_members": [
        {
          "band_id": 1,
          "band_name": "Poppin'Party",
          "present_members": ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
          "present_count": 5,
          "total_count": 5,
          "is_full": true
        }
      ],
      "other_members": [
        { "key": "键盘支援", "value": ["远程连线"] }
      ],
      "comments": ["短版"]
    }
  ]
}
```

### 字段说明

顶部字段：
- `live_id`: Live 主键 ID
- `live_date`: 日期
- `live_title`: 标题
- `venue`: 场地名，来自 `live_attrs.venue_id -> venue_list.venue`
- `opening_time`: 开场时间，来自 `live_attrs.opening_time`
- `start_time`: 开演时间，来自 `live_attrs.start_time`
- `bands`: 去重后的 `band_id` 列表，按升序返回
- `band_names`: 从 `band_member` 中聚合出的乐队名称列表
- `url`: Live 链接，来自 `live_attrs.url`

`detail_rows[]` 字段：
- `row_id`: 由 `segment_type + sub_order` 拼接得到，例如 `M1`、`EN1`
- `song_name`: 曲目名
- `band_members`: 参加该曲目的乐队成员信息
- `other_members`: 其他成员信息，统一规范为 `{key, value: string[]}`
- `comments`: 备注标签，目前仅在 `is_short = true` 时返回 `["短版"]`

### 字段生成规则

- `detail_rows` 实际按数据库中的 `absolute_order` 返回，不是按 `row_id` 字典序排序
- `band_members[].present_count = present_members.length`
- `band_members[].total_count` 来自 `band_attrs.band_members` 的数据库查询结果
- `band_members[].is_full = present_count >= total_count`
- `band_members` 会优先按 `band_id` 升序排列，无法映射到 `band_id` 的项目排在后面
- `band_names` 会先去重，再按 `bands` 中的 `band_id` 顺序排列；无法映射到 `band_id` 的名称排在最后
- `other_members` 会按 `key` 升序排列
- `other_members` 的 value 允许源数据是：
  - 数组
  - 单个字符串
  - JSON 字符串数组
  - JSON 字符串字面量
  后端会统一归一化为 `string[]`

### 常见错误

- `400`: `live_id < 1`
- `404`: 指定 `live_id` 不存在
- `500`: 数据库一般错误
- `504`: 数据库连接超时或查询超时

## 5. 批量获取 Live 详情

`POST /api/lives/details:batch`

### 说明

该接口用于批量预读详情，前端首页首屏会在获取列表后调用它，将当前页的详情预加载到缓存中。

### 请求体

```json
{
  "live_ids": [123, 124, 125]
}
```

### 请求约束

- `live_ids` 必填
- `live_ids` 长度必须在 `1..100` 之间
- `live_ids` 任一元素必须 `>= 1`
- 后端会按请求顺序去重后再执行查询

### 实现逻辑

后端会：

1. 先对 `live_ids` 去重并保序
2. 一次性批量查询所有命中 Live 的头部信息
3. 一次性批量查询所有命中 Live 的行明细
4. 在 SQL 中先把每行的 `band_members` 预聚合成 JSON
5. 再在 Python 层组装最终返回结构
6. 未命中的 ID 放入 `missing_live_ids`

### 200 Response

```json
{
  "items": [
    {
      "live_id": 123,
      "live_date": "2026-03-28",
      "live_title": "示例 Live 名称",
      "venue": "K-Arena Yokohama",
      "opening_time": "17:00",
      "start_time": "18:00",
      "bands": [1, 2, 3],
      "band_names": ["Poppin'Party", "Afterglow", "Roselia"],
      "url": "https://example.com/live/123",
      "detail_rows": []
    }
  ],
  "missing_live_ids": [999]
}
```

### 返回规则

- `items` 中的单项结构与 `GET /api/lives/{live_id}` 返回结构一致
- `items` 会按“去重后的请求顺序”输出，而不是数据库自然顺序
- `missing_live_ids` 也按“去重后的请求顺序”返回
- 允许部分成功
  - 即使部分 `live_id` 不存在，接口整体仍返回 `200`

### 常见错误

- `400`: 任一 `live_id < 1`
- `422`: `live_ids` 缺失、为空数组、或长度超过 `100`
- `500`: 数据库一般错误
- `504`: 数据库连接超时或查询超时

## 6. 错误响应说明

当前实现没有统一自定义错误包装，实际返回的是 FastAPI 默认错误结构。

### 常见示例

参数错误：

```json
{
  "detail": "page_size must be 15 or 20"
}
```

资源不存在：

```json
{
  "detail": "Live id 999999 not found"
}
```

请求体校验失败：

```json
{
  "detail": [
    {
      "type": "too_short",
      "loc": ["body", "live_ids"],
      "msg": "List should have at least 1 item after validation, not 0",
      "input": []
    }
  ]
}
```

超时：

```json
{
  "detail": "Database query timeout"
}
```

### 状态码汇总

- `200`: 请求成功
- `400`: 参数错误
- `404`: 资源不存在
- `422`: 请求体验证失败
- `500`: 数据库或服务内部错误
- `504`: 数据库连接超时或查询超时

## 7. 备注

- 当前前端实际调用的后端 API 就是本文档列出的 5 个接口
- 当前前端收藏状态使用 `localStorage`，不依赖后端收藏接口
- 当前前端依赖 `pagination.total` 与 `pagination.total_pages` 驱动分页
- 当前详情接口已返回 `venue`、`opening_time`、`start_time`、`url`
- 当前 `band_members[].total_count` 已不再固定写死，而是按 `band_attrs` 中的数据库值返回
