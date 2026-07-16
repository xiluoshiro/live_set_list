# LiveSetList

一个前后端分离的 Live 资料库工程。当前定位是站方维护的演唱会 / Live setlist 数据库：匿名用户可公开查询和浏览，登录用户可收藏，`editor+` 用户可通过控制台维护数据；普通用户暂不直接编辑资料，只通过轻量联系 / 反馈入口报告问题。

## 生产状态

生产站点已部署到 Google Compute Engine。常规应用发布使用 GitHub Actions 的 `vYYYY-MM-DD-NNN` tag：隔离数据库 CI、白名单出包、`production` 人工审批、SSH 部署和公网 smoke test 已验证。

- 实际部署、GitHub Environment 配置、验收、排障与回滚：[docs/production-deployment-runbook.md](D:/Code/PythonCode/5%20LiveSetList/docs/production-deployment-runbook.md)
- 生产架构、安全基线与剩余 TODO：[docs/design/production-deployment.md](D:/Code/PythonCode/5%20LiveSetList/docs/design/production-deployment.md)
- 当前生产 schema 已到 V11。包含 Flyway SQL 的版本暂不走普通自动发布；后续将实施“受保护 migration + attestation 后应用切换”的两阶段流程。

## 主要功能

### 公共资料库

- 默认首页已改为公开资料库入口，而不是单一后台表格
- 首页展示 Live 总数、最近 Live、搜索入口、乐队浏览入口、全部内容入口、收藏入口和控制台入口
- 全站标题已统一为 `BanG Dream! Live 资料库`
- 顶部导航已改为全宽置顶条：页签按钮与背景同色，通过文字色和下划线表达当前页；右侧菜单可打开侧边栏导航
- 匿名用户可浏览首页、全部 Live 列表、Live 详情和公共搜索结果
- Live 详情保留日期、类型、乐队、setlist、成员信息、来源 URL 和收藏能力
- Live 详情已提供“发现问题 / 补充信息”入口，当前为静态联系说明，不保存站内工单
- 已提供“关于 / 联系 / 数据说明”入口，明确站方维护、用户反馈纠错、不开放直接编辑

### 搜索与浏览

- 首页搜索框已接入真实搜索
- 公共搜索 API 支持按 Live 标题、乐队 / 艺人名、歌曲名、场地名查询
- 搜索结果按 Live、乐队 / 艺人、歌曲、场地分组展示
- 搜索结果中的 Live 可直接打开现有详情
- 已新增按乐队浏览入口，可查看乐队摘要、收录 Live 数和相关 Live 列表

### 登录、收藏与控制台

- 已提供登录接口：`POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout`
- 已支持应用启动时自动补齐默认 admin 账号（优先读取环境变量，否则使用内建默认值）
- 已提供服务端收藏接口：`GET /api/me/favorites/lives`、`PUT /api/me/favorites/lives/{live_id}`、`DELETE /api/me/favorites/lives/{live_id}`
- 前端已接入登录态恢复、登录弹窗、服务端收藏切换、Live 列表、详情页、分页、主题切换和控制台录入界面
- 收藏页已支持空闲预读与缓存命中，`全量 -> 收藏` 切换默认无加载闪烁；进入收藏页仅在存在脏状态时才触发一次会话对账
- `editor+` 用户可进入现有控制台新增 Live、歌曲、场地和追加 setlist

### 后端、数据库与工程脚本

- 后端使用 `FastAPI + psycopg2` 连接 Docker PostgreSQL（默认 `localhost:15432`）
- 提供数据库健康检查接口：`GET /api/health/db`
- 已提供 Live 列表、单条详情和详情批量预读接口
- 接口会执行真实业务查询；健康检查接口会执行 `select 1;`
- 前端使用 `React + TypeScript + Vite`
- 前端样式入口已收敛到 `frontend/src/styles/index.css`，旧的根级 `frontend/src/styles.css` 已移除
- 已引入 Flyway baseline 和 `V2~V11` 认证、收藏、权限、控制台、live_type 与 setlist 数据规范化相关迁移
- 提供一键启动脚本，可同时启动前后端并统一关闭
- `scripts/run_dev.py` 默认连接生产库，`--test-db` 连接测试库；脚本会显式注入后端 DB host / port / name，降低父 shell 环境污染风险
- `scripts/run_dev.py` 启动前会清理 8000 端口残留后端；若旧后端无法清理且端口仍不可用，会停止启动，避免新旧后端同时服务导致误连测试库
- 已包含后端单元测试、集成测试和前端接口 / 行为测试框架

## 快速开始

### 1) 后端准备

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

数据库连接与超时配置默认都从 `infra/postgres/.env.pg-migrate` 读取；`backend/.env` 已不再作为日常维护入口。

如需安装新引入的登录框架依赖，请重新执行：

```powershell
pip install -r requirements.txt
```

### 2) 前端准备

```powershell
cd frontend
npm install
```

### 3) 一键启动

脚本入口说明见 [scripts/README.md](D:/Code/PythonCode/5%20LiveSetList/scripts/README.md)。

常用命令：

```powershell
python scripts/run_dev.py
python scripts/run_dev.py --test-db
```

默认启动会连接 `infra/postgres/.env.pg-migrate` 中的 `APP_DB`，当前为 `live_statistic`；`--test-db` 会连接 `TEST_DB_NAME`，默认 `live_statistic_test`。

### 4) 默认 admin 账号

以下是本地开发或空测试库行为。生产数据迁移会保留 dump 中的管理员，生产环境应保持 `AUTH_DEFAULT_ADMIN_ENABLED=false`；详见[生产部署 runbook](D:/Code/PythonCode/5%20LiveSetList/docs/production-deployment-runbook.md)。

在完成数据库迁移并启动后端后，应用会自动确保一个默认 admin 账号存在。

可选环境变量：

```powershell
$env:AUTH_DEFAULT_ADMIN_USERNAME="admin"
$env:AUTH_DEFAULT_ADMIN_PASSWORD="your_password"
$env:AUTH_DEFAULT_ADMIN_DISPLAY_NAME="Administrator"
```

说明：

- 若未设置环境变量，后端会使用代码内默认值
- 用户名会自动规范成小写
- 当前阶段默认不开放公开注册
- 默认账号会在应用启动时自动写入或更新为 `admin` 角色

## 运行测试

### 后端检查（类型 + 单元测试）

```powershell
cd backend
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m mypy --config-file mypy.ini
.\.venv\Scripts\python.exe -m pytest tests\unit -q
```

说明：

- 当前 `mypy` 会检查 `app + tests`
- 其中也包含 `tests/integration`

### 后端集成测试（连接测试库）

```powershell
cd backend
.\.venv\Scripts\python.exe -m mypy --config-file mypy.ini
.\.venv\Scripts\python.exe -m pytest tests\integration -q
```

说明：

- integration 用例会连接 `live_statistic_test`
- 每条测试前会自动导入基础 seed 数据

### 前端接口测试

```powershell
cd frontend
npm run test
```

### 前端类型检查

```powershell
cd frontend
npm run typecheck
```

脚本化检查入口说明见 [scripts/README.md](D:/Code/PythonCode/5%20LiveSetList/scripts/README.md)。

## 风险与覆盖边界

- 现有前端测试以功能行为断言为主（组件渲染、交互、文案），不等价于视觉回归测试。
- `ConsoleInsertPanel` 用例主要覆盖控制台局部逻辑，无法自动看护 `main.tsx` 这类全局入口样式变更。
- 引入第三方组件库时，若增加全局 reset/base CSS，可能影响非控制台页面；即使功能测试通过，也可能出现样式回归。
- 本次已记录一例“全局样式改动未被现有测试拦截”的复盘，见 [docs/fails/frontend-global-style-coverage-gap.md](D:/Code/PythonCode/5%20LiveSetList/docs/fails/frontend-global-style-coverage-gap.md)（含 `TODO/待实现` 清单）。

## 日志位置

- 后端日志默认写入 [backend/logs/app.log](D:/Code/PythonCode/5%20LiveSetList/backend/logs/app.log)
- 前端日志默认写入浏览器 `localStorage`，键名为 `live-set-list-logs`

## 数据库版本控制

- Flyway 落地说明：[docs/design/flyway.md](D:/Code/PythonCode/5%20LiveSetList/docs/design/flyway.md)
- 数据库角色与后端用户：[docs/db-roles.md](D:/Code/PythonCode/5%20LiveSetList/docs/db-roles.md)
- 数据库操作说明：[backend/db/README.md](D:/Code/PythonCode/5%20LiveSetList/backend/db/README.md)
- 产品需求：社区 Live 数据库首页与个人工作台：[docs/product/homepage-community-database.md](D:/Code/PythonCode/5%20LiveSetList/docs/product/homepage-community-database.md)
- 归档设计文档：[docs/archive/completed-design](D:/Code/PythonCode/5%20LiveSetList/docs/archive/completed-design)
- 仓库内 Flyway 骨架位于 `backend/db/flyway`
- Docker PostgreSQL 配置位于 `infra/postgres`

## 当前完成状态

- `DONE` 首页与入口：默认首页、最近 Live、Live 总数、全部内容入口、登录 / 收藏 / 控制台入口、首页最近 Live 打开详情
- `DONE` 全宽应用框架：页面取消外层居中框，顶部导航改为全宽置顶条，右侧菜单可打开侧边栏导航
- `DONE` 站点说明与轻反馈入口：关于 / 联系 / 数据说明、Live 详情反馈说明；当前不做反馈数据库表、反馈 API 或后台工单
- `DONE` 公共搜索：Live、乐队 / 艺人、歌曲、场地分组搜索，搜索结果可打开 Live 详情
- `DONE` 公开乐队浏览：乐队列表、收录 Live 数、乐队相关 Live 列表
- `DONE` dev 启动脚本加固：显式注入 DB 配置，清理旧 8000 后端，避免残留测试库后端被误连
- `DONE` Live 详情页改为独立页签：从模态弹窗切换为独立详情页面，顶部含返回按钮，保留原有信息结构和曲目表格
- `DONE` 首页按钮视觉统一：线性箭头风格 action-link，与下方列表列对齐，补充 primary-btn hover 态，联系入口内联为文字链接
- `DONE` 隐私说明：在"联系我们"页面明确说明收集/不收集的数据范围、Cookie 策略和数据删除方式
- `DONE` 外部反馈入口：配置 mailto 邮箱链接（xiluoshiro@gmail.com），替换原来的占位文案
- `DONE` 顶部导航精简：移除"首页"tab，标题 `BanG Dream! Live 资料库` 改为可点击按钮（hover 粉色），侧边栏保留首页入口
- `DONE` 首页指标卡片数据化：新增 `GET /api/catalog/stats` 端点，三张卡片展示"已收录 Live 总数"、"歌曲 / 场地统计"、"最近更新日期"
- `DONE` 列表卡片模式：全量和收藏列表支持表格/卡片双视图，单按钮切换（☷/▦），卡片模式支持无限滚动加载，工具栏置于内容上方
- `DONE` 全量与收藏筛选：已统一支持关键词、年份、Live 类型、乐队 / 艺人和日期排序；桌面横向布局、手机折叠筛选，选项不显示数量；完整 functional 检查已通过
- `DONE` 详情页返回按钮优化：返回按钮移至标题右侧，使用 ✕ 关闭风格（与旧弹窗一致），详情页加白色卡片背景
- `DONE` 生产发布链路：GCE VM、私有 PostgreSQL、Nginx 同源入口、systemd 备份、GitHub Actions tag 出包与审批后 SSH 部署

## 当前待办

- `P1` 后续补齐歌曲页、场地页、城市页、巡演页等资料库实体页
- `P1` 登录用户首页增强最近查看、收藏更新提醒和关注更新；当前只展示收藏数量与收藏入口
- `P2` 增加管理员创建用户与用户管理能力（近期暂缓）
- `P2` 补充 E2E，覆盖首页、搜索、乐队浏览、控制台新增 Live / 追加 setlist 的跨页签链路
- `P2` 评估截图型视觉回归测试，重点看护顶部导航、首页、详情页和控制台的全局样式回归
- `P1` 完成 staging、监控告警、安全头、Host 限制和异地备份；细项见生产部署设计
