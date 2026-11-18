# Pi Desktop 产品边界

Pi Desktop 是本机编码 Agent 的桌面工作台。默认 Agent 是 Pi Coding Agent；从 0.10 起还可以按项目切换到本机安装、通过 **ACP（Agent Client Protocol）** 工作的其它 Agent（第一个是 Antigravity CLI）。桌面端只提供窗口、项目、编辑器、审查界面与协议桥接，不内置任何模型或提示词。

## 桌面端永远不能做

- 界面（WebView 里的 Vue 代码）不得导入 Node.js 内置模块、Go 宿主内部模块或 Pi 的 npm 包，也不得自行启动 Pi。
- 不直接依赖 Pi 的 npm 包；会话只通过 RPC 驱动本机 `pi`，配置 / 资源 / 技能的读写集中在 `internal/host/` 的 Go 宿主。
- 应用代码不得直接调用模型服务；除用户当前选择的 Agent 外，不得私自另起一个后台 Agent 会话。
- 外部 Agent（Antigravity）只通过本机 CLI 的 ACP stdio 会话驱动：不注入系统提示词 / 任务指令，不改它的配置，也不把它的凭据读进桌面端。
- 除上面两个文件（宿主层）外，应用代码不得读写系统提示词、提示词模板或 Pi 的配置。
- 界面只能通过 `window.piDesktop`（MyGo 绑定的适配层）使用预先声明的宿主能力，没有其它直达文件系统 / 进程 / 网络的通道。
- 宿主调用 Pi 时只能使用明确列出的 RPC 方法，白名单位于 `internal/host/pool.go`。
- 桌面端不得根据消息内容自行计算 token、费用或压缩结果，这些数据只能展示 Pi 返回的结果。
- 附件只能作为用户明确选择的文件内容或图片交给 Pi，不能追加隐藏任务指令。

## 允许的职责

- MyGo 宿主（`cmd/pi-desktop` + `internal/host`）负责窗口、系统对话框、文件权限和 Agent 进程生命周期。
- 外部 Agent 按项目选择，宿主启动本机 `agy acp` 并按 ACP v1 收发 JSON-RPC；界面与 Agent 之间同样只经过 `window.piDesktop` 的宿主绑定。协议细节见 [多 Agent 接入](agents.md)。
- 对话里的图片可以按本地路径读取显示（用户自己贴的 `![](C:\…\a.png)`）：只读、只认图片类型、单文件上限 20 MB，读完转成 data URL 交给渲染层；绝对路径允许落在工作区之外。除此外不新增其它越界读取能力。
- `internal/host/pool.go` 负责工作区隔离、RPC 白名单、会话 Worker 和受控文件操作；文件 / Git / 终端各有独立文件。
- Vue 界面可以维护由 RPC 快照和 Pi 事件派生的临时视图状态。
- 设置界面可以管理桌面端自己的显示、编辑和更新偏好。
- 可选的终端插件允许用户明确启动本地 shell / CLI 与一次性后台命令（包括用户手动运行 `pi` 等工具）；只有 Go 终端宿主可以创建 PTY，界面只通过固定绑定传递按键和尺寸。该功能不会自动启动第二个 Agent 或调用模型，默认关闭；shell 选择与自定义可执行路径属于桌面端偏好。

## 自动检查

渲染层由 `product-boundary` 时代的 TypeScript 检查改为人工评审 + `go test ./internal/host`；新增一个上述禁止项时，必须同时说明它属于哪一项例外，不能静默扩大桌面端的职责。

## 能力归属：Agent 自带 vs 桌面端插件

判断标准只有一条：**这个能力是不是用户当前选择的 Agent（Pi，或 Antigravity 这类外部 ACP Agent）本身 / 协议层就有的？** Pi 自带的对话、会话、`@` 文件引用与 Skills 依然按这条规则留在核心里。

- 是 → 属于核心，常驻，不出现在插件列表里，也不允许被停用
- 否 → 做成插件（可停用）；核心不得直接 import 插件组件，也不得自己实现一遍

| 能力 | 归属 | 说明 |
| --- | --- | --- |
| 对话与内置工具卡片（read / bash / edit / write），以及输入框里的 `!` / `!!` 命令 | 核心 | Pi 的输出、内置工具与 RPC `bash` |
| 会话、模型与思考等级、斜杠命令 | 核心 | Pi 自带 |
| `@` 文件 / 文件夹引用 | 核心 | Pi TUI 的补全就是文件 |
| Skills / MCP / Packages / AGENTS.md | 核心 | Pi 自带的配置能力 |
| 外部 Agent（Antigravity / ACP） | 核心（按项目切换） | 运行本机 `agy acp`，通过 ACP v1 驱动；不注入提示词，不打包模型 |
| 子代理（subagent / parallel / review / bg_wait） | 插件 `subagent` | 由 `pi-subagents` 扩展提供，不是 Pi 自带 |
| 引用对话（本项目 / 其它项目） | 插件 `session-quote` | 桌面端能力 |
| Mermaid 图表 | 插件 `mermaid` | 渲染扩展 |
| 文件区 Markdown 预览 | 插件 `markdown` | 打开 .md 时的预览视图（对话正文渲染在核心里，不受插件影响） |
| 项目文件树 | 插件 `files` | 桌面端能力 |
| 版本控制 | 插件 `git` | 桌面端能力 |
| 终端与后台任务 | 插件 `terminal` | 桌面端能力，默认关闭 |
| RPC 事件查看器 | 插件 `events` | 桌面端调试工具 |
| 插件管理 | 核心插件 `plugin-manager` | 必须常驻，不可停用 |

实现约定：

- 非核心能力只能通过插件贡献点接入：`registerToolRenderer`（工具卡片）、`registerMentionSource`（`@` 候选）、`panel` / `stage` / `dock`（面板与视图）。
- 核心组件不得 import 插件目录里的组件；停用插件后界面必须退回安全形态（通用工具卡片、`@` 只剩文件补全）。
- `scripts/checks/capability-boundary.check.ts` 校验这张表与代码一致；新增能力放错位置会让它失败。
