# Pi Desktop 产品边界

Pi Desktop 是本机 Pi Coding Agent 的桌面工作台。Pi 是唯一的 Agent，桌面端只提供窗口、项目、编辑器、审查界面和 RPC 桥接。

## 桌面端永远不能做

- 渲染进程不得导入 Node.js、Electron 主进程模块、Pi SDK，也不得自行启动 Pi。
- 不直接依赖 Pi 的 npm 包；会话只通过 RPC 驱动本机 `pi`，配置 / 资源 / 技能的读写集中在 `electron/pi-host.ts` 与 `electron/pi-resources.ts`。
- 应用代码不得直接调用模型服务，也不得创建第二个 Agent 会话。
- 除上面两个文件（宿主层）外，应用代码不得读写系统提示词、提示词模板或 Pi 的配置。
- 渲染进程只能通过 `window.piDesktop` 使用预先声明的宿主能力。
- 宿主调用 Pi 时只能使用明确列出的 RPC 方法，白名单位于 `electron/pi-host.ts`。
- 桌面端不得根据消息内容自行计算 token、费用或压缩结果，这些数据只能展示 Pi 返回的结果。
- 附件只能作为用户明确选择的文件内容或图片交给 Pi，不能追加隐藏任务指令。

## 允许的职责

- Electron 主进程负责窗口、系统对话框、文件权限和 Pi 进程生命周期。
- 对话里的图片可以按本地路径读取显示（用户自己贴的 `![](C:\…\a.png)`）：只读、只认图片类型、单文件上限 20 MB，读完转成 data URL 交给渲染层；绝对路径允许落在工作区之外。除此外不新增其它越界读取能力。
- `electron/pi-host.ts` 负责工作区隔离、RPC 白名单、会话 Worker 和受控文件操作。
- Vue 界面可以维护由 RPC 快照和 Pi 事件派生的临时视图状态。
- 设置界面可以管理桌面端自己的显示、编辑和更新偏好。
- 可选的终端插件允许用户明确启动本地 shell / CLI 与一次性后台命令（包括用户手动运行 `pi` 等工具）；只有 Electron 的终端宿主可以创建 PTY，界面只通过固定 IPC 传递按键和尺寸。该功能不会自动启动第二个 Agent 或调用模型，默认关闭；shell 选择与自定义可执行路径属于桌面端偏好。

## 自动检查

`scripts/checks/product-boundary.check.ts` 会扫描应用源码及边界文档。新增一个上述禁止项时，必须同时说明它属于哪一项例外；不能静默扩大桌面端的职责。

## 能力归属：Pi 自带 vs 桌面端插件

判断标准只有一条：**这个能力是不是 Pi（CLI / Agent）自己就有的？**

- 是 → 属于核心，常驻，不出现在插件列表里，也不允许被停用
- 否 → 做成插件（可停用）；核心不得直接 import 插件组件，也不得自己实现一遍

| 能力 | 归属 | 说明 |
| --- | --- | --- |
| 对话与内置工具卡片（read / bash / edit / write） | 核心 | Pi 的输出与内置工具 |
| 会话、模型与思考等级、斜杠命令 | 核心 | Pi 自带 |
| `@` 文件 / 文件夹引用 | 核心 | Pi TUI 的补全就是文件 |
| Skills / MCP / Packages / AGENTS.md | 核心 | Pi 自带的配置能力 |
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
