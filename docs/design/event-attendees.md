# 活动出演成员实现设计

## 范围

本设计实现 [活动出演成员需求](../product/event-attendees.md)。字段只补充活动详情，不参与列表、筛选、Setlist 或统计。

## 数据结构

Flyway V15 为 `live_attrs` 增加：

```sql
event_attendees jsonb NOT NULL DEFAULT '{}'::jsonb
```

数据库只保存 `band_id -> 完整成员数组`：

```json
{
  "3": ["高松燈", "千早愛音"],
  "8": ["三角初華", "若葉睦", "八幡海鈴", "祐天寺にゃむ", "豊川祥子"]
}
```

不持久化 `mode`。全员仍保存完整名单；查询时将成员数与 `band_attrs.band_members` 当前完整名单比较，得到 `partial|full`。

## 写入契约

`POST /api/console/lives` 接受：

```json
"event_attendees": [
  {"band_id": 3, "members": ["高松燈", "千早愛音"]}
]
```

- 仅 `live_type=event` 允许非空值。
- `band_id` 必须同时存在于 `default_band_ids`。
- 同一 Band 不得重复；成员不能为空、重复或不属于该 Band 的 `band_members`。
- 后端按 Band ID 和 Band 成员目录顺序规范化后写入。
- 创建响应返回 `band_id/mode/members`，其中 `mode` 为计算值。

## 读取契约

单详情和批量详情均返回：

```json
"event_attendees": [
  {
    "band_id": 3,
    "band_name": "MyGO!!!!!",
    "mode": "partial",
    "members": ["高松燈", "千早愛音"]
  }
]
```

详情的有效乐队规则与列表统一：存在 Setlist 时来自 `live_setlist.band_member`；完全没有 Setlist 时回退 `default_band_ids`。`event_attendees` 只在活动类型返回内容，其他类型固定为空数组。

## 前端

- 控制台在默认 Band 浮层内复用 Setlist 的成员二级复选结构。
- 切换掉默认 Band 时同步清除该 Band 的出演成员；切换到非活动类型时清空全部出演成员。
- 详情复用 `.detail-row` 和现有 Band SVG 资源。
- `partial` 展开全部成员；`full` 只渲染“全员”。
- 图标带 Band 名称的 `alt/title`，成员项允许换行但单个“图标 + 姓名”不拆开。

## 验证

- 后端单元测试覆盖写入校验、完整名单持久化、mode 计算和详情映射。
- PostgreSQL 集成测试覆盖无 Setlist 活动的默认 Band 回退，以及单条/批量详情一致性。
- 前端测试覆盖活动成员选择、部分/全员内联展示和非活动抑制。
- 最终运行 `python scripts/run_checks.py functional`。
