# 本地一键启动因 npm 路径失败回溯（2026-09-16）

## 现象与影响

本机将 `live_statistic_test` 和 `live_statistic` 核对／迁移至 Flyway V35 后，用户执行 `python scripts/run_dev.py`。脚本先启动 Uvicorn，随后在创建前端进程时抛出 `FileNotFoundError: [WinError 2]`。前端没有启动；原脚本的前端 `Popen` 位于清理逻辑之外，导致已经启动的后端继续占用 8000 端口。此次失败发生在本地开发服务启动阶段，不是 V33—V35 SQL 执行失败；主库迁移后的 `flyway validate`、所有权契约和应用只读连接均已通过。没有执行远程迁移。

## 直接原因与形成过程

- 本机 PATH 中 `where.exe npm` 只找到 `npm.exe`，`where.exe npm.cmd` 找不到文件。旧版 [`scripts/run_dev.py`](../../scripts/run_dev.py) 在 Windows 上固定传 `npm.cmd` 给 `subprocess.Popen`，而不是解析当前环境中的真实可执行文件。
- 这行硬编码可由 `git blame HEAD` 追溯到 2026-03-29 的 `84fc38f`（一键启动脚本），不是本次数据库迁移新增的回归。当前 npm 安装／PATH 何时变为仅提供 `npm.exe`，没有足够证据确定。
- 2026-09-13 的 `fb84414` 已把 [`scripts/run_checks.py`](../../scripts/run_checks.py) 的 npm 命令改成 `shutil.which("npm")`，并增加“仅有 `npm.exe`”的单元测试；同一修正没有覆盖 `run_dev.py`。两个入口因此使用不同的可执行文件选择策略。
- 旧版 `run_dev.py` 先创建后端进程、再创建前端进程，只有两个进程都成功创建后才进入 `try`／`except KeyboardInterrupt`。前端 `Popen` 抛异常时，不会走关闭后端的分支，形成残留进程。

## 为什么现有检查没拦住

1. `python scripts/run_checks.py functional` 对 `scripts/*.py` 只运行 AST 语法解析；前端 typecheck／Vitest 由检查脚本自己的 npm 解析逻辑启动，后端测试也不会调用一键启动脚本。它通过只证明各自的测试入口可运行，不证明 `python scripts/run_dev.py` 能拉起两个服务。
2. 故障前已有的“仅有 `npm.exe`”测试位于 [`test_run_checks.py`](../../backend/tests/unit/test_run_checks.py)，只断言检查脚本的前端命令；当时没有对应的 `run_dev.py` 启动命令或进程清理测试。
3. 本轮本地迁移验收停在 Flyway、所有权、行数和应用账号直连。发现本地 HTTP 服务未运行后，我将健康接口记为“未验证”，却没有补做一键启动与 Vite 代理冒烟。这是交付验收遗漏；即使数据库本身正常，用户依照文档启动项目仍会失败。

因此，用户所说“有个冒烟测试就不该漏掉”是准确的：在当前 Windows/npm 环境里，实际运行一次 `run_dev.py` 并等待前后端就绪，即会暴露 `WinError 2`。不能把一次 `functional` 通过表述为开发服务启动通过。

## 已修复与已验证

- [`run_dev.py`](../../scripts/run_dev.py) 现在启动后端之前用 `shutil.which("npm")` 解析前端命令；找不到 npm 时提前报错，不留下后端。前端进程创建失败时也会关闭已启动的后端。
- 新增 [`test_run_dev.py`](../../backend/tests/unit/test_run_dev.py)，看护仅有 `npm.exe`、npm 缺失时不启动后端、前端创建失败时清理后端三种情况。
- 2026-09-16 实际运行修复后的 `python scripts/run_dev.py`：Uvicorn 与 Vite 均启动；后端 `/api/health/db`、`http://localhost:5173/` 和 Vite 代理的 `/api/health/db` 均返回 200；验证后关闭本次进程。随后 `python scripts/run_checks.py functional` 以退出码 0 结束：mypy 96 个源文件通过，前端 42 个文件共 432 项、恢复单元／契约 25 项及后端测试通过。

## 尚待补齐的防复发门禁

- [ ] 为一键启动增加自动化进程级冒烟：使用测试库与隔离端口，等待前后端就绪，访问前端页面、后端健康接口和 Vite API 代理，并在成功、失败、超时时都清理本次进程。不能占用或清理开发者已有的 8000／5173 服务。
- [ ] 将“实际启动并完成 HTTP 冒烟”纳入本地数据库迁移后、以及一键启动脚本变更后的交付验收；如果环境不允许启动，应明确报告未验证，而非用 Flyway／functional 成功替代。
- [ ] 统一开发启动、功能检查和发布构建的 npm 解析策略。[`scripts/build_release.py`](../../scripts/build_release.py) 目前也在 Windows 上写死 `npm.cmd`，在相同 PATH 条件下有同类风险；本次没有修改或实际验证发布构建。

结论：直接故障是旧的 Windows npm 可执行文件假设；漏检则来自测试入口与用户实际启动入口分离，以及迁移后没有做服务级冒烟。修复了已发生的启动失败，但自动化启动冒烟门禁仍未完成。
