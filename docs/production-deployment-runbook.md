# LiveSetList 公网部署实录与自动化发布 TODO

本文档记录 2026-07 首次将 LiveSetList 部署到 Google Cloud Compute Engine 的可复用流程，并定义后续自动化出包、部署的实施顺序。

它是实际操作 runbook；架构、安全基线和总体待办仍以 [生产部署设计](design/production-deployment.md) 为准。不要把真实密码、SSH 私钥、数据库 dump 或 `/etc/livesetlist/*.env` 提交到仓库。

## 已验证的部署结果

- 运行环境：Google Compute Engine，Debian 12 Bookworm（`debian-12-bookworm-v20260609`）。
- 部署结构：Nginx 托管 `frontend/dist`，同源 `/api/*` 转发到 FastAPI `127.0.0.1:8000`，PostgreSQL Docker 容器仅绑定 `127.0.0.1:15432`。
- 公网入口：`bang.dreamliveevents.com` 的 A 记录指向 VM 的静态外部 IP。
- VPC 防火墙：允许入站 TCP `80`、`443`；不对公网开放 `8000`、`15432`、`5432`。
- 运行验证：Nginx 本机首页正常、FastAPI 根接口和 `/api/health/db` 正常、公网 HTTP 访问正常，生产 `/openapi.json` 返回 `404`。
- 业务数据通过 PostgreSQL dump 迁入；迁入的管理员账号保留，`auth_sessions` 保持为空，不启用默认管理员 bootstrap。

HTTPS、管理员登录、写操作、自动备份和恢复演练应在每次重要发布前后按本文的验收项复核，不应只以首页能打开作为上线成功判断。

## 目标拓扑

```text
Internet
  |
  +-- TCP 80: Nginx -> HTTPS redirect / ACME challenge
  +-- TCP 443: Nginx
        |-- /       -> /opt/livesetlist/current/frontend/dist
        +-- /api/*  -> FastAPI at 127.0.0.1:8000
                            |
                            +-- PostgreSQL at 127.0.0.1:15432 (Docker)
```

服务器目录约定：

```text
/opt/livesetlist/releases/livesetlist-<version>  已解压的只读发布版本
/opt/livesetlist/current                          指向当前版本的符号链接
/etc/livesetlist                                  仅服务器持有的环境文件
/var/log/livesetlist                              后端日志
/var/backups/livesetlist                          备份文件
```

应用 systemd 服务以 `livesetlist` 非 root 用户运行；Docker 和 Nginx 由系统服务管理。

## 首次部署流程

### 1. 本地构建发布包

在仓库根目录执行：

```powershell
python scripts/run_checks.py functional
Set-Location frontend
npm run build
Set-Location ..
python scripts/build_release.py --version 2026-07-10-003
Get-FileHash .\dist-release\livesetlist-2026-07-10-003.tar.gz -Algorithm SHA256
```

`build_release.py` 是白名单打包器。发布包包含后端应用、Flyway SQL、PostgreSQL 初始化 SQL、前端构建产物、运行配置模板、恢复脚本和必要配置；不包含 `.git`、本地虚拟环境、`node_modules`、日志、缓存、真实 env 和数据库 dump。

将 `.tar.gz` 和校验值通过受控方式传到 VM 临时目录，例如 `~/tmp`。不要把数据库 dump 上传到 GitHub Releases 或提交到 Git。

### 2. 准备 VM 运行时

安装并启用 Nginx、Docker、Python 运行时和 Certbot。关键检查是 Docker Compose v2 命令可用：

```bash
docker --version
docker compose version
sudo systemctl is-enabled docker nginx
```

`docker.io` 本身不一定携带 `docker compose` 子命令。若上述检查失败，先按 Debian 12 的 Docker Compose v2 安装方式补齐，再继续；不要使用旧的 `docker-compose` 命令替代本文命令。

创建运行用户和目录后，上传并解压版本，切换 `current`：

```bash
VERSION=2026-07-10-003
sudo tar -xzf "$HOME/tmp/livesetlist-${VERSION}.tar.gz" -C /opt/livesetlist/releases
sudo chown -R livesetlist:livesetlist "/opt/livesetlist/releases/livesetlist-${VERSION}"
sudo ln -sfn "/opt/livesetlist/releases/livesetlist-${VERSION}" /opt/livesetlist/current
```

发布包不带 Python 虚拟环境。为当前版本创建虚拟环境并安装固定依赖：

```bash
sudo -u livesetlist python3 -m venv /opt/livesetlist/current/backend/.venv
sudo -u livesetlist /opt/livesetlist/current/backend/.venv/bin/pip install -r /opt/livesetlist/current/backend/requirements.txt
```

服务器 Python 版本必须先与项目依赖兼容；不要将开发机 `.venv` 拷贝到 Linux 服务器。

### 3. 配置机密和启动数据库

从 `infra/production/env.production.example` 创建以下两个仅服务器可读的文件，再填入真实值：

```text
/etc/livesetlist/backend.env
/etc/livesetlist/postgres.env
```

两个文件中的同一数据库运行时账号密码必须保持一致，例如 `APP_RO_PASSWORD` 与 `DB_PASSWORD`。复杂密码应通过编辑器写入文件，避免未经引用的 shell 替换破坏 `#`、`$` 等字符。

启动数据库：

```bash
sudo docker compose \
  --env-file /etc/livesetlist/postgres.env \
  -f /opt/livesetlist/current/infra/production/docker-compose.postgres.yml \
  up -d
sudo docker ps --filter name=live-set-list-postgres
```

容器首次初始化会创建运行时角色。确认端口只监听本机：

```bash
sudo ss -ltnp | grep 15432
```

期望为 `127.0.0.1:15432`，而不是 `0.0.0.0:15432`。

### 4. 首次业务数据迁移

这是一次性流程，不应混入每次应用发布：

1. 在迁移前保存源库 dump 的校验值和表行数。
2. PostgreSQL 容器及项目角色完成初始化后，使用受控的 `pg_restore` 将 dump 导入目标库。
3. 若 dump 含有 `ALTER DEFAULT PRIVILEGES FOR ROLE live_project_flyway`，恢复执行身份必须有权修改该角色的默认权限；不要把 `errors ignored` 当作成功。
4. 对业务表、管理员账号和运行时角色做行数/权限验证。
5. `auth_sessions` 可以为 0，迁移后用户需要重新登录。

本次迁移曾遇到 default privileges 权限错误和复杂密码被 shell 处理的问题。后续重复迁移前，必须在非生产库演练 dump、角色成员关系和密码写入流程。

因为数据 dump 已包含管理员账号，生产环境保持：

```env
AUTH_DEFAULT_ADMIN_ENABLED=false
```

只有全新空库且没有迁入管理员时，才短暂开启 bootstrap；确认登录后立刻关闭并重启后端。

### 5. 启动后端和 Nginx

安装 `infra/production/livesetlist-backend.service`，重载并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now livesetlist-backend
curl -f http://127.0.0.1:8000/
curl -f http://127.0.0.1:8000/api/health/db
```

从 Nginx 模板创建站点配置。申请证书前，生效的 `server` 块必须包含真实域名，而不能保留 `server_name _;`：

```nginx
server_name bang.dreamliveevents.com;
```

配置 DNS A 记录、GCP VPC 入站规则后，验证公网 HTTP：

```bash
curl -I --connect-timeout 5 http://bang.dreamliveevents.com/
```

签发并启用证书：

```bash
sudo certbot --nginx -d bang.dreamliveevents.com
curl -I https://bang.dreamliveevents.com/
curl -f https://bang.dreamliveevents.com/api/health/db
sudo systemctl status certbot.timer --no-pager
```

Certbot 选择 HTTP 跳转 HTTPS。只有 HTTPS 生效后，`AUTH_COOKIE_SECURE=true` 的登录 Cookie 才能被浏览器正常使用。

## 常规手工发版

每次发版遵循以下顺序：

1. 本地执行 `python scripts/run_checks.py functional`，再构建前端和白名单发布包。
2. 记录版本号、Git commit、发布包 SHA-256；在涉及数据库变更前先备份生产数据库。
3. 上传新发布包，解压到新的 `/opt/livesetlist/releases/livesetlist-<version>` 目录。
4. 在新版本目录创建 `.venv` 并安装后端依赖；不得覆盖 `/etc/livesetlist` 中的真实环境文件。
5. 若包含新 migration，先对生产库执行 Flyway `validate`，确认通过后再执行 `migrate`。已执行的 migration 绝不能修改。
6. 将 `/opt/livesetlist/current` 切到新版本，执行 `sudo systemctl restart livesetlist-backend`，再执行 `sudo nginx -t && sudo systemctl reload nginx`。
7. 运行本机和公网健康检查，浏览器验证登录、读取数据和一项写操作。
8. 观察 `journalctl -u livesetlist-backend`、应用日志和备份 timer，确认无异常后记录发布完成。

回滚只适用于应用和静态文件：将 `current` 指回上一版本并重启后端。数据库 migration 不是可自动回滚的操作；在执行 migration 前必须完成备份，并让 schema 变更保持前后版本兼容。

## 每次发布的验收清单

- [ ] `python scripts/run_checks.py functional` 在构建机通过。
- [ ] 发布包 SHA-256 已记录，且包内不含真实 env、dump、`.git`、`.venv` 或 `node_modules`。
- [ ] `curl -f http://127.0.0.1:8000/api/health/db` 成功。
- [ ] `curl -I https://bang.dreamliveevents.com/` 返回成功状态或 HTTPS 重定向后的成功状态。
- [ ] `curl -f https://bang.dreamliveevents.com/api/health/db` 成功。
- [ ] `https://bang.dreamliveevents.com/openapi.json` 返回 `404`。
- [ ] 管理员可登录；至少一次读取和一次授权写操作成功。
- [ ] `sudo ss -ltnp` 未显示 `0.0.0.0:8000`、`0.0.0.0:15432` 或 `0.0.0.0:5432`。
- [ ] `livesetlist-backend`、`docker`、`nginx`、`certbot.timer` 和备份 timer 状态正常。
- [ ] 已确认本次发布的回滚版本和数据库备份位置。

## 自动化出包与部署 TODO

自动化目标是减少手工失误，而不是把生产数据库密码或 SSH 主机控制权暴露给 CI。建议先实现 CI 出包，稳定后再加入需要人工审批的生产部署。

### P0：自动化构建，不自动连接生产服务器

- [ ] 在 GitHub Actions 增加 PR/主分支检查工作流：安装项目要求的 Python 和 Node，执行 `python scripts/run_checks.py functional`。
- [ ] 工作流执行前端生产构建，并运行 `python scripts/build_release.py --version <git-tag-or-run-number>`。
- [ ] 对 `.tar.gz` 生成 SHA-256，作为构建日志和 artifact 元数据保存。
- [ ] 将发布包作为 GitHub Actions artifact 上传，设置合理保留期；数据库 dump 不上传。
- [ ] 只允许 tag 或 `workflow_dispatch` 产生候选发布包，避免每个 PR 自动生成可部署生产包。
- [ ] 在本地复现一次 CI 使用的构建命令，确保 Node、Python 和依赖版本固定。

完成条件：Actions 可在不接触 VM 的情况下生成经过检查、可下载、可校验的发布包。

### P1：受控自动部署到生产 VM

- [ ] 在 GitHub 创建 `production` Environment，并设置 required reviewers；部署 job 必须绑定该 Environment。
- [ ] 设置 GitHub Variables：`DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER`、`DEPLOY_PATH=/opt/livesetlist`、`DEPLOY_KNOWN_HOSTS`。
- [ ] 设置 GitHub Secret：专用于部署的最小权限 SSH 私钥 `DEPLOY_SSH_PRIVATE_KEY`。不要将 `/etc/livesetlist/*.env`、数据库密码或管理员密码放进 GitHub Actions。
- [ ] 在 VM 创建仅用于发布的 SSH 用户或受限 sudo 规则：只能上传 release、切换 `current`、重启指定 systemd 服务和执行受控 migration/备份脚本。
- [ ] 在仓库增加可重复执行的服务器端发布脚本，参数仅接收已校验的版本号；脚本负责解压、创建 venv、安装依赖、切换符号链接、重启服务和健康检查。
- [ ] 部署前由服务器端脚本运行数据库备份；如有 migration，先 `validate`，再 `migrate`，并记录结果。
- [ ] 部署 job 将 artifact 上传到新 release 目录，校验 SHA-256 后才允许切换 `current`。
- [ ] 后端启动失败或健康检查失败时，自动将 `current` 指回前一版本并重启；migration 失败时停止，不进行盲目数据库回滚。
- [ ] 部署后执行 HTTPS 首页、DB health、OpenAPI 404 和登录/权限冒烟检查，并保存日志。

完成条件：生产部署只能由已审核的 tag 或手动 workflow 触发，任何部署都有版本、校验值、备份记录、服务日志和可追溯的应用层回滚。

### P2：部署闭环增强

- [ ] 增加 staging VM/数据库，先部署、迁移和验收 staging，再允许 production job。
- [ ] 将数据库备份上传到独立、加密且有生命周期策略的对象存储；定期做恢复演练。
- [ ] 增加 Uptime、证书到期、磁盘空间、Docker 容器、systemd 服务和错误日志告警。
- [ ] 为发布增加变更记录、版本对比和负责人记录。
- [ ] 在自动化流程中增加可重复的浏览器 E2E 冒烟，覆盖登录、查询和权限边界。

## GitHub Actions 发布流建议

```text
tag / workflow_dispatch
  -> functional checks
  -> frontend build
  -> strict release archive + SHA-256
  -> upload artifact
  -> production Environment manual approval
  -> SSH upload + server-side SHA-256 verification
  -> backup -> validate/migrate (if needed)
  -> switch current -> restart -> HTTPS smoke tests
  -> retain release metadata and logs
```

在 P1 完成前，推荐继续采用“GitHub Actions 自动出包 + 人工上传并按本 runbook 部署”的方式。它已能消除构建环境差异，同时不会过早把生产凭据和数据库迁移权限交给 CI。
