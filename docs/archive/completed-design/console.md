# 控制台交互与录入规则

控制台通过候选查询、完整详情、编辑草稿和确认保存维护资料。写接口使用 editor 及以上权限、session、CSRF 和事务审计，接口字段见[API 规则](../../api.md)。

## 0. 查询与编辑

- 候选查询和详情读取分别使用对应 API，候选摘要不能作为完整编辑快照保存。
- 管理选择器复用 `ConsoleEditSelect`；查询选中首个匹配项，分页和保存刷新保留当前对象及标签。
- 切换对象通过未保存草稿保护；查询期间锁定旧编辑对象，空结果不请求不存在的详情。
- 歌曲选择明确歌曲组、具体版本及正式归属；专辑收录具体歌曲版本。

## 1. 目标

控制台的目标不是单纯“把一个前端页面做出来”，而是形成完整的后台录入链路：

1. `editor+` 用户可进入控制台并执行业务录入。
2. 控制台提交的数据进入真实后端接口，而不是只停留在前端内存态。
3. 后端对写操作执行角色校验、参数校验、CSRF 校验和审计日志记录。
4. 前后端权限模型与数据库运行时账号分工保持一致。

## 2. 维护范围

演出、歌单、歌曲版本、专辑、巡演、活动组、乐队历史、场馆及地区各自维护对应实体。新增和管理保留独立草稿，共用字段、确认表和状态样式。

歌曲单曲新增、批量新增和歌单内嵌维护使用相同归属协议。批量结果逐项对应原草稿；错误项保留待修正数据，已保存项采用服务端返回的 ID 和 revision。

## 4. 推荐的权限边界

为了避免后续接口一上来就把所有写能力都堆给 `admin`，建议继续沿用现有角色分层：

- `viewer`
  - 可浏览
  - 可使用收藏
  - 不可访问控制台写接口
- `editor`
  - 可进入控制台
  - 可新增歌曲
  - 可新增 Live
  - 可向指定 live 追加 setlist 行
  - 不可执行用户管理
- `admin`
  - 拥有 `editor` 的全部能力
  - 可执行用户管理
  - 可处理后续更敏感的后台维护能力

这与当前前端“控制台对 `editor+` 开放”的实现保持一致，也和文档里对 `admin` 后续扩展的定位一致。

## 5. 接口边界

读接口与写接口的字段、分页、错误码和事务行为以当前 OpenAPI 及[API 补充规则](../../api.md)为准。

- 创建使用服务端返回的实体 ID，不使用 mock ID 或人工推测序列。
- 更新提交已读取的 revision 或状态令牌；冲突保留草稿，不覆盖新资料。
- 歌单引用歌曲组，专辑曲目引用具体歌曲版本；实际出演不反写歌曲归属。
- 资料保存成功后刷新关联候选、详情和缓存；失败不产生部分写入。

## 6. 批量文本解析

### 6.4 新增 Setlist 批量粘贴解析设计

目标：

- 支持用户把活动官网/公告中的 setlist 文本一次性粘贴到控制台。
- 前端解析后自动拆解到“新增Setlist”的现有表格字段。
- 解析只更新前端草稿，不直接写库；最终仍由用户点击“提交插入”触发真实写接口。
- 解析层优先使用成熟 parser SDK 或 parser generator，不手写大段字符串解析逻辑。

技术选型建议：

- 首选方案：前端使用 `Peggy` 这类 JavaScript parser generator，把 setlist 文本格式定义为 grammar，并在构建阶段生成可被 React 组件直接 import 的 parser。
- 备选方案：如果希望解析逻辑集中在后端，可使用 Python 的 `Lark`，新增只读解析接口，例如 `POST /api/console/setlist/parse-preview`，由后端返回草稿和 warning。
- 暂不推荐方案：在 React 组件里直接手写多段正则、逐行状态机和特殊分支。这样短期快，但后续支持更多官网格式时会很脆。

推荐选择：

- 第一版建议放在前端，用 `Peggy` 生成 parser。
- 原因是批量粘贴解析只生成前端草稿，不写库，也不需要服务端事务；前端解析可以即时预览，失败定位也更贴近用户输入。
- parser 只负责把文本解析成结构化 AST；band 匹配、`from` 归属、`band_id=0` 排除等业务语义仍放在一层独立 mapper 中处理。
- 如果后续多个客户端都需要同一套解析能力，再迁移为 Python `Lark` 后端接口。

入口设计：

- 在“新增Setlist”区域增加“批量粘贴 Setlist”折叠面板。
- 面板内包含多行文本框、`解析预览`、`应用到表格`、`清空`。
- `解析预览` 只生成草稿和 warning，不覆盖当前表格。
- `应用到表格` 才替换当前 `setlistRows`。
- 应用后不自动提交，也不自动新增歌曲；用户继续使用现有“查询歌曲”按钮解析 `song_id`。

输入格式：

```text
＜Roselia×戸山香澄 from Poppin'Party＞

M1. BLACK SHOUT

<Roselia>

M2. Requiem for Fate

EN1. BRAVE JEWEL
```

解析规则：

- 空行忽略。
- 支持半角尖括号 `<...>` 与全角尖括号 `＜...＞`。
- 尖括号行表示“演出者上下文”，作用于后续歌曲行，直到遇到下一条尖括号行。
- 歌曲行格式为 `M1. song_name` / `EN1. song_name` / `RH1. song_name`。
- 歌曲行、演出者行、空行和未知行由 parser grammar 识别，不在 React 组件中手写逐行正则。
- `song_name` 取序号点号后的文本，保留原始大小写和符号。
- `song_id` 初始为空，继续由 `GET /api/console/songs` 的“查询歌曲”流程填充。

建议 grammar 产物：

- `performer_context`：尖括号中的原始演出者文本，以及输入行号。
- `song_entry`：`segment_type`、`segment_order`、`song_name`、输入行号。
- `unknown_line`：无法识别但非空的原始文本和行号。
- `blank_line`：通常不进入最终 AST，除非后续需要做更精细的错误提示。

建议前端文件边界：

- `frontend/src/components/console/setlistParser/setlist.peggy`：语法定义。
- `frontend/src/components/console/setlistParser/generatedParser.ts`：由 `Peggy` 生成，不手改。
- `frontend/src/components/console/setlistParser/mapParsedSetlist.ts`：把 AST 映射到 `SetlistDraftRow`。
- `frontend/src/components/console/setlistParser/types.ts`：AST、warning 和 preview 类型。

依赖与构建：

- 新增 `peggy` 作为前端开发依赖。
- 新增生成脚本，例如 `npm run generate:setlist-parser`。
- `npm run build` 或 `run_checks.py frontend` 前应确保生成文件是最新的。
- 如果团队不希望提交生成文件，也可以在前端构建前自动生成；但为了减少本地环境差异，第一版更建议提交生成后的 parser 文件。

字段映射：

- `song_name`：歌曲行中的曲名。
- `song_id`：解析阶段置空。
- `segment_start_type`：每个段落的第一首填 `M / OP / EN / WEN / RH`，同段后续歌曲填空。
- `is_short`：第一版默认 `false`，后续可再识别 `short / 短版 / TV size`。
- `band_member`：来自当前尖括号上下文中可匹配到有效 band 的 token。
- `other_member`：来自无法归属到有效 band 的 token。

演出者 token 拆解：

- 尖括号内容先按 `×` 拆分。
- 每个 token trim 后单独判断。
- 先用当前已加载的 `GET /api/console/bands` 候选做 band 匹配。
- band 匹配字段优先级：`band_name` 精确匹配、`band_abbr` 精确匹配；后续如需要再加别名表。
- 匹配到的 band 必须满足 `band_id > 0`，`band_id = 0` 视为无效占位，不可写入 `band_member`。

`from` token 归属规则：

- 对 `戸山香澄 from Poppin'Party` 这类 token，不应直接落入 `other_member`。
- 先解析为 `member_name = 戸山香澄`、`source_band = Poppin'Party`。
- 再用 `source_band` 去当前 band 候选中查找有效 band，且要求 `band_id > 0`。
- 如果找到有效 band：
  - 如果该 band 的 `band_members` 包含 `戸山香澄`，则写入 `band_member[source_band] = ["戸山香澄"]`。
  - 如果该 band 的 `band_members` 不包含 `戸山香澄`，仍优先归入该 band，但给 warning：`成员不在 band_members 中，请人工确认`。
  - 如果当前行同一个 band 已经因为 `Poppin'Party` token 被整团选中，则保留整团成员，不再缩窄为单人。
- 如果找不到有效 band，或匹配到的 band `id = 0`：
  - 才落入 `other_member`，建议为 `{ member_key: source_band, member_value: member_name }`。

示例映射：

```text
＜Roselia×戸山香澄 from Poppin'Party＞
M1. BLACK SHOUT
```

在已加载 band 中存在有效 `Roselia` 与 `Poppin'Party` 时：

```json
{
  "song_name": "BLACK SHOUT",
  "segment_start_type": "M",
  "band_member": {
    "Roselia": ["Roselia 的全部成员"],
    "Poppin'Party": ["戸山香澄"]
  },
  "other_member": []
}
```

如果 `Poppin'Party` 不存在或只有 `band_id = 0`：

```json
{
  "song_name": "BLACK SHOUT",
  "segment_start_type": "M",
  "band_member": {
    "Roselia": ["Roselia 的全部成员"]
  },
  "other_member": [
    {
      "member_key": "Poppin'Party",
      "member_value": "戸山香澄"
    }
  ]
}
```

warning 设计：

- 未识别行：展示原始行号和文本。
- 歌曲行没有演出者上下文：提示该行 `band_member` 为空。
- 演出者 token 无法匹配有效 band：提示将落入 `other_member`。
- `from` token 的成员不在 `band_members` 中：提示人工确认。
- 曲序跳号或重复：只提示，不阻断解析。
- 段落编号不从 1 开始：只提示，不阻断解析。

推荐实现顺序：

1. 引入 `Peggy`，先用 grammar 生成 parser，避免手写解析器。
2. 新增 `mapParsedSetlist(ast, bands): ParseSetlistResult`，只负责业务映射，不负责文本语法解析。
3. 给 parser 和 mapper 分别补单元测试，重点覆盖全角尖括号、`M/OP/EN/WEN/RH`、`×`、`from`、`band_id=0`、未知 band、曲序跳号。
4. 在 `LiveInsertTab` 增加批量粘贴面板和预览结果。
5. `应用到表格` 时替换 `setlistRows`，并重置 `didSongLookup=false`。
6. 复用现有“查询歌曲”按钮填充 `song_id`。

后端化备选设计：

- 如果选择 Python `Lark`，可新增 `POST /api/console/setlist/parse-preview`。
- 该接口应使用 `editor+` 权限，但不需要 CSRF，因为它是只读预览，不写库。
- 请求包含 `raw_text`，可选包含前端已加载的 band 候选版本；后端也可以直接复用 `GET /api/console/bands` 的查询逻辑加载 band。
- 响应返回 `rows`、`warnings` 和 `unrecognized_lines`。
- 即使走后端解析，最终插入仍必须由 `POST /api/console/lives/{live_id}/setlist` 完成，避免“解析预览”产生任何数据污染。

参考：

- `Peggy`：JavaScript parser generator，适合在前端构建阶段生成浏览器可用 parser。
- `Lark`：Python parsing library，适合未来把解析预览收敛到后端服务。
