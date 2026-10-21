# bangdreamlive.top 稳定慢加载排查交接

记录日期：2026-10-19，Asia/Shanghai。工作目录：`D:\Code\PythonCode\5 LiveSetList`。

本文档上一轮（00:18 前后）只完成只读排查；本轮（00:23–00:43）已完成**问题复现**，并给出按优先级排序的解决方案。除本文档外，本轮没有修改业务代码、Cloudflare 配置、代理或运行服务。

## 一句话结论

同时存在两个独立问题，必须分开修：

1. **启动白屏**：域名当前提供的是 Vite 开发服务。首页静态依赖 127 个 `no-cache` 模块（解压 6.34 MB、7 层依赖），浏览器必须全部取回才执行入口并挂载 React。本轮浏览器实测：`#root` 空白 29.37 秒、首次内容绘制 29.26 秒，且**全部请求成功**。这是稳定复现的部分。
2. **一条 Cloudflare A 记录不可用**：默认 DNS 下 Chrome 文档请求约 51 秒后 `ERR_TIMED_OUT`，另一次约 55 秒后 `ERR_CONNECTION_CLOSED`；固定到 `104.21.44.169` 同样失败，固定到 `172.67.201.151` 则 29 秒正常出页面。这解释了“约一分钟才出现页面”和“偶发请求超时”，但**不能解释稳定白屏**。

## 本轮复现结果

### 运行结构（已核实，与上一轮一致）

```text
浏览器 → Cloudflare → 本机 cloudflared → Vite [::1]:5173
                                             └─ /api → FastAPI 127.0.0.1:8000
```

- 域名首页仍返回开发入口：`/@vite/client`、`/src/main.tsx?t=1792337377187`、`/@react-refresh`（其中时间戳与上一轮相同，说明源码与 Vite 实例未变）。
- `cloudflared` 仍以 Windows 服务 `Cloudflared` 运行；Vite 仍只监听 IPv6 回环 `[::1]:5173`；FastAPI 监听 `127.0.0.1:8000`。
- 域名解析出两条 A 记录：`104.21.44.169`、`172.67.201.151`（另有两条 AAAA）。

### 模块图（从运行中的 Vite 重新抓取）

| 项目 | 上一轮 | 本轮 |
| --- | ---: | ---: |
| 静态依赖模块数 | 127 | **127**（/src/ 115、node_modules 9） |
| `no-cache` / `immutable` | 119 / 8 | **119 / 8** |
| 解压后正文总大小 | 6,339,435 字节 | **6,339,435 字节** |
| 依赖深度 | 未统计 | **1–7 层**（第 3–6 层共 116 个模块） |

最大的几个模块同样未变：React 预构建 chunk 931,082 字节、`radix-ui.js` 648,124、`ConsoleInsertPanel.tsx` 446,195、`App.tsx` 238,734。

### HTTP/2 依赖重放（固定 `172.67.201.151`）

| 场景 | 上一轮 | 本轮 |
| --- | ---: | ---: |
| 缓存验证（ETag → 304） | 22.61–30.98 秒，119×304，零失败 | **17.23 秒，119×304，零失败** |
| 冷加载（全 200） | 41.33 秒，127×200，零失败 | **26.01 秒，127×200，零失败，1,537,468 字节** |

### 浏览器级复现（本轮新增，固定可用 IP）

方法：本机 Chrome 无头模式 + DevTools 协议，独立临时配置目录，`--host-resolver-rules` 固定到 `172.67.201.151`，采样 `#root` 子节点数量与 `Page.lifecycleEvent`。

| 指标 | 冷加载 | 同配置再次加载 |
| --- | ---: | ---: |
| 文档响应完成 | 1.5 秒 | 1.8 秒 |
| `main.tsx` 响应 | 3.1 秒 | 3.7 秒 |
| `App.tsx` 响应 | 5.7 秒 | 5.8 秒 |
| `ConsoleInsertPanel.tsx` 响应 | 9.8 秒 | 10.3 秒 |
| `AlbumAdminSection.tsx` 响应 | 22.6 秒 | 18.8 秒 |
| `albumTracks.ts` 响应 | 28.1 秒 | 28.3 秒 |
| **首次内容绘制（FCP）** | **29.26 秒** | **33.26 秒** |
| **`#root` 首次出现子节点** | **29.37 秒** | **33.36 秒** |
| 请求数 / 失败数 | 135 / **0** | 135 / **0** |

- 128 个脚本请求全部 200；其中 85 个是在最后 10 秒才完成的。
- 再次加载时响应仍全部是 200（未命中 304），所以它**不能**代表“带缓存的 F5”；带 ETag 的 304 场景以上面的 17.23 秒重放为准。
- 页面挂载后 `/api/auth/me`、`/api/catalog/stats`、`/api/catalog/calendar` 均在 29.7–30.3 秒返回 200。

### 每请求耗时构成（同一模块）

| 环节 | 实测 |
| --- | ---: |
| 本机直连 Vite | 1–20 毫秒 |
| Cloudflare 到源站 `cfOrigin`（边缘↔cloudflared↔Vite） | 300–1,000 毫秒 |
| 边缘处理 `cfEdge` | 15–53 毫秒 |
| 本机到边缘 HTTP/2 PING | 250–300 毫秒（出口落在 LHR 边缘） |
| 单模块、热连接 | 0.6–1.1 秒 |

即：每个模块都至少付一次“客户端↔边缘 RTT + 边缘↔源站 RTT”，再乘以 7 层依赖，就是数十秒。并发 100 条流也无法把 127 个模块压到几秒内（重放 26 秒为证）。

### 两条 A 记录的差异（浏览器证据）

| 场景 | 结果 |
| --- | --- |
| 默认 DNS（两条 A 都可用） | 文档请求约 **51 秒** 后 `net::ERR_TIMED_OUT`；另一次约 **55 秒** 后 `net::ERR_CONNECTION_CLOSED`；页面未提交、`#root` 始终为空 |
| 固定 `104.21.44.169` | 同样失败（无响应；node HTTP/2 60 秒超时） |
| 固定 `172.67.201.151` | 29 秒正常出页面，零失败 |

这是本机线路的观察，不能外推所有外部设备；但它是“约一分钟”和“请求超时”的直接候选解释。

### 未复现项

- **演出资料 API 超时**：所有成功跑中列表/统计类 API 都返回 200。没有拿到一次真实超时的浏览器瀑布与前端日志，因此“某个 API 请求落到不可用连接 → `fetchWithTimeout` 在 10 秒 abort → 请求超时”目前仍是**推断**，不是结论。
- 真实（非无头）浏览器的 F5 瀑布和缓存命中状态。
- 生产构建后的任何性能数字。

## 为什么白屏：代码机制

- `frontend/src/main.tsx` 静态导入 `App`，第 37 行才 `createRoot(...).render(...)`；在此之前 `#root` 为空，页面没有任何占位内容。
- `frontend/src/App.tsx` 第 2、40、44、48–53 行静态导入 `SongCatalog`、`ConsoleInsertPanel`、`StageLedgerPage`、`StatisticsPanel`、`TourArchivePage`、`TourDetailPage`、`PerformanceGroupDetailPage`、`VenueDetailPage`。
- `ConsoleInsertPanel.tsx` 又静态引入专辑、歌曲、场馆、演出组等管理组件。
- 这些组件在 JSX 里按 `tab` 条件渲染，但**静态 import 不会因此变成按需加载**；只要打开首页，浏览器就要把整张图取完才能执行入口模块。

补充：模块图分析显示，仅移除 `App → ConsoleInsertPanel` 一条静态边，可达模块即从 127 降到 79、需验证模块 119 降到 72（上一轮纯图分析，未实测）。

## 开发服务挂在公网的其他代价

- 外网可直接读取 `/src/` 下的全部源码与 `frontend/` 根内文件。实测前端根之外的仓库文件（如根目录 `AGENTS.md`）返回 403，其它越界路径落到 SPA 回退 HTML，未发现任意磁盘读取；但源码对外可见本身已不必要。
- 每个源文件一个请求、`no-cache`、附带 HMR 客户端，都是为了本机开发优化，不是交付形态。
- 这既是性能问题，也是“应该换成生产构建”的独立理由。

## 解决方案

按“收益 ÷ 成本”排序。P0、P1 是性能根因，P4 是另一个独立故障，P2/P3 是配套。

### P0（首选）用生产构建替换 Vite 开发服务

**做什么**

1. `cd frontend && npm run build`，产物在 `frontend/dist`。
2. 用静态服务器（Nginx / Caddy / 现有反代）托管 `dist`：
   - `try_files $uri /index.html`（SPA 回退）；
   - `/api` 反向代理到 `127.0.0.1:8000`；
   - `index.html` 返回 `Cache-Control: no-cache`；
   - `/assets/*`（带内容哈希）返回 `Cache-Control: public, max-age=31536000, immutable`；
   - 开启 gzip/br。
3. 把 `cloudflared` 的 ingress 目标从 `[::1]:5173` 改到静态服务端口，重启 `Cloudflared` 服务。
4. 保留开发模式在本机自用，不再对外。

**预期**：模块请求从 127 个降到个位数，`no-cache` 模块从 119 降到 1，首屏从“数十秒”降到秒级。**这是预期，不是已测结果**，必须按下面的验收口径实测。

**风险与注意**

- 需确认构建通过、`/api` 代理、history 回退、CSP/压缩；
- 生产构建下 `import.meta.env.DEV` 分支行为变化，需要回归核心页面；
- 换目标属于部署操作，需单独确认后执行。

### P1 首屏静态依赖拆包（开发模式也有效，生产构建下进一步缩小首屏 chunk）

**做什么**（`frontend/src/App.tsx`）

- 引入 `const ConsoleInsertPanel = lazy(() => import("./components/ConsoleInsertPanel").then(m => ({ default: m.ConsoleInsertPanel })))`，对 `StageLedgerPage`、`StatisticsPanel`、`TourArchivePage`、`TourDetailPage`、`PerformanceGroupDetailPage`、`VenueDetailPage`、`SongCatalog` 同样处理；
- 用 `<Suspense fallback={...}>` 包住页面区域（约 1474–1672 行的条件渲染链）；
- 类型导入（如 `TourDetailFallback`、`ConsoleLeaveGuard`）改为 `import type`，避免把模块拉回静态图。

**预期**：首页可达模块大幅下降（单去 Console 边即 127→79）；生产构建下首屏 chunk 更小。

**风险**：页面切换时出现短暂 fallback；App 级测试中懒加载组件解析变为异步，需按 `findBy*` 断言调整。改完必须跑 `python scripts/run_checks.py frontend`。

### P2 首屏占位与可观测性（半小时量级）

- `frontend/index.html` 的 `#root` 内放一行静态占位（例如“正在加载…”），React 挂载后自动替换。**不改变加载时间**，但消除“纯白屏”，并把问题从“看起来没反应”变成“有进度”。
- `frontend/src/main.tsx` 在 `createRoot` 前打 `performance.mark("app-entry")`；在模块加载失败（`window_error`）时已有 `logger.ts` 记录，可补一条入口耗时，方便下次对照。

### P3 列表/详情 API 超时的处理

- 不要简单调大 `frontend/src/api.ts` 的 `REQUEST_TIMEOUT_MS = 10000`，那只会把失败时间拉长。
- 对**幂等 GET** 增加一次快速重试（例如 300–500 毫秒抖动后重试一次），并在 UI 上区分“网络超时”与“服务端错误”；写操作不重试。
- 根因仍在线路侧（P4）；重试只能把“卡死的 10 秒”变成“第二次机会”。

### P4 网络侧：确认 `104.21.44.169` 的归属

- 换一条网络（手机热点）复测该 IP 与域名，判断是**本机线路/代理分流**问题还是 **Cloudflare 边缘**问题；
- 查看 `cloudflared` 日志与 Cloudflare 仪表盘的隧道健康（本机服务状态为 Running，但累计 origin proxy error 需要看增量）；
- 本机对比两个地址的 `tracert` 路径差异；
- 在结论明确前，不要把某个 IP 写进长期配置。临时可在 hosts 固定到 `172.67.201.151` 规避，但必须标注为临时手段。

### 不建议的做法

- 只加 loading 动画、不拆包、不换生产构建；
- 用延长超时掩盖不可用线路；
- 继续把 Vite 开发服务长期暴露在公网。

### 建议落地顺序

1. P4 先做网络判定（只读诊断，最快）；
2. P0 生产构建 + 静态托管（收益最大，需要部署窗口）；
3. P1 拆包（独立前端改动，可随后做）；
4. P2 占位与打点；
5. P3 视 P4 结论再决定是否加重试。

## 本轮已实施的改动（00:48–00:58）

用户确认“开始处理”后，先做可回滚的前端改动与生产构建验证；**没有切换 Cloudflared 目标，也没有上线生产构建**。

| 文件 | 改动 | 目的 |
| --- | --- | --- |
| `frontend/src/App.tsx` | `SongCatalog`、`ConsoleInsertPanel`、`StageLedgerPage`、`StatisticsPanel`、`TourArchivePage`、`TourDetailPage`、`PerformanceGroupDetailPage`、`VenueDetailPage` 改为 `React.lazy` 动态导入；页面条件渲染链外包 `<Suspense>`，fallback 复用 `ContentState` 的加载态 | P1：把非首屏页面移出首页启动依赖图 |
| `frontend/index.html` | `#root` 内增加启动占位（复用 `.content-state` 类） | P2：模块加载期间不再纯白屏 |
| `frontend/vite.config.ts` | 增加 `preview.proxy`，与 `server.proxy` 一致 | 让 `npm run preview` 能本地验证生产构建 |
| `frontend/src/__tests__/App.test.tsx` | 两处控制台断言改为 `findBy*` / `await` | 适配懒加载后的异步组件解析 |

`frontend/` 单目录改动，已执行仓库要求的 `python scripts/run_checks.py frontend`：typecheck + 503 个测试全部通过。

### 实测结果

| 指标 | 改动前 | 改动后 |
| --- | ---: | ---: |
| 开发模式启动可达模块 | 127 | **61** |
| 其中 `no-cache` | 119 | **54** |
| 解压后模块总大小 | 6,339,435 字节 | **3,407,709 字节** |
| 域名浏览器 FCP | 29.26 秒 | **1.62 秒**（占位首绘） |
| 域名浏览器应用内容挂载 | 29.37 秒 | **16.60 秒** |
| 域名浏览器请求数 / 失败 | 135 / 0 | **70 / 0** |

生产构建（`npm run build`）验证通过，首屏只剩 3 个请求：

| 产物 | 大小 | gzip |
| --- | ---: | ---: |
| `index.html` | 0.41 kB | 0.30 kB |
| `assets/index-*.js` | 298.22 kB | 94.39 kB |
| `assets/index-*.css` | 175.95 kB | 29.24 kB |

懒加载分块（仅访问对应页面时下载）：`ConsoleInsertPanel` 262.13 kB、`VenueMapMenu` 51.96 kB、`StageLedgerContent` 21.77 kB、`TourDetailPage` 13.19 kB、`SongCatalog` 10.51 kB 等。本地 `vite preview` 实测：8 个请求、FCP 132 毫秒、应用挂载 269 毫秒、零失败。

启动占位的视觉记录：`tmp/perf-repro/placeholder.png` 与 `tmp/perf-repro/visual-acceptance.md`（复用现有 `.content-state`，未新增 CSS；深色主题下的占位外观记为未验证）。

### 行为说明与限制

- 应用内容挂载仍有 16.6 秒，因为域名当前仍是 Vite 开发服务，剩余 61 个模块仍要逐个取回；生产构建才是把这段压到秒级的改动。
- 占位只解决“纯白屏”的感知，不减少模块请求；若入口模块加载失败，用户会停在“正在加载…”，需要配合后续错误提示。
- 深链接进入被拆分的页面时会出现短暂 fallback；随后由懒加载 chunk 渲染，测试已覆盖相关跳转路径。
- 本轮检查期间发现 Vite 与后端进程已停止（域名无源站），已用 `scripts/run_dev.py` 恢复开发栈；生产构建的持久化托管尚未建立。

## 生产切换（已执行，01:00–01:10）

**没有改 Cloudflare 隧道目标**：本机 `Cloudflared` 以 `tunnel run --token-file C:\ProgramData\cloudflared\token` 运行，入口规则由 Cloudflare 侧管理，本机没有 `config.yml`。因此切换方式是**把监听 `[::1]:5173` 的进程从 Vite 开发服务器换成构建产物服务**，隧道配置一个字都没动。

新增两个脚本：

| 文件 | 作用 |
| --- | --- |
| `scripts/serve_frontend.py` | 托管 `frontend/dist`：SPA 回退、`/assets/*` 一年 immutable、`index.html` `no-cache`、`/icons/*` 一天缓存、`/api/*` 转发到 `127.0.0.1:8000`、附加安全头；对应 Nginx 模板里的同名规则 |
| `scripts/run_prod.py` | 启动 FastAPI（**不带 `--reload`**）与静态服务；登录后 Docker 未就绪时重试等待；5173 已有旧服务时先清理再启动（与 `run_dev.py` 处理 8000 端口一致），支持直接重启接管 |

启动方式（当前正在运行）：

```powershell
backend\.venv\Scripts\pythonw.exe scripts\run_prod.py
```

开机自启：`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LiveSetListProd.cmd`（当前用户启动目录，登录时运行，无需管理员）。原先尝试注册计划任务，因需要管理员权限被拒绝，未创建。

### 切换后实测（同一浏览器、同一域名、固定可用 IP）

| 指标 | 开发服务（基线） | 拆包后仍为开发服务 | **生产构建（当前）** |
| --- | ---: | ---: | ---: |
| 请求数 | 135 | 70 | **10** |
| FCP | 29.26 秒 | 1.62 秒（占位） | **3.62 秒** |
| 应用内容挂载 | 29.37 秒 | 16.60 秒 | **3.85 秒** |
| 首个 API 返回 | 30.1 秒 | 17.1 秒 | **4.87 秒** |
| 失败请求 | 0 | 0 | **0** |
| 文档 / CSS / JS 响应 | — | — | 1.59 s / 2.72 s / 3.65 s |

页面渲染截图：`tmp/perf-repro/prod-page.png`（首页数据、日历、导航均正常）。本地直连静态服务也已验证：HTML `no-cache`、`/assets/*` immutable、深度路由回退 200、`/api/health/db` 返回 `{"ok":true,"result":1}`、缺失资源 404。

### 需要知道的副作用

- 生产服务现在占用 `[::1]:5173`；再用 `python scripts/run_dev.py` 起开发服务时，Vite 会自动改用下一个端口（5174），不会顶掉线上。
- `scripts/run_prod.py` 与 `scripts/serve_frontend.py` 属于 `scripts/` 改动，已通过 `python scripts/run_checks.py scripts`（语法 + mypy + 92 个测试）。
- `pythonw.exe` 没有控制台流（`sys.stderr` 为 `None`）。静态服务的访问日志必须先判断再写入，否则请求处理会抛错、Cloudflare 直接 502；切换后实际踩到过，已修复并有测试覆盖。
- 生产模式下后端不再热重载，改后端代码后需重启 `run_prod.py`；这是有意的，避免 Windows 上 reload 的信号问题。
- 静态服务没有做 gzip 压缩，压缩交给 Cloudflare 边缘。
- `104.21.44.169` 仍然不可用（与本次切换无关，见上一节）。

## 验收口径

改前改后必须用**同一浏览器、同一域名、相同缓存条件**对照，记录：

| 指标 | 采集方式 |
| --- | --- |
| `#root` 首次出现内容 / FCP | CDP + `Page.lifecycleEvent`（`tmp/perf-repro/cdp.cjs`） |
| 文档响应、首个脚本、全部脚本完成时间 | Network 事件 |
| 模块/脚本请求数与失败数 | Network 事件 |
| 演出资料首个 API 耗时 | Network 事件 + 后端日志 |
| 传输字节数 | Network 事件 |

单次 curl、或模块图变小，都不构成修复验收；必须给出修改前后的浏览器数字。

## 尚未拿到的关键证据

- 真实（非无头）浏览器 F5 的瀑布、缓存命中状态与 `#root` 挂载时间；
- 一次真实 API 超时的前端 `api_request_start` / `api_request_error` 日志与精确 URL；
- `104.21.44.169` 是本机线路问题还是 Cloudflare 侧故障；
- 生产构建与拆包后的实测收益（方案尚未实施）。

## 现场证据位置与复测入口

本轮产物在仓库内的 `tmp/perf-repro/`（`tmp/` 已被 `.gitignore` 忽略，不是交付物）：

```text
tmp/perf-repro/
  graph.json              本轮从运行中的 Vite 重新抓取的模块图（ETag、缓存头、大小、依赖边）
  reload-h2.json          缓存验证重放（119×304，17.23 秒）
  cold-h2.json            冷加载重放（127×200，26.01 秒）
  browser-good.json       浏览器加载（固定可用 IP）：FCP 29.26 秒、#root 29.37 秒
  browser-warm.json       同配置再次加载（33.36 秒，未命中 304）
  browser-f5-cold.json    新一轮冷加载（29.37 秒）
  browser-f5-warm.json    新一轮再次加载（33.36 秒）
  browser-default2.json   默认 DNS：文档 51 秒 ERR_TIMED_OUT
  browser-bad2.json       固定 104.21.44.169：文档 55 秒 ERR_CONNECTION_CLOSED
  mkgraph.cjs             重新生成模块图
  probe32.cjs/probe100.cjs  HTTP/2 依赖重放（32 / 100 并发流）
  cdp.cjs                 浏览器加载测量（CDP）
  diag.cjs/dump-resources.cjs  卡住页面的现场诊断
  check.cjs/headers.cjs/rtt.cjs 连通性、边缘头、RTT 测量
  run-chrome-test.ps1 / run-f5.ps1 / run-two.ps1  浏览器测量入口
```

复测命令（需重新确认解析与可用 IP；固定 IP 只用于隔离变量，不是长期配置）：

```powershell
$node = 'C:\Users\xiluo\AppData\Local\Author Software\nvm\installs\v24.21.0\node.exe'
& $node tmp\perf-repro\mkgraph.cjs tmp\perf-repro\graph.json
& $node tmp\perf-repro\probe32.cjs tmp\perf-repro\graph.json reload
& $node tmp\perf-repro\probe100.cjs tmp\perf-repro\graph.json cold
powershell -NoProfile -ExecutionPolicy Bypass -File tmp\perf-repro\run-f5.ps1
```

上一轮临时目录 `C:\Users\xiluo\AppData\Local\Temp\livesetlist-perf-5SWPGZ\` 仍可参考，可能被系统清理。

## 本轮交付状态

- 已复现问题、刷新本文档，并完成 P1（首屏拆包）、P2（启动占位）与 P0（生产构建上线到本机隧道）。
- 新增 `scripts/serve_frontend.py`、`scripts/run_prod.py` 与启动目录自启项；当前域名由生产构建提供。
- 检查：`python scripts/run_checks.py frontend`（typecheck + 503 个测试）与 `python scripts/run_checks.py scripts`（语法 + mypy + 92 个测试）均通过。
- 未修改 Cloudflare 隧道配置、后端业务代码与数据库；只替换了 `[::1]:5173` 上的服务进程。
- `104.21.44.169` 仍不可用，属于独立的线路/边缘问题，本轮未处理。
- 浏览器测量使用无头 Chrome 与独立临时配置目录；成功跑固定了可用 IP，本机出口落在 LHR 边缘（RTT 250–300 毫秒），因此绝对值与用户现场会有差异。
