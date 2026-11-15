# MyGo 迁移说明

本项目原本是 Electron 45 + Vue 3 桌面端。重构后保留 Vue 3 界面与全部业务交互，窗口、进程、文件、Git、终端、更新等宿主能力改为 **Go（MyGo 0.9.1）**，前端由系统 WebView 承载。

## 为什么换

| | Electron（旧） | MyGo（新） |
| --- | --- | --- |
| Windows 产物 | 约 120 MB 安装包，内含 Chromium + Node | 约 36 MB 单 exe / 安装包，不含浏览器 |
| 运行时 | Electron 自带的 Chromium + Node | 系统 WebView2 / WKWebView / WebKitGTK |
| 主进程 | TypeScript + IPC + preload | Go + MyGo 绑定 |
| 终端 | `node-pty` 原生模块 | Go ConPTY / Unix PTY |
| 文件 / Git / 会话 | Node `fs` / `child_process` | Go 标准库 + `os/exec` + `fsnotify` |
| 原生依赖 | 需要按 Electron ABI 重编译 | 纯 Go，交叉编译 |

代价是 Windows 依赖系统 WebView2、Linux 依赖 WebKitGTK；这两个运行时在目标系统上通常已经存在，安装包不再自带浏览器。

## 目录与分层

```text
cmd/pi-desktop/main.go        MyGo 入口：单实例、窗口、绑定 Host、冒烟开关
internal/host/                Go 宿主（原 electron/）
  host.go                     状态、窗口、事件、未保存草稿确认
  bindings.go                 约 100 个 Host.* 绑定（对应旧 window.piDesktop）
  pool.go                     每个工作区的 Pi Worker 池 / RPC 分发 / 会话生命周期
  rpc.go                      JSONL RPC 客户端、超时、白名单
  entry.go                    定位本机 pi（npm shim / 独立二进制）
  session.go                  会话 JSONL、分页、标题、克隆、跨项目
  files.go / git.go           文件与 Git 操作
  worktree.go                 隔离工作区
  terminal.go                 PTY + 一次性后台命令
  settings.go / resources.go  设置、信任、模型默认值、工具开关、资源
  mcp.go / network.go         MCP 配置、代理
  update.go                   更新检查 / 下载 / 安装
  watcher.go                  fsnotify 工作区变更
  logs.go                     四流日志（app/renderer/pi/perf）
  smoke.go                    PI_DESKTOP_SMOKE 探针
packages/ui/src/mygo/host.ts  绑定 → window.piDesktop 形状的适配层
packages/ui/src/mygo/bindings.ts  mygo 自动生成的绑定（勿手改）
mygo.config.ts                应用名、slug、版本、devUrl、前端目录、产物目录
```

## 前端如何保持兼容

旧前端到处调用 `window.piDesktop.xxx()`。迁移没有改这些调用，而是在 `packages/ui/src/mygo/host.ts` 里：

- 安装一个 `window.piDesktop` 代理，把每个方法映射到 `call("Host.xxx")`；
- 把 MyGo 的 `on("pi:event")`、`on("app:window-state")`、`on("files:disk-change")`、`on("pi:terminal-event")` 适配成旧的事件订阅形状；
- 用 `onFileDrop` 缓存拖放路径，并提供异步 `resolveDroppedPaths()`（旧接口是同步的，Workbench 已改为 `await`）；
- 设置 `__piDesktopHost = "mygo"`，让 TitleBar 跳过 Electron 时代的双击最大化补丁，改用 CSS `--app-region: drag`。

业务组件、内核、插件、主题、检查脚本都不需要知道宿主是 Go 还是 Electron。

## 行为对照

| 能力 | 旧实现 | 新实现 | 说明 |
| --- | --- | --- | --- |
| 窗口 | BrowserWindow + 自定义 preload | `mygo.Window` | Windows/Linux 无边框；macOS `TitleBarHidden` + 红绿灯位置 |
| 单实例 | `app.requestSingleInstanceLock` | `mygo.App` 单实例锁 | 第二次启动聚焦已有窗口 |
| 关闭确认 | `before-quit` / `close` 事件 | `win.OnClose` + 原生 Message | 有未保存草稿时阻止关闭 |
| RPC | Node `PiRpcClient` | Go `PiRpcClient` | 一行一个 JSON；30s 默认超时；白名单在 `pool.go` |
| 定位 Pi | `pi-entry.ts` | `entry.go` | npm shim → `node dist/cli.js`；独立二进制直接执行 |
| 终端 | `node-pty` | `go-pty` | Windows ConPTY；24ms 批量输出；UTF-8 清洗 |
| 文件删除 | `shell.trashItem` | `mygo.Shell.TrashItem` | 回收站，失败回退永久删除 |
| 拖放 | `webContents` 的 `drop` 事件 | `mygo.Window.OnFileDrop` | 路径读取改为异步 |
| 打开外链 | `shell.openExternal` | `mygo.Shell.OpenURL` | 仍只允许 http/https |
| 日志 | `electron/logger.ts` | `logs.go` | 四流、8MB 轮转、脱敏、后台 flush |
| 更新 | GitHub releases + Electron 安装器 | 同样的 GitHub releases + exe/dmg 安装 | Windows 安装后以 `--updated` 静默重启 |
| 代理 | Electron session proxy + 子进程环境变量 | Go HTTP Transport + 子进程环境变量 | `auto/system/direct/custom` 一次管两处 |
| 崩溃恢复 | `render-process-gone` 自动重载 / GPU 回退 | 交给系统 WebView | WebView 进程由系统管理；Go 宿主 panic 由日志记录 |
| 最大化 1 DIP 补丁 | 动画后切 fullscreen | 删除 | MyGo 无边框窗口不再有 Chromium 客户区矮 1px 的问题 |

## 开发与构建

要求 Go 1.27.3+、Node 22.18+。Go 不在 PATH 时（例如本机装在 `D:\dev\env\go`）：

```bash
PATH="/d/dev/env/go/bin:$PATH" npx mygo dev
PATH="/d/dev/env/go/bin:$PATH" npx mygo build -skip-installer
```

- `mygo dev` 启动 Vite（127.0.0.1:1420）并编译 Go；改 Go 文件会自动重编译重启。
- `mygo build` 先构建 `packages/ui`，再把 `dist` 嵌入可执行文件；产物在 `dist-mygo/<os>-<arch>/`。
- `mygo.config.ts` 的 `version` 读 `package.json`，`bindings` 指向 `packages/ui/src/mygo/bindings.ts`；绑定由 CLI 生成，不要手改。
- 开发模式的应用名是 `Pi Desktop Dev`，userData 独立，不会和安装版抢单实例锁。

## 冒烟

```bash
PI_DESKTOP_SMOKE=1 PI_DESKTOP_SMOKE_PTY=1 PI_DESKTOP_SMOKE_BASH=1 \
PI_DESKTOP_SMOKE_PROMPT=1 PI_DESKTOP_SMOKE_UI=1 PI_DESKTOP_SMOKE_SETTINGS=1 \
PI_DESKTOP_SMOKE_REPO=1 npx mygo dev
```

探针覆盖宿主、PTY、一次性命令、真实 Pi prompt、前端 UI / 文件 / Git、设置接口和临时 Git 仓库 + worktree。日志在仓库 `logs/`，截图在系统临时目录。

## 已知差异 / 后续

- 只在 Windows 上完成了真实窗口、PTY、Pi prompt、打包 exe 的验证；macOS / Linux 需要各跑一次第 3、4 节。
- WebView 的开发者工具、崩溃转储、GPU 开关不再由应用控制；需要调试时用 WebView2 / Safari 的远程调试。
- 旧 Electron 时代的 29 个宿主内部检查已删除，等价覆盖在 `internal/host/*_test.go` 与冒烟里；前端 57 个检查全部保留。
- 安装包未签名；macOS 首次打开仍需在隐私与安全性里放行。
