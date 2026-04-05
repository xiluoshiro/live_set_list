# LiveSetList

一个前后端分离的最小示例工程，用于在本机访问 PostgreSQL。

## 主要功能

- 后端使用 `FastAPI + psycopg2` 连接 `localhost:5432`
- 提供数据库健康检查接口：`GET /api/health/db`
- 接口会执行 `select 1;` 并返回结果
- 前端使用 `React + TypeScript + Vite`
- 页面包含一个按钮，点击后调用后端接口并展示成功/失败信息
- 提供一键启动脚本，可同时启动前后端并统一关闭
- 已包含后端单元测试和前端接口测试框架

## 快速开始

### 1) 后端准备

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

在 `backend/.env` 中填写数据库连接信息（默认用户为 `live_project_ro`）。

### 2) 前端准备

```powershell
cd frontend
npm install
```

### 3) 一键启动

在项目根目录执行：

```powershell
python run_dev.py
```

或：

```powershell
.\start-dev.bat
```

按 `Ctrl+C` 可同时关闭前后端。

## 运行测试

### 后端检查（类型 + 单元测试）

```powershell
cd backend
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m mypy --config-file mypy.ini
.\.venv\Scripts\python.exe -m pytest tests\unit -q
```

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

### 一键检查脚本（推荐）

```powershell
cd <项目根目录>
python run_checks.py <arguments>
```

- `frontend`：只运行前端 `typecheck + test`
- `backend`：运行后端 `mypy + pytest tests/unit`
- `all`：先运行后端 `mypy + pytest`，再运行前端 `typecheck + test`

## 数据库版本控制

- Flyway 落地说明见 [docs/flyway.md](D:/Code/PythonCode/5%20LiveSetList/docs/flyway.md)
- 仓库内 Flyway 骨架位于 `backend/db/flyway`

### 修改表结构时怎么做

1. 先在 pgAdmin 中试验 SQL
2. 将正式变更整理成新的 `backend/db/flyway/sql/V...sql`
3. 先对测试库执行 Flyway：

```powershell
flyway -configFiles=backend/db/flyway/flyway.toml validate
flyway -configFiles=backend/db/flyway/flyway.toml migrate
```

4. 跑后端/前端检查，确认接口与页面正常
5. 不要修改已执行过的 `V...sql`；如需修正，新增下一个版本文件

## 开发路线图（TODO）

- [x] 初始化前后端工程骨架
- [x] 后端连通本机 PostgreSQL 并提供 `select 1` 健康检查接口
- [x] 前端按钮触发接口并展示结果
- [x] 增加一键启动脚本（同时启动/统一关闭）
- [x] 搭建后端单元测试和前端接口测试框架
- [ ] 新增后端查询接口（返回真实表数据）
- [ ] 前端改为表格展示查询结果
- [ ] 支持单行编辑并提交更新
- [ ] 增加后端更新接口权限与参数校验
- [ ] 补充错误提示、空数据态、加载态
- [ ] 增加基础日志与配置说明
