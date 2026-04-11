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
- `GET /api/lives`
  - Live 列表分页查询
- `GET /api/lives/{live_id}`
  - 单条 Live 详情查询
- `POST /api/lives/details:batch`
  - 批量详情预读接口

说明：
- 当前后端还挂载了其他路由，例如认证相关接口
- 全量路径、请求参数、响应 schema 请直接查看自动文档

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

### 3. `POST /api/lives/details:batch`

这个接口的 schema 很直观，但业务行为有几个点需要补充：

- `live_ids` 会先去重并保留原始请求顺序
- 允许部分成功
- 未命中的 ID 会进入 `missing_live_ids`
- `items` 按去重后的请求顺序返回，而不是数据库自然顺序
- `missing_live_ids` 也按去重后的请求顺序返回
- `items` 中的单项结构与 `GET /api/lives/{live_id}` 一致

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
- `422` 当前通常返回 FastAPI / Pydantic 默认的数组型校验错误结构

## 维护建议

后续若接口发生变化，建议按以下顺序维护：

1. 先修改后端 schema / route metadata
2. 以自动生成的 OpenAPI 文档作为主契约
3. 若有必要，再更新本文档中的补充规则

这样可以减少“手写 Markdown 文档”和“实际代码行为”之间的漂移。
