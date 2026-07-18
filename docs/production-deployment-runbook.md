# LiveSetList 公网部署与自动发布实录

本文档是当前生产环境的操作 runbook。生产架构、安全基线和后续优先级见[生产部署设计](design/production-deployment.md)。不要将真实密码、SSH 私钥、数据库 dump 或 `/etc/livesetlist/*.env` 提交到仓库。

## 当前状态

截至 2026-07-17，以下路径已在生产 VM 上验证：

- Google Compute Engine VM：Debian 12 Bookworm（`debian-12-bookworm-v20260609`）。
- Nginx 托管 `frontend/dist`，同源 `/api/*` 转发至 FastAPI `127.0.0.1:8000`；PostgreSQL Docker 容器仅绑定 `127.0.0.1:15432`。
- 公网域名：`bang.dreamliveevents.com`；生产 OpenAPI 路径返回 `404`。
- 业务数据和管理员来自 PostgreSQL dump，`AUTH_DEFAULT_ADMIN_ENABLED=false`，`auth_sessions` 为空是预期状态。
- `livesetlist-backup.timer` 每天 `03:20` 执行自动备份，根目录为 `/var/backups/livesetlist`。
- GitHub Actions tag 发布已跑通：CI 创建隔离 PostgreSQL、执行 Flyway 和 `functional`、构建发布包并经 `production` Environment 审批后部署到 VM。
- 首个完整成功的自动发布 tag 为 `v2026-07-14-006`。
- 首个 migration release 已完成：生产数据库从 V9 升至 V11，新 release 已切换、后端数据库 health 验收成功。

两阶段 migration 发布代码、VM root-owned 入口、deploy-only sudoers 和 GitHub repository secrets/variables/Environments 已完成配置。仓库已有 `v2026-07-17-001` 至 `v2026-07-17-003`；但 tag 存在不等价于生产 migration 已验收。本文当前可确认的生产记录仍是 V11，仓库最新 migration 是 V13；确认 V12/V13 状态时必须同时核对 Actions、VM release state / attestation 与生产 `flyway info`，再补写执行记录。

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

后端以 `livesetlist` 非 root 用户运行。备份 service 和发布脚本需要调用 Docker / systemd，因此以 root 运行；发布 SSH 用户仅获准 sudo 执行 release manager 的 `prepare` / `migrate` 入口与 `/usr/local/sbin/livesetlist-deploy`。

## 日常自动发布

最短操作路径：

- app-only 和 migration release 都只创建并推送一个 `vYYYY-MM-DD-NNN` tag，不为 migration 再创建第二个 tag。
- tag workflow 自动完成 CI、出包、SHA-256 校验、上传 VM 和服务器侧分类。
- `app-only` 继续自动部署；`migration-needed` 停在 GitHub，维护人先运行一次 `Migration release control` 的 `migrate` / `MIGRATE`，验收后再运行一次 `deploy` / `DEPLOY`。
- 日常发布不需要人工 SSH 登录 VM。本页 VM 命令只用于一次性入口安装、首次验收和故障排查。

### 1. 发布前检查

1. 检查本次是否包含 `backend/db/flyway/sql` 变化；SQL 不变会走 app-only 自动部署，SQL 变化会在 prepare 后停止并进入两阶段 migration。
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
6. `Prepare production candidate` 下载同一 artifact、校验 SHA-256、上传至 VM，并由服务器按 `current` 分类。
7. app-only release 进入 `production` 后调用部署脚本；migration release 不改数据库也不切换应用，只在 Job Summary 给出两阶段 handoff 参数。
8. 应用部署完成后，从 GitHub Runner 对 `PUBLIC_BASE_URL` 检查首页、`/api/health/db` 与 `/openapi.json` 的 `404`。

在 Actions 页面确认 `Verify and package`、`Prepare production candidate` 成功后，app-only release 审阅 tag、commit 和变更内容并批准 `production` 部署；migration release 按本页两阶段流程操作。

### 4. 服务器端部署行为

`/usr/local/sbin/livesetlist-deploy <version> <sha256>` 会：

1. 校验版本格式、归档 SHA-256、归档路径和链接文件。
2. 调用 release manager 校验 prepared 状态；migration release 还必须匹配 root-only attestation、SQL 树 hash 和生产 Flyway version。
3. 先启动一次数据库备份任务。
4. 解压到新的 release 目录，使用当前 release 的 Python 创建 venv 并安装依赖。
5. root 化 release，安装 systemd unit，原子切换 `current`，重启后端与 Nginx。
6. 最多等待 20 秒，直到 `http://127.0.0.1:8000/api/health/db` 成功。
7. 成功后再执行一次备份并把服务器状态标记为 deployed；失败则将 `current` 指回上一 release 并重启后端，schema 不自动回滚。

## GitHub Environment 与 VM 前置条件

GitHub 仓库须有 `production` Environment，并建议增加 `production-migration`：

- Deployment rule：**Tag** 类型的 `v*`，不是 Branch 规则。
- Required reviewer：按维护人配置；单人维护时不要启用 self-review 禁止项。
- Repository secrets：`DEPLOY_SSH_PRIVATE_KEY`、`DEPLOY_KNOWN_HOSTS`；prepare job 不绑定 Environment，因此不能只配置为 Environment secret。
- Repository variables：`DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER=livesetlist-deploy`、`PUBLIC_BASE_URL`。

`DEPLOY_KNOWN_HOSTS` 的第一列必须与 `DEPLOY_HOST` 完全一致。若使用 VM IP，可在 VM 上生成：

```bash
sudo awk '{print "<VM_IP>", $1, $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

GitHub Hosted Runner 使用动态出口 IP。当前直接 SSH 模式要求 GCP 防火墙允许其访问 TCP 22；SSH 必须禁用密码登录和 root 登录，并使用专用部署密钥与受限 sudo。不要把数据库或后端端口开放给公网。

部署 root 脚本不会由自身自动更新。修改 `infra/production/livesetlist-deploy` 或 `release_manager.py` 后，必须先以管理员身份更新 VM 上的入口；完整命令见“VM 启用两阶段入口”。

```bash
sudo install -o root -g root -m 755 \
  /home/livesetlist-deploy/livesetlist-release-manager.next \
  /usr/local/sbin/livesetlist-release-manager
sudo install -o root -g root -m 755 \
  /home/livesetlist-deploy/livesetlist-deploy.next \
  /usr/local/sbin/livesetlist-deploy
```

先通过 `livesetlist-deploy` SSH 用户把两个新脚本上传到该用户自己的 home，再用管理员会话执行上述安装。不要使用固定的 `/tmp/*.next` 路径：`/tmp` 的 sticky bit 会阻止部署用户覆盖由管理员或其他用户留下的同名文件，导致后续升级不可重复执行。

## 数据库迁移与旧手工流程

新版两阶段入口会自动执行备份、Flyway 和 attestation，但 migration 与应用切换仍是两次独立人工触发。以下手工步骤保留为新入口尚未启用时的旧流程和自动 migration 故障时的应急参考。

有 migration 时：

1. 创建生产库手动备份并确认备份文件可被 `pg_restore -l` 读取。
2. 在非生产环境完成 `flyway validate` / `migrate` 与功能验收。
3. 在生产窗口先确认 pending migration，再执行 `migrate`，最后执行 `validate` 和 `info`，记录输出。不要用 Bash `source` 或 `docker compose config --environment` 读取 `/etc/livesetlist/postgres.env`：密码中的 `$`、`!` 等字符会被 shell 或 Compose 插值。应使用 `python-dotenv` 的 `interpolate=False` 读取，并通过 Python 子进程环境将变量传给 Docker。
4. 解压该 release、用其 `sql/` 手工完成 migration，并手工切换该 release 为 `current`；若新版两阶段入口已启用，应优先使用受 attestation 约束的 workflow，不要混用手工切换。
5. 验证数据库 health、读路径、授权写路径和备份。该 release 成为 `current` 后，后续 SQL 不变的版本可恢复自动发布。

不要修改已执行 migration；回滚应用版本不等于回滚数据库。

### 已执行记录：V9 -> V11

本次生产数据库已从 V9 成功迁移至 V11：

- `V10__allow_same_song_name_for_different_bands.sql` 成功将歌曲唯一约束调整为 `(song_name, band_id)`。
- `V11__normalize_empty_other_members.sql` 成功规范化 `live_setlist.other_member` 中的空值。
- 迁移顺序为 `info -> migrate -> validate -> info`；在存在 pending migration 时先执行 `validate` 会被 Flyway 12 拒绝，这是预期行为。
- 服务器 env 中的密码包含 `$` 等字符。Bash `source` 会触发 `unbound variable`，Docker Compose 环境解析会插值并给出变量缺失警告；迁移使用 `python-dotenv(interpolate=False)` 读取后，由 Python 子进程环境把变量传给 Docker。

迁移 release 已完成手工切换，后端数据库 health 通过。后续 SQL 不变的版本可继续使用现有自动发布路径。

## Flyway 变化时的两阶段自动发布

实现入口为 `infra/production/release_manager.py`、`infra/production/livesetlist-deploy`、`.github/workflows/release.yml` 和 `.github/workflows/migration-release.yml`。必须先在 VM 安装新版 root-owned 入口，再合并或启用新 workflow；不能让新 workflow 调用旧服务器脚本。

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
            -> workflow_dispatch(migrate) -> migration attestation
            -> workflow_dispatch(deploy)  -> smoke
```

所有生产阶段使用同一个 `livesetlist-production` concurrency group，禁止两个 release 交叉 prepare、migrate 或 deploy。

### 1. 构建和候选包准备

1. tag CI 完成隔离 PostgreSQL、Flyway migration、`functional`、前端构建、白名单归档和 SHA-256。
2. `prepare-production` 将归档上传到 VM 后调用 root-owned `livesetlist-release-manager prepare <version> <sha256>`。
3. prepare 脚本重复校验 SHA-256、归档根目录、路径穿越和链接文件，将候选包解压到 root-only staging 目录。
4. 脚本比较候选包和 `current` 的完整 Flyway SQL 文件树，输出结构化分类：`app-only` 或 `migration-needed`。分类必须来自服务器比较结果，供后续 job 使用。
5. `app-only` 继续进入现有应用部署；`migration-needed` 不允许直接切换，必须进入 migration 审批门。

### 2. 阶段 A：受保护的 migration

1. tag workflow 检测到 `migration-needed` 后停止，并在 Job Summary 写出 version 与 SHA-256。维护人手动运行 `Migration release control`，选择 `phase=migrate` 并输入确认词 `MIGRATE`。这一步本身就是 GitHub Free 私有仓库可用的显式人工门；支持 Environment reviewer 时还可在 `production-migration` 上增加审批。
2. job 调用 root-owned `livesetlist-release-manager migrate <version> <sha256>`。脚本只接受已经 prepare 且分类为 `migration-needed` 的候选包。
3. 脚本先执行生产备份并用 `pg_restore -l` 验证可读性，记录备份路径和备份文件 SHA-256；备份失败立即停止。
4. Flyway 镜像固定为 `redgate/flyway:12.11.0`。生产 env 由 Python 直接读取且不执行插值，再通过子进程环境传给 Docker/Flyway；密码值不会进入命令行参数或发布包。
5. 执行顺序固定为 `info -> migrate -> validate -> info`，优先使用 Flyway 结构化输出记录迁移前版本、已应用 migration 和最终版本，不解析易变的人类可读文本。
6. 仅在所有步骤成功后写入 `/var/lib/livesetlist/deploy-attestations/<version>.json`，文件必须为 `root:root`、`0600`。至少记录：version、归档 SHA-256、新旧 SQL 树 SHA-256、迁移前后 Flyway version、已应用 migration、执行时间、备份路径与备份 SHA-256。
7. 同一 version 重试时，若已有 attestation，只有 version、归档 SHA-256、SQL 树 SHA-256 和数据库最终版本全部一致才可视为幂等成功；任一项不同都必须停止并人工处理。

阶段 A 完成后仍不更新 `current`。migration 失败时保留 staging、备份和日志，由人工决定修复 migration 还是按恢复 runbook 还原数据库。

### 3. 阶段 B：受 attestation 约束的应用切换

1. migration 验收后再次手动运行 `Migration release control`，选择 `phase=deploy` 并输入确认词 `DEPLOY`。对 `app-only` release 则由 tag workflow 沿用一次 `production` 审批和原子切换流程。
2. 对 `migration-needed` release，扩展后的 `livesetlist-deploy` 必须读取 root-only attestation，并验证 version、归档 SHA-256、SQL 树 SHA-256 全部匹配。
3. 部署脚本再次查询生产 Flyway version，确认不低于 attestation 的最终版本；缺少 attestation、字段不匹配或数据库版本不符时全部 fail closed。
4. 验证通过后才创建 venv、安装依赖、安装 systemd unit、原子切换 `current`，然后执行后端就绪等待、数据库 health、发布后备份和公网 smoke test。
5. 应用启动或 smoke 失败时恢复上一版 `current`，但保留已经迁移的 schema。旧版应用能否继续工作由 expand/contract 兼容要求保证。
6. migration attestation 保持为迁移完成时的不可变证明；发布成功后只把 release state 原子标记为 `deployed`，记录 active release 与切换时间。version 和归档 SHA-256 可用于关联 tag 与 GitHub run。

### 4. 实施拆分与验收

1. `release_manager.py prepare` 校验并解压候选包、按生产 `current` 分类，状态写入 `/var/lib/livesetlist/release-state`。
2. `release_manager.py migrate` 执行备份和固定版本 Flyway，attestation 写入 `/var/lib/livesetlist/deploy-attestations`，文件权限为 root-only。
3. `livesetlist-deploy` 对 app-only 检查 prepared 状态，对 migration 检查 attestation 与生产 Flyway version，任何未知状态均拒绝发布。
4. `.github/workflows/release.yml` 负责 build、prepare 和 app-only 部署；`.github/workflows/migration-release.yml` 用两次 `workflow_dispatch` 分别执行 migration 和应用切换。两个 workflow 共用 `livesetlist-production` concurrency group。
5. 生产启用前仍需在独立 staging 数据库验证 app-only、migration 成功、migration 失败、attestation 篡改、重复执行、应用切换失败六类场景。

完成标准：普通 release 仍只需一次应用审批；migration release 必须经过 migration 人工门、生成可验证 attestation，再经应用切换审批，且任何失败都不会自动执行数据库回滚。

## VM 启用两阶段入口

以下操作必须在包含本次代码的 tag 被推送前完成。生产 release 内的模板不会自动覆盖 `/usr/local/sbin` 下的 root-owned 入口。

### 1. 上传并安装服务器入口

从可信的本地 checkout，以 `livesetlist-deploy` 用户上传两个文件。home 中的暂存文件始终由部署用户持有，因此重复执行 `scp` 可以安全覆盖上一次上传：

```powershell
scp infra/production/release_manager.py livesetlist-deploy@<VM_IP>:/home/livesetlist-deploy/livesetlist-release-manager.next
scp infra/production/livesetlist-deploy livesetlist-deploy@<VM_IP>:/home/livesetlist-deploy/livesetlist-deploy.next
```

如果本机已配置 `livesetlist-vm` SSH 别名，可将上面的 `livesetlist-deploy@<VM_IP>` 直接替换为 `livesetlist-vm`。

在 VM 管理员会话执行：

```bash
sudo install -o root -g root -m 755 \
  /home/livesetlist-deploy/livesetlist-release-manager.next \
  /usr/local/sbin/livesetlist-release-manager
sudo install -o root -g root -m 755 \
  /home/livesetlist-deploy/livesetlist-deploy.next \
  /usr/local/sbin/livesetlist-deploy

sudo install -d -o root -g root -m 700 /opt/livesetlist/staging
sudo install -d -o root -g root -m 700 /var/lib/livesetlist/release-state
sudo install -d -o root -g root -m 700 /var/lib/livesetlist/deploy-attestations
sudo install -d -o root -g root -m 700 /var/lib/livesetlist/release-archives
sudo docker pull redgate/flyway:12.11.0
```

入口验证完成后，由部署用户清理暂存文件：

```powershell
ssh livesetlist-deploy@<VM_IP> "rm -f /home/livesetlist-deploy/livesetlist-release-manager.next /home/livesetlist-deploy/livesetlist-deploy.next"
```

确认 `python3 --version` 至少为 Python 3.11。release manager 不依赖新版 `tarfile.extractall(filter=...)`，而是只手工写出通过白名单校验的普通文件与目录，因此支持 Debian 12 自带 Python。同时确认 `/etc/livesetlist/postgres.env` 至少包含 `POSTGRES_HOST`、`POSTGRES_PORT`、`APP_DB`、`FLYWAY_USER`、`FLYWAY_PASSWORD`；`/etc/livesetlist/backend.env` 应保持 `LIVESETLIST_BACKUP_ROOT=/var/backups/livesetlist`。

### 2. 更新 deploy-only sudoers

使用 `sudo visudo -f /etc/sudoers.d/livesetlist-deploy` 写入：

```sudoers
Cmnd_Alias LIVESETLIST_PREPARE = /usr/local/sbin/livesetlist-release-manager prepare *
Cmnd_Alias LIVESETLIST_MIGRATE = /usr/local/sbin/livesetlist-release-manager migrate *
Cmnd_Alias LIVESETLIST_DEPLOY = /usr/local/sbin/livesetlist-deploy *
livesetlist-deploy ALL=(root) NOPASSWD: LIVESETLIST_PREPARE, LIVESETLIST_MIGRATE, LIVESETLIST_DEPLOY
```

然后检查权限和入口：

```bash
sudo chmod 440 /etc/sudoers.d/livesetlist-deploy
sudo visudo -cf /etc/sudoers.d/livesetlist-deploy
sudo -u livesetlist-deploy sudo -n -l
sudo /usr/local/sbin/livesetlist-release-manager --help
sudo systemctl start livesetlist-backup.service
sudo systemctl status livesetlist-backup.service --no-pager
```

不要为了测试入口而在生产执行伪造的 `migrate` 参数；真正的 manager 命令只由完成 CI 和 SHA-256 校验的 release workflow 调用。

### 3. 调整 GitHub 配置

`prepare-production` 不绑定 Environment，因此 SSH 凭据必须配置为 repository secrets，而不能只存在于 `production` Environment：

- Repository secrets：`DEPLOY_SSH_PRIVATE_KEY`、`DEPLOY_KNOWN_HOSTS`。
- Repository variables：`DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER=livesetlist-deploy`、`PUBLIC_BASE_URL`。
- Environment：保留 `production`；另建 `production-migration`。套餐支持时为两者配置 required reviewer；不支持时，两次独立 `workflow_dispatch` 和确认词仍会阻止普通 tag 自动迁移数据库。

### 4. 首次启用验收顺序

1. **已完成**：VM 入口安装、sudoers 校验、Flyway 镜像预拉取和备份 service 验证。
2. **已完成**：合并并推送 workflow 代码。
3. **已完成**：配置 repository secrets/variables，保留 `production` 并新建 `production-migration` Environment。
4. **已完成 tag 创建**：仓库已有 `v2026-07-17-001` 至 `v2026-07-17-003`。其中 V12 相对本文已确认的生产 V11 属于 migration 变化，应被 prepare 分类为 `migration-needed`；后续包含 V13 的 release 同样必须走 migration 两阶段流程。
5. **仍需按外部状态确认并记录**：在 Actions Summary 核对不带 `v` 的 version、归档 SHA-256、prepare 分类和状态文件；不要仅凭本地 tag 判断部署成功。
6. migration release 手动运行 `Migration release control`：先选 `migrate` / `MIGRATE`；检查备份、Flyway 输出、attestation 和旧应用读写。
7. 验收通过后再次运行同一 workflow：选 `deploy` / `DEPLOY`；完成应用切换和公网 smoke。两次手工阶段始终使用同一 version 和 SHA-256，不再推送 tag。完成后把生产版本与 Flyway version 写回本节和“已执行记录”。

首次验收或故障排查时可选执行的服务器侧检查（不是日常发布的人工步骤）：

```bash
sudo cat /var/lib/livesetlist/release-state/<version>.json
sudo cat /var/lib/livesetlist/deploy-attestations/<version>.json
sudo sha256sum /var/lib/livesetlist/release-archives/livesetlist-<version>.tar.gz
readlink -f /opt/livesetlist/current
curl -f http://127.0.0.1:8000/api/health/db
sudo systemctl status livesetlist-backend livesetlist-backup.timer --no-pager
```

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
| `scp` 上传 `/tmp/livesetlist-*.next` 报 `dest open ... Permission denied` | `/tmp` 有 sticky bit，同名旧文件由管理员或其他用户持有，部署用户不能覆盖 | 将可重复上传的暂存文件固定放在 `/home/livesetlist-deploy`，安装时再由管理员以 `sudo install` 复制到 `/usr/local/sbin` |
| production job 被拒绝 | Environment 将 `v*` 配成 Branch 规则 | 使用 Tag 类型的 `v*` 规则 |
| prepare 解压报 `extractall() got an unexpected keyword argument 'filter'` | VM Python 的 `tarfile` 尚未提供 extraction filter | release manager 改为手工解压已验证的普通文件/目录，保持 Python 3.11 兼容与路径安全校验 |
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
