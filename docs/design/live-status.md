# Live 状态与日期阶段实现设计

## 状态

- 文档状态：设计完成，尚未实现。
- 本文只定义实现方案；不把产品需求、实现进度或生产部署状态混入本文。
- 当前代码、FastAPI schema、Flyway SQL 和运行数据始终优先于本文。

## 范围

本设计为单场 `live_attrs` 增加人工维护的演出状态、按 Live 当地日期自动计算的日期阶段，以及只记录正式改期的公开业务历史。

本期不实现：

- 分钟级“正在演出”判断或预计结束时间。
- 售票中、售罄、停售、现场票等票务状态。
- 草稿、发布、下架等内容管理状态。
- Tour 或活动组自身的聚合状态。
- 资料修正历史的公开展示。

## 当前实现基线

`live_attrs` 当前已有：

- `live_date date NOT NULL`
- `opening_time time with time zone NOT NULL`
- `start_time time with time zone NOT NULL`
- `live_type text NOT NULL`
- Venue、默认 Band 和活动出演成员等字段

控制台新增和更新 Live 当前共用 `ConsoleLiveUpsertRequest`。公开列表只返回日期、标题、类型、乐队和聚合引用；公开详情另行返回开场、开演和 Venue。Tour 与活动组在各自详情中继续引用同一条 Live。

当前没有结束时间，因此无法可靠判断分钟级“演出中”。本设计明确采用日期级自动阶段，不增加结束时间，也不使用固定演出时长进行推测。

## 状态模型

### 人工状态 `event_status`

`event_status` 持久化到 `live_attrs`，使用稳定 code：

| code | 公共文案 | 含义 |
|---|---|---|
| `scheduled` | 按计划 | 默认状态，没有延期或取消 |
| `postponed` | 延期 | 原计划不再按期举行，新日期尚未确定 |
| `cancelled` | 已取消 | Live 已取消 |

状态语义统一为“取消”。`cancelled` 可以与已有 Setlist 共存，服务端不根据 Setlist 是否存在自动改写状态，也不因状态变化自动删除已经录入的资料。

`scheduled` 不表示 Live 一定尚未开始；一场按计划举行的历史 Live 仍保持 `scheduled`，由日期阶段表达其已经过去。

### 自动日期阶段 `date_phase`

`date_phase` 不持久化，由服务端按 Live 当地日期计算：

| code | 公共文案 | 条件 |
|---|---|---|
| `upcoming` | 待举行 | `live_date` 晚于 Live 当地今天 |
| `today` | 今日举行 | `live_date` 等于 Live 当地今天 |
| `past` | 已结束 | `live_date` 早于 Live 当地今天 |

日期阶段刻意不使用 `in_progress` 或“演出中”。整场日期判断无法区分开演前、实际演出期间和散场后，使用“今日举行”可以避免虚假的实时精度。

### 正式改期

正式改期不是当前互斥状态，而是业务历史：

- 当前有效日期、时间和 Venue 继续保存在 `live_attrs`。
- 正式改期时，把改期前的排期快照写入 `live_schedule_history`。
- 存在至少一条改期历史时，公共接口返回 `was_rescheduled=true`。
- 公开端根据当前日期阶段显示“已改期”或“曾改期”。

因此可以同时表达：

- `scheduled + upcoming + was_rescheduled`：已改期 · 待举行
- `scheduled + today + was_rescheduled`：已改期 · 今日举行
- `scheduled + past + was_rescheduled`：已结束 · 曾改期
- `postponed`：延期
- `cancelled`：已取消

### 资料修正

日期、开场、开演或 Venue 的变化不一定是主办方改期，也可能只是本站原资料录错。

资料修正规则：

- 不写入 `live_schedule_history`。
- 只写现有 `audit_logs`，作为控制台内部审计。
- 公共列表、详情、搜索、Tour、活动组和统计接口都不返回“资料修正”标记、原因或历史值。
- 非控制台前端不得展示“资料修正”“原资料有误”或控制台审计内容。

资料修正和正式改期必须由控制台操作者明确选择，服务端不得只根据日期或时间字段发生变化自动推断。

## 状态展示优先级

公开端按以下优先级生成主状态：

1. `event_status=cancelled`：已取消
2. `event_status=postponed`：延期
3. `event_status=scheduled`：按 `date_phase` 显示待举行、今日举行或已结束

`was_rescheduled` 是次级标记，不覆盖主状态：

- 待举行或今日举行时显示“已改期”。
- 已结束时显示“曾改期”。
- 延期或取消时，主状态优先；正式改期历史只在详情的排期记录中展示，不与主标签争夺视觉层级。

服务端返回稳定 code，中文文案由前端唯一的状态映射格式化，不在多个页面重复维护字典。

## 时区与日期阶段

### 计算口径

“今天”必须是 Live 自身时区中的日期，不能使用：

- 浏览器所在时区的本地日期。
- FastAPI 进程所在机器的本地日期。
- PostgreSQL session 的裸 `CURRENT_DATE`。
- 固定的上海或日本日期。

当前 `opening_time` 和 `start_time` 是 `time with time zone`，控制台使用同一个 UTC offset 写入二者。日期阶段使用 `start_time` 携带的 UTC offset 计算 Live 当地今天：

```text
now_utc
  + start_time 中保存的 UTC offset
  -> event_local_now
  -> event_local_today
```

然后只比较 `live_date` 与 `event_local_today`。

例如在同一个 UTC 时刻，`+09:00` 的日本 Live 可能已经进入下一天，而 `+08:00` 的中国 Live 仍处于前一天；两条 Live 必须得到不同的 `date_phase`。

### 实现边界

新增 `backend/app/live_status.py`，集中提供：

- `EventStatus` 和 `DatePhase` 类型。
- 从 `start_time` 读取 UTC offset 的规范化逻辑。
- `derive_date_phase(live_date, start_time, now_utc)`。
- 状态优先级和公共状态结构的构造函数。

计算函数显式接受 `now_utc`，以便单元测试固定时间边界。路由不得各自读取系统日期并重复实现判断。

第一阶段不提供 `date_phase` 服务端筛选。当前 Live 列表分页在 SQL 中完成，如果先分页再在 Python 中过滤会造成总数和页数错误。需要日期阶段筛选时，应另行把同一时区口径下沉到共享 SQL 条件，再同时应用于 count 和 page query。

日期阶段在每次 API 请求时重新计算。前端在页面重新聚焦或重新进入页面时刷新数据；第一阶段不为跨午夜常驻页面增加复杂的逐 Live 定时器。

## 数据库设计

当前已执行迁移不得修改。实现时新增下一版 Flyway migration。

### `live_attrs`

新增：

```sql
event_status text NOT NULL DEFAULT 'scheduled',
status_note text
```

约束：

```sql
CHECK (event_status IN ('scheduled', 'postponed', 'cancelled'))
```

`status_note` 保存延期或取消说明。允许为空，因为历史资料可能只能确认状态而无法找到可靠原因。`scheduled` 也允许保留普通补充说明，但公开端只在状态信息需要解释时展示。

### `live_schedule_history`

新增业务历史表：

```sql
CREATE TABLE public.live_schedule_history (
    id bigserial PRIMARY KEY,
    live_id integer NOT NULL REFERENCES public.live_attrs(id),
    previous_live_date date NOT NULL,
    previous_opening_time time with time zone NOT NULL,
    previous_start_time time with time zone NOT NULL,
    previous_venue_id integer NOT NULL REFERENCES public.venue_list(id),
    changed_at timestamptz NOT NULL DEFAULT now(),
    changed_by bigint REFERENCES public.app_users(id) ON DELETE SET NULL,
    note text
);
```

索引：

```sql
CREATE INDEX live_schedule_history_live_id_changed_at_idx
    ON public.live_schedule_history (live_id, changed_at, id);
```

每次正式改期插入“改期前快照”。当前值始终读取 `live_attrs`。多次正式改期会依次保存每个旧版本，可以按 `changed_at, id` 还原排期变化。

迁移同时补齐现有数据库角色的目标权限、对象 owner 和序列权限；不得改变 `flyway_schema_history` 的 owner。

### 旧数据

现有 Live 全部回填为：

```text
event_status = scheduled
```

旧数据不根据标题自动识别延期或取消，也不生成改期历史。历史异常状态和正式改期记录需要后续人工核对来源后录入。

测试 seed 显式写入 `event_status`，避免长期依赖默认值。

## API 设计

### 公共 Live 列表

`LiveItem` 增加：

```json
{
  "event_status": "scheduled",
  "date_phase": "upcoming",
  "was_rescheduled": false
}
```

列表不返回：

- `status_note`
- 完整改期历史
- 资料修正类型
- `audit_logs` 内容

### 公共 Live 详情

`LiveDetailResponse` 增加：

```json
{
  "event_status": "postponed",
  "date_phase": "past",
  "status_note": "主办方公告延期，新日期未定",
  "was_rescheduled": true,
  "schedule_history": [
    {
      "previous_live_date": "2026-08-10",
      "previous_opening_time": "18:00:00+09:00",
      "previous_start_time": "19:00:00+09:00",
      "previous_venue_id": 12,
      "previous_venue": "旧 Venue",
      "changed_at": "2026-07-20T10:00:00Z",
      "note": "主办方正式改期"
    }
  ]
}
```

详情只返回 `live_schedule_history` 中的正式改期。资料修正没有业务历史行，因此不存在从公共详情泄漏的路径。

批量详情返回与单详情相同的状态字段，保证列表预取、独立详情、Tour 内嵌详情和活动组内嵌详情一致。

### Tour、活动组与巡演场次顺序

Tour stop 和活动组 Live item 增加：

- `event_status`
- `date_phase`
- `was_rescheduled`

Tour 摘要/详情和活动组摘要/详情增加：

- `cancelled_live_count`

`cancelled_live_count` 统计当前聚合对象中 `event_status = 'cancelled'` 的 Live 数量。原有 `collected_live_count`、`live_count`、`day_count` 和日期范围继续包含取消 Live，不改变“已收录”字段的含义。

第一阶段不为 Tour 或活动组计算独立状态。单场 Live 被延期或取消时：

- 不自动删除 `tour_lives` 或 `performance_group_lives` 关系。
- 不改变 stop 顺序以外的显式关系。
- 子 Live 入口显示自身状态。

取消 Live 不拆散聚合：单日多场、多日活动和巡演都继续作为原有聚合对象返回，分页、排序、日期范围和收藏聚合规则不变。公开活动组卡片只按下文调整取消样式、取消场数文案和点击能力；巡演列表只增加取消场数文案。以下活动组排序规则只用于“巡演详情 → 场次详情”中的巡演场次序列。

巡演场次采用“活动组排序块优先、块内时间排序”：

1. 同时属于同一个活动组和当前 Tour 的 Live 组成一个不可交叉的排序块。
2. 不属于活动组的 Live 各自形成单场排序块。
3. 排序块以块内第一条 Live 的 `live_date, start_time, live_id` 排序。
4. 同一排序块内部按 `live_date, start_time, live_id` 排序。
5. 一个活动组的场次全部排完后，才进入下一个排序块；不能被另一个活动组中日期相同或更早的场次穿插。
6. `stop_order` 按最终展示顺序重新生成连续值。

例如：

```text
活动组 A：场3 02-01、场4 02-02
活动组 B：场5 02-01、场6 02-02
```

巡演详情的场次顺序为：

```text
场3 / 场4 / 场5 / 场6
```

而不是按全局日期交叉成 `场3 / 场5 / 场4 / 场6`。如果活动组 A 的两场都取消，顺序仍为：

```text
场3（已取消） / 场4（已取消） / 场5 / 场6
```

取消状态不拆散活动组排序块，也不改变其他活动组的公开聚合行为。

### 控制台读取

控制台候选增加 `event_status` 和 `date_phase`，并支持可选的 `event_status` 精确筛选。完整编辑响应增加：

- `event_status`
- `status_note`
- 正式改期历史

控制台可以读取内部审计，但公共 API 不复用或转发审计 payload。

### 控制台写入

新增和更新不再完全共用同一个请求模型：

```text
ConsoleLiveBaseRequest
├── ConsoleLiveCreateRequest
└── ConsoleLiveUpdateRequest
```

公共字段增加：

```json
{
  "event_status": "scheduled",
  "status_note": null
}
```

更新请求额外接受：

```json
{
  "schedule_change_kind": "correction",
  "schedule_change_note": null
}
```

`schedule_change_kind` 仅允许：

- `correction`：本站资料修正，只写控制台审计。
- `reschedule`：主办方正式改期，写业务历史和控制台审计。

服务端规则：

1. 对目标 `live_attrs` 执行 `SELECT ... FOR UPDATE`。
2. 比较 `live_date/opening_time/start_time/venue_id`。
3. 上述排期字段发生变化时，必须提供 `schedule_change_kind`。
4. `schedule_change_kind=reschedule` 时，先把锁定行的旧排期写入 `live_schedule_history`。
5. `schedule_change_kind=correction` 时，不写 `live_schedule_history`。
6. 排期字段没有变化时，提交 `schedule_change_kind` 返回 `422`，避免产生虚假改期记录。
7. 更新 `live_attrs`，并把全部字段差异及 `schedule_change_kind` 写入现有 `live_update` 审计。
8. 改期历史插入、Live 更新和审计写入必须在同一事务提交或回滚。

延期后确定新日期时：

- 把 `event_status` 改回 `scheduled`。
- 更新当前日期、时间或 Venue。
- 使用 `schedule_change_kind=reschedule` 保存旧排期。

单纯修正错误日期时：

- 保持当前 `event_status`。
- 使用 `schedule_change_kind=correction`。
- 公开端只看见修正后的正确值，不显示任何修正提示。

## 控制台前端

现有 Live 表格已经包含日期、标题、类型、URL、开场、开演和时区，不增加新的横向列。状态区放在主表格下方，复用现有控制台表单、提示和确认样式：

```text
演出状态  [按计划 / 延期 / 已取消]
日期阶段  今日举行（只读）
状态说明  [                                 ]
```

当日期、开场、开演或 Venue 与原始快照不同时，显示：

```text
本次排期变化
○ 资料修正
○ 主办方正式改期
```

交互规则：

- 新增 Live 默认 `scheduled`。
- 日期阶段只读，不允许人工覆盖。
- 没有排期字段变化时不显示“资料修正 / 正式改期”选项。
- 有排期字段变化但未选择类型时禁止保存。
- 保存确认框同时显示字段差异和“资料修正 / 正式改期”。
- 有 Setlist 的 Live 改为 `cancelled` 时显示强警告，但不自动删除 Setlist。
- 更新成功后继续使用服务端响应刷新原始快照和缓存。

“资料修正”只存在于 Live 管理和控制台审计界面。普通列表、卡片、首页、公开详情、Tour 和活动组均不得渲染该词或相应标记。

## 公开前端

新增一份共享状态映射和展示函数，作用与现有 `LIVE_TYPE_LABELS` 相同，所有页面复用稳定 code，不创建页面级重复字典。

### Live 详情

- 标题旁始终显示主状态。
- `postponed/cancelled` 时在基本信息下显示 `status_note`。
- 有正式改期历史时显示原定日期、时间和 Venue。
- 不显示资料修正记录。

### 表格、卡片和首页

- 不新增独立状态列，避免继续扩大现有表格宽度。
- 在标题或日期旁使用紧凑状态标签。
- 突出待举行、今日举行、延期、取消和已改期。
- 普通历史 Live 可以省略重复的“已结束”，详情中仍完整展示。
- 取消状态不能只依赖颜色，必须有可读文字。

### 活动组与巡演聚合卡片

- 单日多场活动组、多日活动组和巡演都保留现有聚合形态，不因部分或全部场次取消而拆成单场卡片。
- 活动组摘要使用 `cancelled_live_count`。只要 `cancelled_live_count > 0`，整张活动组卡片使用取消状态颜色，并渲染为不可点击、不可通过键盘聚焦的静态卡片。
- 活动组卡片仍显示名称、日期或日期范围、Band 和原有收录场数；取消数以明确文字追加：单日活动为 `已收录 N 场 · 取消 X 场`，多日活动为 `已收录 D 日 · N 场 · 取消 X 场`。
- 活动组卡片不可点击只改变公开入口交互，不删除活动组、Live 关联或活动组详情 API；取消数为零时保持现有点击行为。
- 巡演摘要同样使用 `cancelled_live_count`，大于零时显示 `已收录 N 场 · 取消 X 场`；巡演仍保持聚合卡片并可进入巡演详情。
- 巡演卡片不因存在取消场次而整体进入取消状态，因为详情中仍需查看其他正常场次；`取消 X 场` 文字使用取消语义颜色即可。
- `cancelled_live_count = 0` 时不显示 `取消 0 场`，保持现有文案密度。

### 巡演详情与活动组详情

- 只在子 Live 入口展示单场状态。
- 不自动推导整个 Tour 或活动组的主状态。
- 取消、延期和正式改期不删除关联。
- 资料修正不显示任何标记。
- 活动组与巡演的聚合边界、分页和排序保持现状；取消只影响上述摘要文案、颜色和点击能力。
- 巡演详情头部在存在取消场次时显示 `场次：N · 取消 X 场`。
- 巡演详情的场次入口按“活动组排序块优先、块内时间排序”排列。
- 取消场次保留原位置，标题后追加 `（已取消）`，并使用取消状态颜色。
- 取消且没有 Setlist 的场次渲染为不可点击文本，不进入 Live 详情。
- 取消但存在 Setlist 的场次仍可点击，以便读取已有歌曲资料。
- 是否可进入详情不改变现有收藏关系或收藏按钮能力。
- 未取消场次保持现有点击和收藏交互。

## Setlist 与统计口径

### Setlist

- `cancelled` 不自动删除已有 Setlist。
- `cancelled` 且存在 Setlist 时，已有歌曲仍表示实际发生的演唱资料，可以继续参与歌曲演唱统计。
- `cancelled` 且没有 Setlist 时，不产生歌曲演唱统计。
- `postponed` 通常不应存在 Setlist；若已有 Setlist，控制台保存时警告，但不自动删除。

### Live 计数

后续统计改造应区分：

- 收录记录数：包含全部状态。
- 已完整举行数：`scheduled + past`。
- 待举行数：`scheduled + upcoming/today`。
- 延期数：`postponed`。
- 取消数：`cancelled`。

需要判断歌曲资料时，以 Setlist 是否存在为准；`event_status=cancelled` 本身不负责清理或推断 Setlist。

Tour 和活动组继续使用“已收录”口径表达数据库覆盖范围；如新增“已举行”统计，必须明确排除延期和取消状态，不能悄悄改变原有字段含义。

聚合查询在保留原有总数字段的同时增加取消数：

```sql
COUNT(*) FILTER (
  WHERE l.event_status = 'cancelled'
)::int AS cancelled_live_count
```

活动组查询使用现有去重口径：

```sql
COUNT(DISTINCT l.id) FILTER (
  WHERE l.event_status = 'cancelled'
)::int AS cancelled_live_count
```

普通列表、收藏列表、Tour 摘要/详情和活动组摘要/详情必须使用相同定义。取消 Live 仍参与活动组完整收藏判断和总场数统计，避免取消状态改变既有聚合边界。

## 缓存与失效

以下写入成功后清理相关缓存：

- `event_status` 或 `status_note` 变化。
- Live 日期、时间或 Venue 变化。
- 新增正式改期历史。

至少清理：

- Live 列表和收藏列表。
- 单详情与批量详情预取缓存。
- Catalog 搜索和 Band Live 列表。
- Tour 与活动组详情。
- 使用 Live 候选集的公共统计缓存。

资料修正与正式改期都需要清理相同的资料缓存；区别只在是否写业务历史和是否公开展示。

## 错误行为

- 未知 `event_status`：`422`。
- 排期字段变化但未提供 `schedule_change_kind`：`422`。
- 排期字段未变化却提供 `schedule_change_kind`：`422`。
- `reschedule` 缺少可识别的排期字段变化：`422`。
- Live、Venue 或历史关联资源不存在：`404`。
- 未登录、角色不足或 CSRF 无效：`401/403`。
- 查询或连接超时：`504`。
- 其他数据库错误：`500`。

## 验证

### 后端单元测试

- `+08:00` 和 `+09:00` 在同一 UTC 时刻得到不同的当地日期阶段。
- `upcoming -> today -> past` 只在 Live 当地午夜切换。
- 浏览器、FastAPI 主机和 PostgreSQL session 时区不影响结果。
- `cancelled/postponed` 的主状态优先于日期阶段。
- `was_rescheduled` 只来自正式改期历史。

### PostgreSQL 集成测试

- 新增和更新持久化 `event_status/status_note`。
- 正式改期插入旧排期快照并在同一事务写审计。
- 资料修正只更新当前值和审计，不写 `live_schedule_history`。
- 公共接口只返回正式改期历史。
- 取消 Live 不删除 Setlist、Tour、活动组或收藏关系。
- 多次正式改期可以按顺序还原旧排期。
- Tour 和活动组的总场数继续包含取消 Live，并正确返回 `cancelled_live_count`。
- 普通列表与收藏列表使用相同的取消计数和聚合规则。

### 前端测试

- 控制台正确展示只读日期阶段。
- 排期字段变化后必须选择资料修正或正式改期。
- 确认框明确展示选择结果。
- 普通公开页面不出现“资料修正”。
- 详情、列表、卡片、Tour 和活动组复用同一状态文案。
- 普通历史列表不被大量“已结束”标签占满。
- 包含取消 Live 的单日或多日活动组仍返回一张聚合卡片，显示 `取消 X 场`，整张卡使用取消样式且不可点击。
- 不含取消 Live 的活动组保持现有样式和点击行为，不显示 `取消 0 场`。
- 包含取消 Live 的巡演仍返回一张聚合卡片，显示 `取消 X 场` 且仍可进入巡演详情。
- 巡演详情继续按活动组排序块展示场次，取消且无 Setlist 的场次不可点击。

实现涉及业务代码、数据库和测试后，最终只运行：

```powershell
python scripts/run_checks.py functional
```

## 实施顺序

1. 新增 Flyway migration、seed 和数据库权限。
2. 新增统一状态计算模块与后端 schema。
3. 扩展公共列表、详情、批量详情、Tour 和活动组查询。
4. 拆分控制台新增与更新请求，落实 correction/reschedule 事务。
5. 扩展控制台表单、确认、脏状态和缓存失效。
6. 扩展公开详情、列表、卡片和聚合入口。
7. 按明确口径调整统计和文档。
8. 补齐单元、集成和前端测试，运行完整 functional 检查。
