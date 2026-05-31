# Live 类型字段持久化设计

本文档描述控制台“新增 Live”里的 `type` 字段从 UI 临时字段演进为正式业务字段的设计方案。当前文档只记录设计，不代表代码已经实现。

## 1. 当前真实状态

### 1.1 前端

当前控制台新增 Live 表单已经有 `type` 下拉框：

- 选项定义在 `frontend/src/components/console/constants.ts`，当前为 `["专场", "拼盘", "对邦", "活动", "其他"]`。
- `ConsoleInsertPanel` 用 `liveType` 维护表单状态，并把它作为 `type` 放进 `createConsoleLive` 请求体。
- `LiveAdminSection` 在新增表单和“暂无新增 Live 记录”下方的本地插入记录表里展示 `type`。
- 新增成功后的本地历史记录使用的是请求里的 `payload.type`，不是后端返回值。
- 刷新页面后，前端无法从 `GET /api/lives` 或 `GET /api/lives/{live_id}` 重新拿到这个值。

因此当前 `type` 只在本次前端会话内可见。

### 1.2 前端 API 类型

`frontend/src/api.ts` 当前状态：

- `ConsoleLiveCreatePayload` 包含 `type: string`。
- `ConsoleLiveMutationItem` 不包含 `type` 或 `live_type`。
- `LiveItem` 不包含 `type` 或 `live_type`。
- `LiveDetailResponse` 不包含 `type` 或 `live_type`。

这意味着即使后端未来开始持久化，前端公开列表、详情和收藏列表也需要同步扩展类型定义。

### 1.3 后端写接口

`backend/app/schemas/console.py` 当前状态：

- `ConsoleLiveCreateRequest.type` 是可选字段。
- 字段说明明确写着“accepted for compatibility but not persisted yet”。
- 校验逻辑只做 trim，空值转为 `None`，没有值域校验。

`backend/app/routers/console_write.py` 当前状态：

- `POST /api/console/lives` 的接口描述明确写着 `type` 不会持久化。
- `INSERT INTO live_attrs` 只写入 `live_date / live_title / is_internal / url / opening_time / start_time / venue_id`。
- 如果请求带了 `type`，只会把它写进审计日志 payload 的 `ui_type`。
- 响应的 `item` 不返回 `type`。

### 1.4 数据库

`backend/db/flyway/sql/B1__baseline_schema.sql` 里的 `live_attrs` 初始列为：

- `id`
- `live_date`
- `live_title`
- `is_internal`
- `url`
- `opening_time`
- `start_time`
- `venue_id`

当前数据库迁移进度：

- `V8__add_nullable_live_type_to_live_attrs.sql` 已新增 nullable `live_type`，用于人工回填历史数据。
- `V9__require_live_type_on_live_attrs.sql` 已在回填后把 `live_type` 收紧为 `NOT NULL`，并将 CHECK 约束改为只允许正式枚举值。
- 后续不能修改 B1、V8 或 V9；如果类型枚举继续变化，应新增后续 `V<n>__...` 迁移。

### 1.5 后端读接口

以下接口当前都不会返回 Live 类型：

- `GET /api/lives`
- `GET /api/me/favorites/lives`
- `GET /api/lives/{live_id}`
- `POST /api/lives/details:batch`

对应的 SQL 和 Pydantic schema 只包含日期、标题、乐队聚合、url、场地、时间、收藏状态和详情行。

### 1.6 测试现状

当前测试已经锁定“`type` 不持久化”的行为：

- `backend/tests/integration/test_console_api.py` 的新增 Live 集成测试说明写着“保留当前控制台 UI 的 `type` 兼容字段但不持久化”。
- 测试只断言 `audit_logs.payload_json.ui_type`，没有断言 `live_attrs` 中存在类型字段。
- 前端测试只断言新增 Live 请求会携带 `type: "专场"`，以及本地历史记录显示成功。

落地本方案时，这些测试需要从“兼容字段”改为“正式业务字段”。

## 2. 目标和非目标

目标：

1. 让 Live 类型成为 `live_attrs` 的正式持久化字段。
2. 统一新增、列表、收藏列表、详情和批量详情的响应结构。
3. 消除当前前端“本地看得到，刷新后丢失”的假展示。
4. 允许短期兼容旧请求体里的 `type`，降低一次性改造风险。
5. 为后续筛选、展示和统计留出稳定字段。

非目标：

1. 本方案不新增 Live 编辑接口。
2. 本方案不重做控制台新增 Live 的整体 UI。
3. 本方案不尝试自动判断历史 Live 的真实类型，已有数据先保持 `live_type = NULL`，由人工回填真实类型。
4. 本方案不引入独立 lookup 表，除非后续类型需要用户自定义或频繁变更。

## 3. 字段和值域设计

推荐把数据库和 API 的正式字段命名为 `live_type`，避免直接使用 `type`。

推荐使用稳定 code 存储和传输，前端负责显示中文 label。英文演出语境里，“拼盘”更接近 `multi-act show / multi-act bill / multi-artist event`，不建议使用 `omnibus`：

| code | label | 说明 |
|------|-------|------|
| `oneman` | `专场` | 单一主办或单一主轴 Live |
| `taiban` | `对邦` | 对邦/双主轴演出 |
| `multi_act` | `拼盘` | 多组艺人/乐队同场的普通拼盘演出 |
| `festival` | `音乐节` | 音乐节或 festival-style 演出 |
| `event` | `活动` | 活动、企划、展会舞台等 |
| `other` | `其他` | 暂未归类或无法判断 |

选择 code 而不是中文直接入库的原因：

- 避免数据库中混入 `oneman / 专场 / One Man` 这类多语言同义值。
- 后续若 UI 文案调整，不需要迁移历史数据。
- API 消费方能依赖稳定枚举值。

兼容规则：

- 新前端应发送 `live_type`，值为上表 code。
- 后端短期继续接受旧字段 `type`。
- 旧字段 `type` 可以接受现有中文值，也可以接受 code。
- 如果请求同时带 `live_type` 和 `type`，两者归一化后必须一致，否则返回 400。
- 响应统一只返回 `live_type`，不再返回 `type`。

建议归一化映射：

```text
专场 -> oneman
拼盘 -> multi_act
对邦 -> taiban
音乐节 -> festival
活动 -> event
其他 -> other
oneman -> oneman
multi_act -> multi_act
taiban -> taiban
festival -> festival
event -> event
other -> other
```

## 4. 数据库适配方案

第一阶段迁移：

```text
backend/db/flyway/sql/V8__add_nullable_live_type_to_live_attrs.sql
```

推荐迁移内容：

```sql
ALTER TABLE public.live_attrs
    ADD COLUMN live_type text;

ALTER TABLE public.live_attrs
    ADD CONSTRAINT live_attrs_live_type_check
    CHECK (
        live_type IS NULL
        OR live_type IN ('oneman', 'taiban', 'multi_act', 'festival', 'event', 'other')
    );

COMMENT ON COLUMN public.live_attrs.live_type
    IS 'Stable live type code: oneman, taiban, multi_act, festival, event, other. NULL means legacy row pending classification.';
```

说明：

- 第一阶段不设置默认值，也不设置 `NOT NULL`，避免把历史数据错误标记为 `other`。
- `NULL` 只表示已有行尚未分类，不是正式 Live 类型；前端展示时应显示为“未分类”或 `-`。
- 后续后端写接口落地后，新增 Live 仍应强制写入非空 `live_type`。
- 待人工回填历史数据并确认不存在 `NULL` 后，再新增迁移收紧为 `NOT NULL`，同时把 CHECK 简化为只允许正式枚举值。
- 当前仓库使用表级权限，新增列通常不需要额外列级 GRANT；仍需要通过集成测试确认 `live_project_ro`、`live_project_super_ro`、`live_project_user_rw` 的读写行为没有退化。
- 不要修改 `B1__baseline_schema.sql` 或任何已经执行过的迁移。

如果未来类型需要后台配置，应再引入 `live_type_list` lookup 表。当前固定 6 类用 CHECK 约束更简单。

第二阶段迁移：

```text
backend/db/flyway/sql/V9__require_live_type_on_live_attrs.sql
```

推荐迁移内容：

```sql
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.live_attrs
        WHERE live_type IS NULL
    ) THEN
        RAISE EXCEPTION 'live_attrs.live_type still contains NULL rows; backfill before applying V9';
    END IF;
END $$;

ALTER TABLE public.live_attrs
    DROP CONSTRAINT live_attrs_live_type_check;

ALTER TABLE public.live_attrs
    ALTER COLUMN live_type SET NOT NULL;

ALTER TABLE public.live_attrs
    ADD CONSTRAINT live_attrs_live_type_check
    CHECK (live_type IN ('oneman', 'taiban', 'multi_act', 'festival', 'event', 'other'));

COMMENT ON COLUMN public.live_attrs.live_type
    IS 'Stable live type code: oneman, taiban, multi_act, festival, event, other.';
```

说明：

- V9 先检查是否仍有 NULL，避免漏回填的库被错误推进到正式约束。
- V9 之后 `live_type` 已是正式必填字段，`NULL` 不再是合法数据库状态。

## 5. 后端适配点

### 5.1 `backend/app/schemas/console.py`

需要调整：

- 将 `ConsoleLiveCreateRequest.type` 从“兼容但不持久化”改为正式业务输入。
- 推荐新增规范字段 `live_type`，同时保留 `type` 作为兼容输入。
- 增加枚举值校验和中文 label 到 code 的归一化。
- `ConsoleLiveItem` 增加 `live_type: str`。

可选实现策略：

- 在 Pydantic 层做字段归一化，router 只消费 `payload.live_type`。
- 如果 Pydantic 别名逻辑让兼容处理变复杂，可以在 router 前段显式处理 `payload` 字段，但要保持 OpenAPI 文档清晰。

### 5.2 `backend/app/routers/console_write.py`

需要调整：

- `POST /api/console/lives` 描述去掉“不持久化”说明。
- `INSERT INTO live_attrs` 增加 `live_type`。
- 返回 item 增加 `live_type`，并使用数据库中实际写入的归一化 code。
- 审计日志 payload 中建议写 `live_type`，不要继续只写 `ui_type`。
- 可短期保留 `ui_type` 作为兼容审计字段，但后续查询应使用 `live_type`。

推荐审计 payload：

```json
{
  "venue_id": 2,
  "opening_time": "18:00:00+09:00",
  "start_time": "19:00:30+09:00",
  "live_type": "oneman"
}
```

### 5.3 `backend/app/schemas/lives.py`

需要调整：

- `LiveItem` 增加 `live_type`。
- `LiveDetailResponse` 增加 `live_type`。

这会影响：

- `GET /api/lives`
- `GET /api/me/favorites/lives`
- `GET /api/lives/{live_id}`
- `POST /api/lives/details:batch`

### 5.4 `backend/app/routers/lives.py`

需要调整：

- `LIVES_BASE_QUERY` SELECT 增加 `l.live_type`。
- `GROUP BY` 增加 `l.live_type`。
- 列表响应构造增加 `live_type`。
- `LIVE_DETAIL_HEADER_QUERY` 增加 `l.live_type`。
- `BATCH_LIVE_DETAIL_HEADERS_QUERY` 增加 `l.live_type`。
- `_build_live_detail_from_rows` 和批量详情构造逻辑同步 row index。

注意：这里现有 SQL row index 比较多，改动时要避免错位。建议优先使用 cursor description 或局部命名 tuple/dict 来降低后续风险，但如果只做本字段改动，也可以保持当前 tuple 风格并补测试兜底。

### 5.5 `backend/app/routers/me.py`

收藏列表复用 `LivesResponse`，也必须同步：

- `FAVORITE_LIVES_BASE_QUERY` SELECT 增加 `l.live_type`。
- `GROUP BY` 增加 `l.live_type`。
- 响应构造增加 `live_type`。

否则 `GET /api/me/favorites/lives` 会无法满足更新后的 response model。

## 6. 前端适配点

### 6.1 类型定义

`frontend/src/api.ts` 需要同步：

- `LiveItem.live_type: string`
- `LiveDetailResponse.live_type: string`
- `ConsoleLiveCreatePayload.live_type: string`
- `ConsoleLiveMutationItem.live_type: string`

如果短期仍需要兼容旧后端，可以让响应解析对缺失 `live_type` 做 `other` 兜底。但正式落地后，后端应始终返回。

### 6.2 选项定义

建议把当前字符串数组改成 code/label 结构：

```ts
export const LIVE_TYPE_OPTIONS = [
  { value: "oneman", label: "专场" },
  { value: "multi_act", label: "拼盘" },
  { value: "taiban", label: "对邦" },
  { value: "festival", label: "音乐节" },
  { value: "event", label: "活动" },
  { value: "other", label: "其他" },
];
```

同时提供一个 helper：

```ts
export function formatLiveType(value: string): string {
  return LIVE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
```

### 6.3 `ConsoleInsertPanel`

需要调整：

- `liveType` 状态保存 code，默认 `oneman`。
- 提交 payload 从 `type: liveType` 改为 `live_type: liveType`。
- 确认弹窗展示 label，但 payload 表格可以同时展示 code 或只展示中文 label，避免用户看到不熟悉的内部 code。
- 新增成功后的本地历史记录使用 `response.item.live_type`，不要继续使用 `payload.type`。
- `insertedLives` 类型字段改成 `live_type`。

### 6.4 `LiveAdminSection`

需要调整：

- select 的 value 使用 code，option 文案使用 label。
- 已新增记录表中展示 `formatLiveType(row.live_type)`。
- 表头可从 `type` 改成 `live_type` 或“类型”。如果该表是面向录入者的调试表，保留 `live_type` 也可以。

### 6.5 主列表和详情

是否在主列表或详情弹窗展示 Live 类型是产品决策。技术上需要先把数据放进前端模型，展示可以分阶段：

- 第一阶段：只让控制台和 API 正确传递，不改首页视觉。
- 第二阶段：在详情弹窗的场地/时间信息旁展示类型。
- 第三阶段：如果需要，增加列表筛选或标签。

推荐第一阶段至少在详情数据模型里保留 `live_type`，避免后续再次改 API。

### 6.6 缓存影响

`createConsoleLive` 当前成功后会调用 `clearLiveCollectionCaches()`。字段新增后仍应保留这一行为。

如果新增 Live 后希望当前页立即显示类型，控制台本地插入的 `LiveItem` 也需要包含 `live_type`，否则 TypeScript 会报错，或者 UI 只能显示默认值。

## 7. 测试适配点

### 7.1 后端集成测试

需要更新 `backend/tests/integration/test_console_api.py`：

- 新增 Live 请求使用 `live_type: "oneman"`。
- 兼容测试覆盖旧字段 `type: "专场"` 仍能写入 `oneman`。
- 查询 `live_attrs` 时断言 `live_type = 'oneman'`。
- 审计日志断言 `payload_json.live_type`。
- 增加非法值用例，断言 422 或 400。

需要新增或更新 lives/me 相关集成测试：

- `GET /api/lives` 返回 `live_type`。
- `GET /api/me/favorites/lives` 返回 `live_type`。
- `GET /api/lives/{live_id}` 返回 `live_type`。
- `POST /api/lives/details:batch` 返回 `live_type`。

### 7.2 后端单元测试

`backend/tests/unit/test_console_api_mock.py` 需要同步：

- mock payload 增加 `live_type`。
- 成功路径断言 SQL 参数包含归一化后的类型。
- 兼容路径断言旧 `type` 被接受。
- 冲突路径断言 `live_type` 和 `type` 不一致时失败。

### 7.3 前端测试

需要更新：

- `frontend/src/__tests__/api.console.test.ts`
  - 请求体从 `type` 改为 `live_type`。
  - 响应 item 包含 `live_type`。
- `frontend/src/components/__tests__/ConsoleInsertPanel.test.tsx`
  - 新增 Live 成功后断言 `createConsoleLive` 收到 `live_type: "oneman"`。
  - 确认弹窗和已新增记录展示中文 label。
  - 后端返回不同但合法的 `live_type` 时，本地历史使用后端返回值。
- 如果主详情展示类型，再补 `App.test.tsx` 的详情弹窗断言。

当前前端 jsdom 测试不会覆盖视觉排版，如果在详情弹窗或列表增加标签，仍需要人工或浏览器级检查。

## 8. 推荐实施顺序

1. [x] 新增 Flyway `V8__add_nullable_live_type_to_live_attrs.sql`，只添加 nullable `live_type` 和允许 NULL 的 CHECK。
2. [x] 人工回填已有 `live_attrs.live_type` 数据，能判断的填真实类型，确实无法判断的才填 `other`。
3. [x] 新增 Flyway `V9__require_live_type_on_live_attrs.sql`，把 `live_type` 收紧为 `NOT NULL`，并把 CHECK 改为不允许 NULL。
4. [x] 更新 seed 数据，让测试样例覆盖至少 `oneman`、`multi_act` 和 `festival` 三种类型。
5. [ ] 后端 console schema/router 写入 `live_type`，并保持旧 `type` 兼容。
6. [ ] 后端 lives/me 读接口全部返回 `live_type`。
7. [ ] 更新后端单元和集成测试。
8. [ ] 更新前端 API 类型和控制台新增 Live 表单。
9. [ ] 选择是否把类型展示到主详情弹窗。
10. [ ] 跑 `python scripts/run_checks.py functional`。

由于本改动涉及 `backend/app/**`、`backend/db/**`、`backend/tests/**`、`frontend/src/**`，实际实施时最终验证必须跑 `python scripts/run_checks.py functional`。

## 9. 风险和注意事项

- API 字段命名从 `type` 迁移到 `live_type` 时，要避免前后端同时改动不完整导致 422。
- `lives.py` 和 `me.py` 的 SQL row index 容易错位，测试要覆盖所有返回路径。
- 历史数据不要统一回填 `other`；`other` 只用于确实无法归类或业务上就是其他类型的 Live。
- 第一阶段允许 `NULL` 会让读接口和前端展示多一种“未分类”状态，前后端落地时要显式处理。
- 如果直接把中文 label 存库，短期省事，但后续文案和多语言会变成数据迁移问题，不推荐。
- 如果未来需要类型筛选，`live_type` 可以先不加索引；等出现筛选 SQL 再评估是否加普通 btree 索引。

## 10. 待确认事项

- `对邦` 的正式 code 是否采用 `taiban`，还是采用更业务化的 `versus`。
- 主列表是否需要显示类型，还是先只在详情和控制台显示。
- 旧客户端兼容窗口保留多久。建议至少保留到下一轮前后端都完成发布后，再考虑移除 `type` 输入兼容。
