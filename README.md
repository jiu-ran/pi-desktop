# Pi Desktop

基于本机 **Pi Agent CLI**（`@earendil-works/pi-coding-agent`）的跨平台桌面客户端，技术栈 **MyGo + Go 宿主 + Vue 3 / TypeScript**。

桌面端不跑模型、不内置工具，只通过 JSON-RPC 驱动你已经装好的 `pi`；会话记录（JSONL）由宿主增量读取，Pi 的配置与资源（MCP、软件包、Skills、`settings.json`）也由 Go 宿主读写，默认 `~/.pi/agent`，可用 `PI_CODING_AGENT_DIR` 覆盖。所有项目文件操作都限制在当前工作区目录内。

界面布局参考 JetBrains Air，配色与材质参考 Kero：粉紫到奶油的渐变窗框、透明侧栏、带镜面高光与柔和阴影的毛玻璃卡片、按项目分组的任务列表、标题栏面包屑、中央多标签编辑器、右侧文件树与变更审查，以及底栏带模型与思考等级的输入框。

## 目录

- [快速开始](#快速开始)
- [功能](#功能) · [工作区与对话](#工作区与对话) · [项目文件与编辑器](#项目文件与编辑器) · [终端与后台任务](#终端与后台任务) · [扩展工具与设置](#扩展工具与设置)
- [快捷键](#快捷键)
- [架构](#架构) · [插件清单](#插件清单) · [MyGo / Go 宿主边界](#mygo--go-宿主边界) · [关键目录与文件](#关键目录与文件)
- [开发](#开发) · [发布](#发布)
- [文档索引](#文档索引) · [许可](#许可)

## 快速开始

### 用现成的版本

到 [GitHub Releases](https://github.com/jiu-ran/pi-desktop/releases) 下载最新版本：

| 平台 | 产物 |
|---|---|
| Windows | `Pi.Desktop.exe`（便携）、`pi-desktop-setup-*.exe`（安装包） |
| macOS | `.dmg`（未签名，首次打开需在隐私与安全性里放行） |
| Linux | `.tar.gz` / `.deb` / `.rpm` |

前置条件只有一条：本机能在命令行跑 `pi`。桌面端跑的就是这份 `pi`，所以 `pi update` 之后桌面端当场就是新版本；没装 `pi` 时应用能打开，但不会启动会话。

### 从源码构建

前置：Go **1.27.3+**、Node.js **22.18+**、本机可运行的 `pi`，以及 `git`（版本控制面板与隔离工作区需要）。

```bash
npm install
npm ci --prefix packages/ui

npm run dev          # mygo dev：启动 Vite、编译 Go 宿主并打开窗口（改 Go 会自动重启）
npm run build        # mygo build：构建前端并编译当前平台的可执行文件
npm run dist         # 同上，同时产出 NSIS / dmg / tar.gz / deb / rpm
npm run check        # 57 个检查 + 3 个静态分析（tsc / vue-tsc / 语法）+ go test ./...
npm run check:go     # 只跑 Go 宿主测试
```

产物在 `dist-mygo/<os>-<arch>/`：Windows 约 36 MB（不再打包 Chromium）、macOS 是 `.app` / `.dmg`、Linux 是 `tar.gz` / `deb` / `rpm`。交叉构建用 `mygo build -platform windows/amd64,darwin/universal,linux/amd64`。

## 功能

### 工作区与对话

- **多项目并行**：每个项目对应一个 Pi RPC 工作区，可保留多个 Worker 跑并行任务（空闲 Worker 数 1–8 可调），后台任务完成时可发系统通知。同一目录用不同斜杠 / 大小写打开会被识别为同一个项目。
- **打开项目有两种入口**：「打开文件夹…」（`Ctrl+O`）与「从 Git 克隆…」（实时预览克隆目标、拒绝覆盖非空目录、支持 `https://` / `git@host:owner/repo` / `ssh://` / `file:///` 与本地路径）。
- **欢迎页与起点卡片**：没打开项目时显示本机 Pi 版本、最近项目与快捷键提示；空会话提供四张起点卡片（浏览结构 / 查找遗留问题 / 解释最近改动 / 审查未提交改动）。
- **会话**：新建、切换、重命名、停止运行中的任务；流式显示文本、思考、工具调用与通知块；向上滚动按页补历史（先加载最近 40 条并补齐至少 3 轮，长工具链最多 240 条，每次再加载 8 条），顶部显示已加载 / 总条数。
- **输入框**：四条命令式输入 —— 普通提问、`!` shell 模式、`@` 文件引用、`/` 斜杠命令，另有 ↑ / ↓ 历史（50 条）与排队消息编辑。
- **`!` 直接在对话里跑命令**：`!` / `!!` 只当模式标记不进入输入框，命令在项目目录执行、输出流式显示；`!` 的输出下次提问时作为上下文交给模型，`!!` 只留在会话记录里。运行中的卡片可「停止」或 Esc 中断，退出码非 0 标红，输出被截断时给出完整输出路径。
- **附件只传路径**：文本文件无论大小都只发绝对路径、大小和「请用 `read` 工具读取」的提示，避免长会话被附件重复撑爆；图片按图片发送并可 Ctrl+V 粘贴，目录附件附带目录树，徽标显示文件大小。
- **对话内搜索**（`Ctrl / Cmd + F`）只匹配用户消息与回复的**正文**，思考、工具参数与输出、运行中的内容都不参与计数。
- **会话大纲**：对话右侧按用户消息列出轮次，标注当前轮，悬停看「第 N 轮」摘要，点击跳转。
- **会话用量**：输入框右侧上下文占用环可点开弹层，显示上下文进度、累计输入 / 输出 / 缓存读写 Token、费用与消息统计（来自 Pi 的 `getSessionStats`）。
- **活动分组**：连续 4 步以上的思考 / 常规工具调用折叠成一组（单组最多 20 步），折叠头显示数量、动作摘要与运行中 / 失败状态；编辑 / 写入和带图片的结果保持独立。折叠头不吸顶，展开的长记录在「组头滚出视野、组尾还没到」时，聊天区右下角出现悬浮「收起」，与「回到底部」按钮上下错开。
- **失败与恢复**：Provider 报错、自动重试、上下文压缩都显示为状态卡片 —— 倒计时逐秒走、进度条按这次退避时间重走，成功后收成一行「已重新连接（第 N 次重试）」并收掉期间的红卡；手动重发恢复时红卡就地改成「✓ 已重新连接，任务继续」；彻底失败才写原因与重试次数。重开会话时也会认「后来已连上」，不留永久红卡。
- **MCP 调用可辨识**：三种暴露方式都能标出来 —— `direct` / `deferred` 用 `mcp__<服务>__<工具>`，`codemode` 下从脚本里认出 `tools.mcp__<服务>__<工具>`；时间线上带 `MCP · <服务>` 标记（同一脚本多次写 `×N`，多服务写 `服务 +N`），组头摘要还会统计「MCP N 次」，卡片标题是可读的工具名而不是原始编号。拼接出来的名字认不出就不标。
- **渲染**：Markdown 用 `markstream-vue`，代码块用 Shiki 按语言高亮并跟随主题，支持 Mermaid 图表（按 SVG 实际宽高比收缩预览）；超过 500 字的用户消息折叠成 6 行，`/skill:name` 渲染成可展开的技能卡片；助手消息可一键复制 Markdown 源文。

### 项目文件与编辑器

- **文件树**：浏览、搜索、刷新；标注 Git 状态（`M` / `U` / `D` / `R`）并汇总目录内变更数，一键「只看变更」；隐藏 `.git`、`node_modules`、`.pi`。
- **就地新建（仿 VS Code）**：新建文件 / 文件夹直接在目标目录长出一行输入框，Enter 创建、Esc 取消、点别处有名字就提交；名字不合法就地提示（斜杠、Windows 保留字符、`.` / `..`、超长）。
- **右键菜单**：系统程序打开、重命名、复制绝对 / 相对路径、在文件管理器中显示、移入回收站；项目根目录另有新建文件 / 文件夹与复制项目路径。
- **编辑器**：多标签、未保存状态、自动保存与 Markdown 预览，`.md` 源码也带语法高亮（可在插件管理里停用 Markdown 插件恢复纯文本）；标签右键可关其他 / 右侧 / 已保存、复制路径、在文件管理器中显示，关闭自动保存且有改动时会先确认。标签绑定打开时的项目目录与文件版本（切项目后再保存不会写错），保存前发现外部修改会提示冲突并保留草稿，写入用同目录临时文件 + 原子替换。
- **`@` 文件引用**按 Pi TUI 的方式只写 `@相对路径`（含空格 / 中文标点自动加引号，目录继续补全子路径），不内联内容，由模型自己 `read`。
- **引用对话（插件）**：`@` 里可以引用当前项目或其它项目的会话，选中后变成一枚「对话」附件，发送时压成上下文（只取用户与助手文字，单条 700 字、整块 12k 字封顶）；点附件可改名称与注入正文，「恢复自动摘要」一键还原。停用该插件后 `@` 只剩 Pi 自带的文件补全。
- **斜杠命令**：Pi CLI 的 24 条内置命令除 `/tree`、`/login`、`/logout`、`/share`、`/bug`、`/scoped-models`（依赖终端交互）之外都有桌面端实现，包括 `/trust`、`/import`、`/export`、`/changelog`、`/quit`；只能在终端用的那几条不进菜单，直接敲出来会说明原因。对照表见 [Pi 兼容记录](docs/pi-compatibility.md)。
- **排队消息可编辑**：任务进行中发出的消息先排队，气泡带「待发送」标记，点「编辑」可改写文字（Enter 保存、Esc 取消），自动附带的文件 / 引用上下文原样保留。

### 终端与后台任务

- **默认关闭的可选插件**：在「设置 → 终端」或「插件管理 → 工作台工具」启用后才出现终端按钮、底部终端岛与快捷键；停用只隐藏界面，不强制结束已有任务。
- **真实 PTY**：点击标题栏「+ / 新建终端」启动。Windows 默认 `%ComSpec%`（CMD + ConPTY），macOS / Linux 默认 `$SHELL` / 登录 shell；可运行 `pi`、Claude Code、Codex、mysql、psql、Node REPL、vim、top 等（应用不代装、不代登录）。默认 shell 可在设置里改，自动列出 pwsh、Windows PowerShell、Git Bash、CMD、Zsh、Bash、Fish，也支持自定义可执行路径 + JSON 参数数组；只校验文件、不执行探测，参数分开传给宿主。「+」旁「其他 shell…」可临时换 shell。
- **按键归终端**：`Ctrl+C` 中断当前程序而不是结束 shell，`exit` 或标签 × 结束整个进程树；Esc、`Ctrl+W`、`Ctrl+L` 原样交给终端，聚焦终端时不会误触发宿主关窗 / 刷新。滚轮优先交给应用协商的鼠标协议，全屏备用屏幕没有滚轮协议时改用 PageUp / PageDown。复制粘贴：`Ctrl+C` / `Ctrl+V`（macOS `Cmd+C` / `Cmd+V`）、`Ctrl+Shift+C` / `Ctrl+Shift+V`、`Ctrl+Insert` / `Shift+Insert`。
- **多任务**：最多 8 个运行中的终端或一次性后台任务；每个 PTY 会话保留独立屏幕与滚动位置，切换 / 收起不中断程序，尺寸变化会同步行列数。
- **标签与面板**：标签按「交互终端」「后台命令」分组，重名追加序号，过多时溢出为「全部」下拉，支持方向键 / Home / End / 滚轮横向浏览；面板分四层（全局操作 / 标签 / 状态行 / 命令栏），窄窗口隐藏辅助信息，高度低于 220px 进入紧凑模式。面板可拖拽调高并记住，最多占窗口高度 55%（最高 640px）。
- **后台命令**：底部命令栏始终可用，命令不进当前终端，只在任务列表新增一条；支持 ANSI 颜色、自动跟随 / 回到最新、自动换行、复制 / 清空、停止进程树、清屏与 ↑ / ↓ 历史。选中一条跑过的命令、输入框留空时按钮变成「重新执行」，Enter 就在**同一标签**里重跑（输出清空、位置不变）；「编辑」只把命令填回输入框。
- **接回任务**：任务由 Go 宿主托管，切项目或刷新窗口可接回；宿主保留每个任务最近 1 MB 原始输出，界面缓存最多 500 KB。终端输出按 24ms 批量上报、UTF-8 清洗，退出时杀进程树。

### 扩展工具与设置

- **变更条**：对话底部单行显示未提交文件数与增删统计，变窄时自动收起文件名，点击整条查看改动。
- **版本控制**：面板分「更改 / 分支 / 历史 / 工作区 / 快照」。更改按已暂存 / 未暂存 / 未跟踪分区，支持路径搜索、Agent 筛选、单文件与分组暂存 / 取消暂存，索引与工作区各自展示 Diff；提交栏显示目标分支与暂存数量，支持提交、获取 / 拉取 / 推送，非 Git 项目可初始化仓库；历史页可看提交树与详情，实时 Diff 支持行内评审并汇总进输入框。
- **分支管理**：搜索本地 / 远程分支、查看上游与最新提交；支持新建并切换、本地切换、从远程新建跟踪分支。写操作只允许在项目目录等于仓库根目录时执行；切换前请先提交或 stash、保存草稿并等 Agent 任务结束 —— 应用不会自动丢弃或强制覆盖改动。
- **隔离工作区**：从当前 HEAD 创建 `pi/<类型>-<名称>` 分支与独立 `git worktree`（类型 feat / fix / chore / docs / refactor / test / perf / ci），目录名默认「仓库名-分支名」；面板区分主工作区、Pi Desktop 创建的隔离工作区与外部 worktree，可打开、定位或移除（只删目录、保留分支，主工作区与使用中的工作区不可移除）。
- **插件管理**：按界面区域分组启停插件，核心插件不可停用。判断标准见[产品边界](docs/product-boundary.md)：**Pi 自带的能力留在核心**，其它一律做成插件。
- **工具开关**：启停 Pi 的内置工具（`read` / `bash` / `edit` / `write` / `grep` / `find` / `ls` / `powershell`）与内置扩展 `codemode` / `tool_search`。写入 `defaultTools` 用 Pi 官方推荐的增量写法：打开默认没有的写 `+name`、关掉默认有的写 `-name`，回到默认就删键（全部关掉才写 `[]`），Pi 以后调整默认集合时你的选择会跟着走；项目级只记与全局的差异，且需先信任项目。启动 Pi 时用 `--tools +name/-name` 校正已有会话（Pi 1.3 起恢复会话会保留当时的工具）；终端里的 `pi` 用的也是同一份选择。MCP 工具不受这里控制。
- **出网方式**：「设置 → Pi Desktop → 网络」可选**自动**（有代理环境变量就沿用，否则跟随系统）/ **系统代理** / **直连** / **自定义地址**（如 `127.0.0.1:7890`）。一次管两处：应用自己的请求走 Go 宿主的 HTTP 客户端，Pi 的模型请求 / MCP / `pi update` 走子进程的 `HTTP(S)_PROXY`（Pi 用 undici 的 `EnvHttpProxyAgent`，看不见系统代理，所以由桌面端转换后注入）。已在运行的会话需重启才换规则。
- **主题**：5 套浅色（云樱 / 晴空 / 青岚 / 琉璃 / 素雪）与 5 套深色（星夜 / 星云 / 极光 / 霜夜 / 曜石）wash 主题，浅色 / 深色窗口各自调校整套玻璃与表面色板；悬停提示统一使用跟随主题的浮层。
- **运行日志**：默认写在程序目录 `logs/`（不可写时回落到 userData），分 `app` / `renderer` / `pi` / `perf` 四个文件，记录启动退出、宿主调用失败与慢调用、前端报错、会话与压缩事件、界面卡顿。单文件 8 MB 轮转、总量上限可调（默认 100 MB），从最旧删起，内容先脱敏；设置里可查看目录、占用、打开或一键清理。
- **软件更新**：启动时检查 GitHub Release，发现新版本在标题栏与设置页提示，由用户手动下载。

## 快捷键

| 场景 | 快捷键 |
|---|---|
| 打开文件夹 | `Ctrl+O` |
| 对话内搜索 | `Ctrl / Cmd + F` |
| 快速打开文件 | `Ctrl / Cmd + P` |
| 关闭编辑器标签 | `Ctrl / Cmd + W`（输入框里不会误关窗口） |
| 切换 / 直达标签 | `Ctrl / Cmd + Tab`、`Ctrl / Cmd + 1`–`9` |
| 显示 / 隐藏终端 | `Ctrl / Cmd` + 反引号（需先启用终端插件） |
| 中断运行中的任务 | `Esc` |
| 输入框历史 | `↑` / `↓`（无选区且光标在首 / 末行时接管） |
| 终端复制 / 粘贴 | `Ctrl+C` / `Ctrl+V`（macOS `Cmd`）、`Ctrl+Shift+C` / `Ctrl+Shift+V`、`Ctrl+Insert` / `Shift+Insert` |

发送消息的快捷键在「设置 → 对话」里配置。

## 架构

分层是「组合根 → 界面骨架 → 内核 → 宿主」，插件只通过内核公开的上下文与贡献能力接入界面：

```text
main.ts                 组合根：创建内核、注册内置插件
  ├─ shell/              工作台骨架：标题栏、项目栏、对话区、编辑器、右侧面板
  ├─ components/         可复用界面组件：消息、工具卡片、面板、弹窗
  ├─ plugins/            功能插件：文件、版本控制、事件、Markdown、Mermaid、子代理、引用对话、终端等
  ├─ services/           主题、设置、命令面板、扩展 UI 等跨界面服务
  ├─ kernel/             事件总线、插件管理、工作区状态、会话投影、内容舞台
  └─ internal/host/      Go 宿主：窗口绑定、Pi Worker 池、文件 / Git / 终端 / 更新；每个工作区可运行并行 RPC 会话
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

插件可用 `dock` 贡献停靠组件，用 `defaultEnabled: false` 声明需要主动启用的可选功能；终端屏幕按需加载，未启用时不注册命令、也不启动宿主订阅。清单位于 [`plugins/index.ts`](packages/ui/src/plugins/index.ts)，生命周期与注册接口在 [`kernel/plugin-manager.ts`](packages/ui/src/kernel/plugin-manager.ts)。

### MyGo / Go 宿主边界

- `cmd/pi-desktop/main.go` 创建 MyGo 窗口并把 `Host` 绑定给前端；Windows / Linux 无边框（窗口按钮自绘），macOS 保留系统标题栏与红绿灯。单实例锁、关窗时的草稿确认都在宿主里。
- `internal/host/pool.go` 为每个工作区维护 Worker 池：启动 `pi --mode rpc`，按 `sessionId` 切换 / 新建 / 压缩 / 删除会话；每个 Worker 一条 JSONL RPC、默认 30 秒超时，白名单之外的方法直接拒绝。
- `internal/host/terminal.go` 用 ConPTY / Unix PTY 托管终端与一次性命令，退出时结束整棵进程树（Windows 用 Job 对象）。终端只在已授权项目目录启动。
- `internal/host/files.go` / `git.go` / `worktree.go` 做受控文件操作、Git 状态与写操作、隔离工作区：路径经过工作区边界与真实路径（防符号链接逃逸）校验，写入带 revision 冲突检测与原子替换。
- `internal/host/settings.go` / `resources.go` / `mcp.go` 读写 `settings.json`、`trust.json`、模型默认值、工具开关、扩展 / 技能 / 提示词 / 主题与 MCP 配置。
- `internal/host/bindings.go` 导出 `Host.*` 方法，前端桥 [`mygo/host.ts`](packages/ui/src/mygo/host.ts) 把它们适配成 `window.piDesktop` 形状，业务代码不感知宿主实现。事件通过 `pi:event`、`app:window-state`、`files:disk-change`、`pi:terminal-event` 推送。
- 开发模式下改 Go 代码由 `mygo dev` 自动重编译并重启；生产构建把 `packages/ui/dist` 嵌入可执行文件，运行时没有 Chromium、Node 或 `node-pty`。

### 关键目录与文件

| 模块 | 文件 | 职责 |
|---|---|---|
| 组合根 | `packages/ui/src/main.ts` | 创建内核并按清单注册内置插件 |
| 工作台骨架 | `packages/ui/src/shell/Shell.vue` | 摆放标题栏、对话区、编辑器、面板和活动栏 |
| 内核 | `packages/ui/src/kernel/workbench.ts` | 多工作区状态、会话切换、发送 / 停止、文件操作 |
| 内核 | `packages/ui/src/kernel/transcript.ts` | 把 Pi 消息与流式事件折叠成统一的消息块 |
| 终端 | `internal/host/terminal.go` + `services/terminal.ts` + `components/terminal/` | 一次性后台命令、PTY / xterm 屏幕、原始输入、resize、任务状态与底部面板 |
| 插件 | `packages/ui/src/plugins/files/` | 文件树、编辑器和文件操作 |
| 插件 | `packages/ui/src/plugins/markdown/` | Markdown 预览与 Mermaid 共用渲染开关 |
| 插件 | `packages/ui/src/plugins/mermaid/` | Mermaid 插件启停生命周期 |
| 渲染修复 | `packages/ui/src/plugins/markdown/mermaid-fit.ts` | 按 SVG 视图框比例修正 Mermaid 预览高度 |
| 宿主 | `internal/host/*.go` | Pi Worker 池、白名单 RPC、文件 / Git / 终端 / 设置 / 更新 |
| 自检 | `scripts/checks/` + `internal/host/*_test.go` | 界面纯逻辑检查；Go 会话分页 / 模型默认值 / 工具开关 / 文件 / Git 与 worktree 测试 |

## 开发

- **只调前端**：在 `packages/ui` 下 `npm run dev`；开发服务器默认 `127.0.0.1:1420`。`mygo dev` 用独立的应用名（`Pi Desktop Dev`）与 userData 目录，可以和已安装版同时运行。
- **内容安全策略**：窗口页面加载 CSP（WebView 里同样生效），只允许自身脚本 / 样式、`data:` / `blob:` / `https` 图片与本地工作线程。新增依赖如果用 `eval`、内联脚本或远程 `http` 资源，要同步改 `packages/ui/index.html` 的策略。
- **剪贴板与回收站**：界面里所有「复制」「删除」都走宿主（系统剪贴板 / 回收站 API），失败时用界面通知反馈。
- **提示文案**：Toast 统一中文，宿主绑定的技术前缀会被移除，常见文件系统 / 网络错误翻译成可读说明，认不出的保留原文并以「操作失败：」「提示：」开头。
- **终端**：Windows 10 1809+、macOS 13+、Linux（glibc 2.28+）。用 Go 的 ConPTY / Unix PTY，不需要 `node-pty` 或 C++ 工具链。
- **一次性探针**写进 `temp/`，用完删；新检查放进 `scripts/checks/*.check.ts` 会被自动发现。

## 发布

1. 改版本号（`package.json` 与 `package-lock.json`）和 `CHANGELOG.md`，写 `docs/releases/v<版本>.md`。
2. 按 [`docs/release-review.md`](docs/release-review.md) 的分级验证逐节跑：`npm run check`、宿主冒烟、打包与手工验收。
3. 打 tag 触发 GitHub Actions，三个平台构建 + 发布 Release（资产与 `SHA256SUMS.txt` 齐全后再对外）。

升级本机 `pi` 之后，按 [`docs/pi-compatibility.md`](docs/pi-compatibility.md) 复查宿主自己实现的配置 / 资源 / RPC 规则是否还跟得上；宿主架构与迁移对照见 [`docs/mygo-migration.md`](docs/mygo-migration.md)。

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/product-boundary.md`](docs/product-boundary.md) | 桌面端能做什么、不能做什么；什么该做成插件 |
| [`docs/pi-compatibility.md`](docs/pi-compatibility.md) | 与 Pi CLI 的能力对照、斜杠命令映射、已知差异 |
| [`docs/mygo-migration.md`](docs/mygo-migration.md) | Electron → MyGo + Go 宿主的迁移对照与探针覆盖 |
| [`docs/release-review.md`](docs/release-review.md) | 发布前自检清单与验证分级 |
| [`docs/thinkrail-adoption.md`](docs/thinkrail-adoption.md) | 参考 JetBrains ThinkRail 的功能对照与取舍 |
| [`docs/releases/`](docs/releases) | 每个版本的更新说明 |

## 许可

MIT，见 [LICENSE](./LICENSE)。

部分交互与实现参考 [JetBrains ThinkRail](https://github.com/JetBrains/thinkrail)（Apache-2.0），详见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) 与 [docs/thinkrail-adoption.md](./docs/thinkrail-adoption.md)。
