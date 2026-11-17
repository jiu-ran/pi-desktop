# Pi Desktop

基于本机 **Pi Agent CLI**（`@earendil-works/pi-coding-agent`）的跨平台桌面客户端，技术栈 **MyGo + Go 宿主 + Vue 3 / TypeScript**。界面参考 JetBrains Air 的布局与 Kero 的材质。

桌面端不跑模型、不内置工具，只通过 JSON-RPC 驱动你已经装好的 `pi`；会话记录、Pi 的配置与资源（MCP、软件包、Skills、`settings.json`）由 Go 宿主读写（默认 `~/.pi/agent`，可用 `PI_CODING_AGENT_DIR` 覆盖）。所有文件操作限制在当前工作区目录内。

## 快速开始

**用现成的**：到 [GitHub Releases](https://github.com/jiu-ran/pi-desktop/releases) 下载 —— Windows `Pi.Desktop.exe`（便携）/ `pi-desktop-setup-*.exe`（安装包），macOS `.dmg`，Linux `.tar.gz` / `.deb` / `.rpm`。

**前置条件**只有一条：本机能跑 `pi`。桌面端跑的就是这份 `pi`，`pi update` 之后当场生效；没装 `pi` 时应用能打开但不会启动会话。

**从源码构建**（Go 1.27.3+、Node.js 22.18+、`git`）：

```bash
npm install && npm ci --prefix packages/ui

npm run dev      # mygo dev：编译 Go 宿主并打开窗口（改 Go 自动重启）
npm run build    # 构建前端 + 编译当前平台可执行文件，产物在 dist-mygo/
npm run check    # 57 个检查 + 3 个静态分析 + go test ./...
```

## 核心功能

- **多项目工作台**：每个项目一个 Pi RPC 工作区，可并行跑任务；打开文件夹或从 Git 克隆即新任务。
- **对话**：流式文本 / 思考 / 工具调用，历史按页回溯，`!` 直接在对话里跑命令，`@` 引用文件和其它会话，`/` 斜杠命令，排队消息可编辑。
- **上下文友好**：附件只传路径不传内容，长会话按页加载，活动组自动折叠，会话用量与费用一览。
- **项目文件与编辑器**：文件树（标注 Git 状态、就地新建）、多标签编辑器、Markdown 预览与高亮、冲突检测与原子写入。
- **终端与后台任务**：真实 PTY（ConPTY / Unix PTY）、多标签、Ctrl+C 只中断当前程序、一次性后台命令可原地重跑。
- **版本控制**：更改 / 分支 / 历史 / 工作区 / 快照，暂存与提交、从远程建跟踪分支、创建 `pi/<类型>-<名称>` 隔离工作区。
- **可开关的扩展**：插件按区域启停；工具开关按 Pi 官方的 `+name` / `-name` 增量写法写入 `defaultTools`。
- **网络与更新**：出网方式一次管两处（应用请求 + Pi 子进程），启动检查 GitHub Release。

每条能力的细节与限制见 **[功能细节](docs/features.md)**，包含快捷键表。

## 架构

分层是「组合根 → 界面骨架 → 内核 → 宿主」，插件只通过内核公开的上下文与贡献能力接入界面：

```text
main.ts                 组合根：创建内核、注册内置插件
  ├─ shell/ components/ 工作台骨架与可复用组件
  ├─ plugins/           文件、版本控制、Markdown、Mermaid、子代理、引用对话、终端等
  ├─ services/ kernel/  主题、设置、命令面板；事件总线、插件管理、会话投影
  └─ internal/host/     Go 宿主：窗口绑定、Pi Worker 池、文件 / Git / 终端 / 更新
```

- `cmd/pi-desktop/main.go` 创建窗口并把 `Host` 绑定给前端；Windows / Linux 无边框，macOS 保留系统标题栏与红绿灯。
- `internal/host/pool.go` 为每个工作区维护 Pi Worker 池，启动 `pi --mode rpc`，白名单之外的方法直接拒绝。
- `internal/host/{files,git,worktree,terminal,settings,resources,mcp}.go` 负责受控文件操作、Git、隔离工作区、PTY、配置与资源；路径都经过工作区边界与真实路径校验。
- `internal/host/bindings.go` 导出 `Host.*`，前端桥 `packages/ui/src/mygo/host.ts` 适配成 `window.piDesktop`，业务代码不感知宿主实现。

运行时没有 Chromium、Node 或 `node-pty`：生产构建把前端 `packages/ui/dist` 嵌入 Go 可执行文件。

## 开发与发布

- 只调前端：`packages/ui` 下 `npm run dev`（默认 `127.0.0.1:1420`）。`mygo dev` 用独立的 `Pi Desktop Dev` 应用名与 userData，可与安装版同时运行。
- 窗口页面受 CSP 约束（只允许自身脚本 / 样式、`data:` / `blob:` / `https` 图片与本地工作线程），新增依赖若要 `eval`、内联脚本或远程 `http`，需同步改 `packages/ui/index.html`。
- 新检查放进 `scripts/checks/*.check.ts` 会被自动发现；一次性探针写 `temp/`，用完删。
- 发布：改版本号与 `CHANGELOG.md`、写 `docs/releases/v<版本>.md`，按 [`docs/release-review.md`](docs/release-review.md) 逐节验证后打 tag 触发 CI。

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/features.md`](docs/features.md) | 全部功能细节、约束与快捷键 |
| [`docs/product-boundary.md`](docs/product-boundary.md) | 桌面端能做什么、不能做什么；什么该做成插件 |
| [`docs/pi-compatibility.md`](docs/pi-compatibility.md) | 与 Pi CLI 的能力对照、斜杠命令映射、已知差异 |
| [`docs/mygo-migration.md`](docs/mygo-migration.md) | Electron → MyGo + Go 宿主的迁移对照 |
| [`docs/release-review.md`](docs/release-review.md) | 发布前自检清单与验证分级 |
| [`docs/thinkrail-adoption.md`](docs/thinkrail-adoption.md) | 参考 JetBrains ThinkRail 的功能对照与取舍 |
| [`docs/releases/`](docs/releases) | 每个版本的更新说明 |

## 许可

MIT，见 [LICENSE](./LICENSE)。

部分交互与实现参考 [JetBrains ThinkRail](https://github.com/JetBrains/thinkrail)（Apache-2.0），详见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) 与 [`docs/thinkrail-adoption.md`](docs/thinkrail-adoption.md)。
