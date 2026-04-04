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
      "bands": [1, 2, "Band_3"],
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
  "url": "https://example.com/live/123",
  "description": "详情描述文本"
}
```

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
- `500`: 服务器内部错误

## 4. 备注

- 当前前端收藏状态使用 `localStorage`，不依赖后端收藏接口。
- 当前前端需要 `pagination.total` 与 `pagination.total_pages` 来驱动分页显示。
- 建议后续收敛 `bands` 为 `number[]`（`1..12`），减少前端解析分支。
