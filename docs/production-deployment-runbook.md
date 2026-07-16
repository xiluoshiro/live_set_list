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
- 首个 migration release 已完成：生产数据库从 V9 升至 V11，新 release 已切换、后端数据库 health 验收成功。

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
3. 在生产窗口先确认 pending migration，再执行 `migrate`，最后执行 `validate` 和 `info`，记录输出。不要用 Bash `source` 或 `docker compose config --environment` 读取 `/etc/livesetlist/postgres.env`：密码中的 `$`、`!` 等字符会被 shell 或 Compose 插值。应使用 `python-dotenv` 的 `interpolate=False` 读取，并通过 Python 子进程环境将变量传给 Docker。
4. 解压该 release、用其 `sql/` 手工完成 migration，并手工切换该 release 为 `current`；不能调用当前自动部署脚本，因为它会拒绝 SQL 文件差异。
5. 验证数据库 health、读路径、授权写路径和备份。该 release 成为 `current` 后，后续 SQL 不变的版本可恢复自动发布。

不要修改已执行 migration；回滚应用版本不等于回滚数据库。

### 已执行记录：V9 -> V11

本次生产数据库已从 V9 成功迁移至 V11：

- `V10__allow_same_song_name_for_different_bands.sql` 成功将歌曲唯一约束调整为 `(song_name, band_id)`。
- `V11__normalize_empty_other_members.sql` 成功规范化 `live_setlist.other_member` 中的空值。
- 迁移顺序为 `info -> migrate -> validate -> info`；在存在 pending migration 时先执行 `validate` 会被 Flyway 12 拒绝，这是预期行为。
- 服务器 env 中的密码包含 `$` 等字符。Bash `source` 会触发 `unbound variable`，Docker Compose 环境解析会插值并给出变量缺失警告；迁移使用 `python-dotenv(interpolate=False)` 读取后，由 Python 子进程环境把变量传给 Docker。

迁移 release 已完成手工切换，后端数据库 health 通过。后续 SQL 不变的版本可继续使用现有自动发布路径。

## 后续方案：Flyway 变化时的两阶段自动发布

本节是实施方案，当前代码尚未实现。现有自动发布继续拒绝 SQL 差异，直到以下服务器端脚本、审批门和 attestation 校验全部落地；不能先删除现有拒绝逻辑再逐步补安全措施。

### 设计原则

1. 以生产 VM 的 `/opt/livesetlist/current/backend/db/flyway/sql` 为比较基准，不使用“上一个 Git tag”推断生产状态。生产可能跳过版本、手工回滚或发生迁移 release 手工切换，Git 历史不能替代服务器事实。
2. 同一个 tag 只构建一次归档。分类、迁移和应用切换始终使用同一 version 与 SHA-256，不在 VM 重新构建。
3. 数据库凭据只保留在 `/etc/livesetlist`。GitHub 只持有受限 SSH 凭据，不读取生产数据库密码。
4. migration 先执行、应用后切换，因此 migration 必须遵守 expand/contract：迁移完成后旧应用仍应可运行。删除列、改名或收紧约束等破坏性变更必须拆到后续 contract release。
5. migration 失败绝不自动恢复数据库；应用切换失败只回滚 `current` 符号链接，不回滚 schema。

### 流水线状态机

```text
build-and-verify
  -> prepare-production
       -> app-only -------> deploy-production -> smoke
       -> migration-needed
            -> migrate-production -> migration attestation
            -> deploy-production  -> smoke
```

所有生产阶段使用同一个 `livesetlist-production` concurrency group，禁止两个 release 交叉 prepare、migrate 或 deploy。

### 1. 构建和候选包准备

1. tag CI 完成隔离 PostgreSQL、Flyway migration、`functional`、前端构建、白名单归档和 SHA-256。
2. `prepare-production` 将归档上传到 VM 后调用 root-owned `livesetlist-prepare-release <version> <sha256>`。
3. prepare 脚本重复校验 SHA-256、归档根目录、路径穿越和链接文件，将候选包解压到 root-only staging 目录。
4. 脚本比较候选包和 `current` 的完整 Flyway SQL 文件树，输出结构化分类：`app-only` 或 `migration-needed`。分类必须来自服务器比较结果，供后续 job 使用。
5. `app-only` 继续进入现有应用部署；`migration-needed` 不允许直接切换，必须进入 migration 审批门。

### 2. 阶段 A：受保护的 migration

1. `migrate-production` job 绑定独立的 `production-migration` Environment，并要求与普通应用发布分离的人工确认。若当前 GitHub 套餐不支持私有仓库所需的 Environment reviewer，则用带 version、SHA-256 输入的 `workflow_dispatch` 作为显式人工门，凭据使用 repository secrets；普通 tag 不得直接执行生产 migration。
2. job 调用 root-owned `livesetlist-migrate <version> <sha256>`。脚本只接受已经 prepare 且分类为 `migration-needed` 的候选包。
3. 脚本先执行生产备份并用 `pg_restore -l` 验证可读性，记录备份路径和备份文件 SHA-256；备份失败立即停止。
4. Flyway 镜像固定到明确版本或 digest，不能继续使用 `redgate/flyway:latest`。生产 env 由 Python 使用 `python-dotenv(interpolate=False)` 读取，再通过子进程环境传给 Docker/Flyway。
5. 执行顺序固定为 `info -> migrate -> validate -> info`，优先使用 Flyway 结构化输出记录迁移前版本、已应用 migration 和最终版本，不解析易变的人类可读文本。
6. 仅在所有步骤成功后写入 `/var/lib/livesetlist/deploy-attestations/<version>.json`，文件必须为 `root:root`、`0600`。至少记录：version、归档 SHA-256、新旧 SQL 树 SHA-256、迁移前后 Flyway version、已应用 migration、执行时间、备份路径与备份 SHA-256。
7. 同一 version 重试时，若已有 attestation，只有 version、归档 SHA-256、SQL 树 SHA-256 和数据库最终版本全部一致才可视为幂等成功；任一项不同都必须停止并人工处理。

阶段 A 完成后仍不更新 `current`。migration 失败时保留 staging、备份和日志，由人工决定修复 migration 还是按恢复 runbook 还原数据库。

### 3. 阶段 B：受 attestation 约束的应用切换

1. `deploy-production` 保留独立人工审批。对 `app-only` release 沿用当前备份与原子切换流程。
2. 对 `migration-needed` release，扩展后的 `livesetlist-deploy` 必须读取 root-only attestation，并验证 version、归档 SHA-256、SQL 树 SHA-256 全部匹配。
3. 部署脚本再次查询生产 Flyway version，确认不低于 attestation 的最终版本；缺少 attestation、字段不匹配或数据库版本不符时全部 fail closed。
4. 验证通过后才创建 venv、安装依赖、安装 systemd unit、原子切换 `current`，然后执行后端就绪等待、数据库 health、发布后备份和公网 smoke test。
5. 应用启动或 smoke 失败时恢复上一版 `current`，但保留已经迁移的 schema。旧版应用能否继续工作由 expand/contract 兼容要求保证。
6. 发布成功后把 attestation 标记为 `deployed`，记录切换前后 release、Git commit/tag 和 GitHub run id，形成服务器端部署审计。

### 4. 实施拆分与验收

1. 新增 `infra/production/livesetlist-prepare-release` 和 `infra/production/livesetlist-migrate`，并将其作为 root-owned 固定入口安装到 `/usr/local/sbin`；release 内的模板不能自动覆盖已安装入口。
2. 扩展 `infra/production/livesetlist-deploy`：保留 app-only SQL 相同路径，新增 attestation 校验路径，任何未知状态均拒绝发布。
3. 扩展 `.github/workflows/release.yml`：增加 prepare 分类输出、migration 条件 job、统一 concurrency，以及 GitHub 套餐不支持 Environment reviewer 时的 `workflow_dispatch` 入口。
4. 先在独立 staging 数据库验证 app-only、migration 成功、migration 失败、attestation 篡改、重复执行、应用切换失败六类场景。
5. 生产启用前固定 Flyway 版本，完成备份恢复演练，并确认现有应用能在迁移后 schema 上继续运行。

完成标准：普通 release 仍只需一次应用审批；migration release 必须经过 migration 人工门、生成可验证 attestation，再经应用切换审批，且任何失败都不会自动执行数据库回滚。

## 首次环境与数据迁移要点

首次部署使用白名单发布包和 PostgreSQL dump，而不是上传整个工作区。发布包不含 `.git`、`.venv`、`node_modules`、真实 env、`backend/db/flyway/flyway.toml`、`recovery/.runtime`、日志或 dump。

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
| 发布包包含本机 Flyway 配置或恢复沙箱 | 出包脚本递归收集白名单目录时未排除被 Git 忽略的 runtime 文件 | 显式排除 `flyway.toml`、运行时 env 和 `.runtime`，并用归档级测试校验 |
| SHA-256 校验找不到归档 | 校验文件记录了构建机的 `dist-release/` 路径 | 在 `dist-release` 内生成校验文件，只记录文件名 |
| production job 被拒绝 | Environment 将 `v*` 配成 Branch 规则 | 使用 Tag 类型的 `v*` 规则 |
| Flyway 命令读取 env 报 `unbound variable` 或 Compose 提示变量未设置 | 用 Bash `source` 或 Compose 读取含 `$` 的密码 | 用 `python-dotenv(interpolate=False)` 读取并由 Python 将变量传给 Docker |
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
