# LiveSetList

一个前后端分离的 BanG Dream! Live / setlist 资料库。匿名用户可以搜索和浏览演出资料，登录用户可以同步收藏，`editor+` 用户可以通过控制台维护 Live、歌曲、场地和 setlist。

## 当前能力

- 公开首页、演出资料列表、Live 独立详情、全文搜索、乐队浏览和资料库统计。
- 统计页支持全部 / 收藏 Live、年份 / 乐队 / 类型筛选、按实际演唱乐队划分的年度高频歌曲与久未演唱；未选乐队时每队取 1 首并按 `band_id` 排序。
- 按关键词、年份、Live 类型、乐队和日期排序筛选，支持表格 / 卡片视图。
- 服务端登录、收藏、批量收藏、会话恢复与 CSRF 防护。
- `editor+` 控制台支持新增 Live、歌曲、场地和追加 setlist。
- Flyway 管理 PostgreSQL schema；当前仓库 migration 为 B1 + V2~V13。
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
- [生产部署实录](docs/production-deployment-runbook.md)

生产状态、发布验收、数据库角色、恢复流程、测试覆盖边界、完成历史和长期规划均由上述专项文档维护，根 README 不再重复保存这些易漂移内容。
