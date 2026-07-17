# Live 类型字段持久化（已完成）

本文档记录控制台"新增 Live"里的 `type` 字段从 UI 临时字段演进为正式业务字段的实施过程。

## 1. 实施完成后的状态

### 1.1 数据库

- V8 新增 nullable `live_type` 列 + 允许 NULL 的 CHECK。
- V9 收紧为 `NOT NULL` + 严格枚举 CHECK（6 个 code）。
- Seed 数据覆盖 `oneman`、`multi_act`、`festival`、`other` 四种类型。

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

### 1.4 测试

- 后端单元测试：`_valid_live_payload` 基础值包含 `live_type: "oneman"`，新增 4 个非法值校验用例。
- 后端集成测试：请求使用 `live_type: "oneman"`，DB 查询和审计断言包含 `live_type` 列。
- 前端测试：mock 响应全部补齐 `live_type`，断言从 `type: "专场"` 改为 `live_type: "oneman"`。
- `python scripts/run_checks.py functional` 全部通过。

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

## 3. 已完成步骤

1. [x] 新增 Flyway V8（nullable `live_type` + CHECK）。
2. [x] 人工回填已有数据。
3. [x] 新增 Flyway V9（`NOT NULL` + 严格 CHECK）。
4. [x] 更新 seed 数据。
5. [x] 后端 console schema/router 写入 `live_type`。
6. [x] 后端 lives/me 读接口全部返回 `live_type`。
7. [x] 更新后端单元和集成测试。
8. [x] 更新前端 API 类型和控制台新增 Live 表单。
9. [x] 在演出资料筛选器和独立详情视图展示 Live 类型。

## 4. 后续方向

- 观察类型筛选查询量，确有需要时再评估 btree 索引。
- 如需类型可配置化，再引入 `live_type_list` lookup 表。
