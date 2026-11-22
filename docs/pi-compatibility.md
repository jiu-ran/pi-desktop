# Pi 兼容记录

记录桌面端为适配当前 Pi 版本而保留的行为。升级**本机安装的 pi**（或调整下面任何一致性规则）时，必须同时复查每一项。

## 当前版本

- 依赖：**不依赖 Pi 的 npm 包**；安装包里没有 Pi 的副本
- 会话运行时：**本机安装的 pi**（`pi --mode rpc`），入口由 `internal/host/entry.go` 从 PATH / 设置里的自定义路径反解成 `dist/cli.js`；找不到就提示安装
- 通信方式：自己实现的 `PiRpcClient`（`internal/host/rpc.go`），由 Go 宿主直接起 `node dist/cli.js` 或独立 `pi` 可执行文件，不依赖桌面端自带的 Node
- 配置 / 资源 / 技能：自己实现（`internal/host/resources.go`）
- 白名单：`internal/host/pool.go（`allowedRpcMethods`）`

## 适配项

| 适配 | 位置 | 原因 | 删除条件 |
|---|---|---|---|
| 使用 RPC 而非进程内 SDK 会话 | `internal/host/pool.go 等 Go 宿主` | 保持桌面端与 Pi 进程隔离 | Pi 提供受支持的嵌入式主机 API 且产品决定改变运行方式 |
| 会话跑本机 pi，不用依赖里的副本 | `internal/host/entry.go` | 产品边界要求不内置 Pi 的推理与工具执行；用户 `pi update` 后桌面端要立刻用上新版本 | Pi 官方提供「指定 CLI 入口」的正规 API |
| 自己解析安装方式（PATH 与常见目录） | `internal/host/entry.go（locatePi / piKnownCandidates / resolvePiCommand）` | Pi 有五种官方装法，落点各不相同（见下节），且 Windows 的 PATH 是登录时继承的，装完 pi 不注销就对已运行的桌面端不可见 | Pi 提供「查询安装位置」的 CLI 子命令 |
| 自己实现 RPC 客户端 | `internal/host/rpc.go` | 不想把整个 Pi 包拖进安装包；也不想因上游写死 `spawn("node")` 而要求用户装 Node | Pi 官方提供无依赖的 RPC 客户端 |
| 自己读写设置 / 软件包 / 技能 | `internal/host/resources.go` | 同上；只依赖 Pi 的磁盘约定（settings.json / `pi` 字段 / 目录布局） | Pi 把这些能力全部做成带 `--json` 的 CLI |
| 附件在发送前转换为文件和图片内容 | `internal/host/pool.go 等 Go 宿主` | 当前 RPC 提示接口接收文本和图片，不接收桌面端附件对象 | Pi 提示接口原生支持受控文件附件 |
| 界面缓存派生自 RPC 快照和事件 | `packages/ui/src/kernel` | 界面需要立即响应，但不能变成第二份会话记录；打开会话的首屏历史直接读会话文件分页（`messagePage`），快照里的 messages 只在空会话时向 Pi 要 —— 否则带大图的会话要整份往返一次 | 界面能直接订阅 Pi 的完整只读状态并仍满足响应要求 |

| `/` 命令由桌面端自己实现一遍 | `packages/ui/src/shared/pi-commands.ts`、`services/slash-commands.ts` | RPC 的 `get_commands` 只返回扩展 / 提示模板 / 技能三类，Pi 的 24 条内置命令都得自己接 | Pi 的 RPC 直接提供内置命令的枚举与执行 |
| 项目信任自己读写 `trust.json` | `internal/host/settings.go` | Pi 在 RPC 模式下拿不到「信不信任这个目录」的回答，默认按不信任处理，项目级扩展 / 技能 / MCP 会静默不加载 | Pi 的 RPC 提供 trust 查询与设置 |
| 出网方式自己选，并转成子进程环境变量 | `internal/host/network.go`、`packages/ui/src/shared/network-mode.ts` | Pi 用 undici 的 `EnvHttpProxyAgent`，只认 `HTTP(S)_PROXY`；系统代理设置它看不见，RPC 也没有「设置代理」的命令 | Pi 的 RPC 或设置里提供代理配置 |
| 会话导入 / JSONL 导出自己实现 | `internal/host/pool.go 等 Go 宿主`（`importSession` / `exportSessionJsonl`） | RPC 只有 `export_html`，没有 import / jsonl 导出 | Pi 的 RPC 补齐这两条命令 |
| 对话里的 `!` / `!!` 走 RPC `bash` | `internal/host/rpc.go`、`packages/ui/src/shared/bash-input.ts` | 命令输出要在对话里边跑边看；RPC 的最终结果与流式增量靠桌面端生成的 `id` 关联 | Pi 的 RPC 取消 `bash` / `abort_bash` 或改为其它协议 |
| 工具开关写入 `defaultTools`，启动时用 `--tools` 校正 | `internal/host/settings.go`、`packages/ui/src/components/overlays/settings/ToolSettings.vue` | RPC 没有运行时启停工具的接口；`defaultTools` 只在启动时读取，已有会话还会从记录里恢复自己的工具 | Pi 的 RPC 提供工具清单与运行时启停 |

## 安装方式与识别顺序

Pi 官方（pi.dev）目前给五种装法，桌面端按下面的顺序认：

1. **设置里的手动路径**（`piCustomPath`）——最高优先级，填 `.cmd` / 可执行文件 / `.js` 都行，`.js` 会用 node 拉起
2. **PATH** 上的 `pi` / `pi.cmd` / `pi.exe`
3. **PATH 没有时扫已知目录**：`<agentDir>/bin`（官方安装器）、`%APPDATA%\npm`、`%LOCALAPPDATA%\pnpm`、`%LOCALAPPDATA%\Programs\pi`、`~/.bun/bin`、`~/.local/bin`、`~/bin`、`~/.bin`、`~/.nix-profile/bin`、`/opt/homebrew/bin`、`/usr/local/bin`

认出来之后，启动命令按来源决定：

| 安装方式 | 入口 | 桌面端怎么起 |
|---|---|---|
| 官方安装器（Windows） | `<agentDir>\bin\pi.cmd` → `pi-launcher.js` | `node <agentDir>\bin\pi-launcher.js --mode rpc`（launcher 自己读 `install/current-version`、设 `PI_MANAGED_INSTALL_ROOT`） |
| 官方安装器（macOS / Linux） | `<agentDir>/bin/pi`（sh launcher），常以 `~/.local/bin/pi` 软链暴露 | 直接执行 launcher（它自己设置随包 Node 的 PATH） |
| npm / pnpm 全局 | `<prefix>/pi.cmd`（Windows）、`<prefix>/bin/pi`（Unix） | 解析 shim 里的入口后 `node <…>/dist/cli.js`（老包）或 `dist/bundle/cli.js`（新包） |
| bun 全局 | `~/.bun/bin/pi` | 相对路径能解析就 `node` 跑，解析不到就直接执行（shebang 指向 bun） |
| Nix | `~/.nix-profile/bin/pi` 包装脚本 | 直接执行 |
| 源码 / 自定义 | 手动填 `dist/cli.js` 或 `pi-launcher.js` | `node <该 js> --mode rpc` |

`locatePi` 的结果带 `source`（PATH / 官方安装器 / npm 全局 / …），设置页会显示，`pi.log` 里的「Pi 启动命令」也会记下来源与实际路径 —— 「设置里能识别、工作区却进程出错」时先看这一行。

## 自己实现部分的已知差异

这些是「不再复用 Pi 的 SDK」后由本项目维护的规则，升级 Pi 后需要抽查（`npm run check` 里的 `pi-*` 检查覆盖了纯函数部分）：

- **逐项启用 / 停用**：`pi config` 是 TUI，桌面端没有对应实现。设置里写成对象（`{source, autoload, skills, …}`）时按白名单处理，不列出具体项就全部启用/禁用，不能再细到单个资源。
- **资源类型判定**按扩展名收集：扩展 `.js/.mjs/.cjs/.ts`、技能 `SKILL.md`、提示词 `.md`、主题 `.json`。Pi 如果新增类型，这里要跟着改。
- **自动发现范围**：`<agentDir>/{extensions,skills,prompts,themes}`、`<cwd>/.pi/{extensions,skills,prompts,themes}`，以及用户级 `~/.agents/skills`；项目祖先目录里的 `.agents/skills` 只在 `skillsOverview` 的目录列表里展示，不参与资源合并。
- **安装位置**：npm 包在 `<agentDir>/npm/node_modules/<名>`（项目级在 `<cwd>/.pi/npm/…`），git 源在 `<agentDir>/git/<host>/<path>`。老版本 Pi 用的全局 npm 目录不再识别。
- **安装 / 卸载 / 更新**走本机 `pi install|remove|update`，失败时把 `pi` 的输出尾部反馈到界面。

## `/` 命令对照（Pi 1.4.0）

Pi 的内置命令在 CLI 的交互模式里实现，RPC 的 `get_commands` 只返回扩展命令、提示模板与技能。所以桌面端按 `shared/pi-commands.ts` 这张表逐条适配，`pi-commands.check.ts` 盯着「表里的桌面端条目必须在 `slash-commands.ts` 里有实现」——Pi 升级加命令时这里会直接报红。

| 命令 | 桌面端 | 说明 |
|---|---|---|
| `/settings` `/model` `/thinking` `/copy` `/name` `/session` | 等价实现 | 桌面端自己的设置页 / 模型选择 / 思考等级 / 剪贴板 |
| `/new` `/resume` `/fork` `/clone` | 等价实现 | 会话管理；`/fork` 列出可分的用户消息 |
| `/compact` `/reload` `/export` | 等价实现 | `/export` 同时支持 `.html` 与 `.jsonl` |
| `/import` | 等价实现 | 外部 `.jsonl` 复制进当前项目的会话目录再切换 |
| `/trust` | 等价实现 | 读写 `<agentDir>/trust.json`，写入后重启 Pi 让资源重新加载 |
| `/changelog` `/quit` | 等价实现 | 打开本版本更新日志 / 关闭窗口 |
| `/tree` | 只能终端 | RPC 没有「切换分支」的能力；桌面端用 `/fork` 代替 |
| `/login` `/logout` | 只能终端 | 凭据由 Pi 的交互流程接管（浏览器 OAuth / 输入 API Key），桌面端不碰 |
| `/share` `/bug` | 只能终端 | Pi 的云端分享与诊断报告，需要 Pi 自己的授权 |
| `/scoped-models` | 只能终端 | 桌面端没有 Ctrl+P 轮换模型的开关，也就没有「轮换范围」 |

**撞名时桌面端优先**：Pi 自带的扩展里就有 `mcp`（管 MCP 的 OAuth 登录），如果让扩展赢，敲 `/mcp` 会进扩展的流程（对话里还会多一条 `/mcp` 消息），而不是打开 MCP 设置页。所以 `mergeCommands` 保留桌面端实现、隐藏同名的扩展命令（`slash-merge.check.ts` 盯着这条）。

MCP 服务的 OAuth 授权仍然交给 Pi：设置页的「登录 / 退出登录」直接转发 `pi mcp login|logout`（授权在浏览器里完成，凭据由 Pi 保存），完成后自动刷新服务状态。

只能在终端里做的命令**不进 `/` 菜单**（菜单里只列真能执行的）。直接敲出来时：菜单里显示「/login 只能在终端里用」，回车给出一句说明（为什么没做 + 现在怎么做），同时清空输入框 —— **不会**把 `/login` 这样的文字发给模型。

### 工具开关（`defaultTools`）

设置 → 扩展 → 工具开关读写 Pi 的 `defaultTools`（全局或项目 `.pi/settings.json`），沿用 Pi 的语义：

- 普通名单替换默认的 `read` / `bash` / `edit` / `write`，只有 `+name` / `-name` 才叠加；空数组表示全部停用。
- 界面的「恢复 Pi 默认」= **删掉 `defaultTools` 键**（不是写空数组）：Pi 缺省就是 `read` / `bash` / `edit` / `write` 四个，页面上显示 4 / 8；显式 `[]` 才显示 0 / 8 并带一条红字提醒。
- 项目普通名单替换全局；项目只写 `+/-` 时叠加在全局选择上。
- 写入时只记「与继承选择的差异」：新增写 `+name`、去掉写 `-name`，与继承完全一致就删掉键（不是写 `[]`）；目录外的扩展工具名 / `mcp__*` 条目照原样保留。这样 Pi 以后调整默认工具集合时，用户的选择会跟着走。
- `codemode` / `tool_search` 属于内置扩展，也能在这里启用；MCP 工具不受影响，仍由 MCP 页的暴露模式控制。
- 项目级开关和其他 `.pi` 资源一样受项目信任约束：未信任时 Pi 不加载 `.pi/settings.json`，桌面端也不写（设置页会给出「信任此项目」按钮，或先执行 `/trust`）。

**已有会话也要生效**：Pi 1.3 起恢复会话时会保留会话记录里的工具，只改 `defaultTools` 对它们无效。因此桌面端在 `defaultTools` 有配置时，启动 Pi 会附上 `--tools +read,+bash,…,-write,…`（Pi 1.1 起是叠加语义），把目录内工具校正到开关状态；没配置过时不传，保持 Pi 自己的默认行为与恢复规则。启动参数在 `PiRpcClient.start()` 里追加，正常 worker 与温备 worker 都走同一条路径。

开关在下次启动 Pi 时读取；设置页提供「重启空闲会话」，正在输出的会话会在本轮结束后才用上新工具。

### 项目信任（`/trust`）

Pi 只在项目里有「需要信任」的资源时才校验：`.pi/{settings.json,mcp.json,extensions,skills,prompts,themes,SYSTEM.md,APPEND_SYSTEM.md}`，或自己 / 祖先目录里的 `.agents/skills`。校验顺序是信任记录 → `defaultProjectTrust` 设置 → 弹窗询问。

桌面端走 RPC（没有 TUI），最后一步拿不到答案，于是**一律按不信任处理**——项目级扩展、技能、MCP 全部静默不加载，而「设置 → 扩展 → Skills」里的清单是按文件扫出来的，看起来一切正常。所以桌面端：

- 技能页在「需要信任但未生效」时显示横幅与「信任此项目」按钮；
- `/trust` 可以查看状态、写入信任 / 信任上一级目录 / 不信任，写入后自动重启 Pi 进程（资源在启动时加载，不重启不生效）。
