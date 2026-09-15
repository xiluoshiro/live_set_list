# 远端 SQL 运维账户设计

## 目标与边界

新建独立 SSH 账户 `livesetlist-sql`，用于从受信任的本地工作站上传并执行任意、已人工审查的 SQL。保留 `livesetlist-sync` 的只读备份导出边界，不将任何 SSH 运维账户加入 Docker 组。

该账户对生产业务库具有等同数据库管理员的破坏能力。隔离账户和受限入口提供的是主机权限隔离、目标固定、执行前备份与审计，不会把任意 SQL 本身变成低风险操作。

## 权限模型

- `livesetlist-sql` 可登录 SSH，并只在 `/home/livesetlist-sql/uploads` 下暂存文件。
- 账户没有 Docker socket 权限，也没有通用 sudo。
- sudoers 只允许调用 root 持有的 `/usr/local/sbin/livesetlist-sql-exec check|apply ...`。
- 服务端入口从 `/etc/livesetlist/postgres.env` 读取固定容器、数据库和 PostgreSQL 超级用户，不接受客户端覆盖目标。
- `apply` 只接受专用上传目录中的普通文件，拒绝符号链接、非该账户所有、组或其他用户可写、超过 64 MiB、SHA-256 不匹配的文件。
- 文件只打开一次并在同一文件描述符上校验和读取，避免校验后替换；内容以内存 stdin 交给 `docker exec ... psql`。
- 只允许 SQL 语句，拒绝首个非空白字符为反斜杠的 `psql` 元命令，避免借助 `\!` 等客户端命令越过固定数据库入口。
- 执行前必须成功运行 `livesetlist-backup.service`。`psql` 使用 `ON_ERROR_STOP=1`，但 SQL 自身未包事务时，失败前已提交的语句不会自动回滚。
- `/var/log/livesetlist/sql-operator.log` 记录 UTC 时间、sudo 调用者、操作、SQL 哈希和结果，不记录 SQL 内容。

## VM 初始化

以下命令需要 VM 管理员执行一次；先把仓库中的入口上传到管理员可读位置：

```bash
sudo adduser --disabled-password --gecos '' livesetlist-sql
sudo install -d -o livesetlist-sql -g livesetlist-sql -m 700 /home/livesetlist-sql/.ssh
sudo install -d -o livesetlist-sql -g livesetlist-sql -m 700 /home/livesetlist-sql/uploads
sudo install -o root -g root -m 755 infra/production/livesetlist_sql_exec.py /usr/local/sbin/livesetlist-sql-exec
```

将专用公钥写入 `/home/livesetlist-sql/.ssh/authorized_keys`，文件权限设为 `600`。建议在 key options 或 `sshd_config` 的 `Match User livesetlist-sql` 中禁用 agent、端口和 X11 转发。

使用 `sudo visudo -f /etc/sudoers.d/livesetlist-sql` 写入：

```sudoers
Cmnd_Alias LIVESETLIST_SQL_CHECK = /usr/local/sbin/livesetlist-sql-exec check
Cmnd_Alias LIVESETLIST_SQL_APPLY = /usr/local/sbin/livesetlist-sql-exec apply *
livesetlist-sql ALL=(root) NOPASSWD: LIVESETLIST_SQL_CHECK, LIVESETLIST_SQL_APPLY
```

然后验证：

```bash
sudo chmod 440 /etc/sudoers.d/livesetlist-sql
sudo visudo -cf /etc/sudoers.d/livesetlist-sql
sudo -u livesetlist-sql sudo -n -l
sudo -u livesetlist-sql sudo -n /usr/local/sbin/livesetlist-sql-exec check
```

本机 SSH 配置应使用新的 `livesetlist-sql` 别名。预检与正式执行分别为：

```powershell
python scripts/apply_remote_sql.py path/to/change.sql --ssh-host livesetlist-sql --precheck
python scripts/apply_remote_sql.py path/to/change.sql --ssh-host livesetlist-sql --force
```

## 撤销

先移除 `/etc/sudoers.d/livesetlist-sql`，再锁定账户和移除 authorized key。保留审计日志与执行前备份，不要为了清理账户删除它们。
