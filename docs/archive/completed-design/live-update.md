# Live 更新实现设计（已完成）

## 范围

状态：已完成并归档。当前接口字段与行为以代码、OpenAPI 和 [API 补充说明](../../api.md) 为准。

本设计实现 [Live 更新需求](../completed-product/live-update.md)。复用现有 Live 新增表单、Venue 选择、默认 Band 和活动出演成员控件，不提供 Setlist 或关联关系编辑。

## 接口

- `GET /api/console/lives?q=&live_type=&page=1&page_size=20`：按关键词和可选精确类型筛选，并以 `live_date DESC, live_id DESC` 返回全部 Live 的编辑候选。
- `GET /api/console/lives/{live_id}`：返回完整可编辑资料、Venue 名称和计算后的出演成员 mode。
- `PUT /api/console/lives/{live_id}`：以完整请求体替换目标 Live 的可编辑基础资料。

新增和更新共用 `ConsoleLiveUpsertRequest`。请求不接受出演成员 `mode`；数据库继续只保存 `band_id -> 完整成员数组`。

## 服务端事务

1. 使用写连接对目标 `live_attrs` 行执行 `SELECT ... FOR UPDATE`。
2. 校验 Venue、默认 Band 和活动成员，并按 Band 成员目录顺序规范化。
3. 在一条 `UPDATE` 中同时写入类型、默认 Band 和出演成员，满足 V15 的事件专用约束。
4. 比较更新前后字段，只在发生变化时写入 `live_update` 审计日志。
5. 返回规范化后的完整 Live 数据，出演成员 mode 由完整名单与当前目录计算。

更新不修改 `live_setlist`、`tour_lives`、`performance_group_lives` 或 `user_live_favorites`。

## 前端状态

- `ConsoleMode` 使用独立的 `live_create` 与 `live_edit` 分支，分别显示“新增Live”和“Live管理”。
- 两个分支复用 `LiveAdminSection` 的字段渲染，通过 `variant=create|edit` 隔离候选工具栏、按钮语义、清空选项和新增/更新记录。
- `originalDraft` 保存最近一次服务端快照，`draft` 保存当前表单值；二者规范化比较得到 dirty 状态。
- 编辑工具栏复用巡演管理结构；三个管理区的新建入口统一使用强调按钮，选择器和同类查询控件统一使用 Venue/Band 的 `13px` 字体、间距与高度基准。
- 类型筛选通过后端 `live_type` 参数重新查询并从第一页展示，不在前端对当前页做局部过滤。
- 新建时主按钮为“提交插入”，编辑时为“保存修改”；编辑确认框只展示差异。
- 更新成功后清理 Live 列表与详情缓存，刷新候选，并把响应设为新的原始快照。
- 已保存结果由顶部成功信息表达；表单下方只在 dirty 时显示未保存修改警告。
- `clearLiveAfterCreate` 只控制新增成功后的草稿处理：开启时调用完整 Live 草稿重置（包括 Venue 查询、选择及弹层），关闭时仅关闭弹层并保留字段；更新既有 Live 不受该选项影响。

## 错误行为

- Live、Venue 或 Band 不存在：`404`。
- 活动成员不属于对应 Band：`400`。
- 请求结构或跨字段规则非法：`422`。
- 未登录、角色不足或 CSRF 无效：`401/403`。
- 查询或连接超时：`504`；其他数据库错误：`500`。

## 验证

- 后端单元测试覆盖读取、成功更新、无变化、关联资源校验和审计。
- PostgreSQL 集成测试覆盖真实持久化、活动转非活动和关系不变。
- 前端测试覆盖候选加载、表单回填、差异确认、恢复原值、脏草稿保护和缓存清理。
- 最终运行 `python scripts/run_checks.py functional`。
