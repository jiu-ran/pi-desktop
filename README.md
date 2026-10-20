# Pi Desktop

基于本机 **Pi Agent CLI** 的跨平台桌面客户端（Electron + Vue 3 + TypeScript）。界面布局与配色参考 JetBrains Air：深色窗框上的圆角“岛”、按项目分组的任务列表、标题栏面包屑、中央多标签文件编辑器、右侧多面板文件树与变更审查，以及底栏带模型与思考等级的输入框。

桌面端不内置 Pi 的推理与工具执行，而是通过 RPC 驱动用户已安装的 `pi`。同时，桌面端会读取会话 JSONL，并通过宿主层管理已暴露的 Pi 配置与资源（全局 / 项目 MCP、软件包、Skills 和设置）；默认使用 `~/.pi/agent`，也支持 `PI_CODING_AGENT_DIR` 覆盖。项目文件操作仍限制在当前工作区目录内。

## 下载与安装

- **预构建安装包 / 便携包**：前往 [GitHub Releases](https://github.com/jiu-ran/pi-desktop/releases) 下载对应系统的最新版本（Windows `.exe` / `.zip`、macOS `.dmg` / `.zip`、Linux `.AppImage` / `.tar.gz`）。
- **前置条件**：本机需已安装并可在命令行运行 `pi`（`@earendil-works/pi-coding-agent`）。

## 从源码运行与打包

```bash
npm install
npm install --prefix packages/ui
npm run dev          # 编译 Electron 主进程并启动 Vite + Electron 开发环境
npm run build        # 构建 Electron 主进程与前端静态资源
npm start            # 直接启动桌面端
npm run dist         # 打包当前系统安装包与便携包（输出到 dist/）
npm run check        # TypeScript 检查 + 各层自检（包含 Mermaid 高度计算检查）
npm run check:smoke  # 构建 Electron 后运行最小宿主冒烟检查
```

开发服务器默认监听 `127.0.0.1:1420`。如果只需要调试前端，可以在 `packages/ui` 下运行 `npm run dev`。

## 当前功能

### 工作区与对话

- 同时管理多个项目目录，每个项目对应一个可调度的 Pi RPC 工作区。
- 支持新建任务、切换历史会话、停止运行中的任务，以及流式显示文本、思考、工具调用和通知块。
- 历史会话按页回溯（每页 8 条，向上滚动自动加载）；用户消息里的图片直接显示缩略图（点击放大），文本/目录附件显示为文件名徽标。
- 每个工作区可以保留多个 Worker 以支持并行任务；空闲 Worker 数量可在设置中调整（1–8），后台任务完成时可发送通知。
- 对话中的 Markdown 使用 `markstream-vue` 渲染，助手消息支持一键复制 Markdown 源文。
- ` ```mermaid ` 代码块可渲染为流程图、时序图等图表；图表按 SVG 实际宽高比自动收缩预览区域，避免扁图被固定的大容器撑开。
- 对话和 Markdown 文件中的代码块使用 Shiki 按语言进行语法高亮，并跟随深色 / 浅色主题。
- 打开 `.md` 文件时，源码编辑区也会显示 Markdown 语法高亮；可在插件管理中停用 Markdown 插件并恢复纯文本编辑。

### 项目文件

- 浏览、搜索和刷新项目文件树；文件可以拖拽到输入框作为附件，截图/图片可用 Ctrl+V 直接粘贴；输入框里图片显示为缩略图（点击预览、右上角一键移除）。
- 在编辑器中打开文本文件，支持多标签、未保存状态、自动保存和 Markdown 预览。
- 文件树和搜索结果提供常用右键操作：用系统程序打开、重命名、复制绝对路径、复制相对路径、在文件管理器中显示，以及将文件或文件夹移入回收站。
- 项目根目录支持新建文件、新建文件夹、复制项目路径和在文件管理器中显示。

### 扩展工具与设置

- **文件变更**：汇总当前会话修改的文件，提供行级 Diff。
- **Git 树**：查看提交历史、工作区状态和 Commit / Diff 详情。
- **RPC 事件**：实时查看 Pi 子进程发出的 JSON-RPC 事件及完整载荷，并可复制 JSON。
- **插件管理**：按“对话区域 / 文件区域 / 扩展工具”分组启用或停用插件；核心插件不可停用，选择会保存在本地。
- **主题与设置**：切换深色 / 浅色主题，配置发送快捷键、消息密度、自动保存、Worker 上限、自动压缩 / 重试、Pi 软件包、Skills、MCP 和插件。
- **软件更新**：启动时可检查 Pi Desktop 的 GitHub Release；发现新版本后在标题栏和设置页提示，并由用户手动打开下载页面。

## 架构

项目按“组合根 → 界面骨架 → 内核 → 宿主”分层，插件只通过内核公开的上下文和贡献能力接入界面：

```text
main.ts                 组合根：创建内核、注册内置插件
  ├─ shell/              工作台骨架：标题栏、项目栏、对话区、编辑器、右侧面板
  ├─ components/         可复用界面组件：消息、工具卡片、面板、弹窗
  ├─ plugins/            功能插件：文件、变更、Git、事件、Markdown、Mermaid 等
  ├─ services/           主题、设置、命令面板、扩展 UI 等跨界面服务
  ├─ kernel/             事件总线、插件管理、工作区状态、会话投影、内容舞台
  └─ electron/           窗口、IPC、Pi Worker 池；每个工作区可运行并行 RPC 会话
```

### 插件清单

| 插件 | 区域 | 职责 |
|---|---|---|
| `files` | 扩展工具 | 文件树、文件搜索、编辑器标签和文件操作 |
| `changes` | 扩展工具 | 当前会话的文件变更和 Diff |
| `git` | 扩展工具 | Git 提交树、状态和详情 |
| `events` | 扩展工具 | Pi JSON-RPC 事件流 |
| `plugin-manager` | 扩展工具 | 管理插件启停；自身为核心插件 |
| `markdown` | 文件区域 / 对话区域 | `.md` 源码高亮、实时预览，以及对话代码块语法高亮 |
| `mermaid` | 对话区域 | 对话和 Markdown 文件中的 Mermaid 图表；与 Markdown 渲染共用 |

内置插件清单位于 [`packages/ui/src/plugins/index.ts`](packages/ui/src/plugins/index.ts)，插件生命周期和注册接口位于 [`packages/ui/src/kernel/plugin-manager.ts`](packages/ui/src/kernel/plugin-manager.ts)。插件停用时会执行其清理回调、取消订阅并关闭对应面板 / 详情标签。

### Electron 边界

- [`electron/pi-host.ts`](electron/pi-host.ts) 负责每个工作区的 Pi Worker 池、会话目录、白名单 RPC，以及文件创建、重命名、删除和回收站操作。
- [`electron/main.ts`](electron/main.ts) 与 [`electron/preload.cts`](electron/preload.cts) 负责窗口和 IPC；渲染进程只通过 `window.piDesktop` 访问宿主能力。
- IPC 参数和返回值都会被纯化为可结构化克隆的 JSON 数据，前端响应式 Proxy 不会直接穿过进程边界。
- 宿主会隐藏 `.git`、`node_modules` 和 `.pi` 等目录；所有项目路径都经过工作区边界校验。文件预览上限为 2 MB，保存上限为 20 MB。

## 关键目录与文件

| 模块 | 文件 | 职责 |
|---|---|---|
| 组合根 | `packages/ui/src/main.ts` | 创建内核并按清单注册内置插件 |
| 工作台骨架 | `packages/ui/src/shell/Shell.vue` | 摆放标题栏、对话区、编辑器、面板和活动栏 |
| 内核 | `packages/ui/src/kernel/workbench.ts` | 多工作区状态、会话切换、发送 / 停止、文件操作 |
| 内核 | `packages/ui/src/kernel/transcript.ts` | 把 Pi 消息与流式事件折叠成统一的消息块 |
| 插件 | `packages/ui/src/plugins/files/` | 文件树、编辑器和文件操作 |
| 插件 | `packages/ui/src/plugins/markdown/` | Markdown 预览与 Mermaid 共用渲染开关 |
| 插件 | `packages/ui/src/plugins/mermaid/` | Mermaid 插件启停生命周期 |
| 渲染修复 | `packages/ui/src/plugins/markdown/mermaid-fit.ts` | 按 SVG 视图框比例修正 Mermaid 预览高度 |
| 宿主 | `electron/pi-host.ts` | Pi Worker 池、白名单 RPC、文件系统操作 |
| 自检 | `scripts/checks/` | transcript、会话历史分页、会话标题、Diff、宿主、删除、附件、文件树和 Mermaid 高度检查 |

## 架构图

模块边界和插件生命周期见 [`docs/modularization.svg`](docs/modularization.svg)。

## 复制行为

界面中的“复制”入口面向不同内容：

- 助手消息下方的按钮复制该消息的 Markdown 源文；`/copy` 命令复制最后一条助手回复。
- RPC 事件详情页的按钮复制格式化 JSON。
- 项目文件右键菜单复制绝对路径或项目内相对路径。

这些操作依赖 Electron 的安全剪贴板环境；失败时会通过界面通知反馈。

## 许可

MIT，见 [LICENSE](./LICENSE)。
