# LiveSetList

一个前后端分离的 BanG Dream! Live / setlist 资料库。匿名用户可以搜索和浏览演出、活动组与巡演资料，登录用户可以同步逐场收藏，`editor+` 用户可以通过控制台维护 Live、歌曲、场馆、setlist、巡演和活动组。

## 当前能力

- 公开首页、统一演出资料列表、Live / 活动组详情、巡演列表与详情、全文搜索、乐队浏览和资料库统计。
- 歌曲资料使用 `/songs` 概览、`/songs/{song_id}` 版本详情、`/albums/{album_id}` 唱片单页；支持乐队目录、首次发行、演奏次数排序、年份筛选和完整唱片分区曲目。
- 演出资料自动聚合多日 Live 与单日午场 / 晚场；全部场次命中筛选时保留聚合，部分命中或部分收藏时按实际场次展示。
- 巡演详情支持页内切换场次、按指定乐队统计相邻 Setlist 变化，以及从单场或活动组内 Live 反向进入巡演。
- 统计页支持全部 / 收藏 Live、年份 / 乐队 / 类型筛选、按实际演唱乐队划分的年度高频歌曲与久未演唱；未选乐队时每队取 1 首并按 `band_id` 排序。
- 按关键词、年份、Live 类型、乐队和日期排序筛选，支持表格 / 卡片视图。
- 服务端登录、收藏、批量收藏、会话恢复与 CSRF 防护。
- `editor+` 控制台支持新增和更新 Live、歌曲、场馆、版本化 Setlist（含历史名称、旧/新阵容与交接基准），以及创建和更新巡演、活动组关系。
- Flyway 管理 PostgreSQL schema；当前仓库 migration 为 B1 + V2~V23。
- 一键启动、功能检查、数据库备份恢复和 tag 发布工具链。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18、TypeScript、Vite、Vitest |
| 后端 | FastAPI、Python 3.12、psycopg2、pytest、mypy |
| 数据库 | PostgreSQL、Docker、Flyway |
| 认证 | HttpOnly Session Cookie、CSRF、Argon2 |

## 快速开始

首次准备后端：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
```

首次准备前端：

```powershell
cd frontend
npm install
```

从项目根目录启动：

```powershell
python scripts/run_dev.py --test-db
```

`--test-db` 连接测试库，适合日常开发；不带参数时连接 `APP_DB`。数据库配置来自 `infra/postgres/.env.pg-migrate`。启动脚本的端口清理、代理和数据库选择规则见 [scripts/README.md](scripts/README.md)。

## 本机生产模式（Cloudflare 隧道）

域名由本机 Cloudflare 隧道提供，源站监听 `[::1]:5173`。生产模式不运行 Vite 开发服务器，而是托管 `frontend/dist` 构建产物，并由 FastAPI 提供 `/api`。

前端代码变更后重新构建：

```powershell
cd frontend
npm run build
```

启动生产栈（后端 + 静态服务）：

```powershell
backend\.venv\Scripts\pythonw.exe scripts\run_prod.py
```

也可以直接运行 `scripts\start_prod.cmd`；该入口已放入当前用户启动目录，登录时自动执行。

后端代码变更后重启（直接再执行一次启动命令即可，它会先接管 5173）：

```powershell
backend\.venv\Scripts\pythonw.exe scripts\run_prod.py
```

需要彻底停止（例如长时间停机）时：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'run_prod\.py|serve_frontend\.py' } |
  ForEach-Object { taskkill /PID $_.ProcessId /T /F }
```

注意：启动器使用 `pythonw.exe`，进程名不是 `python.exe`，所以停止时按命令行匹配，不要按进程名过滤。

要点：

- 只改前端时，重新 `npm run build` 即可，静态服务按请求读取 `dist`，无需重启；浏览器刷新即可拿到新哈希资源。
- 只改后端时，重新执行启动命令即可：`run_prod.py` 会先清理 5173 上的旧服务再启动，和 `run_dev.py` 处理 8000 端口的方式一致，不需要手动先停。
- 生产 uvicorn 不带 `--reload`，避免 Windows 上 reload 信号影响自动化宿主。
- 生产模式占用 `[::1]:5173`。再执行 `python scripts/run_dev.py` 时，Vite 会自动改用 5174，开发和线上互不影响。
- Cloudflare 隧道使用 token 模式，入口规则在 Cloudflare 侧维护，本机不需要也不应该修改隧道配置。

## 验证

业务代码修改后的统一检查：

```powershell
python scripts/run_checks.py functional
```

包含数据库恢复沙箱测试的完整检查：

```powershell
python scripts/run_checks.py full
```

## 项目结构

```text
backend/          FastAPI、数据库访问、迁移与后端测试
frontend/         React 应用、样式与前端测试
docs/             产品、API、设计、部署、复盘与归档文档
infra/            PostgreSQL 与生产部署配置
recovery/         数据库备份恢复实现及测试
scripts/          开发、检查、发布与恢复命令入口
```

## 文档入口

- [文档总索引](docs/README.md)
- [产品状态与 TODO](docs/product/homepage-community-database.md)
- [API 补充规则](docs/api.md)
- [开发与检查脚本](scripts/README.md)
- [数据库操作](backend/db/README.md)
- [生产部署操作指南](docs/production-deployment-runbook.md)

接口、数据库角色、开发与部署流程由上述专项文档维护；各文档只保留有效规则，不保存执行历史。
