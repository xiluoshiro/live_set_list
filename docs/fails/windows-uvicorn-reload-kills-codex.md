# Windows Uvicorn 自动重载中断 Codex 复盘

## 现象

在 Codex 的工具终端中运行 `python scripts/run_dev.py` 后修改后端 Python 文件，当前 Codex 任务突然中断，界面表现为本地代理崩溃并重新连接。

## 根因

`run_dev.py` 以 `uvicorn --reload` 启动后端。Uvicorn 在 Windows 检测到文件变化时，通过 `os.kill(child_pid, signal.CTRL_C_EVENT)` 重启服务进程。在 Codex 工具终端的进程环境中，这个控制台事件可能传播到 Codex CLI。事故日志中的退出码为 `3221225786`，即 Windows `0xC000013A`（Control-C exit）。

文件写入只是触发了 Uvicorn 重载；写文件工具本身不是崩溃源。日志里紧邻退出信息的其他警告也不能代替退出码判断根因。

## 操作规则

- 在 Codex 或其他自动化终端内修改后端文件时，不得保持带 `--reload` 的 Uvicorn 常驻进程。
- 修改前先停止 `python scripts/run_dev.py`；不要依赖现有的 Windows process group 参数隔离 `CTRL_C_EVENT`。
- 自动化接口验证使用不带 `--reload` 的单次 Uvicorn 进程，验证完成后显式停止。
- 只需验证纯函数或外部 API 请求时，优先直接调用目标 Python 代码，不启动开发服务器。

## 诊断依据

事故时间线上，后端文件写入后约两秒 Codex CLI 以 `0xC000013A` 退出；Uvicorn 的 Windows reload 实现正是在变更时发送 `CTRL_C_EVENT`。Windows Application Error 与 Crashpad 均没有对应的原生崩溃记录。
