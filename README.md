# LiveSetList

一个前后端分离的 Live 信息管理工程，用于在本机访问 PostgreSQL，并逐步演进到带登录、收藏和后台录入能力的完整应用。

## 主要功能

- 后端使用 `FastAPI + psycopg2` 连接 Docker PostgreSQL（默认 `localhost:15432`）
- 提供数据库健康检查接口：`GET /api/health/db`
- 已提供 Live 列表、单条详情和详情批量预读接口
- 已提供登录骨架接口：`POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout`
- 已提供服务端收藏接口：`GET /api/me/favorites/lives`、`PUT /api/me/favorites/lives/{live_id}`、`DELETE /api/me/favorites/lives/{live_id}`
- 接口会执行真实业务查询；健康检查接口会执行 `select 1;`
- 前端使用 `React + TypeScript + Vite`
- 前端已接入登录态恢复、登录弹窗、服务端收藏切换、Live 列表、详情弹窗、分页、主题切换和控制台 mock 录入界面
- 收藏页已支持空闲预读与缓存命中，`全量 -> 收藏` 切换默认无加载闪烁；进入收藏页仅在存在脏状态时才触发一次会话对账
- 提供一键启动脚本，可同时启动前后端并统一关闭
- 已引入 Flyway baseline 和 `V2~V6` 认证/收藏/权限相关迁移
- 已支持应用启动时自动补齐默认 admin 账号（优先读取环境变量，否则使用内建默认值）
- 已包含后端单元测试和前端接口测试框架

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

### 4) 默认 admin 账号

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

## 日志位置

- 后端日志默认写入 [backend/logs/app.log](D:/Code/PythonCode/5%20LiveSetList/backend/logs/app.log)
- 前端日志默认写入浏览器 `localStorage`，键名为 `live-set-list-logs`

## 数据库版本控制

- Flyway 落地说明见 [docs/flyway.md](D:/Code/PythonCode/5%20LiveSetList/docs/design/flyway.md)
- 登录与权限方案见 [docs/archive/completed-design/auth-design.md](D:/Code/PythonCode/5%20LiveSetList/docs/archive/completed-design/auth-design.md)
- 数据库角色与后端用户梳理见 [docs/db-roles.md](D:/Code/PythonCode/5%20LiveSetList/docs/db-roles.md)
- 数据库操作说明见 [backend/db/README.md](D:/Code/PythonCode/5%20LiveSetList/backend/db/README.md)
- 仓库内 Flyway 骨架位于 `backend/db/flyway`
- Docker PostgreSQL 配置位于 `infra/postgres`
- 当前容器内默认使用的账号分工：
  - `postgres`：容器 bootstrap / 管理账号
  - `live_project_owner`：业务库 owner，由 `APP_OWNER` / `APP_OWNER_PASSWORD` 指定
  - `live_project_flyway`：Flyway 迁移账号
  - `live_project_ro`：普通查询账号
  - `live_project_user_rw`：前端普通用户写账号，当前用于收藏写入
  - `live_project_super_ro`：高权限业务账号，可查询/插入/更新，当前用于认证与后续控制台写接口
  - `live_project_test_admin`：测试库专用管理账号，用于 integration 的重置与 seed

## 开发路线图（TODO）

- [x] 初始化前后端工程骨架
- [x] 后端连通本机 PostgreSQL 并提供 `select 1` 健康检查接口
- [x] 前端按钮触发接口并展示结果
- [x] 增加一键启动脚本（同时启动/统一关闭）
- [x] 搭建后端单元测试和前端接口测试框架
- [x] 新增后端查询接口（返回真实表数据）
- [x] 前端改为表格展示查询结果
- [x] 增加基础日志与配置说明
- [x] 增加登录框架第一阶段骨架（数据库迁移、认证接口、默认 admin 加载）
- [x] 前端接入登录态恢复、登录弹窗与服务端收藏切换
- [x] 收藏改为仅登录用户可见并切换到服务端存储
- [x] 收藏页切换体验优化（预读收藏第一页，减少不必要的 `/api/auth/me` 请求）
- [x] 运行时数据库连接拆分为 `ro / user_rw / super_ro`
- [ ] 控制台接入真实写接口
- [ ] 控制台按 `viewer / editor / admin` 做真正的角色控制
- [ ] 增加后端更新接口权限与参数校验
- [ ] 补充错误提示、空数据态、加载态
- [ ] 增加管理员创建用户与用户管理能力
