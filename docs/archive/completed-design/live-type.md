# Live 类型字段持久化（已完成）

Live 类型使用稳定枚举编码，数据库、接口和前端表单保持同一值域。

## 1. 存储与接口

### 1.1 数据库

- `live_attrs.live_type` 为非空字段，CHECK 约束与接口共同限制稳定枚举。

### 1.2 后端

- `ConsoleLiveCreateRequest.live_type` 为必填字段，只接受 6 个稳定 code，不做中文 label 转 code。
- `INSERT INTO live_attrs` 写入 `live_type` 列。
- 审计日志 `payload_json` 使用 `live_type` 键。
- `LiveItem`、`LiveDetailResponse` 包含 `live_type: str`。
- `GET /api/lives`、`GET /api/me/favorites/lives`、`GET /api/lives/{live_id}`、`POST /api/lives/details:batch` 均返回 `live_type`。
- SQL 查询中 `l.live_type` 追加在 SELECT 末尾，不位移已有 tuple 索引。

### 1.3 前端

- `LIVE_TYPE_OPTIONS` 为 `{value, label}[]` 结构（6 个 code/label 对），含 `formatLiveType()` helper。
- `LiveItem`、`LiveDetailResponse`、`ConsoleLiveCreatePayload`、`ConsoleLiveMutationItem` 均包含 `live_type: string`。
- `ConsoleInsertPanel` 的 `liveType` 状态存 code，payload 发送 `live_type`，成功回填使用 `response.item.live_type`，确认面板用 `formatLiveType` 展示 label。
- `LiveAdminSection` 的 select 用 `option.value`/`option.label` 渲染，表头改为 `live_type`，历史行用 `formatLiveType` 展示。
- 演出资料支持按 Live 类型筛选；独立详情视图使用 `formatLiveType()` 展示中文类型标签。

## 2. 字段和值域

| code | label | 说明 |
|------|-------|------|
| `oneman` | `专场` | 单一主办或单一主轴 Live |
| `taiban` | `对邦` | 对邦/双主轴演出 |
| `multi_act` | `拼盘` | 多组艺人/乐队同场的普通拼盘演出 |
| `festival` | `音乐节` | 音乐节或 festival-style 演出 |
| `event` | `活动` | 活动、企划、展会舞台等 |
| `other` | `其他` | 暂未归类或无法判断 |

后端只做枚举校验，前端负责发送 code 并显示中文 label。

## 4. 后续方向

- 观察类型筛选查询量，确有需要时再评估 btree 索引。
- 如需类型可配置化，再引入 `live_type_list` lookup 表。
