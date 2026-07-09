# 生产部署设计与上线 TODO

本文档只讨论 LiveSetList 部署到公网前必须补齐的工程、安全、运维事项，不讨论资料库功能开发进度。

当前结论：

- 当前仓库适合本地开发和内网试用，不能直接按现状暴露到公网。
- 上线前应优先完成生产入口、HTTPS、前后端地址配置、Cookie/CORS、数据库隔离、登录防护、备份恢复和部署文档。
- 推荐采用同源部署：公网只暴露 `https://<domain>`，静态前端由反向代理托管，`/api/*` 反代到后端，PostgreSQL 只允许后端内网访问。
- 上线前的最后验收应包含功能检查、浏览器实测、生产环境健康检查、备份恢复演练和回滚演练。

当前推荐服务器：

- Google Cloud Compute Engine `e2-medium`
- 实际环境：Debian 12 Bookworm image `debian-12-bookworm-v20260609`
- Balanced Persistent Disk：30 GB 最低，40 GB 推荐，50 GB 是更宽松余量
- 初版不使用 Vercel、Cloud Run、Cloud SQL 或 Kubernetes

## 1. 当前公网部署阻塞点

### 1.1 前端 API 地址已改为生产可配置

当前 `frontend/src/api.ts` 默认使用同源相对路径，并允许通过 `VITE_API_BASE_URL` 覆盖：

```ts
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
```

当前采用以下策略：

- 推荐：前端请求同源相对路径，例如 `/api/...`，由反向代理转发到后端。
- 可接受：通过 Vite 环境变量注入公网 API 地址，例如 `VITE_API_BASE_URL=https://api.example.com`。

### 1.2 后端 CORS 已改为环境变量配置

当前开发环境默认允许：

```py
DEV_CORS_ALLOW_ORIGINS = ["http://localhost:5173"]
```

生产环境默认不开放跨域；如果必须前后端不同域名，则通过 `CORS_ALLOW_ORIGINS` 配置明确 origin allowlist，不能使用泛化 `*` 搭配 credentials。

### 1.3 Cookie 安全配置已在生产环境强制

当前生产环境启动时会要求 `AUTH_COOKIE_SECURE=true`。公网必须满足：

- 全站 HTTPS。
- `AUTH_COOKIE_SECURE=true`。
- Session cookie 继续保持 `HttpOnly`。
- `SameSite=Lax` 在同源部署下可以保留；如果未来拆成跨站前后端，需要重新评估 cookie 策略。

### 1.4 生产启动方式缺失

当前只有 `scripts/run_dev.py`，后端启动使用 `uvicorn --reload`，这是开发模式，不适合生产。

生产环境需要明确：

- 后端生产进程命令。
- 进程守护方式，例如 systemd、Docker Compose 或平台托管服务。
- 前端构建与静态文件托管方式。
- 反向代理配置。
- 日志、健康检查、重启策略。

### 1.5 数据库端口不能公网暴露

当前 PostgreSQL compose 文件映射了 `${POSTGRES_PORT}:5432`。本地开发默认端口是 `15432`，生产环境不能把该端口暴露给公网。

生产数据库应满足：

- 只在内网、Docker network、localhost 或云厂商私有网络可达。
- 防火墙禁止公网访问 PostgreSQL 端口。
- 应用只使用运行时最小权限角色连接数据库。
- Flyway/migration 管理账号不用于常规应用请求。

### 1.6 默认 admin bootstrap 需要生产化

当前应用启动时会按环境变量自动确保默认 admin 用户存在。公网前必须处理：

- 生产 admin 密码必须强随机，不能使用示例值。
- 首次初始化完成后，优先关闭 `AUTH_DEFAULT_ADMIN_ENABLED`。
- 如果保留自动补齐机制，必须确保不会在每次启动时意外覆盖 admin 密码、角色或启用状态。
- 管理员账号创建和密码轮换要有可审计流程。

### 1.7 登录入口缺少防爆破策略

当前未看到应用层登录限流、账号锁定或验证码策略。公网登录接口必须至少具备一种防护：

- 反向代理按 IP 对 `/api/auth/login` 限流。
- 应用层按 IP、用户名、IP+用户名组合限流。
- 多次失败后的短期冷却或账号保护。
- 审计日志能看出失败原因和来源。

### 1.8 生产密钥与 env 文件保护不足

当前真实 `.env` 文件未被 Git 跟踪，但 `.gitignore` 没有明确忽略 `.env` 类文件。上线前应补齐：

- `.env`、`.env.*`、`infra/**/.env*` 的忽略策略，但保留 `.example`。
- 生产环境变量通过服务器 secret、平台 secret 或私有配置文件注入。
- 禁止把生产密码、token、数据库连接串提交到仓库。

### 1.9 OpenAPI 文档和内部接口暴露策略未定

FastAPI 默认会暴露 `/docs`、`/redoc`、`/openapi.json`。公网前必须决定：

- 生产环境禁用。
- 或只允许管理员/IP allowlist 访问。
- 或通过反向代理限制访问。

### 1.10 备份、恢复、监控、回滚尚未形成生产流程

项目已有 recovery 工具，但生产上线前必须明确：

- 生产库备份频率、保留周期和存放位置。
- 恢复演练步骤。
- 迁移失败回滚策略。
- 服务进程、数据库、磁盘、证书、错误率的监控方式。

## 2. 推荐目标架构

### 2.1 单域名同源架构

推荐初版生产架构：

```text
Internet
  |
  v
HTTPS reverse proxy: Nginx / Caddy
  |-- /              -> frontend static files
  |-- /api/*         -> backend FastAPI on private port
  |-- /docs          -> blocked or allowlisted
  |-- /redoc         -> blocked or allowlisted
  |-- /openapi.json  -> blocked or allowlisted
  |
  v
PostgreSQL: private network only
```

这样前端只请求 `/api/...`，避免浏览器跨域、Cookie 跨站和 CORS 复杂度。

### 2.2 服务边界

- 公网只暴露 80/443。
- 80 只做 HTTPS 跳转。
- 后端端口只监听 `127.0.0.1` 或容器私有网络。
- PostgreSQL 只允许后端、维护脚本和备份任务访问。
- Flyway 迁移只在部署流程中执行，不作为长期公网服务。

### 2.3 环境分层

建议至少区分：

- `development`：本地开发，允许 localhost CORS，允许 `AUTH_COOKIE_SECURE=false`。
- `staging`：公网或内网预发，配置接近生产，使用独立数据库。
- `production`：真实域名、HTTPS、生产数据库、严格 cookie、限流和备份。

## 3. 上线 TODO

### P0 必须完成

- [x] 前端 API 基址改为同源 `/api`，并支持 `VITE_API_BASE_URL`。
- [x] 后端 CORS 改为环境变量配置，并为生产域名提供明确 allowlist。
- [x] 生产环境强制 `AUTH_COOKIE_SECURE=true`。
- [x] 新增生产启动方案，不使用 `uvicorn --reload`。
- [x] 新增反向代理配置，完成 HTTPS、静态前端托管和 `/api/*` 转发模板。
- [x] 生产数据库 compose 模板只绑定 `127.0.0.1`，不公网暴露。
- [x] 生产 admin bootstrap 默认关闭，显式启用时拒绝占位/弱密码。
- [x] 为 `/api/auth/login` 增加 Nginx `limit_req` 模板。
- [x] 生产环境默认关闭 `/docs`、`/redoc`、`/openapi.json`。
- [x] `.gitignore` 明确忽略真实 env 文件，保留 `.example`。
- [x] 准备生产环境变量清单，覆盖 DB、auth、cookie、日志、域名、CORS。
- [ ] 跑通一次生产数据库迁移流程：Flyway validate -> migrate -> app startup。
- [x] 建立生产备份任务模板；真实 VM 上仍需完成首次备份和恢复演练。
- [x] 建立部署验收清单和回滚步骤。

### P0 已新增仓库入口

- 生产模板目录：`infra/production`
- 生产 env 样例：`infra/production/env.production.example`
- 私有 PostgreSQL compose：`infra/production/docker-compose.postgres.yml`
- Nginx 模板：`infra/production/nginx.livesetlist.conf.template`
- 后端 systemd：`infra/production/livesetlist-backend.service`
- 自动备份 systemd：`infra/production/livesetlist-backup.service`、`infra/production/livesetlist-backup.timer`
- 发布包脚本：`python scripts/build_release.py --version <version>`

### P1 强烈建议完成

- [ ] 增加 Host 限制或反代 Host allowlist。
- [ ] 增加 HTTPS 安全头：HSTS、`X-Content-Type-Options`、`Referrer-Policy`、基础 CSP。
- [ ] 反向代理设置请求体大小限制和基础请求频率限制。
- [ ] 后端正确记录真实客户端 IP，避免日志里只出现反代地址。
- [ ] 统一生产日志输出策略：控制台、文件、轮转、采集目标。
- [ ] 为后端、前端静态服务、数据库、磁盘空间、证书过期设置监控。
- [ ] 增加 staging 环境，先在 staging 完成真实域名、HTTPS、迁移、备份演练。
- [ ] 对公共搜索、列表、详情批量接口增加流量保护策略。
- [ ] 补充生产部署文档 `docs/deploy.md` 或 `infra/production/README.md`。
- [ ] 补充最小 E2E 冒烟：打开首页、搜索、详情、登录、收藏、控制台权限拒绝/允许。

### P2 可后续增强

- [ ] 接入错误监控或告警平台。
- [ ] 增加自动化证书续期检查。
- [ ] 增加管理员密码轮换流程。
- [ ] 增加只读维护页或停机页。
- [ ] 建立发布版本号、变更记录和部署审计。
- [ ] 增加截图型视觉回归，覆盖首页、顶部导航、详情页和控制台。

## 4. 生产配置建议

### 4.1 后端环境变量

建议生产环境至少显式配置：

```powershell
APP_ENV=production
APP_LOG_LEVEL=INFO
APP_LOG_FILE=/var/log/livesetlist/app.log
TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128

DB_HOST=<private-db-host>
DB_PORT=5432
DB_NAME=live_statistic
DB_USER=<readonly-runtime-user>
DB_PASSWORD=<readonly-runtime-password>
DB_WRITE_USER=<super-runtime-user>
DB_WRITE_PASSWORD=<super-runtime-password>
DB_USER_RW_USER=<normal-write-runtime-user>
DB_USER_RW_PASSWORD=<normal-write-runtime-password>
DB_CONNECT_TIMEOUT_SECONDS=5
DB_STATEMENT_TIMEOUT_MS=10000

AUTH_COOKIE_SECURE=true
AUTH_SESSION_HOURS=8
AUTH_DEFAULT_ADMIN_ENABLED=false

CORS_ALLOW_ORIGINS=https://<domain>
LIVESETLIST_BACKUP_ROOT=/var/backups/livesetlist
```

如果首次部署需要 bootstrap admin，可以短暂设置：

```powershell
AUTH_DEFAULT_ADMIN_ENABLED=true
AUTH_DEFAULT_ADMIN_USERNAME=<admin-user>
AUTH_DEFAULT_ADMIN_PASSWORD=<strong-random-password>
AUTH_DEFAULT_ADMIN_DISPLAY_NAME=<display-name>
```

初始化完成并确认可登录后，应改回：

```powershell
AUTH_DEFAULT_ADMIN_ENABLED=false
```

### 4.2 前端环境变量

如果采用同源反代，推荐前端默认请求相对路径，不需要生产 API 域名变量。

如果采用前后端分域部署，则需要：

```powershell
VITE_API_BASE_URL=https://api.<domain>
```

这种方案会增加 CORS 和 cookie 配置复杂度，初版不推荐。

### 4.3 数据库

生产库建议：

- 独立 volume 或云数据库实例。
- 只开放私网访问。
- 每日自动备份，重要变更前手动备份。
- migration 前先执行 `flyway validate`。
- 严禁在生产库上直接修改已执行 migration。

## 5. 部署流程设计

### 5.1 首次上线流程

1. 准备 Google Cloud VM、防火墙和静态公网 IP。
2. 准备域名、DNS 和 HTTPS 证书；暂无域名时只做临时 HTTP/本机验收。
3. 本地执行 `npm run build` 生成 `frontend/dist`。
4. 执行 `python scripts/build_release.py --version <version>` 生成白名单发布包。
5. 上传发布包到 VM，解压到 `/opt/livesetlist/releases/<version>`，并更新 `/opt/livesetlist/current`。
6. 配置 `/etc/livesetlist/backend.env` 和 `/etc/livesetlist/postgres.env`，不提交到 Git。
7. 启动本机私有 PostgreSQL compose。
8. 执行 Flyway validate/migrate。
9. 临时启用默认 admin bootstrap，启动后端，确认 admin 创建成功。
10. 关闭默认 admin bootstrap，重启后端。
11. 启动 Nginx 反向代理，域名到位后启用 HTTPS。
12. 启用备份 timer，执行首次手动备份和恢复演练。
13. 执行上线验收。

### 5.2 常规发布流程

1. 在本地或 CI 运行 `python scripts/run_checks.py functional`。
2. 如有数据库变更，先在 staging 执行 Flyway validate/migrate。
3. 备份生产库。
4. 部署后端代码。
5. 执行生产 Flyway validate/migrate。
6. 构建并部署前端。
7. 重启服务或滚动发布。
8. 执行冒烟验收。
9. 观察日志和监控。

### 5.3 回滚流程

回滚策略必须在上线前明确：

- 前端静态文件可回滚到上一版构建产物。
- 后端可回滚到上一版代码和依赖。
- 数据库 migration 一旦执行，不能依赖简单代码回滚解决所有问题。
- 破坏性 schema 变更必须拆成多阶段兼容迁移。
- 必须保留上线前数据库备份，并验证可恢复。

## 6. 上线验收清单

### 6.1 自动检查

- [ ] `python scripts/run_checks.py functional` 通过。
- [ ] 前端生产构建通过。
- [ ] 后端生产启动命令可启动并可重启。
- [ ] Flyway validate 通过。
- [ ] 生产库 migration 成功。

### 6.2 浏览器检查

- [ ] `https://<domain>` 可打开首页。
- [ ] 首页统计卡片加载成功。
- [ ] 搜索可返回 Live、乐队、歌曲、场地结果。
- [ ] Live 详情页可打开。
- [ ] 登录成功后 cookie 带 `Secure` 和 `HttpOnly`。
- [ ] 收藏新增和取消成功。
- [ ] viewer 用户不能访问 editor 写接口。
- [ ] editor/admin 用户可访问控制台必要功能。
- [ ] 退出登录后写接口返回未登录或 CSRF 错误。

### 6.3 安全检查

- [ ] HTTP 自动跳转 HTTPS。
- [ ] PostgreSQL 端口公网不可访问。
- [ ] `/docs`、`/redoc`、`/openapi.json` 已禁用或受限。
- [ ] `/api/auth/login` 有限流。
- [ ] 生产 env 未提交到 Git。
- [ ] 默认 admin bootstrap 已关闭或有明确风险接受记录。
- [ ] 反向代理启用基础安全头。

### 6.4 运维检查

- [ ] 后端日志可查看、可轮转。
- [ ] 数据库备份任务已运行。
- [ ] 恢复演练完成并记录结果。
- [ ] 证书续期方式明确。
- [ ] 服务器磁盘空间、进程状态、数据库连接健康有监控。
- [ ] 回滚包和回滚命令已准备。

## 7. 建议实施顺序

1. 先改配置能力：前端 API base、后端 CORS、生产 cookie、OpenAPI 暴露开关。
2. 再补生产部署骨架：反代配置、生产启动命令、env 样例、`.gitignore`。
3. 然后补安全边界：登录限流、数据库私网、Host/安全头、admin bootstrap 收口。
4. 最后补运维闭环：备份恢复、监控告警、上线验收、回滚演练。

这个顺序的目标是先让应用能以正确拓扑跑在公网，再逐步降低公开暴露后的安全和运维风险。
