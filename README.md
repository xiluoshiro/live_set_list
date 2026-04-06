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

### 一键检查脚本（推荐）

```powershell
cd <项目根目录>
python run_checks.py <arguments>
```

- `frontend`：只运行前端 `typecheck + test`
- `backend-unit`：运行后端 `mypy(app + tests) + pytest tests/unit`
- `backend-integration`：运行后端 `mypy(app + tests) + pytest tests/integration`
- `backend`：运行后端 `mypy(app + tests) + pytest tests/unit + pytest tests/integration`
- `all`：先运行后端完整检查，再运行前端 `typecheck + test`

## 数据库版本控制

- Flyway 落地说明见 [docs/flyway.md](D:/Code/PythonCode/5%20LiveSetList/docs/flyway.md)
- 数据库操作说明见 [backend/db/README.md](D:/Code/PythonCode/5%20LiveSetList/backend/db/README.md)
- 仓库内 Flyway 骨架位于 `backend/db/flyway`
- Docker PostgreSQL 配置位于 `infra/postgres`
- 当前容器内默认使用的账号分工：
  - `postgres`：容器 bootstrap / 管理账号
  - `live_project_owner`：业务库 owner，由 `APP_OWNER` 指定
  - `live_project_flyway`：Flyway 迁移账号
  - `live_project_ro`：普通查询账号
  - `live_project_super_ro`：高权限业务账号，可查询/插入/更新
  - `live_project_test_admin`：测试库专用管理账号，用于 integration 的重置与 seed

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
