# 收藏乐观同步设计

本文档描述首页“收藏”能力的前端交互优化方案，目标是在本地开发环境存在偶发连接抖动时，降低收藏操作的体感卡顿，同时保持后端与数据库不被错误写入污染。

## 当前进度

截至 2026-04-12，本文档对应方案已完成以下落地：

- 已将收藏弱一致状态机从 `AuthProvider` 拆分到独立的 `FavoriteProvider`
- 已实现乐观切星与单条目单飞同步
- 已取消收藏按钮的 `disabled` 阻塞交互
- 已实现连续失败 `>= 3` 的统一提示文案
- 已实现进入“收藏”页时通过会话快照进行一次对账收敛
- 已补充 favorites 域埋点：
  - `favorite_click`
  - `favorite_sync_start`
  - `favorite_sync_success`
  - `favorite_sync_failed`
  - `favorite_sync_reconcile`
  - `favorite_sync_warning_shown`

当前代码位置：

- 收藏 provider：[FavoriteProvider.tsx](/D:/Code/PythonCode/5%20LiveSetList/frontend/src/favorites/FavoriteProvider.tsx)
- 收藏同步辅助逻辑：[favoriteSync.ts](/D:/Code/PythonCode/5%20LiveSetList/frontend/src/favorites/favoriteSync.ts)
- 认证 provider：[AuthProvider.tsx](/D:/Code/PythonCode/5%20LiveSetList/frontend/src/auth/AuthProvider.tsx)
- 页面接入：[App.tsx](/D:/Code/PythonCode/5%20LiveSetList/frontend/src/App.tsx)
- 回归测试：[App.test.tsx](/D:/Code/PythonCode/5%20LiveSetList/frontend/src/__tests__/App.test.tsx)

## 1. 背景

当前收藏链路的后端接口与数据库执行通常只需几十毫秒，但浏览器对本地服务的连接建立偶发会出现约 `300ms+` 的额外耗时。

现有实现中，收藏按钮点击后会：

- 立即进入 `disabled`
- 光标变为 `not-allowed`
- 等待请求成功后才更新星标

这会把中等延迟放大成明显的“卡住”体验。

## 2. 目标

本方案希望达到以下效果：

1. 点击星标后立即给出正向反馈
2. 不再因为单次收藏请求等待而阻塞用户继续浏览
3. 收藏请求偶发失败时允许短时前后端不一致
4. 连续失败时给出统一提示文案
5. 收藏页仍以服务端真值为准，避免长期漂移

统一失败提示文案：

`收藏同步失败，请稍后重试或刷新页面确认`

触发阈值：

- 收藏同步连续失败次数 `>= 3`

## 3. 非目标

本方案不处理以下内容：

- 不修改收藏数据库表结构
- 不改造后端收藏接口契约
- 不新增自动重试定时任务
- 不把收藏状态重新放回 `localStorage`
- 不让收藏页脱离服务端真值

## 4. 总体策略

采用“乐观更新 + 单条目单飞同步 + 连续失败提示 + 关键时机对账”。

核心原则：

- 全量页星标展示优先响应用户最后一次意图
- 收藏页列表数据仍以服务端返回为准
- 单次失败允许不回滚
- 连续失败达到阈值后提示用户
- 认证失效类错误必须立即收敛

## 5. 状态模型

建议将收藏状态拆成四层。

### 5.1 服务端真值

`serverFavoriteIds: number[]`

含义：

- 最近一次由服务端确认下来的收藏集合
- 来源包括登录成功、`/api/auth/me`、进入收藏页后重新拉取收藏列表后的同步结果

### 5.2 乐观覆盖层

`optimisticFavoriteIntents: Record<number, boolean>`

含义：

- 记录前端尚未完全与服务端对齐的“最终意图”
- `true` 表示希望该 `liveId` 处于已收藏
- `false` 表示希望该 `liveId` 处于未收藏

说明：

- 该层只覆盖展示，不直接代表服务端已成功写入
- 如果某条目没有乐观意图，则显示服务端真值

### 5.3 单条目同步状态

`favoriteSyncById: Record<number, FavoriteSyncState>`

推荐结构：

```ts
type FavoriteSyncState = {
  inFlight: boolean;
  lastAttemptSeq: number;
  lastErrorCode: string | null;
  lastErrorAt: number | null;
};
```

含义：

- 控制同一 `liveId` 任何时刻只允许一个同步请求在飞
- `lastAttemptSeq` 用于防止乱序回写覆盖最新意图

### 5.4 会话级连续失败计数

`favoriteConsecutiveFailureCount: number`

含义：

- 统计当前会话中收藏同步的连续失败次数
- 任意一次收藏同步成功后清零
- 连续失败次数达到 `3` 时触发统一提示

说明：

- 这里使用“会话级计数”而不是“单 liveId 计数”
- 原因是当前问题更像链路层偶发抖动；若多个不同条目连续失败，也应提示用户整体同步异常

## 6. 派生状态

### 6.1 页面展示用收藏集合

`effectiveFavoriteIdSet`

计算规则：

1. 先以 `serverFavoriteIds` 构建基准集合
2. 再应用 `optimisticFavoriteIntents`
3. 若某个 `liveId` 的意图为 `true`，则加入集合
4. 若某个 `liveId` 的意图为 `false`，则从集合中删除

用途：

- 全量页星标是否点亮
- 详情页未来若增加收藏入口时的展示判断

### 6.2 条目是否正在同步

`isFavoriteSyncing(liveId: number): boolean`

用途：

- 控制星标轻量视觉态
- 不再用于 `disabled`

## 7. 交互流程

### 7.1 全量页点击星标

流程：

1. 用户点击星标
2. 读取当前展示态 `currentDisplayedState`
3. 计算目标态 `nextDesiredState = !currentDisplayedState`
4. 立即写入 `optimisticFavoriteIntents[liveId] = nextDesiredState`
5. 页面立刻重渲染星标
6. 若该 `liveId` 当前无 in-flight 请求，则启动一次后台同步
7. 若已有 in-flight 请求，则只更新最终意图，不额外并发第二条请求

用户感知：

- 立即看到星标变化
- 按钮仍可悬浮点击，不再变成禁止光标

### 7.2 后台同步成功

流程：

1. 根据发起时的目标态调用 `PUT` 或 `DELETE`
2. 请求成功后，将 `serverFavoriteIds` 更新到对应状态
3. 清除该 `liveId` 的乐观覆盖
4. 清除该条目的 in-flight 状态
5. 会话级连续失败计数清零
6. 如果发现用户在请求飞行期间又修改了该条目的最终意图，则立即发起下一轮同步

### 7.3 后台同步失败

流程：

1. 保留当前 `optimisticFavoriteIntents`
2. 不立刻回滚 UI
3. 清除该条目的 in-flight 状态
4. `favoriteConsecutiveFailureCount += 1`
5. 记录 `lastErrorCode`、`lastErrorAt`
6. 若连续失败次数达到 `3`，展示统一提示文案
7. 不自动无限重试，只在后续事件触发时再尝试收敛

说明：

- 这样可以避免因临时网络抖动把用户的点击结果立刻推翻
- 同时也避免后台无界重试污染后端日志与请求量

### 7.4 同一条目快速连点

规则：

- 同一 `liveId` 同时只允许一条请求在飞
- 用户连续点击时，只更新最终意图
- 当前请求返回后，如果最终意图已变化，则再补发一条请求

示例：

1. 当前未收藏
2. 用户点击一次，意图变为 `true`，发起 `PUT`
3. 请求尚未完成时，用户又点击一次，意图改为 `false`
4. 第一条 `PUT` 成功返回后，发现最终意图已变成 `false`
5. 立即再发一条 `DELETE`

这样可以保证：

- 请求数量按“最终状态变化”收敛
- 不因响应乱序把旧结果写回界面

### 7.5 实现时序注意事项（补发链路）

在 React 中，`setState` 的 updater 回调并不是同步立即执行；因此“是否需要补发下一轮同步”的判定不能依赖 updater 内部对外部变量的赋值结果。

推荐做法：

1. 在首轮请求 `await` 返回后，先从同步快照（如 `stateRef.current.optimisticFavoriteIntents[liveId]`）计算 `latestDesiredIntent`
2. 若 `latestDesiredIntent !== desired`，标记需要补发
3. 再执行 `setState` 提交本轮成功结果（清 in-flight、更新 server 真值等）
4. 最后基于步骤 1 的快照结论触发 `flushFavoriteIntent(liveId, latestDesiredIntent)`

额外约束：

- 补发链路需要允许绕过“旧快照里仍为 in-flight”的短暂窗口，否则可能被错误短路，导致第二轮不发。

## 8. 对账策略

本方案允许短时不一致，因此必须定义有限的对账时机。

### 8.1 进入收藏页时

规则：

- 收藏页列表数据始终以服务端接口返回为准
- 进入收藏页时，先尝试刷新当前 session 快照，再加载服务端收藏列表
- 若此前存在未收敛的乐观意图，允许保留在全量页展示层，但不直接污染收藏页列表

说明：

- 收藏页是“服务端真值视图”
- 全量页是“用户即时交互视图”

### 8.2 登录恢复时

规则：

- 启动恢复登录态或重新登录成功后
- 用后端返回的 `favorite_live_ids` 覆盖 `serverFavoriteIds`
- 对于仍未确认成功的本地意图，可以保留并等待下一次同步机会

### 8.3 连续失败达到阈值时

规则：

- 展示提示文案
- 停止继续静默吞掉异常信号
- 后续以进入收藏页或页面刷新作为主要确认路径

## 9. 错误分类与处理

### 9.1 网络错误 / 超时 / 5xx

处理策略：

- 保留乐观展示
- 计入连续失败次数
- 记录日志
- 不立即回滚

### 9.2 401 / 403 认证错误

处理策略：

- 不走“弱一致容忍”
- 立即按现有认证失效逻辑处理
- 必要时回到匿名态或弹登录框
- 清理后续无意义同步

原因：

- 认证已失效时，继续保留乐观收藏只会让状态越走越偏

## 10. 前端实现分层

### 10.1 视图层

文件：

- `frontend/src/App.tsx`

职责：

- 响应用户点击星标
- 调用 `FavoriteProvider` 暴露的收藏切换动作
- 根据 `effectiveFavoriteIdSet` 渲染星标
- 根据 `isFavoriteSyncing(liveId)` 显示轻量同步态
- 展示统一失败提示文案

不应承担：

- 不直接决定何时发 `PUT/DELETE`
- 不直接维护服务端真值
- 不直接处理乱序请求

### 10.2 领域状态层

文件：

- `frontend/src/favorites/FavoriteProvider.tsx`
- `frontend/src/favorites/favoriteSync.ts`

职责：

- 持有 `serverFavoriteIds`
- 持有 `optimisticFavoriteIntents`
- 持有 `favoriteSyncById`
- 持有 `favoriteConsecutiveFailureCount`
- 暴露：
  - `isFavoriteSyncing(liveId)`
  - `toggleFavorite(liveId)`
  - `reconcileFavorites()`

说明：

- 收藏的“意图、同步、收敛”都应下沉到 favorites 域
- `favoriteSync.ts` 承载纯状态辅助逻辑，`FavoriteProvider` 只保留 provider 级时序控制
- `App.tsx` 不应再维护 `favoritePendingIds`

### 10.3 认证层

文件：

- `frontend/src/auth/AuthProvider.tsx`

职责：

- 持有登录态、用户信息与 `csrfToken`
- 持有当前会话返回的 `sessionFavoriteLiveIds`
- 提供 `refreshSession()` 给 favorites 域用于对账

说明：

- 收藏弱一致状态已不再放在 auth 域内部
- auth 只提供 favorites 收敛所需的会话快照
### 10.4 API 访问层

文件：

- `frontend/src/api.ts`

职责：

- 继续负责 `favoriteLive` / `unfavoriteLive`
- 保持接口契约不变
- 保留请求级日志

说明：

- 当前问题不是接口定义问题，因此本层无需结构性改造

### 10.5 日志与观测层

文件：

- `frontend/src/logger.ts`

当前已落地事件：

- `favorite_click`
- `favorite_sync_start`
- `favorite_sync_success`
- `favorite_sync_failed`
- `favorite_sync_reconcile`
- `favorite_sync_warning_shown`

用途：

- 后续继续观察本地环境抖动是否仍频繁影响收藏体验

### 10.6 后端层

文件：

- `backend/app/routers/me.py`
- `backend/app/favorites.py`
- `backend/app/db.py`

本阶段结论：

- 不需要为本方案改动后端接口设计
- 不需要新增数据库表
- 不需要为收藏链路加入额外复杂重试

## 11. 当前数据接口
当前 `FavoriteProvider` 暴露的接口形态如下：

```ts
type FavoritesContextValue = {
  favoriteLiveIds: number[];
  favoriteLiveIdSet: ReadonlySet<number>;
  isFavoriteSyncing: (liveId: number) => boolean;
  toggleFavorite: (liveId: number) => Promise<void>;
  reconcileFavorites: () => Promise<void>;
  favoriteSyncWarning: string | null;
};
```

说明：

- `toggleFavorite` 采用“乐观切换 + 异步后台处理”的模式
- `favoriteSyncWarning` 仅在连续失败次数达到阈值后返回固定文案

## 12. 推荐伪代码

```ts
function toggleFavorite(liveId: number) {
  const nextDesired = !isFavorite(liveId);
  setOptimisticIntent(liveId, nextDesired);
  logInfo("favorite_click", { liveId, desired: nextDesired });

  if (!isSyncInFlight(liveId)) {
    void flushFavoriteIntent(liveId);
  }
}

async function flushFavoriteIntent(liveId: number) {
  const desired = getLatestIntent(liveId);
  const attemptSeq = markSyncStart(liveId);

  try {
    if (desired) {
      await favoriteLive(liveId, csrfToken);
    } else {
      await unfavoriteLive(liveId, csrfToken);
    }

    commitServerFavoriteState(liveId, desired);
    clearOptimisticIntentIfSettled(liveId, desired);
    clearSyncState(liveId, attemptSeq);
    resetFavoriteFailureCount();
  } catch (error) {
    clearSyncState(liveId, attemptSeq);
    increaseFavoriteFailureCount();
    recordFavoriteError(liveId, error);

    if (getFavoriteFailureCount() >= 3) {
      showFavoriteWarning("收藏同步失败，请稍后重试或刷新页面确认");
    }

    if (isAuthError(error)) {
      handleExpiredSession();
    }
    return;
  }

  if (hasNewerIntent(liveId, desired)) {
    void flushFavoriteIntent(liveId);
  }
}
```

## 13. 需要特别避免的问题

1. 不要把收藏按钮继续做成 `disabled`
2. 不要把乐观状态直接写进服务端列表快照
3. 不要对失败做无限自动重试
4. 不要在 `App.tsx` 和 `AuthProvider.tsx` 各自维护一套 pending 状态
5. 不要把 401/403 当成普通可忽略失败

## 14. 实施拆分建议

### 第一阶段：状态重构

- [x] 将 `favoritePendingIds` 从 `App.tsx` 下沉移除
- [x] 初版弱一致状态机已搭起
- [x] 增加 `toggleFavorite`、`isFavoriteSyncing`

### 第二阶段：界面行为调整

- [x] 收藏按钮取消 `disabled`
- [x] 增加轻量同步视觉态
- [x] 接入固定失败提示文案

### 第三阶段：收敛与对账

- [x] 进入收藏页时引入服务端真值刷新
- [x] 登录恢复时完善收藏集合收敛
- [x] 增加相关埋点日志
- [x] 将 favorites 弱一致状态从 auth 域拆分成独立 provider

## 15. 验收标准

满足以下条件时，可认为方案达到预期：

1. 点击收藏后星标立即变化
2. 偶发 `300ms~400ms` 网络抖动不再明显表现为“卡住”
3. 单次失败不会立即把星标打回原状态
4. 连续失败 `>= 3` 次后出现统一提示文案
5. 进入收藏页后，列表仍以服务端返回为准
6. 刷新页面或重新登录后，收藏状态最终可回归服务端真值
