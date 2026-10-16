# Console 编辑与确认

新增控制台编辑页时复用以下组件和 hook，保留对应业务的 API 校验与并发令牌。

- `ConsoleConfirmDialog`：提供标题、关闭按钮、取消／确认操作、遮罩与 Escape 关闭、焦点限制与恢复、提交锁定和失败展示。更新时传 `changes`、`changesLabel`，仅显示变化项目并自动禁止空变更提交；标题应包含对象类型和 ID。新增使用“确认提交”，更新使用“确认更新”，只修改本地草稿使用“确认应用”。阵容追加、取消关联保留相应操作名称。
- `ConsoleEditorLock`：用 `locked={loading || submitting || confirming}` 包住编辑内容，阻止在加载旧对象、确认或提交期间改动。确认框通过 portal 显示，不受后台表单的锁定影响。
- `useConsoleDraftGuard`：传入当前 `dirty`、`busy`、对象 `label` 和 `onDiscard`；渲染返回的 `dialog`，对象切换、清空或其他丢弃操作经过返回的 `guard`。组件隐藏时传 `active={false}`。
- `ConsoleDraftProvider`：控制台根节点已有 provider。控制台模式切换通过 `useConsoleLeaveGuard`，离开控制台由 `onLeaveGuard` 接入应用导航；刷新／关闭页面通过 `beforeunload` 保护。
- `CompactConfirmationTable`：只用于新增摘要或必要的业务后果说明。更新原／新值由 `changes` 展示，不另列未变化字段。
- `refreshConsoleAfterSave`：写入已成功后刷新候选，并区分写入成功与刷新失败；传入的刷新函数应把读取失败抛出，避免吞掉异常后误报刷新成功。

保存失败保留确认框和草稿，成功后更新原值基准及并发令牌。写入成功与候选刷新分开处理，刷新失败不能提示重新保存。确认明细按可独立编辑的字段逐项列出，嵌套对象及列表中的对象也逐字段展开，不把模式与归属、名称与 URL、曲目属性或阵容属性合并成摘要。新增／删除整条关联时同样列出各项资料；单个字段的多选值可保留为一个列表。

行为测试覆盖取消不写入、失败重试、空变更禁用、对象／页面切换保护和连续保存基准。宽窄屏、长内容滚动和主题样式在真实浏览器验证。
