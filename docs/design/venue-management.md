# Venue 独立管理与历史名称实现设计

2026-09-18 确认：只有正式更名新增名称历史版本，真实搬迁新建 Venue；所在地、地址、坐标与时区保留补录和录错纠正入口，不产生版本。地图关联不因这些纠错自动失效。详见 [版本语义纠正记录](venue-revision-correction-2026-09-18.md)。

## 文档定位

本文只定义 Venue 独立管理、历史名称、Live 场馆名称固化、重复 Venue 合并，以及现有查询链路迁移的技术方案。

后续地理信息扩展见 [场馆所在地与时区](venue-location-and-timezone.md)。本文“明确不做”中的地址、坐标和地图属于原首期边界；当前已实现地理资料维护、公共 Venue 详情、Live 地图入口、Google 搜索／点选和人工 POI 关联，自动批量 POI 关联仍不纳入本期。

本文不承担产品需求清单；本期边界以本文“范围”和“明确不做”章节为准。当前代码、FastAPI schema、Flyway SQL 和运行数据始终优先于本文。

## 状态与已确认口径

- 文档状态：2026-09-20 按当前仓库代码刷新。核心维护与公共读取已实现，合并、历史名称选择等尚未全部完成，具体见下方进度表。
- 当前仓库最新 migration 为 `V34__simplify_live_timezones.sql`；此处说明迁移文件状态，不代表已核验本地数据库执行版本。
- `live_attrs.venue_id` 和 `live_schedule_history.previous_venue_id` 已允许 `NULL`，表示场馆尚未公布；不得为此创建“未定”Venue。
- V28 在兼容字段 `venue_list.venue` 之外增加 Venue 类型、合并指向和独立名称版本表。
- 同一物理场馆的正式更名保持同一个 `venue_id`；搬迁到不同地址或新建替代场馆时创建新的 `venue_id`。
- Live 展示其录入时明确绑定的名称版本，不随 Venue 当前名称变化。
- 名称拼写或资料错误仅通过 SQL 修正；控制台真实更名必须追加名称版本，不能覆盖旧版本。
- 重复 Venue 通过显式合并处理，不根据名称、日期或相似度自动合并。
- 本期不设计父场馆、来源链接和 Venue 备注。
- alias、多语言名称和完整 i18n 属于低优先级后续能力，本期不预建空表或占位字段。

## 当前实现进度（2026-09-20）

本节以仓库实现为依据；下文原始设计和迁移阶段不代表所有条目均已交付。进度只按代码、本地数据及本地验证衡量，不以远程部署或发布为完成条件。本次仅检查代码和测试文件，没有重新运行测试、浏览器验收或查询本地数据库；现有测试覆盖不等于本轮验证通过。

| 能力 | 状态 | 实现依据与边界 |
| --- | --- | --- |
| 稳定身份、名称历史及成对引用 | 已实现 | V28/V29 建表及 `MATCH FULL`；正式更名追加版本，Live 与改期历史保存明确版本 ID |
| 独立新增场馆 | 已实现 | `VenueCreateSection` → `POST /api/console/venues`；同一事务保存身份、初始名称、位置及 Google 关联；创建失败保留草稿 |
| 管理页搜索、分页、历史名称展示 | 已实现 | `VenueAdminSection`；历史名称只读，分页不依赖固定 100 条全集 |
| 类型、正式更名和位置统一编辑 | 已实现 | `VenueLocationPanel` → `edit-preview` → `PUT /venues/{id}/edit`；事务保存、状态令牌校验及审计 |
| 地区和位置资料维护 | 已实现 | 独立 `LocalityAdminSection`；国家／行政区／城市层级；资料纠错不生成名称版本，不重写既有 Live 时间 |
| 场馆时区与演出时间 | 已实现新口径 | V34 移除地区时区和 Live 时区快照；实体／未公开场馆保存自身 IANA，ONLINE 演出采用固定偏移，时间保存为 `timetz`，详见 [演出时区](live-timezone.md) |
| 地图定位与人工平台关联 | 核心链路已实现 | Google 搜索、点选、拖动、逆地理、离线 IANA、地图实例复用；Apple／高德保留人工关联；共享限流尚未实现 |
| 公共读取 | 已实现 | 公共场馆详情、名称记录、地图及关联演出；Live、巡演、活动组等读取绑定名称版本 |
| 重复场馆合并 | 部分实现 | 后端有预览、映射和事务执行；任一方有地理资料即拒绝，控制台没有合并入口 |
| Live 历史名称选择 | 部分实现 | 搜索历史名称可带入命中版本，保存校验版本归属；无按日期推荐及完整版本选择流程 |
| 名称兼容列收尾 | 未完成 | 创建、更名仍维护 `venue_list.venue`，尚无删除该列的后续迁移 |

主要代码入口：[`console_venues.py`](../../backend/app/routers/console_venues.py)、[`console_geography.py`](../../backend/app/routers/console_geography.py)、[`ConsoleInsertPanel.tsx`](../../frontend/src/components/ConsoleInsertPanel.tsx)、[`VenueLocationPicker.tsx`](../../frontend/src/components/console/VenueLocationPicker.tsx)。

## 未完成项：按重要性排序

以下排序综合数据正确性、核心操作阻塞和使用便利性；P1 为优先补齐，P2 为后续收尾，不表示当前已有数据损坏。每项完成后按实际修改范围运行根目录规定的检查；交互变更另做本地浏览器验证。

| 顺序 | 优先级 | 未完成项 | 完成条件 |
| --- | --- | --- | --- |
| 1 | P1 | 带地理资料的重复 Venue 合并及管理入口 | 明确地区、地址、坐标、时区、各平台关联的冲突处理；提供管理员预览与版本映射；事务更新 Live／历史成对引用并保留审计，不能简单移除现有拒绝保护 |
| 2 | P1 | Live 名称版本按日期推荐与显式选择 | 可查看并选择全部名称版本；按日期推荐，日期与版本不符时提示；修改日期不静默覆盖已选版本 |
| 3 | P1 | 地图外部请求共享限流 | 在多客户端／多 worker 下约束上游请求；并发与超限行为有验证。现有缓存、8 秒超时及响应大小限制不替代限流 |
| 4 | P2 | 新增前相似场馆提示 | 展示已有正式名称候选，编辑者可确认不同实体后继续创建；不自动合并或仅凭相似名称阻止创建 |
| 5 | P2 | 管理页使用情况与检索辅助 | 接入关联 Live 分页列表、类型筛选、历史名称命中标识；公共详情已有演出列表，不重复计算为缺失 |
| 6 | P2 | 删除名称兼容列 | 核对所有读写、脚本及种子依赖后，新增独立 migration 删除 `venue_list.venue`，移除兼容写入并验证名称读取契约 |

待核验事项单列，不算作已证实的开发缺口：当前本地库迁移版本与数据完整性、当前代码的自动检查结果、地图桌面／窄屏真实交互。历史回填说明不能代替当前数据核验。本次文档更新不触发这些检查。

明确延后：自动批量 POI 关联、Apple／高德交互地图、alias／i18n、父子场馆、营业生命周期和地理聚合统计。它们不计入上述核心功能收尾清单。

## 范围

本期覆盖：

- 在控制台中增加独立的 `Venue管理` 页签。
- 以 `venue_list.id` 作为不随名称变化的 Venue 身份。
- 保存一个 Venue 的多个正式历史名称及有效期。
- 为每场已有 Venue 的 Live 固化一个 `venue_name_version_id`。
- 为正式改期历史固化修改前的 Venue 名称版本。
- Venue 分页查询、详情、创建、位置资料修正、正式更名和重复项合并。
- 当前名称和历史名称搜索。
- 现有公共列表、详情、Catalog、巡演、活动组和统计的兼容迁移。
- 新旧结构并存期间的回填、一致性检查和最终收口。

## 明确不做

- 父场馆、园区、建筑与子 Hall 的结构化层级。
- 地址、经纬度、地图和地理检索。
- Venue 来源 URL、资料来源和自由备注。
- alias、简称、常见拼写、罗马字或多语言名称。
- 根据名称相似度自动合并 Venue。
- 根据 Live 日期静默改写已经绑定的名称版本。
- 自动从括号文本解析旧名、建筑名或活动冠名。
- 删除有历史引用的 Venue 或名称版本。

同一园区中的不同 Hall 继续作为独立 Venue 使用。由于本期不建立父子关系，统计也不向园区层级自动聚合。

## 改造前基线与问题（历史背景）

### 当前数据结构

```text
venue_list
- id integer primary key
- venue text not null

live_attrs
- venue_id integer null -> venue_list.id

live_schedule_history
- previous_venue_id integer null -> venue_list.id
```

当前所有读取路径都通过 `venue_id` 联接 `venue_list.venue`。因此直接修改 `venue_list.venue` 会同时改变：

- 所有历史 Live 的场馆展示。
- 巡演和活动组内的历史场馆展示。
- 正式改期记录中的旧场馆展示。
- Catalog 场馆名称及搜索结果。

这使“资料修正”和“场馆真实更名”无法区分，也无法准确表达一场 Live 当时使用的名称。

### 当前控制台限制

- `GET /api/console/venues` 只支持 `q + limit`，`limit` 最大为 100，没有分页和总数。
- 控制台初始化调用 `getConsoleVenues(undefined, 100)`，数据超过 100 条后不能形成完整候选集合。
- `POST /api/console/venues` 只接受一个 `venue_name`，没有详情、修改、更名或合并接口。
- Venue 仍附属于 Live 录入区域，没有独立维护入口。

候选查询必须分页，不能以固定 100 条上限假设场馆总量。

### V27 的影响

V27 允许 Live 的场馆为空。新结构必须满足：

```text
venue_id IS NULL
=> venue_name_version_id IS NULL
```

场馆公布后，Live 更新操作一次性写入 `venue_id + venue_name_version_id`。取消或改回未公布状态时，两者也必须一起清空。

## 核心模型

```text
venue_list
  └─ venue_name_versions

live_attrs
  ├─ venue_id
  └─ venue_name_version_id

live_schedule_history
  ├─ previous_venue_id
  └─ previous_venue_name_version_id
```

各层语义：

- `venue_list.id`：稳定 Venue 身份，用于筛选、统计和合并。
- `venue_list.venue`：迁移期间保留的当前名称兼容投影，最终删除。
- `venue_name_versions`：该 Venue 的正式名称历史。
- `live_attrs.venue_name_version_id`：该场 Live 实际展示的名称版本。
- `live_schedule_history.previous_venue_name_version_id`：改期前快照对应的名称版本。

名称有效期用于管理、推荐和一致性提示；最终展示以 Live 已保存的版本 ID 为准。这样即使有效期资料后来补充或修正，也不会静默改变 Live 的版本选择。

## 数据库设计

### `venue_list`

在兼容阶段保留原字段，并增加最小必要属性：

```sql
ALTER TABLE public.venue_list
    ADD COLUMN venue_kind text NOT NULL DEFAULT 'physical',
    ADD COLUMN merged_into_venue_id integer
        REFERENCES public.venue_list(id) ON DELETE RESTRICT;
```

`venue_kind` 允许：

```text
physical
online
undisclosed
```

规则：

- `physical`：普通实体场馆。
- `online`：无单一实体场馆的线上 Live。
- `undisclosed`：主办方只公开了“某所”等模糊位置。
- 真正“尚未公布”使用 `live_attrs.venue_id = NULL`，不是 `undisclosed` Venue。
- `merged_into_venue_id` 非空表示该行是已合并来源，普通候选查询不再返回它。
- `merged_into_venue_id` 不得等于自身。
- 合并链不允许继续形成多级跳转；目标 Venue 必须是未被合并的有效实体。

本期不增加通用 `status`。停业场馆仍可能用于历史 Live 录入，不能简单从候选中移除；是否需要营业状态由后续独立需求决定。

### `venue_name_versions`

```sql
CREATE TABLE public.venue_name_versions (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    venue_id integer NOT NULL
        REFERENCES public.venue_list(id) ON DELETE RESTRICT,
    venue_name text NOT NULL,
    valid_from date,
    valid_to date,
    CONSTRAINT venue_name_versions_name_not_blank
        CHECK (btrim(venue_name) <> ''),
    CONSTRAINT venue_name_versions_valid_range
        CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
    CONSTRAINT venue_name_versions_venue_id_id_unique
        UNIQUE (venue_id, id)
);

CREATE UNIQUE INDEX venue_name_versions_one_open_idx
    ON public.venue_name_versions (venue_id)
    WHERE valid_to IS NULL;

CREATE INDEX venue_name_versions_lookup_idx
    ON public.venue_name_versions (lower(btrim(venue_name)), venue_id);

CREATE INDEX venue_name_versions_validity_idx
    ON public.venue_name_versions (venue_id, valid_from, valid_to, id);
```

规则：

- 日期范围采用 `[valid_from, valid_to)`，`valid_to` 当天开始不再使用旧名。
- 一个未合并 Venue 最多只能有一个 `valid_to IS NULL` 的开放名称版本。
- 创建和更名 API 负责保证一个未合并 Venue 至少有一个开放名称版本。
- 名称有效期不能重叠；首期由写接口在同一事务内锁定 Venue 后校验，不为此引入额外 PostgreSQL 扩展。
- 已被 Live 或改期历史引用的名称版本不可删除。
- 名称中的首尾空格在 schema 校验前由 API 去除。
- 本期只记录正式展示名称，不区分官方名、冠名或活动品牌子类型。

### `live_attrs`

兼容阶段先增加可空列：

```sql
ALTER TABLE public.live_attrs
    ADD COLUMN venue_name_version_id bigint;
```

回填和双写稳定后增加复合外键：

```sql
ALTER TABLE public.live_attrs
    ADD CONSTRAINT live_attrs_venue_name_version_fkey
    FOREIGN KEY (venue_id, venue_name_version_id)
    REFERENCES public.venue_name_versions (venue_id, id)
    MATCH FULL
    ON DELETE RESTRICT;
```

`MATCH FULL` 保证：

- 两列同时为 `NULL`，表示场馆未公布；或者
- 两列同时非空，且名称版本确实属于所选 Venue。

不能只把 `venue_name_version_id` 设为普通外键，否则可能把 Venue A 和 Venue B 的名称版本错误组合。

### `live_schedule_history`

新增：

```sql
ALTER TABLE public.live_schedule_history
    ADD COLUMN previous_venue_name_version_id bigint;
```

完成回填后增加同样的复合外键：

```sql
ALTER TABLE public.live_schedule_history
    ADD CONSTRAINT live_schedule_history_venue_name_version_fkey
    FOREIGN KEY (previous_venue_id, previous_venue_name_version_id)
    REFERENCES public.venue_name_versions (venue_id, id)
    MATCH FULL
    ON DELETE RESTRICT;
```

不另外保存重复的名称文本快照。名称版本本身就是结构化、受保护的历史记录；修正版本中的拼写错误应同步修正所有相关展示。

既有改期记录无法仅凭当前数据库可靠推断当时官方名称。首次迁移可暂时绑定回填时的兼容名称版本，随后在 Venue 管理页人工校正，不能按日期或外部常识自动修改。

### 当前名称视图

参考现有 `current_band_versions`，建立：

```text
current_venue_versions
- venue_id
- venue_name
- venue_name_version_id
- venue_kind
```

视图只返回 `merged_into_venue_id IS NULL` 的 Venue，并选择唯一开放名称版本。控制台候选和公共当前名称展示通过该视图读取；历史 Live 仍通过其明确的 `venue_name_version_id` 读取。

### 权限与所有权

- 新表、索引、视图和 identity sequence 属于 `live_project_owner`。
- `live_project_ro` 获得公共读取所需的 `SELECT`。
- `live_project_super_ro` 获得控制台所需的 `SELECT / INSERT / UPDATE`。
- 不授予名称版本或 Venue 的通用 `DELETE`。
- `flyway_schema_history` 的 owner 和权限不变。
- 新对象加入 `backend/db/postgres/checks/ownership_contract.sql`。

## 名称操作语义

### 新增 Venue

一个事务内：

1. 创建 `venue_list`。
2. 创建第一个开放名称版本。
3. 同步兼容字段 `venue_list.venue`。
4. 写入 `venue_create` 审计。

不得只创建 Venue 身份而没有开放名称版本。

### 正式更名

请求必须包含新名称和 `valid_from`：

1. `SELECT ... FOR UPDATE` 锁定 Venue 和当前开放名称版本。
2. 将旧版本 `valid_to` 设置为新版本的 `valid_from`。
3. 创建新开放名称版本。
4. 更新兼容字段 `venue_list.venue`。
5. 写入 `venue_name_change` 审计，记录旧/新版本 ID、名称和生效日期。

历史 Live 保持原版本引用。新建 Live 默认选择当前开放版本；录入旧 Live 时可显式选择历史版本。

### 名称资料维护

控制台、前端和后端只允许追加正式更名版本，生效日期必须晚于当前版本。当前及历史名称版本均不提供原地修改入口；拼写纠错、迁移和回填仅通过 SQL 处理。

### 选择 Live 的名称版本

- `venue_id = NULL` 时版本必须为 `NULL`。
- 选择 Venue 后，后端根据 Live 日期返回推荐版本。
- 如果日期落入唯一历史名称区间，默认推荐该版本。
- 如果日期没有明确命中，推荐当前开放版本并返回提示状态。
- 前端必须让编辑者确认最终版本，后端保存明确 ID。
- 修改 Live 日期时不自动改写已有版本；若日期与版本有效期不一致，只提示并允许编辑者调整。

## 重复 Venue 合并

合并是独立的高风险操作，不复用普通编辑接口，也不做相似名称自动执行。

### 合并预览

预览返回：

- 来源和目标 Venue。
- 各自的名称版本。
- 各自关联的 Live 数和改期历史数。
- 来源版本到目标版本的映射要求。
- 合并后会更新的具体记录数。

每个被引用的来源名称版本都必须映射到一个目标名称版本。若目标不存在合适版本，应先通过更名或资料整理流程建立正确版本。

### 合并执行

一个事务内：

1. 按 ID 顺序锁定来源和目标 Venue，避免死锁。
2. 再次确认二者均未被合并，且目标不是来源。
3. 校验所有来源名称版本映射完整，且映射目标属于目标 Venue。
4. 成对更新 `live_attrs.venue_id + venue_name_version_id`。
5. 成对更新 `live_schedule_history.previous_venue_id + previous_venue_name_version_id`。
6. 设置来源 `merged_into_venue_id = target_id`。
7. 写入 `venue_merge` 审计，保存来源、目标、版本映射和更新数量。

来源 Venue 和来源名称版本均不删除。普通搜索不返回来源实体；使用来源名称搜索时，可以把来源标记为“已合并”并引导到目标 Venue。

首期只允许管理员执行合并。普通 Venue 创建、更名和位置资料修正保持 `editor+`。

## API 设计

### Venue 分页查询

```text
GET /api/console/venues
  ?q=
  &page=1
  &limit=20
  &venue_kind=
  &include_merged=false
```

`q` 匹配所有正式名称版本，但每个 Venue 只返回一行。返回当前名称，并说明匹配的是当前名称还是历史名称。

```json
{
  "items": [
    {
      "venue_id": 36,
      "venue_name": "Current name",
      "venue_name_version_id": 201,
      "venue_kind": "physical",
      "matched_name": "Former name",
      "matched_name_version_id": 200,
      "match_kind": "historical",
      "live_count": 12,
      "first_live_date": "2016-11-13",
      "last_live_date": "2026-01-12",
      "merged_into_venue_id": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

排序优先级：

1. 当前名称前缀命中。
2. 历史名称前缀命中。
3. 其他包含命中。
4. `live_count DESC`。
5. 当前名称、`venue_id`。

### Venue 详情与使用情况

```text
GET /api/console/venues/{venue_id}
GET /api/console/venues/{venue_id}/lives?page=1&limit=20
```

详情返回基础资料、全部名称版本和引用统计。Live 列表独立分页，避免 Venue 使用次数较多时让详情响应无限增长。

### Venue 写入

```text
POST  /api/console/venues
PATCH /api/console/venues/{venue_id}
POST  /api/console/venues/{venue_id}/name-versions
GET   /api/console/venues/{source_id}/merge-preview?target_id=
POST  /api/console/venues/{source_id}/merge
```

职责：

- `POST /venues`：原子创建 Venue 和初始名称版本。
- `PATCH /venues/{id}`：本期只修改 `venue_kind`。
- `POST /name-versions`：登记真实更名。
- 不提供名称版本原地修正接口；当前与历史名称修正、迁移和回填仅通过 SQL。
- `merge-preview`：只读返回影响范围和必需映射。
- `merge`：管理员确认后执行事务性合并。

所有写接口继续要求 session、角色检查和 `X-CSRF-Token`。

### Live 写入契约

Live 新增和更新请求增加：

```json
{
  "venue_id": 36,
  "venue_name_version_id": 200
}
```

后端校验两者同时为空或同时有效，并校验版本属于 Venue。兼容阶段允许旧客户端只提交 `venue_id`，服务端临时补当前开放版本；兼容期结束后移除该分支。

## 控制台设计

### 独立页签

在现有控制台 `SectionTabs` 中增加：

```text
Venue管理
```

实现为独立 `VenueAdminSection`，不要继续扩大 `ConsoleInsertPanel.tsx` 中的 Venue 状态。页面复用现有：

- `console-admin-table`
- 管理工具栏和分页形式
- `CompactConfirmationTable`
- 确认对话框
- 成功/失败消息区域
- 现有按钮、输入框和主题 token

### 页面结构

列表区：

| ID | 当前名称 | 类型 | Live 数 | 使用期间 | 状态 |
|---|---|---|---:|---|---|

详情区：

- 当前 Venue ID、名称和类型。
- 名称版本表：名称、生效日、结束日、引用 Live 数。
- 创建新名称版本。
- 名称历史只读，名称修正仅通过 SQL。
- 查看关联 Live。
- 管理员合并入口。

不展示父场馆、来源、备注或 alias 输入框。

### Live 新增与管理

- 保留 Venue 搜索；创建统一进入独立新增场馆页，取代原先在 Live 表单中快捷创建的方案，见 [新增场馆](../venue-create-form.md)。
- 初次进入不再把最多 100 条结果当作完整全集。
- 空查询返回常用 Venue；输入后走服务端搜索。
- 候选显示当前名称；历史名称命中时附带“曾用名命中”。
- 场馆未公布时直接选择“未公布”，两项 ID 都保存为 `NULL`。
- 选择 Venue 后加载名称版本，并按 Live 日期给出推荐。
- 新增场馆页调用统一创建 API，成功后刷新候选；不将自动返回 Live 表单并选中作为当前已实现行为。
- 新增前展示相似正式名称候选，降低重复创建风险，但不自动阻止确认为不同实体的场馆。

## 公共读取、搜索与统计

### 展示

- Live 列表和详情：显示 Live 绑定的名称版本。Live 详情中的场馆名称链接到稳定 `venue_id` 的公共 Venue 详情页；名称旁的独立地图按钮负责选择外部地图，两种交互不复用同一个点击区域。
- 改期历史：显示 `previous_venue_name_version_id` 对应名称。
- Venue 当前资料和 Catalog Venue 结果：显示当前开放名称。公共 Venue 详情展示当前名称、历史名称、类型、完整所在地、地图入口和关联 Live；不公开审计及修订控制字段。
- 巡演和活动组中的每场 Live：显示该 Live 的历史名称版本。

### 搜索

- Catalog Venue 搜索：当前名称或历史名称均返回同一个稳定 `venue_id`，统计覆盖该实体全部 Live。
- Live 自由文本搜索：名称条件匹配 Live 自己绑定的名称版本，搜索旧名不会误返回该 Venue 使用新名称时期的全部 Live。
- `venue_id` 筛选：继续返回该稳定 Venue 的全部名称时期。
- alias 和跨语言搜索留到后续 i18n 设计，不在本期模糊模拟。

### 统计

- Venue 去重继续按 `venue_id`，更名不增加 Venue 数量。
- 合并后统计使用目标 `venue_id`，来源行不再单独计数。
- 现有公开 `venue_count` 在首期保持返回字段和口径兼容。
- `venue_kind` 为后续拆分实体 Venue、Online 和未公开场馆统计提供依据，但本期不强制改变前端统计文案。

## 迁移与实现流程

Venue 改造由 V28 建立加法式结构，运行数据整理完成后由 V29 收口约束。

### 阶段 1：加法式 schema

新增第一份 migration：

1. 给 `venue_list` 增加 `venue_kind` 和 `merged_into_venue_id`。
2. 创建 `venue_name_versions`、索引和约束。
3. 给 `live_attrs` 和 `live_schedule_history` 增加名称版本列，暂时允许 `NULL`。
4. 给每个现有 Venue 创建一个保持原字符串不变的开放名称版本。
5. 将现有 Live 和改期历史绑定到对应初始版本。
6. 建立 `current_venue_versions`。
7. 配置 owner、角色权限和 ownership contract。
8. 保留 `venue_list.venue` 和所有旧读取路径。

迁移不解析括号、不推断旧名、不合并任何 Venue，也不写入特定生产数据判断。

### 阶段 2：后端双读双写

1. 扩展 Venue schema 和分页读取 API。
2. 增加详情、创建、更名、位置资料修正、合并预览和合并接口。
3. Live 新增/更新保存两个 Venue ID。
4. 正式改期创建时保存修改前的两个 Venue ID。
5. 新读取优先使用名称版本；版本为空时临时回退 `venue_list.venue`。
6. Venue 当前名称发生变化时同步兼容字段。
7. 为事务、校验、权限、审计和回退行为补齐单元及集成测试。

### 阶段 3：控制台 Venue 管理

1. 新增 `VenueAdminSection` 和 `venue` 控制台 mode。
2. 接入分页列表、详情和关联 Live。
3. 接入创建、更名和位置资料修正确认流程。
4. 接入管理员合并预览和提交。
5. 将 Live 页的 Venue 选择改成服务端搜索和名称版本选择。
6. 创建统一进入独立新增场馆页，复用同一 API 和校验。

### 阶段 4：公共读取切换

按顺序迁移：

1. Live 列表和详情。
2. 改期历史。
3. Catalog Venue 搜索和 `venue_id` 筛选。
4. 巡演和活动组。
5. 公共统计。

所有读取完成切换前，不删除旧字段或兼容回退。

### 阶段 5：人工数据整理

通过控制台 API 处理，不把运行数据写死进 Flyway：

- 将 `现名（旧 旧名）` 拆成有边界的正式名称版本。
- 校正历史 Live 和改期历史的版本绑定。
- 核对疑似重复项后执行显式合并。
- 将 `ONLINE`、`某所` 等既有特殊记录设为正确 `venue_kind`。

每次操作都写审计，且必须能够从 Venue 详情查看受影响 Live。

### 阶段 6：约束收口

V29 migration 在执行前断言：

- 每个未合并 Venue 恰有一个开放名称版本。
- 每个非空 `live_attrs.venue_id` 都有同 Venue 的名称版本。
- 每个非空 `previous_venue_id` 都有同 Venue 的名称版本。
- 没有 Venue 合并链或环。
- 没有名称有效期重叠。

断言通过后：

1. 增加两个 `MATCH FULL` 复合外键。
2. 移除旧客户端仅提交 `venue_id` 的兼容分支。
3. 移除读取时对 `venue_list.venue` 的回退。
4. 在再后续独立 migration 中删除 `venue_list.venue`；不得与首期结构创建放在同一 migration。

当前实现已完成第 1～3 项。第 4 项仍待独立 migration，确保部署 V29 后保留一个明确的观察窗口。

## 测试与验收

### 数据库

- V28 数据能完整回填，每个 Venue 有一个初始名称版本。
- `venue_id` 和名称版本必须同时为空或同时有效。
- 不能引用其他 Venue 的名称版本。
- 同一 Venue 不能存在两个开放名称版本。
- 更名会关闭旧版本并创建新版本。
- 名称版本有效期不能重叠。
- 已被引用的 Venue 和名称版本不能删除。
- 合并事务任一步失败时完整回滚。

### 后端

- Venue 列表支持分页、总数、类型筛选和历史名称查询。
- 一个 Venue 被多个名称命中时只返回一行。
- 创建 Venue 会原子创建初始名称版本并写审计。
- 正式更名写入追加版本的审计记录；名称原地修正接口不存在。
- Live 日期变化不会静默改变名称版本。
- 场馆未公布时允许两个 ID 同时为空。
- 普通 editor 不能执行 Venue 合并，admin 可以。

### 前端

- Venue 超过 100 条时仍能通过分页或搜索访问全部实体。
- `Venue管理` 能创建、查看只读名称历史和按递增生效日期追加正式更名。
- 历史名称命中有明确提示。
- Live 表单能选择“未公布”。
- 选择历史 Venue 名称后，确认框显示 `venue_id` 和最终展示名称。
- 合并前显示来源、目标、版本映射和受影响数量。

### 端到端业务场景

1. 同一 Venue 从旧名改为新名，旧 Live 仍显示旧名，新 Live 显示新名，统计只计一个 Venue。
2. 控制台及 API 不允许修正已有名称版本；旧名称错字仅通过 SQL 修正。
3. 录入历史 Live 时可以显式选择历史名称版本。
4. 场馆未公布的 Live 保持两个 Venue 字段为空，公布后一次更新为有效组合。
5. 重复 Venue 合并后，Live 和改期历史全部指向目标实体及正确名称版本。
6. 名称相似但实际不同的 Hall 不会被自动合并。

自动化测试文件新增或修改时，按项目约定在测试附近保留简短“测试点”注释。业务代码或数据库变更完成后，最终验证只运行：

```powershell
python scripts/run_checks.py functional
```

本地主库迁移必须另行获得明确授权，并遵循目标确认、备份、`flyway info -> migrate -> validate -> info`、ownership contract、健康检查和代表性只读数据核验流程。本文不授权任何远程 VM 或远程数据库操作。

## 低优先级后续

以下能力在出现明确的 i18n、地图核验或 Venue 层级需求时再单独设计：

- 多语言名称及 locale 回退。
- alias、简称、常见写法和罗马字搜索。
- 自动批量 POI 关联及 Apple／高德交互地图；Google 搜索／点选和人工平台 POI 关联已实现。
- 父场馆、园区与子 Hall 层级。
- 营业、停业和重建生命周期。
- 按国家、城市或园区聚合统计。

后续 i18n 设计应明确区分“同一历史阶段的多语言名称”和“不同时间阶段的正式更名”，不能把翻译文本直接追加为新的历史版本。
