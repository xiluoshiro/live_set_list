# Recovery Notes

本目录存放数据库备份与恢复脚本的核心逻辑，以及对应的 mock/命令契约测试。

当前模块分工：

- `common.py`：共享路径、环境文件读取、命令执行封装
- `backup.py`：备份路径、保留策略、dump 校验与备份生成
- `docker_ops.py`：容器、volume、候选容器切换与回滚
- `restore.py`：Flyway、测试库恢复、主库 `pg_restore` 与权限回灌
- `core.py`：命令入口解析与主流程编排

## 命令入口

项目根目录下的统一入口仍然是：

```powershell
python scripts/recovery_db.py <arguments> [--force]
```

当前支持：

- `test`：在当前正式容器内重建测试库结构并重新导入 seed
- `backup-app-auto`：立即生成一份主库自动备份，保留最近 5 份
- `backup-app-manual`：立即生成一份主库手动备份，保留最近 3 份
- `recovery`：从最近一份主库备份恢复业务库，恢复前会先生成一份恢复流程专用临时快照，再走候选容器验证与回滚

`--force` 的作用：

- 对 `test` 和 `recovery` 这类会修改数据库状态的操作做显式确认
- 不带 `--force` 时，脚本只会提示并退出，不会真正执行恢复动作

## 备份目录

主库备份目录当前固定为：

- `C:\Users\xiluo\OneDrive - stu.jiangnan.edu.cn\Backup\live-set-list-docker`

其中：

- 自动备份：`app/auto`
- 手动备份：`app/manual`
- 恢复流程临时快照：`app/recovery-snapshot`

说明：

- `recovery-snapshot` 只用于单次恢复流程保留“恢复前最后状态”
- 这类快照不参与“最近备份”选择，也不计入自动/手动备份的保留策略
- 恢复成功或失败后，脚本都会尝试清理这次生成的临时快照

## 主库恢复流程

`recovery` 的完整流程如下：

1. 读取自动备份和手动备份，选择最近一份作为恢复源
2. 弹出确认提示
3. 对当前主库生成一份恢复流程专用临时快照
4. 将当前正式容器重命名为备份容器，并用候选 volume 拉起新容器
5. 在候选容器中用 `pg_restore` 恢复主库
6. 对主库执行 `flyway info + validate`，如果存在 `Pending` 再执行 `migrate`
7. 在候选容器中重建测试库并重新导入 seed
8. 跑 `python scripts/run_checks.py all`
9. 如果检查通过：
   - 脚本会暂停，等待人工确认候选容器状态
10. 人工确认后：
   - 将候选 volume 的数据复制回固定正式 volume 名并重新拉起正式容器
11. 如果检查失败，或人工确认阶段取消：
   - 删除候选容器和候选 volume
   - 将旧容器改名并启动回来
   - 删除这次恢复生成的临时快照

## 测试覆盖思路

当前优先做两层看护：

1. mock 单元测试
   - 看护路径生成、备份选择、保留策略、参数分发等纯 Python 逻辑
2. 命令契约测试
   - 看护候选容器流程、external volume 创建、回滚分支、快照清理等命令编排

相关测试位于：

- `recovery/tests`
