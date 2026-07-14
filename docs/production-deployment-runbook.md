# LiveSetList 公网部署与自动发布实录

本文档是当前生产环境的操作 runbook。生产架构、安全基线和后续优先级见[生产部署设计](design/production-deployment.md)。不要将真实密码、SSH 私钥、数据库 dump 或 `/etc/livesetlist/*.env` 提交到仓库。

## 当前状态

截至 2026-07-14，以下路径已在生产 VM 上验证：

- Google Compute Engine VM：Debian 12 Bookworm（`debian-12-bookworm-v20260609`）。
- Nginx 托管 `frontend/dist`，同源 `/api/*` 转发至 FastAPI `127.0.0.1:8000`；PostgreSQL Docker 容器仅绑定 `127.0.0.1:15432`。
- 公网域名：`bang.dreamliveevents.com`；生产 OpenAPI 路径返回 `404`。
- 业务数据和管理员来自 PostgreSQL dump，`AUTH_DEFAULT_ADMIN_ENABLED=false`，`auth_sessions` 为空是预期状态。
- `livesetlist-backup.timer` 每天 `03:20` 执行自动备份，根目录为 `/var/backups/livesetlist`。
- GitHub Actions tag 发布已跑通：CI 创建隔离 PostgreSQL、执行 Flyway 和 `functional`、构建发布包并经 `production` Environment 审批后部署到 VM。
- 首个完整成功的自动发布 tag 为 `v2026-07-14-006`。

自动发布当前只接受不变更 `backend/db/flyway/sql` 的版本。包含 Flyway SQL 的 **migration release 本身** 必须按“数据库迁移”章节完整手工发布；只有该 release 已成为 `current` 后，后续不再改变 SQL 的应用版本才可继续自动发布。

## 生产拓扑与目录

```text
Internet
  |
  +-- Nginx: /       -> /opt/livesetlist/current/frontend/dist
              /api/* -> FastAPI at 127.0.0.1:8000
                                  |
                                  +-- PostgreSQL at 127.0.0.1:15432 (Docker)
```

```text
/opt/livesetlist/releases/livesetlist-<version>  root 持有的只读发布版本
/opt/livesetlist/current                          指向当前版本的符号链接
/etc/livesetlist                                  仅服务器持有的环境文件
/var/log/livesetlist                              后端日志
/var/backups/livesetlist                          备份文件
/usr/local/sbin/livesetlist-deploy                root 持有的自动发布入口
```

后端以 `livesetlist` 非 root 用户运行。备份 service 和发布脚本需要调用 Docker / systemd，因此以 root 运行；发布 SSH 用户仅获准 sudo 执行 `/usr/local/sbin/livesetlist-deploy`。

## 日常自动发布

### 1. 发布前检查

1. 确认本次不含 `backend/db/flyway/sql` 变化；否则先走“数据库迁移”。
2. 在目标 commit 本地运行：

   ```powershell
   python scripts/run_checks.py functional
   ```

3. 检查 `git status`，确保 tag 指向包含所有目标改动的已推送 commit。

### 2. 创建 tag

版本格式固定为 `vYYYY-MM-DD-NNN`，例如：

```powershell
git tag -a v2026-07-14-007 -m "Release 2026-07-14-007"
git push origin v2026-07-14-007
```

不要移动或复用已触发过的 tag。修复工作流或部署脚本后，提交修复并创建新的递增 tag。

### 3. GitHub Actions 做什么

`.github/workflows/release.yml` 仅响应 `v*` tag：

1. 安装 Node 22.12 和 Python 3.12，安装前后端依赖。
2. 从 `flyway.toml.example` 生成 CI 临时 Flyway 配置，创建隔离 Docker PostgreSQL，执行 Flyway migrate。
3. 执行 `python scripts/run_checks.py functional`。
4. 执行 `python scripts/build_release.py --version <version>`；该脚本会重新构建前端并生成白名单发布包。
5. 生成 SHA-256，上传 `.tar.gz` 和 `.sha256` artifact，保留 14 天。
6. `Deploy production` 等待 `production` Environment 审批；批准后才可读取环境级 SSH secrets。
7. 下载同一 artifact、校验 SHA-256、上传至 VM `/tmp`，调用服务器端部署脚本。
8. 从 GitHub Runner 对 `PUBLIC_BASE_URL` 检查首页、`/api/health/db` 与 `/openapi.json` 的 `404`。

在 Actions 页面确认 `Verify and package` 成功后，再审阅 tag、commit 和变更内容并批准 `production` 部署。

### 4. 服务器端部署行为

`/usr/local/sbin/livesetlist-deploy <version> <sha256>` 会：

1. 校验版本格式、归档 SHA-256、归档路径和链接文件。
2. 拒绝 Flyway SQL 与当前版本不同的归档。
3. 先启动一次数据库备份任务。
4. 解压到新的 release 目录，使用当前 release 的 Python 创建 venv 并安装依赖。
5. root 化 release，安装 systemd unit，原子切换 `current`，重启后端与 Nginx。
6. 最多等待 20 秒，直到 `http://127.0.0.1:8000/api/health/db` 成功。
7. 成功后再执行一次备份；失败则将 `current` 指回上一 release 并重启后端。

## GitHub Environment 与 VM 前置条件

GitHub 仓库须有 `production` Environment：

- Deployment rule：**Tag** 类型的 `v*`，不是 Branch 规则。
- Required reviewer：按维护人配置；单人维护时不要启用 self-review 禁止项。
- Secrets：`DEPLOY_SSH_PRIVATE_KEY`、`DEPLOY_KNOWN_HOSTS`。
- Variables：`DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER=livesetlist-deploy`、`PUBLIC_BASE_URL`。

`DEPLOY_KNOWN_HOSTS` 的第一列必须与 `DEPLOY_HOST` 完全一致。若使用 VM IP，可在 VM 上生成：

```bash
sudo awk '{print "<VM_IP>", $1, $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

GitHub Hosted Runner 使用动态出口 IP。当前直接 SSH 模式要求 GCP 防火墙允许其访问 TCP 22；SSH 必须禁用密码登录和 root 登录，并使用专用部署密钥与受限 sudo。不要把数据库或后端端口开放给公网。

部署 root 脚本不会由自身自动更新。修改 `infra/production/livesetlist-deploy` 后，必须先以管理员身份更新 VM 上的入口：

```bash
sudo install -o root -g root -m 755 \
  /tmp/livesetlist-deploy.next \
  /usr/local/sbin/livesetlist-deploy
```

可先通过 `livesetlist-deploy` SSH 用户把新脚本上传到 `/tmp/livesetlist-deploy.next`，再用管理员会话执行上述安装。

## 数据库迁移

自动发布故意拒绝 Flyway SQL 变化，避免应用切换与不可逆 schema 变更混在同一次无人工数据库审批的操作中。

有 migration 时：

1. 创建生产库手动备份并确认备份文件可被 `pg_restore -l` 读取。
2. 在非生产环境完成 `flyway validate` / `migrate` 与功能验收。
3. 在生产窗口手动执行 `flyway validate`，再执行 `migrate`，记录输出。
4. 解压该 release、用其 `sql/` 手工完成 migration，并手工切换该 release 为 `current`；不能调用当前自动部署脚本，因为它会拒绝 SQL 文件差异。
5. 验证数据库 health、读路径、授权写路径和备份。该 release 成为 `current` 后，后续 SQL 不变的版本可恢复自动发布。

不要修改已执行 migration；回滚应用版本不等于回滚数据库。

## 首次环境与数据迁移要点

首次部署使用白名单发布包和 PostgreSQL dump，而不是上传整个工作区。发布包不含 `.git`、`.venv`、`node_modules`、真实 env、日志或 dump。

PostgreSQL 角色密码保存在已初始化 volume 内；即使 `/etc/livesetlist/backend.env` 与 `postgres.env` 互相一致，数据库内部角色仍可能保留旧密码。发生认证失败时，应进入容器使用 `psql` 检查并修正角色，而不是只反复修改 env 文件。

数据库 dump 中若含有 `ALTER DEFAULT PRIVILEGES FOR ROLE live_project_flyway`，恢复执行身份需要对应角色成员关系。`pg_restore` 的 `errors ignored` 不是成功信号。迁入 `app_users` 后保留其中的 admin；清空 `auth_sessions` 是合理的安全处理。

## 验收与排障

每次自动部署后至少验证：

```bash
readlink -f /opt/livesetlist/current
sudo systemctl status livesetlist-backend livesetlist-backup.timer --no-pager
curl -f http://127.0.0.1:8000/api/health/db
sudo ss -ltnp
```

从外部工作站验证：

```powershell
curl.exe -f <PUBLIC_BASE_URL>/
curl.exe -f <PUBLIC_BASE_URL>/api/health/db
curl.exe -I <PUBLIC_BASE_URL>/openapi.json
```

最后一项应为 `404`。本机访问自身公网 IP 可能受 hairpin routing 影响，公网验收以外部工作站或 GitHub smoke test 为准。

本次自动化实施中已修复的故障：

| 现象 | 原因 | 固化处理 |
| --- | --- | --- |
| CI 找不到 `flyway.toml` | 本地配置被 Git 忽略 | CI 从 `flyway.toml.example` 生成临时配置 |
| SHA-256 校验找不到归档 | 校验文件记录了构建机的 `dist-release/` 路径 | 在 `dist-release` 内生成校验文件，只记录文件名 |
| production job 被拒绝 | Environment 将 `v*` 配成 Branch 规则 | 使用 Tag 类型的 `v*` 规则 |
| Setlist 前端测试偶发找不到 textarea | 等待条件在异步检查出现前提前通过 | 等待目标 textarea 实际渲染 |
| 部署后立即 health check 失败 | systemd 返回时 Uvicorn 尚未监听端口 | 部署脚本最多等待 20 秒 |
| VM 本机无法 curl 公网地址 | hairpin 路由不可靠 | 使用外部工作站 / GitHub 进行公网验证 |

若后端在 20 秒后仍未就绪，读取：

```bash
sudo journalctl -u livesetlist-backend -n 120 -l --no-pager
sudo systemctl status livesetlist-backend --no-pager
```

## 剩余运维 TODO

- [ ] 建立 staging VM / 数据库，并让 migration 先在 staging 验收。
- [ ] 接入 HTTPS 安全头、Host allowlist 与真实客户端 IP 记录。
- [ ] 为服务、证书、磁盘、备份和错误日志建立监控告警。
- [ ] 将备份复制到独立加密对象存储，并定期完成恢复演练。
- [ ] 为应用发布记录变更摘要、负责人和回滚版本。
- [ ] 在流水线加入浏览器 E2E 冒烟，覆盖登录、搜索和授权写操作。
