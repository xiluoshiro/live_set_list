# 批量收藏设计与实施（Phase B-Plus）

本文档定义“本页一键收藏 / 取消收藏”能力的后端接口与前端适配方案，目标是在现有收藏弱一致机制上减少请求数量、降低切换等待感，并保持权限与数据安全边界一致。

## 1. 目标与范围

目标：

- 支持“本页全部收藏 / 取消收藏”一次操作
- 将 N 次单条收藏请求收敛为 1 次 batch 请求
- 复用现有会话、CSRF、收藏弱一致状态机
- 保持幂等和部分成功可观测

范围：

- 新增后端 batch 收藏接口（登录态接口）
- 前端新增批量收藏 API 与页面入口按钮
- 增补测试、日志与审计

非目标：

- 不改动现有单条收藏接口契约（保留兼容）
- 不改动收藏表结构
- 不在本阶段实现跨页“全站批量收藏”

## 2. 后端接口设计

### 2.1 接口定义

- 方法：`POST`
- 路径：`/api/me/favorites/lives:batch`
- 权限：已登录用户（`viewer+`）
- 安全：必须携带 `X-CSRF-Token`

请求体：

```json
{
  "action": "favorite",
  "live_ids": [101, 102, 103]
}
```

字段约束：

- `action`：`favorite | unfavorite`
- `live_ids`：数组，去重后长度 `1..100`，元素必须为正整数

成功响应（`200`）：

```json
{
  "action": "favorite",
  "requested_count": 3,
  "applied_live_ids": [101, 102],
  "noop_live_ids": [103],
  "not_found_live_ids": []
}
```

响应字段说明：

- `requested_count`：请求去重后总数
- `applied_live_ids`：
  - `favorite` 时：本次新插入成功的 live_id
  - `unfavorite` 时：本次删除成功的 live_id
- `noop_live_ids`：
  - `favorite` 时：原本就已收藏
  - `unfavorite` 时：原本就未收藏
- `not_found_live_ids`：`live_attrs` 不存在的 id（不会写入）

### 2.2 状态码与错误码

- `200`：执行完成（允许部分 `noop/not_found`）
- `400/422`：参数非法（空数组、超上限、非法 id、未知 action）
- `401`：会话失效
- `403`：CSRF 失败或权限失败
- `500`：服务内部错误

建议错误码：

- `VALIDATION_ERROR`
- `AUTH_SESSION_EXPIRED`
- `AUTH_CSRF_INVALID`
- `AUTH_FORBIDDEN`

## 3. 后端实现拆分

文件建议：

- `backend/app/routers/me.py`
- `backend/app/favorites.py`
- `backend/app/schemas/`（新增 batch 请求/响应模型）

实现要点：

1. 路由层校验登录与 CSRF，并解析 batch 请求体。
2. 服务层先校验 `live_id` 是否存在（一次查询），得到 `not_found_live_ids`。
3. 对存在的 id 执行批量写入：
   - `favorite`：`INSERT ... ON CONFLICT DO NOTHING`
   - `unfavorite`：`DELETE ... WHERE live_id = ANY(...)`
4. 计算 `applied/noop/not_found` 三类结果并返回。
5. 记录审计日志：
   - `favorite_batch`
   - `unfavorite_batch`
   - payload 至少包含 `requested_count/applied_count/noop_count/not_found_count`

## 4. 前端适配方案

文件建议：

- `frontend/src/api.ts`
- `frontend/src/favorites/FavoriteProvider.tsx`
- `frontend/src/App.tsx`

### 4.1 API 层

新增：

- `favoriteLivesBatch(action, liveIds, csrfToken)`

约束：

- 调用前做 `liveIds` 去重
- 超过 100 时按页内场景通常不会触发；若未来复用到大批量场景，前端按 100 分片调用

### 4.2 favorites 域

新增能力：

- `setFavoritesBatch(liveIds: number[], desired: boolean): Promise<void>`

行为：

1. 先乐观更新本批次 `optimisticFavoriteIntents`。
2. 发起一次 batch 请求。
3. 成功后按响应收敛 `serverFavoriteIds`，并清理已确认条目的乐观意图。
4. 失败时复用现有弱一致策略：
   - 不立即回滚 UI
   - 连续失败计数 +1
   - 达到阈值显示统一提示
   - 401/403 按认证失效路径处理

### 4.3 页面层

入口位置：

- 全量页工具区（仅登录用户可见）

按钮文案：

- 当前页全部已收藏：`取消收藏本页`
- 当前页存在未收藏：`收藏本页`

点击逻辑：

- 读取当前页 `live_id` 集合
- 计算目标态 `desired`
- 调用 `favorites.setFavoritesBatch(liveIds, desired)`

## 5. 安全与权限约束

- 前端仅做可见性与交互控制，不作为安全边界。
- 后端必须校验：
  - 已登录会话
  - CSRF token
  - 仅操作当前登录用户自己的收藏数据
- 禁止通过请求体传入任意 `user_id`，服务端只使用会话内用户身份。

## 6. 测试计划

后端测试：

- 参数校验：空数组、超上限、非法 action
- 幂等：重复 favorite/unfavorite 的 `noop` 行为
- 部分成功：存在 `not_found` 的混合输入
- 安全：401/403
- 审计：batch 事件写入

前端测试：

- 按钮显隐（登录态控制）
- 文案切换（全收藏/混合态）
- 一次点击仅触发一次 batch 请求
- 成功后 UI 正确收敛
- 失败后 warning 逻辑符合现有阈值规则

## 7. 验收标准

功能验收：

1. 登录用户在全量页可看到“本页批量收藏”按钮；未登录用户不可见。
2. 当前页混合态点击后，页面内所有条目变为已收藏。
3. 当前页全收藏态点击后，页面内所有条目变为未收藏。
4. 每次批量操作只产生 1 次 batch API 调用（不再逐条调用单条接口）。
5. 刷新页面后，收藏状态与服务端一致。

安全验收：

1. 未登录调用 batch 接口返回 `401`。
2. 缺失或错误 CSRF 返回 `403`。
3. 请求体无法越权操作其他用户收藏。

鲁棒性验收：

1. 重复点击同一批量操作不会造成脏写（接口幂等）。
2. 部分 `live_id` 不存在时，接口返回 `not_found_live_ids`，其余合法 id 正常生效。
3. 网络抖动下不会出现整页交互阻塞；失败后按现有统一文案提示。

回归验收：

1. 单条收藏/取消收藏行为保持可用。
2. 收藏页预读与弱一致对账逻辑不回退。
3. `run_checks functional` 通过。
