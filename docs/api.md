# LiveSetList 接口契约（草案）

本文档定义当前主界面所需的后端接口契约，供后续开发与联调用。

## 基础信息

- Base URL: `http://localhost:8000`
- Content-Type: `application/json`

## 1. 获取 Live 列表

`GET /api/lives`

### 查询参数

- `page` (number, optional)
说明: 页码，从 `1` 开始。
默认: `1`

- `page_size` (number, optional)
说明: 每页条数。
允许值: `15` 或 `20`
默认: `20`

### 请求示例

`GET /api/lives?page=1&page_size=20`

### 200 Response

```json
{
  "items": [
    {
      "live_id": 123,
      "live_date": "2026-03-28",
      "live_title": "示例 Live 名称",
      "bands": [1, 2, 3],
      "url": "https://example.com/live/123"
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

### 字段映射（对应前端 4 列）

- `live_date`: 日期列
- `live_title`: Live 名称列
- `bands`: 乐队图标列（前端映射为 `Band_1.svg` ~ `Band_12.svg`）
- `url`: URL 列（前端以 `🔗` 展示）

### 参数校验规则

- `page` 必须为正整数（`>= 1`）
- `page_size` 只能为 `15` 或 `20`
- `items` 顺序由后端决定（建议按数据库 `ORDER BY`）

## 2. 获取单条 Live 详情

`GET /api/lives/{id}`

### 路径参数

- `id` (number, required): Live 主键 ID

### 200 Response

```json
{
  "live_id": 123,
  "live_date": "2026-03-28",
  "live_title": "示例 Live 名称",
  "bands": [1, 2, 3],
  "band_names": ["Poppin'Party", "Afterglow", "Roselia"],
  "url": "https://example.com/live/123",
  "detail_rows": [
    {
      "row_id": 1,
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

### 字段映射（对应详情弹窗）

顶部信息字段:
- `live_date`: 日期
- `live_title`: 标题
- `bands`: 乐队总数（前端可直接取 `bands.length`）
- `band_names`: 顶部乐队名称列表（从 `band_member` 的 key 去重聚合）
- `url`: 链接

5 列详情表字段:
- `detail_rows[].row_id`: 编号
- `detail_rows[].song_name`: 曲目名称
- `detail_rows[].band_members`: 乐队成员（图标、满员状态、二级弹窗“参加队员”）
- `detail_rows[].other_members`: 其他成员（`{key, value:string[]}`，主表预览 + `+N` 浮层）
- `detail_rows[].comments`: 备注（短标签）

### 参数与字段校验规则

- `id` 必须为正整数（`>= 1`）
- `bands` 建议为去重后的 `number[]`，取值范围建议为 `1..12`
- `detail_rows` 建议按 `row_id ASC` 返回，且 `row_id` 在同一 `live_id` 下唯一
- `band_members[].present_count` 必须 `<= total_count`
- `band_members[].is_full` 建议按 `present_count >= 5` 计算（当前约定固定满员人数为 5）
- `other_members`、`comments` 允许为空数组，不建议返回 `null`

## 3. 错误响应约定

推荐统一错误结构:

```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "page_size must be 15 or 20"
  }
}
```

### 常见状态码

- `400`: 参数错误（如 `page_size` 非法）
- `404`: 资源不存在（如 `id` 不存在）
- `504`: 超时（数据库连接超时或查询超时）
- `500`: 服务器内部错误

## 4. 备注

- 当前前端收藏状态使用 `localStorage`，不依赖后端收藏接口。
- 当前前端需要 `pagination.total` 与 `pagination.total_pages` 来驱动分页显示。
- 建议后续收敛 `bands` 为 `number[]`（`1..12`），减少前端解析分支。
