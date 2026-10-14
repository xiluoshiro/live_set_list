# 歌曲归属一致性与 song_list.band_id 退役排查

排查日期：2026-10-13。代码基线：`8c43c16`，包含本轮归属读取修正。
范围：本机 `localhost:15432/live_statistic`，仓库应用、前端、测试、seed、Flyway、手工回填、scripts 和 recovery；未访问远端。

## 结论

`song_list.band_id` 是旧单乐队归属提示。以下保留 2026-10-13 排查事实；2026-10-14 已完成应用退役改造并新增 V46，实施结果见文末。
正式版本归属由 `owner_mode`、`song_bands`、`song_member_groups`、`song_members` 表达。
歌曲组保存歌曲身份；专辑曲目关联具体版本；演出成员保存实际出演事实。
这几种关系不能相互覆盖，尤其不能由歌单出演乐队直接推导翻唱歌曲的固定归属。

原设计已经将旧列定义为“历史兼容证据；最终删除”：
[歌曲与专辑设计](song-catalog-and-albums.md)。尚未审核的历史归属允许 pending，
[产品规则](../product/song-details-and-albums.md)没有要求把全部旧值机械回填。

## 截图为何矛盾

`Part of the Life`（song_id=809）保存了 `band_id=2`（本地主库为 Afterglow），
但 `owner_mode` 为 NULL，且没有正式归属关系。

- 候选查询此前用旧 `band_id` 回退显示 Afterglow。
- 歌曲管理、版本表和歌曲详情使用正式归属，显示待回填。
- 上轮只更正了 #808，没有恢复同一批的 #809–#812，也没有统一相关读取。

本轮将候选、分组候选、公开搜索、专辑曲目的归属文字统一为正式关系；
乐队筛选也使用正式关系。旧 `band_id=0` 的 Other bands 筛选保留为明确的兼容分支。
编辑器选择框使用已加载或已保存的版本归属，避免旧候选缓存覆盖详情回显。

## 新增歌单中的批量插入链路

| 步骤 | 当前行为 | 依据 |
| --- | --- | --- |
| 文本解析 | 标题转为草稿；乐队标记解析为实际出演 `band_member`，没有固定歌曲归属 | `setlistParser/mapParsedSetlist.ts`、`ConsoleInsertPanel.tsx:buildSetlistPastePreview` |
| 查询已有歌曲 | `/api/console/songs?groups_only=true`，优先精确标题、其次前缀；唯一候选填 `song_group_id`，多候选待选 | `querySongsForSetlist` |
| 批量候选 | 跳过已有组 ID 或多候选行；要求恰好一支实际出演乐队；将其 ID 作为新增歌曲 `band_id` | `requestBatchSongInsert` |
| 确认 | 默认 `cover=false`；可勾选 cover，但 `updateBatchSongCover` 不改变 band_id，也不能确认成员／混合归属 | 批量确认表、`updateBatchSongCover` |
| 请求 | `{songs:[{song_name,band_id,cover}]}` → `POST /api/console/songs:batch` | `executeBatchSongInsert`、`api.ts:createConsoleSongsBatch` |
| 后端 | 逐项 SAVEPOINT，查乐队、按歌名＋旧 band_id 去重、建组和默认版本、审计；上轮补入了正式归属写入 | `console_write.py:create_songs_batch`、`_save_console_song_band` |
| 回填歌单 | 合并新增结果，再查询分组候选，给草稿填组 ID；批量插入本身不保存歌单 | `executeBatchSongInsert`、`querySongsForSetlist` |
| 保存歌单 | 歌单关联组 ID；实际出演仍写入演出关系；专辑另关联具体 song_id | `console_write.py` 歌单写入、`album_tracks` |

审计记录确认 #809–#812 在同一时刻由此旧入口创建，payload 均为
`{band_id:2,cover:false}`。当时的批量写入没有建立正式归属。
它们随后被收录到 OVERGLOW；新增专辑不会追溯补写歌曲归属。

### 批量入口仍需改造的部分

1. **出演和归属混用**：演出某曲的乐队不一定拥有该版本；cover 选项不提供归属确认。
2. **表达能力不足**：一支乐队的标量 band_id 无法表达多乐队、固定成员或 mixed。
3. **去重依赖旧列**：现代归属写入会清空 band_id，旧去重可能漏掉已存在的同名同属版本。
   `NOT EXISTS` 也不是并发唯一性保证；替代规则应先明确歌曲组与版本的身份。
4. **旧编辑入口受限**：`loadSongForEditing`／`beginEditSong` 遇到 band_id=NULL 就返回；
   单值编辑接口也不能编辑多乐队或成员归属。
5. **缓存通知不一致**：`createConsoleSong`、`updateConsoleSong`、`createConsoleSongsBatch`
   没有调用现代 `songCatalogWrite` 的目录失效与跨页面通知；当前批量流程只主动重查本地歌单候选。
   这是代码路径差异，本轮未把它当作已验证的浏览器故障。

建议保留批量插入这个动作，但确认时提交每个新版本的完整 `ownership`。
普通单乐队情况可以提供待确认的初值；翻唱、多乐队或部分成员应显式选择归属或保持 pending。
不从歌单反写既有歌曲的归属，不用专辑归属批量覆盖收录版本。

## song_list.band_id 的直接依赖

| 文件／链路 | 依赖 | 删列前替换 |
| --- | --- | --- |
| `routers/console_write.py` 单曲、批量新增 | INSERT band_id；去重读取 s.band_id；旧更新写 band_id 并用它识别旧记录 | 改成版本写入和完整 ownership；建立独立去重／消歧规则 |
| `schemas/console.py`、`frontend/api.ts` | 旧请求必填单值；旧响应携带可空 band_id | 新增／批量协议采用 ownership；兼容参数只在边界转换，不写旧列 |
| `ConsoleInsertPanel.tsx`、`console/SongAdminSection.tsx`、`console/types.ts` | 批量推导、确认、单曲选择／编辑、创建结果、本地状态依赖单值 | 共用版本归属编辑器；明确组 ID 和版本 ID；用 ownership 回显 |
| `routers/console_read.py` | SQL SELECT 和兼容返回仍含 s.band_id；0 / Other bands 的兼容筛选；旧字段决定部分可选元数据输出 | 去掉旧字段和兼容筛选；明确返回 group_id、version_label、ownership |
| `routers/catalog.py` | 搜索仍返回旧 band_id，但本轮 band_name 改用正式归属 | 删除兼容响应字段并同步 schema 和前端消费者 |
| `song_catalog.py:save_ownership` | 设置正式归属时清空旧 band_id | 移除清空语句；继续保存正式关系 |
| `routers/console_song_catalog.py:correct_ownership` | 读取旧 band_id 写入纠正审计 | 在退役前归档提示；后续审计记录正式 before／after |
| `routers/lives.py` 单条／批量详情 | SELECT 旧 band_id、owner_band；`_build_detail_tags` 仍按旧单乐队构造翻唱注释／cover_band | 注释和原因与正式 `LIVE_COVER_SQL` 对齐；多归属不能压成单个 cover_band |
| `schemas/lives.py`、`DetailMemberTable.tsx` | cover_band 结构只表达一个原属乐队 | 若继续展示原属，应支持完整归属；现场出演信息保留独立结构 |
| `backend/db/postgres/seed/base_seed.sql` | 显式插入旧列，种子归属默认 pending | 用明确的 pending／bands／members／mixed fixture，不再依赖旧列 |
| 单元／集成／前端测试 | 旧 API mock、直接 SQL fixture、旧列断言、翻唱注释兼容样例 | 迁移仍支持的行为用例；删除只服务旧字段的 fixture／断言 |
| `backfill/song-catalog-2026-09-26/` | 历史包 INSERT 包含 band_id，保存审核提示 | 保留执行历史；标明旧 schema 前提；未来回填生成物不再输出旧列 |
| `backend/db/flyway/sql/` B1、V10、V37、V40 | 历史建表／唯一约束／可空化／约束移除 | 不修改已执行迁移；新增最终删除迁移 |
| `docs/api.md`、README、产品／设计与归档文档 | 旧请求示例、归属模型、实际出演说明；不执行数据库操作 | 同步当前协议说明；历史文档保留时间和适用版本，区分歌曲归属与出演字段 |

本轮 `AlbumAdminSection` 的候选、收录曲目和确认文字不直接读取旧列；
此前受后端 `band_name` 回退影响。本轮已统一这条投影。
`SongCatalogAdmin`、`SongGroupEditor`、`SongDetailPage` 本身使用正式归属；
矛盾来自旧候选投影和已加载候选缓存。

## 同名字段必须保留的链路

以下 `band_id` 表达稳定的乐队身份，并非待删除的歌曲旧列。

| 领域 | 仓库链路 | 意义 |
| --- | --- | --- |
| 乐队及历史 | `band_history_write.py`、`console_bands.py`、band_history schema、`BandAdminSection` | 名称版本、阵容版本的乐队身份 |
| 正式歌曲／专辑归属 | `song_catalog.py`、`song_catalog_directory.py`、`songs.py`、song_catalog schema、`OwnershipFields`、`SongCatalogOverview` | song_bands、成员分组、album_bands 的外键；必须保留 |
| 实际出演 | `console_write.py` 的歌单、`lives.py` 演出关系、console schema、`LiveInsertTab`、parser、`StageLedgerContent` | 实际演出乐队、阵容和成员上下文；不能删除或替换为歌曲归属 |
| 演出／收藏筛选 | `live_list_filters.py`、`me.py`、`LiveListFilters`、`App.tsx` | 由实际出演或无歌单时的默认乐队筛选 |
| 巡演／活动组 | `tours.py`、`performance_groups.py`、对应 console routers 和 schemas、Tour／PerformanceGroup 页面 | 聚合对象的乐队、实际出演和筛选 |
| 场馆关联演出 | `venues.py`、`VenueDetailPage` | 场馆下演出的实际乐队集合 |
| 统计、图标、展示 | `catalog.py` 统计分支、catalog schema、`StatisticsPanel`、`CatalogPanels`、`LiveCardBands`、`DetailMemberTable` | 实际乐队排名、路由参数、颜色和图标；不是歌曲标量归属 |
| API 和公共类型 | `api.ts`、各 schemas、`console/constants.ts`／types | 必须按字段所属对象迁移，不能全仓替换或删除所有 band_id |

`scripts/`、`recovery/` 运行代码未发现直接读取／写入 song_list.band_id 的专用逻辑；
备份恢复整体 schema 和数据，未来删列仍需验证旧备份恢复后迁移到新 schema 的流程。
完整文本引用清单保存在本轮临时排查产物 `.tmp/song-band-id-reference-inventory.txt`，
运行文件、测试、seed、历史迁移和手工回填分别分类，不把全部同名标识符当成旧列。

## 本地主库事实

修复前：799 个版本，776 行旧 band_id 非空，68 个正式归属 pending；
其中 64 个有正数旧提示，4 个为 Other bands。pending 中 57 个为旧翻唱、11 个为非翻唱。
35 个版本使用 members／mixed，已经说明单值旧列不足以表示正式归属。

`pg_depend` 的列级查询只发现 `fk_band_id`；未发现依赖该列的 view／rule。
没有包含 band_id 的 song_list 索引；V40 已移除旧 `(song_name,band_id)` 唯一约束。
所以数据库 DDL 依赖较少，但应用 SQL 和协议依赖仍多；静态依赖查询也不能证明动态 SQL 不依赖该列。

历史正数提示不能自动等同固定归属：旧翻唱的提示可能是当时的演出乐队。
本轮仅恢复归属体系建立后、有明确新增审计且未标翻唱的遗漏（#807、#809–#812）；
其余未审核资料保持 pending，不以隐藏状态或临时回退值冒充正式归属。

## 建议退役顺序

1. 先统一所有读取、候选、过滤和编辑回显；恢复有确证的写入遗漏。
2. 改造歌单单曲／批量新增和旧编辑：完整 ownership，明确版本选择和独立重复处理；
   将缓存失效与通知统一到现代目录写入链路。
3. 消除 Live 单条／批量详情对旧列的读取及单乐队翻唱原因推断。
4. 归档仍有价值的历史提示，确认 pending 清单；不强行回填不确定歌曲。
5. 迁移 API、seed、测试和未来 backfill；保持历史 Flyway 文件原样。
6. 当应用运行 SQL 对该列零依赖后，新增 Flyway 迁移显式 DROP COLUMN（不使用 CASCADE），
   先在测试库验证，再按本地主库备份／迁移流程执行；同时验证恢复路径。

排查阶段尚未删除列；后续按该顺序完成改造，见文末。

## 2026-10-13 读取修复与数据核验

- `python scripts/run_checks.py functional` 成功退出：脚本、后端类型／单元／串行集成、
  前端类型／49 个文件 506 个用例、recovery-unit 全部通过。
- 新增真实数据库 API 用例覆盖 pending、bands、members、mixed；同时验证候选、
  分组候选、详情、搜索、专辑曲目和乐队筛选，不靠预排 mock 证明 SQL 语义。
- 编辑保存后的候选回显有行为断言，使用已保存资料而非旧候选缓存。
- 本地主库先执行 `backup-app-manual`，dump 列表及最小恢复 SQL 校验成功。
  备份：`C:\Users\xiluo\OneDrive - stu.jiangnan.edu.cn\Backup\live-set-list-docker\app\manual\live_statistic_manual_20261013_222424.dump`。
- 正常 Console API 恢复 #807、#809–#812 的正式归属，保留原 band_id、标题、翻唱字段、
  歌曲组、专辑和收录关系；每条 revision 增加 1，并追加修改审计。
  与目标无关的 7 张目录表／关系集合内容指纹保持一致。
- 修复后仍为 799 个版本，pending 从 68 减为 63；其余未审核提示保留。
  本轮无 schema 变更，本地主库仍为 V45，`/api/health/db` 正常。
- 真实浏览器中 #809 的上方候选与下方版本归属均显示 Afterglow。
  OVERGLOW 的五条曲目通过真实接口回读均显示 Afterglow。

## 2026-10-14 完成退役

应用运行 SQL、前端协议与公共响应已移除歌曲旧列依赖。本地主库和测试库均由 V45
迁移到 V46，`song_list.band_id` 已删除；关系表中的 `band_id` 仍作为乐队、成员上下文、
实际出演、巡演关系和筛选的必要外键保留。历史 Flyway 文件保持原样。

| 链路 | 完成后的行为 |
| --- | --- |
| 单曲新增 | 新组与已有组新版本使用完整 ownership；组和版本由同一事务创建，保留主键与修订控制 |
| 歌单批量新增 | 展示实际出演乐队，逐首独立选择 pending／bands／members／mixed，不从出演事实直接推断固定归属 |
| 批量结果 | 每项返回 index、完整版本、created 或 error；已存在的相同默认版本复用 ID，不重复审计；错误项回滚并保留前端归属草稿 |
| 去重与并发 | 使用规范化歌名＋归属集合；展示排序不改变归属身份；单曲与批量共享标题事务锁，批次按固定顺序加锁 |
| 歌单回填 | 按返回下标回填准确歌曲组，不再次用模糊查询覆盖选择；多候选继续人工消歧 |
| 歌单内编辑 | 复用 SongCatalogAdmin 和 OwnershipFields，支持多乐队、成员、混合归属与修订控制，保护未保存编辑 |
| 专辑 | 独立保存专辑完整归属；收录具体歌曲版本，曲目归属来自版本关系，不反向覆盖歌曲 |
| 读取与展示 | 候选、歌曲管理、公开搜索、专辑曲目都读取正式归属；pending 不用旧值回退 |
| Live | 单条、批量和歌曲演出历史共用 LIVE_COVER_SQL；comments 的翻唱标记来自 live_cover，详情 ownership 保留全部归属 |
| 写后刷新 | 批量与单曲共用 songCatalogWrite，刷新 Live／歌曲缓存并发布当前窗口和跨窗口写事件 |
| 多选弹层 | 复用 ConsoleMultiSelect；其 portal 浮层高于确认弹窗，窄屏表格沿用横向滚动，选项与提交均可实际操作 |

### 本地主库与恢复核验

- 备份：`C:\Users\xiluo\OneDrive - stu.jiangnan.edu.cn\Backup\live-set-list-docker\app\manual\live_statistic_manual_20261014_045937.dump`。
  dump 列表、恢复 SQL 预览及实际隔离恢复均通过。
- V46 将 776 条非空旧提示逐条写入 `audit_logs`，action 为 `song_legacy_band_archived`，
  包含歌曲、版本、原乐队 ID／名称、原翻唱值与 owner_mode，然后执行非 CASCADE 的 DROP COLUMN。
- `info → migrate → validate → info` 通过，最终 V46；ownership 契约通过。
  排除被删除列后，32 张业务表的行数与全部内容保持一致，已有审计保持一致。
- 正式归属仍为：bands 701、members 18、mixed 17、pending 63，共 799 个版本。
  未审核资料保持待回填，旧提示可以从审计记录核对。
- 新服务实际回读 #808–#812、OVERGLOW 曲目均为 Afterglow；健康接口正常；
  主库 Live 单条／批量详情一致，翻唱注释与 live_cover 一致。

### 独立回填与页面验证

`backfill/` 按仓库规则受 Git 忽略，不进入 Flyway 或自动发布。
已执行的历史 SQL 与原执行 SHA-256 完全一致，未改写原交付文件或验证证据。
本地生成器现在要求新的输出路径，生成 V46+ SQL，移除旧歌曲 band_id 的写入与旧值比较；
仍保存审核过的正式归属、ID、版本、历史事实与非目标数据检查。

在从本次备份恢复的隔离库中，已实际验证 V46 归档、V46 回填提交、重复执行不变、
独立修改冲突时整批回滚、非目标数据不变。首次执行仅对新出现且已审核上下文匹配的
历史出演成员补录 member_id，没有覆盖已确认人物。

真实浏览器使用独立测试库，完成多乐队／混合归属批量新增、准确组回填、歌曲管理、
歌单内新增、专辑归属保存及 1440px／390px 页面操作；没有 page error。
并发请求单曲和批量新增相同身份，只生成一个默认版本。
验收后停止专用测试服务，保留新版无 reload 的主库服务。

最终 `python scripts/run_checks.py functional` 成功退出：scripts、后端类型／单元／
串行集成、前端类型／49 个文件 505 项行为用例，以及 recovery-unit 均通过。
最终日志：`.tmp/song-band-retirement-functional-verified.log`；隔离测试库已还原基础 seed。
