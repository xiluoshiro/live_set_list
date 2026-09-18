# 本地一键启动因 npm 路径失败回溯（2026-09-16）

## 现象与影响

在 Windows 上执行 `python scripts/run_dev.py`，脚本启动 Uvicorn 后，创建前端进程时抛出 `FileNotFoundError: [WinError 2]`。前端 `Popen` 位于清理逻辑之外，异常后后端继续占用 8000 端口。

## 直接原因与形成过程

- 本机 PATH 中 `where.exe npm` 只找到 `npm.exe`，`where.exe npm.cmd` 找不到文件。旧版 [`scripts/run_dev.py`](../../scripts/run_dev.py) 在 Windows 上固定传 `npm.cmd` 给 `subprocess.Popen`，而不是解析当前环境中的真实可执行文件。
- 检查脚本通过 `shutil.which("npm")` 解析 npm，而旧启动脚本固定使用 `npm.cmd`；两个入口采用不同策略，检查入口的测试无法覆盖启动入口。
- 旧版 `run_dev.py` 先创建后端进程、再创建前端进程，只有两个进程都成功创建后才进入 `try`／`except KeyboardInterrupt`。前端 `Popen` 抛异常时，不会走关闭后端的分支，形成残留进程。

## 为什么现有检查没拦住

1. 故障发生时，`python scripts/run_checks.py functional` 对 `scripts/*.py` 只运行 AST 语法解析；前端 typecheck／Vitest 由检查脚本自己的 npm 解析逻辑启动，后端测试也不会调用一键启动脚本。它通过只证明各自的测试入口可运行，不证明 `python scripts/run_dev.py` 能拉起两个服务。
2. 故障前已有的“仅有 `npm.exe`”测试位于 [`test_run_checks.py`](../../scripts/tests/test_run_checks.py)，只断言检查脚本的前端命令；当时没有对应的 `run_dev.py` 启动命令或进程清理测试。
3. 数据库迁移检查未覆盖一键启动与 Vite 代理。即使数据库连接正常，启动脚本仍可能失败，必须独立覆盖服务启动入口。

功能测试与开发服务启动是不同入口；服务启动冒烟应等待前后端就绪并检查 Vite API 代理。

## 修复机制

- [`run_dev.py`](../../scripts/run_dev.py) 现在启动后端之前用 `shutil.which("npm")` 解析前端命令；找不到 npm 时提前报错，不留下后端。前端进程创建失败时也会关闭已启动的后端。
- 新增 [`test_run_dev.py`](../../scripts/tests/test_run_dev.py)，看护仅有 `npm.exe`、npm 缺失时不启动后端、前端创建失败时清理后端三种情况。

## 尚待补齐的防复发门禁

- [ ] 为一键启动增加自动化进程级冒烟：使用测试库与隔离端口，等待前后端就绪，访问前端页面、后端健康接口和 Vite API 代理，并在成功、失败、超时时都清理本次进程。不能占用或清理开发者已有的 8000／5173 服务。
- [ ] 将“实际启动并完成 HTTP 冒烟”纳入本地数据库迁移后、以及一键启动脚本变更后的交付验收；如果环境不允许启动，应明确报告未验证，而非用 Flyway／functional 成功替代。
- [ ] 统一开发启动、功能检查和发布构建的 npm 解析策略。[`scripts/build_release.py`](../../scripts/build_release.py) 目前也在 Windows 上写死 `npm.cmd`，在相同 PATH 条件下有同类风险。

结论：直接故障是旧的 Windows npm 可执行文件假设；漏检则来自测试入口与用户实际启动入口分离，以及迁移后没有做服务级冒烟。修复了已发生的启动失败，但自动化启动冒烟门禁仍未完成。
