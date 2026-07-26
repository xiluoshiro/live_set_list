# 生产部署设计与上线 TODO

本文档只讨论 LiveSetList 部署到公网前必须补齐的工程、安全、运维事项，不讨论资料库功能开发进度。

首次 Google Cloud VM 上线的实际操作、常规手工发布和 GitHub Actions 自动化待办见 [公网部署实录与自动化发布 TODO](../production-deployment-runbook.md)。

当前结论：

- 生产 VM、同源入口、私有 PostgreSQL、备份、Nginx 和 HTTPS/公开访问基线已经落地；首次生产数据迁移也已完成。
- tag 驱动的 GitHub Actions 已验证可完成隔离 CI、白名单出包、`production` 审批、SSH 上传、服务器端备份/切换/回滚和公网 smoke test。
- 生产数据库已通过 `v2026-07-18-001` 完成 V12/V13 migration、应用切换与 health 验收；迁移前已修复历史业务表 owner 漂移。
- 当前仓库 migration 已到 V23，但本文没有生产 V14~V23 的 `flyway info` 或发布验收证据，因此生产确认状态仍停留在 V13。
- 两阶段 migration 发布代码、VM root-owned 入口、sudoers 和 GitHub 配置已完成：tag 自动分类，migration 与 deploy 由两个显式人工阶段控制，服务器端使用 root-only attestation 和共享 owner 契约约束数据库迁移与应用切换。
- 剩余重点从“能否上线”转为 staging、监控告警、安全头、Host 限制、备份异地保存和 migration 自动化前的安全设计。
- 推荐采用同源部署：公网只暴露 `https://<domain>`，静态前端由反向代理托管，`/api/*` 反代到后端，PostgreSQL 只允许后端内网访问。
- 上线前的最后验收应包含功能检查、浏览器实测、生产环境健康检查、备份恢复演练和回滚演练。

当前推荐服务器：

- Google Cloud Compute Engine `e2-medium`
- 实际环境：Debian 12 Bookworm image `debian-12-bookworm-v20260609`
- Balanced Persistent Disk：30 GB 最低，40 GB 推荐，50 GB 是更宽松余量
- 初版不使用 Vercel、Cloud Run、Cloud SQL 或 Kubernetes

## 1. 原始公网部署阻塞点与当前状态

本节保留首次上线前的风险审计，用于解释为什么采用当前架构。各项 P0 结果以第 3 节和[公网部署 runbook](../production-deployment-runbook.md)为准。

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

### 1.4 生产启动方式已提供

生产使用 `infra/production/livesetlist-backend.service`，以 systemd 管理 FastAPI；Nginx 托管静态前端并转发 `/api/*`。服务器端发布脚本会创建版本 venv、原子切换 `current`、重启服务，并等待数据库 health 接口就绪。

### 1.5 数据库端口已隔离

开发 compose 可以映射 `${POSTGRES_PORT}:5432`；生产模板绑定 `127.0.0.1:${POSTGRES_PORT}:5432`，GCP 防火墙不开放 PostgreSQL、后端或 Docker daemon 端口。

生产数据库应满足：

- 只在内网、Docker network、localhost 或云厂商私有网络可达。
- 防火墙禁止公网访问 PostgreSQL 端口。
- 应用只使用运行时最小权限角色连接数据库。
- Flyway/migration 管理账号不用于常规应用请求。

### 1.6 默认 admin bootstrap 已生产化

生产默认关闭 `AUTH_DEFAULT_ADMIN_ENABLED`。首次数据迁移时 admin 来自 `app_users`，不启用 bootstrap。空库初始化才短暂开启 bootstrap，确认登录后关闭。

仍须保持：

- 生产 admin 密码必须强随机，不能使用示例值。
- 首次初始化完成后，优先关闭 `AUTH_DEFAULT_ADMIN_ENABLED`。
- 如果保留自动补齐机制，必须确保不会在每次启动时意外覆盖 admin 密码、角色或启用状态。
- 管理员账号创建和密码轮换要有可审计流程。

### 1.7 登录入口已有基础防爆破策略

Nginx 模板对 `/api/auth/login` 应用 `limit_req`。应用层账号锁定或验证码仍属于后续增强：

- 反向代理按 IP 对 `/api/auth/login` 限流。
- 应用层按 IP、用户名、IP+用户名组合限流。
- 多次失败后的短期冷却或账号保护。
- 审计日志能看出失败原因和来源。

### 1.8 生产密钥与 env 文件已隔离

真实 env 被 `.gitignore` 忽略，运行时仅位于 `/etc/livesetlist`；GitHub Environment 仅保存受限部署 SSH 凭据，不保存数据库或应用密码。仍须保持：

- `.env`、`.env.*`、`infra/**/.env*` 的忽略策略，但保留 `.example`。
- 生产环境变量通过服务器 secret、平台 secret 或私有配置文件注入。
- 禁止把生产密码、token、数据库连接串提交到仓库。

### 1.9 OpenAPI 文档已在生产关闭

生产 `/docs`、`/redoc` 和 `/openapi.json` 均返回 `404`；部署流水线将此作为 smoke check。若未来需要内部文档访问，应单独实现 allowlist。

- 生产环境禁用。
- 或只允许管理员/IP allowlist 访问。
- 或通过反向代理限制访问。

### 1.10 备份与应用回滚已形成基础流程

生产 timer 每日执行备份，发布脚本在切换前后触发备份并在后端 health 失败时回滚应用符号链接。监控、异地备份和 migration 回滚仍未完成：

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
- [x] 完成首次业务数据迁移、app startup 与数据库 health 验收；后续 Flyway migration 仍需单独演练。
- [x] 建立并启用生产备份任务；恢复演练仍应按发布/恢复窗口持续复核。
- [x] 建立部署验收清单和回滚步骤。
- [x] GitHub Actions tag 出包、production 审批、SSH 自动部署与公网 smoke test。
- [x] 完成 V9 -> V11 生产 migration、应用切换和数据库 health 验收。
- [x] 核对并记录 `v2026-07-18-001` 的 V12/V13 Actions、生产 migration、应用切换与 health 结果。

### P0 已新增仓库入口

- 生产模板目录：`infra/production`
- 生产 env 样例：`infra/production/env.production.example`
- 私有 PostgreSQL compose：`infra/production/docker-compose.postgres.yml`
- Nginx 模板：`infra/production/nginx.livesetlist.conf.template`
- 后端 systemd：`infra/production/livesetlist-backend.service`
- 自动备份 systemd：`infra/production/livesetlist-backup.service`、`infra/production/livesetlist-backup.timer`
- 发布包脚本：`python scripts/build_release.py --version <version>`
- GitHub Actions：`.github/workflows/release.yml`
- 服务器端发布入口：`infra/production/livesetlist-deploy`

### P1 强烈建议完成

- [ ] 增加 Host 限制或反代 Host allowlist。
- [ ] 增加 HTTPS 安全头：HSTS、`X-Content-Type-Options`、`Referrer-Policy`、基础 CSP。
- [ ] 反向代理设置请求体大小限制和基础请求频率限制。
- [ ] 后端正确记录真实客户端 IP，避免日志里只出现反代地址。
- [ ] 统一生产日志输出策略：控制台、文件、轮转、采集目标。
- [ ] 为后端、前端静态服务、数据库、磁盘空间、证书过期设置监控。
- [ ] 增加 staging 环境，先在 staging 完成真实域名、HTTPS、迁移、备份演练。
- [x] 在生产 VM 安装两阶段 migration 入口，完成 sudoers 和 GitHub repository secrets/variables/Environments 配置。
- [x] 已通过 `v2026-07-18-001` 核对 V12/V13 的 prepare、attestation、应用切换、health 与公网结果，并写回 runbook。
- [ ] 为 V14~V23 安排 migration release，并在 runbook 记录生产 `flyway info`、owner 契约、应用切换和公网 smoke 证据。
- [ ] 在 staging 完成 app-only、migration 成功、migration 失败、attestation 篡改、重复执行、应用切换失败六类场景演练。
- [ ] 对公共搜索、列表、详情批量接口增加流量保护策略。
- [x] 补充生产部署 runbook、`infra/production/README.md` 和 GitHub Actions 配置说明。
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
3. 执行 `python scripts/build_release.py --version <version>`；脚本会先重建 `frontend/dist`，再生成白名单发布包。
4. 上传发布包到 VM，解压到 `/opt/livesetlist/releases/<version>`，并更新 `/opt/livesetlist/current`。
5. 配置 `/etc/livesetlist/backend.env` 和 `/etc/livesetlist/postgres.env`，不提交到 Git。
6. 启动本机私有 PostgreSQL compose。
7. 执行 Flyway validate/migrate。
8. 临时启用默认 admin bootstrap，启动后端，确认 admin 创建成功。
9. 关闭默认 admin bootstrap，重启后端。
10. 启动 Nginx 反向代理，域名到位后启用 HTTPS。
11. 启用备份 timer，执行首次手动备份和恢复演练。
12. 执行上线验收。

### 5.2 常规发布流程

1. 在目标 commit 运行 `python scripts/run_checks.py functional`，审阅是否包含 Flyway SQL 变化。
2. 无论 app-only 还是 migration release，都只创建并推送一个 `vYYYY-MM-DD-NNN` tag。
3. GitHub Actions 自动完成隔离数据库 CI、`functional`、白名单出包、SHA-256 校验、上传 VM 和服务器侧 prepare 分类。
4. `app-only` 候选包继续进入 `production` 并自动执行备份、原子切换、后端就绪等待与公网 smoke test。
5. `migration-needed` 候选包停止自动切换；维护人使用 Summary 中同一 version/SHA-256 先手动运行 `Migration release control` 的 `migrate` / `MIGRATE`，验收旧应用兼容性后再运行 `deploy` / `DEPLOY`。
6. 日常发布无需手工登录 VM；VM 命令仅用于入口升级、首次验收和故障排查。
7. 复核服务、备份和外部访问；记录发布版本与回滚版本。

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
