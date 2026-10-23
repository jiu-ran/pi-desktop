# Pi Desktop

基于本机 **Pi Agent CLI** 的跨平台桌面客户端（Electron + Vue 3 + TypeScript）。界面布局与配色参考 JetBrains Air：深色窗框上的圆角“岛”、按项目分组的任务列表、标题栏面包屑、中央多标签文件编辑器、右侧多面板文件树与变更审查，以及底栏带模型与思考等级的输入框。

桌面端不内置 Pi 的推理与工具执行，而是通过 RPC 驱动用户已安装的 `pi`。同时，桌面端会读取会话 JSONL，并通过宿主层管理已暴露的 Pi 配置与资源（全局 / 项目 MCP、软件包、Skills 和设置）；默认使用 `~/.pi/agent`，也支持 `PI_CODING_AGENT_DIR` 覆盖。项目文件操作仍限制在当前工作区目录内。

## 下载与安装

- **预构建安装包 / 便携包**：前往 [GitHub Releases](https://github.com/jiu-ran/pi-desktop/releases) 下载对应系统的最新版本（Windows `.exe` / `.zip`、macOS `.dmg` / `.zip`、Linux `.AppImage` / `.tar.gz`）。
- **前置条件**：本机需已安装并可在命令行运行 `pi`（`@earendil-works/pi-coding-agent`）；从源码构建还需要 Node.js `>= 22.18.0`。

## 从源码运行与打包

```bash
npm install
npm install --prefix packages/ui
npm run dev          # 编译 Electron 主进程并启动 Vite + Electron 开发环境
npm run build        # 构建 Electron 主进程与前端静态资源
npm start            # 直接启动桌面端
npm run dist         # 打包当前系统安装包与便携包（输出到 dist/）
npm run check        # TypeScript 检查 + 各层自检（包含 Mermaid 高度计算检查）
npm run check:smoke  # 构建 Electron 后运行宿主、网络、终端、编辑器冒烟检查
```

发布前请对照 [`docs/release-review.md`](docs/release-review.md) 的清单执行依赖审计、冒烟、打包与手工验收。

完整终端使用 `node-pty`（N-API 原生模块）：Windows / macOS 使用随依赖提供的预构建产物；Linux 安装依赖时需要 `python3`、`make`、`g++`（例如先安装 `build-essential python3`）。npm 12 若提示安装脚本被拦截，运行 `npm install-scripts approve node-pty`。原生模块通过 `asarUnpack` 随包解压分发，打包阶段不重复进行 Electron ABI 重编译。

开发服务器默认监听 `127.0.0.1:1420`。如果只需要调试前端，可以在 `packages/ui` 下运行 `npm run dev`。

主进程使用 Electron 45（运行 `npx --no-install electron --version` 可查看当前版本）。渲染进程加载了内容安全策略（CSP），只允许自身脚本 / 样式、`data:` / `blob:` / `https` 图片与本地工作线程；新增依赖如果依赖 `eval`、内联脚本或远程 `http` 资源，需要同步调整 `packages/ui/index.html` 的策略。

开发实例使用独立的 Chromium profile（`%APPDATA%/Pi Desktop Dev`），与已安装的 Pi Desktop 互不影响，可以同时运行；需要自定义目录时设置 `PI_DESKTOP_PROFILE` 环境变量。

## 当前功能

### 工作区与对话

- 同时管理多个项目目录，每个项目对应一个可调度的 Pi RPC 工作区。同一目录使用不同斜杠 / 大小写打开时会被识别为同一个项目，不会产生重复分组。
- 空会话提供品牌首页和四个可直接填入输入框的起点卡片（浏览结构、查找遗留问题、解释最近改动、审查未提交改动）；输入框为悬浮卡片样式，窄舞台下自动收起次要标签，避免模型名、上下文环和发送按钮互相挤压。
- 支持新建任务、切换历史会话、重命名当前任务、停止运行中的任务，以及流式显示文本、思考、工具调用和通知块。
- 历史会话按页回溯：打开会话先加载最近 40 条并补齐至少 3 轮对话（长工具链会话最多 240 条），向上滚动每次再加载 8 条原始消息、且至少补到 8 个可见块；顶部显示已加载/总条数。流式输出中打开会话也会补齐历史，不再只显示压缩后的几条上下文。用户消息里的图片直接显示缩略图（点击放大），文本/目录附件显示为文件名徽标。
- 对话右侧的用户消息大纲会标示当前轮次；悬停查看「第 N 轮」摘要，点击即可跳到对应位置。
- 文件附件只传路径：拖拽 / “+” 添加的文本文件无论大小都不再把内容写进上下文，只发送绝对路径、大小和「请用 `read` 工具读取」的提示，长会话不再因为附件反复重发而撑爆上下文；图片仍作为图片发送，目录附件附带目录树。附件徽标显示文件大小。
- 每个工作区可以保留多个 Worker 以支持并行任务；空闲 Worker 数量可在设置中调整（1–8），后台任务完成时可发送通知。
- 对话中的 Markdown 使用 `markstream-vue` 渲染，助手消息支持一键复制 Markdown 源文。
- 输入框右侧的上下文占用环可点开「会话用量」弹层：上下文进度、累计输入 / 输出 / 缓存读写 Token、费用和消息统计，全部来自 Pi 的 `getSessionStats`。
- 超过 500 字的用户消息自动折叠为 6 行，可展开全文；`/skill:name` 技能调用渲染成折叠卡片，只显示技能名和追加的问题，展开后可查看完整技能说明。
- 连续 4 步以上的思考 / 常规工具调用自动折叠成「活动」组（单组最多 20 步），折叠头显示数量、动作摘要、运行中或失败状态；组内滚动时折叠头吸顶，编辑 / 写入和带图片的结果保持独立。
- 向上翻看历史时，输入框上方会出现「回到底部 / N 条新回复」悬浮按钮，一键回到最新位置。
- Provider 报错、自动重试和上下文压缩会显示为状态卡片：重试卡片展示剩余等待时间和错误详情，压缩卡片可展开摘要并查看压缩前后的 Token 变化。
- ` ```mermaid ` 代码块可渲染为流程图、时序图等图表；图表按 SVG 实际宽高比自动收缩预览区域，避免扁图被固定的大容器撑开。
- 对话和 Markdown 文件中的代码块使用 Shiki 按语言进行语法高亮，并跟随深色 / 浅色主题。
- 打开 `.md` 文件时，源码编辑区也会显示 Markdown 语法高亮；可在插件管理中停用 Markdown 插件并恢复纯文本编辑。

### 项目文件

- 浏览、搜索和刷新项目文件树；文件可以拖拽到输入框作为附件，截图/图片可用 Ctrl+V 直接粘贴；输入框里图片显示为缩略图（点击预览、右上角一键移除）。
- 输入框输入 `@` 按 Pi TUI 的方式插入文件引用：只写入 `@相对路径`（含空格或中文标点自动加引号，目录保留 `/` 并继续补全子路径），不内联内容，由模型用 `read` 工具按需读取；拖拽和“+”按钮仍然作为附件添加。
- 在编辑器中打开文本文件，支持多标签、未保存状态、自动保存和 Markdown 预览；按 Ctrl / Cmd + P 快速打开文件（空输入时显示最近打开，支持模糊路径搜索），标签右键可关闭其他 / 右侧 / 已保存标签、复制路径或在文件管理器中显示；关闭自动保存且仍有未保存修改时会先确认。每个标签绑定打开时的项目目录和文件版本：切换项目后再保存不会写错目标；保存前发现文件已被外部修改会提示冲突并保留草稿；写入采用同目录临时文件 + 原子替换。
- 编辑器支持 Ctrl / Cmd + W 关闭当前标签、Ctrl / Cmd + Tab 循环切换、Ctrl / Cmd + 1–9 直达标签；聊天输入框里的 Ctrl / Cmd + W 不会误关窗口。
- 文件树和搜索结果提供常用右键操作：用系统程序打开、重命名、复制绝对路径、复制相对路径、在文件管理器中显示，以及将文件或文件夹移入回收站。
- 文件树直接标注 Git 状态（`M` / `U` / `D` / `R`）并汇总目录内变更数，工具栏可一键切换「只看变更」。
- 项目根目录支持新建文件、新建文件夹、复制项目路径和在文件管理器中显示。

### 终端与后台任务

- **终端是默认关闭的可选插件**：在「设置 → 终端」或「插件管理 → 工作台工具」启用「终端与后台任务」后，才显示标题栏终端按钮、底部终端岛和 Ctrl / Cmd + 反引号快捷键。启停选择会保存；停用只隐藏界面、不强制结束已有任务，设置页可查看运行数量并选择结束所有任务。
- 点击标题栏 **+ / 新建终端** 启动真实 PTY 会话：Windows 默认读取 `%ComSpec%`（通常是 CMD）并使用 ConPTY，macOS / Linux 默认读取 `$SHELL` / 用户登录 shell。直接点击终端屏幕输入，支持连续命令、Tab 补全、方向键、密码输入、全屏界面和鼠标报告；可运行本机已经安装的 Pi、Claude Code、Codex、mysql、psql、Node REPL、vim / top 等 CLI。应用不会代为安装或登录这些工具。
- 在「设置 → 终端」修改新建会话的默认 shell：自动列出已安装的 pwsh、Windows PowerShell、Git Bash、CMD，以及 macOS / Linux 的 Zsh、Bash、Fish 等；也支持选择自定义绝对可执行路径和 JSON 字符串数组启动参数。只校验文件、不执行探测命令，参数分开传给宿主，不拼接为 shell 命令。这里选择的是 shell，不会修改 Windows Terminal 等外部终端应用的默认设置。
- **+ 旁的「其他 shell…」菜单**可临时用另一 shell 新建会话，不改变已保存的默认配置。shell、历史命令和「全部任务」菜单统一跟随深浅主题，支持方向键、Home / End、Enter 选择、Esc 关闭和 Tab 离开；历史命令只填入底部草稿，不直接执行。修改默认配置只影响未来的新会话，已有终端仍使用启动时的 shell。
- **Ctrl+C 中断终端内的当前程序**，不会把整个 shell 当作后台任务强制结束；输入 `exit` 退出 shell，或者点击标签右侧 × 结束并关闭该会话的进程树。Esc、Ctrl+W、Ctrl+L 等按键原样交给终端程序，聚焦终端时不会误触发 Electron 关窗 / 刷新等菜单快捷键。
- 鼠标滚轮优先交给应用协商的鼠标协议；全屏备用屏幕没有滚轮协议时，改用 PageUp / PageDown 滚动内容，而不是模拟 ↑ / ↓ 去切换 Agent 的输入历史。普通 shell 仍滚动终端日志，键盘 ↑ / ↓ 的历史命令功能不变。
- 终端内的复制粘贴用键盘完成：选中内容后 `Ctrl+C` 复制（Windows / Linux），无选中时 `Ctrl+C` 仍中断当前程序；`Ctrl+V` 粘贴（Windows），macOS 用 `Cmd+C` / `Cmd+V`，所有平台都支持 `Ctrl+Shift+C` / `Ctrl+Shift+V` 与 `Ctrl+Insert` / `Shift+Insert`。密码是否回显由终端程序控制，PTY 输入不进入应用的命令历史、不做人为回显。shell 自身的历史遵循该 shell 的设置。
- 可以同时启动多个终端和一次性后台任务（总共最多 8 个运行中）；每个 PTY 会话保留独立屏幕和滚动位置，切换任务、收起面板不会中断程序或重放控制序列。面板/窗口尺寸变化会同步行列数，适配全屏程序；终端主题跟随深色 / 浅色界面。
- 任务以顶部横向标签呈现，按「交互终端」「后台命令」分组：终端标签显示 shell 名称并在重名时追加序号（CMD 1、CMD 2），后台命令显示命令本身；标签过多时自动溢出为「全部」下拉，也可用左右方向键、Home / End 或滚轮横向浏览，当前任务自动滚入可见区域。
- 面板分为四层：标题栏只放新建 / 清理 / 设置 / 收起等全局操作，任务标签行负责切换（每个标签右侧的 × 结束并关闭该任务），输出区顶部一行显示状态、耗时、shell、目录与退出码，底部始终是后台命令栏。窗口变窄时辅助信息与快捷键提示自动隐藏；面板高度低于 220px 时进入紧凑模式，压缩各层留白而不是挤掉终端内容。
- 底部命令输入框始终可用：打开终端后仍可直接输入并按 Enter 启动一次性后台命令，命令不会发送给当前终端，也不会把全屏程序切走，只在任务列表新增一条记录并短暂提示「已提交后台任务」；终端结束后同样可以继续跑后台命令，右侧提供「新建终端」。一次性任务同样使用设置中选定的默认 shell，支持 ANSI 颜色与样式、自动跟随 / 回到最新、自动换行、重新填入命令、复制 / 清空输出、停止进程树和清理已结束任务；↑ / ↓ 回溯历史，Ctrl / Cmd + L 清屏。
- 任务由 Electron 主进程托管，切换项目或刷新窗口后可接回；宿主保留每个任务最近 1 MB 的原始输出，界面日志缓存最多 500 KB。重新加载时只能恢复该尾部记录；已有 PTY 屏幕在日志裁剪时不会重置。面板可拖拽调高并记住，最多占窗口高度的 55%（最高 640px）。

### 扩展工具与设置

- **对话底部变更条**：始终单行显示当前未提交的文件数量和增删统计；对话区域变窄时自动收起文件名和辅助提示，仍可点击整条查看改动，不会挤到输入框。
- **版本控制**：把 Git 仓库状态和本会话改动合并到一个面板。非 Git 项目可以一键初始化仓库；仓库支持暂存 / 取消暂存、提交、获取 / 拉取 / 推送，并用「全部 / 本会话」筛选和 `Agent` 标记区分手动改动与 Agent 改动；点击文件查看实时 Git Diff，已提交的改动仍可切到会话快照对比。提交树展示历史与 Commit 详情。实时 Diff 支持行内评审：悬停行添加意见，汇总后连同文件、行号、代码上下文一起加入输入框。
- **隔离工作区**：从当前 HEAD 创建 `pi/<任务名>` 分支和独立 `git worktree`，作为新项目打开，适合并行运行互不干扰的任务。面板会区分主工作区、Pi Desktop 创建的隔离工作区和外部 worktree；可以打开、在文件管理器中定位或移除隔离工作区。移除只删除目录、保留分支，主工作区和当前使用中的工作区不可移除。
- **RPC 事件**：实时查看 Pi 子进程发出的 JSON-RPC 事件及完整载荷，并可复制 JSON。
- **插件管理**：按“对话区域 / 文件区域 / 扩展工具”分组启用或停用插件；核心插件不可停用，选择会保存在本地。
- **主题与设置**：切换深色 / 浅色主题，配置发送快捷键、消息密度、自动保存、Worker 上限、自动压缩 / 重试、Pi 软件包、Skills、MCP 和插件。悬停提示统一使用跟随主题的浮层，长内容可滚动，不再出现系统白底提示。
- **软件更新**：启动时可检查 Pi Desktop 的 GitHub Release；发现新版本后在标题栏和设置页提示，并由用户手动打开下载页面。

## 架构

项目按“组合根 → 界面骨架 → 内核 → 宿主”分层，插件只通过内核公开的上下文和贡献能力接入界面：

```text
main.ts                 组合根：创建内核、注册内置插件
  ├─ shell/              工作台骨架：标题栏、项目栏、对话区、编辑器、右侧面板
  ├─ components/         可复用界面组件：消息、工具卡片、面板、弹窗
  ├─ plugins/            功能插件：文件、版本控制、事件、Markdown、Mermaid 等
  ├─ services/           主题、设置、命令面板、扩展 UI 等跨界面服务
  ├─ kernel/             事件总线、插件管理、工作区状态、会话投影、内容舞台
  └─ electron/           窗口、IPC、Pi Worker 池与后台任务宿主；每个工作区可运行并行 RPC 会话
```

### 插件清单

| 插件 | 区域 | 职责 |
|---|---|---|
| `files` | 扩展工具 | 文件树、文件搜索、编辑器标签和文件操作 |
| `git` | 扩展工具 | 仓库状态与本会话改动合并、暂存 / 提交 / 同步、提交树与 Diff |
| `events` | 扩展工具 | Pi JSON-RPC 事件流 |
| `plugin-manager` | 扩展工具 | 管理插件启停；自身为核心插件 |
| `terminal` | 工作台工具（底部停靠区） | 默认关闭的完整 PTY / 后台任务、shell 配置与快捷键 |
| `markdown` | 文件区域 / 对话区域 | `.md` 源码高亮、实时预览，以及对话代码块语法高亮 |
| `mermaid` | 对话区域 | 对话和 Markdown 文件中的 Mermaid 图表；与 Markdown 渲染共用 |

插件可通过 `dock` 贡献工作台停靠组件，`defaultEnabled: false` 声明主动启用的可选功能；终端屏幕按需加载，未启用时不注册终端命令或启动宿主订阅。内置插件清单位于 [`packages/ui/src/plugins/index.ts`](packages/ui/src/plugins/index.ts)，插件生命周期和注册接口位于 [`packages/ui/src/kernel/plugin-manager.ts`](packages/ui/src/kernel/plugin-manager.ts)。插件停用时会执行其清理回调、取消订阅并关闭对应面板 / 详情标签。

### Electron 边界

- [`electron/terminal-host.ts`](electron/terminal-host.ts) 托管一次性后台命令与 node-pty 会话：原始输出限长、分批上报，退出时清理进程树和终端句柄；[`PtyTerminal.vue`](packages/ui/src/components/terminal/PtyTerminal.vue) 为每个会话维护独立 xterm 屏幕。终端仍只在已授权项目目录启动，后续 `cd` 等行为由用户运行的 shell 控制。
- [`electron/pi-host.ts`](electron/pi-host.ts) 负责每个工作区的 Pi Worker 池、会话目录、白名单 RPC，以及文件创建、重命名、删除和回收站操作。
- [`electron/main.ts`](electron/main.ts) 与 [`electron/preload.cts`](electron/preload.cts) 负责窗口和 IPC；渲染进程只通过 `window.piDesktop` 访问宿主能力。窗口禁止附加 `webview`，导航按允许列表校验，打包版限制单实例。
- 文件写入由 [`electron/atomic-file.ts`](electron/atomic-file.ts) 统一串行化并原子替换；宿主在写入前校验调用方持有的内容版本，发现外部修改时拒绝覆盖。
- IPC 参数和返回值都会被纯化为可结构化克隆的 JSON 数据，前端响应式 Proxy 不会直接穿过进程边界。
- 宿主会隐藏 `.git`、`node_modules` 和 `.pi` 等目录；所有项目路径都经过工作区边界校验。文本读取上限为 20 MB；超过 2 MB 的文本以只读大文件模式打开，保存上限为 20 MB。

## 关键目录与文件

| 模块 | 文件 | 职责 |
|---|---|---|
| 组合根 | `packages/ui/src/main.ts` | 创建内核并按清单注册内置插件 |
| 工作台骨架 | `packages/ui/src/shell/Shell.vue` | 摆放标题栏、对话区、编辑器、面板和活动栏 |
| 内核 | `packages/ui/src/kernel/workbench.ts` | 多工作区状态、会话切换、发送 / 停止、文件操作 |
| 内核 | `packages/ui/src/kernel/transcript.ts` | 把 Pi 消息与流式事件折叠成统一的消息块 |
| 终端 | `electron/terminal-host.ts` + `packages/ui/src/services/terminal.ts` + `components/terminal/` | 一次性后台命令、真实 PTY / xterm 屏幕、原始输入、resize、任务状态和底部面板 |
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

## 通知

界面提示和错误 Toast 统一使用中文文案：Electron IPC 的技术前缀会被移除，常见文件系统 / 网络错误会翻译成可读说明；无法识别的外部错误保留原始细节，并以「操作失败：」或「提示：」开头。

## 许可

MIT，见 [LICENSE](./LICENSE)。

部分交互与实现参考 [JetBrains ThinkRail](https://github.com/JetBrains/thinkrail)（Apache-2.0），详见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) 与 [docs/thinkrail-adoption.md](./docs/thinkrail-adoption.md)。
