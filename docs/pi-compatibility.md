# Pi 兼容记录

记录桌面端为适配当前 Pi 版本而保留的行为。升级**本机安装的 pi**（或调整下面任何一致性规则）时，必须同时复查每一项。

## 当前版本

- 依赖：**不依赖 Pi 的 npm 包**；安装包里没有 Pi 的副本
- 会话运行时：**本机安装的 pi**（`pi --mode rpc`），入口由 `electron/pi-entry.ts` 从 PATH / 设置里的自定义路径反解成 `dist/cli.js`；找不到就提示安装
- 通信方式：自己实现的 `PiRpcClient`（`electron/pi-rpc.ts`），用 `process.execPath` + `ELECTRON_RUN_AS_NODE` 起进程，不要求 `node` 在 PATH 里
- 配置 / 资源 / 技能：自己实现（`electron/pi-resources.ts`）
- 白名单：`electron/pi-rpc-allowlist.ts`

## 适配项

| 适配 | 位置 | 原因 | 删除条件 |
|---|---|---|---|
| 使用 RPC 而非进程内 SDK 会话 | `electron/pi-host.ts` | 保持桌面端与 Pi 进程隔离 | Pi 提供受支持的嵌入式主机 API 且产品决定改变运行方式 |
| 会话跑本机 pi，不用依赖里的副本 | `electron/pi-entry.ts` | 产品边界要求不内置 Pi 的推理与工具执行；用户 `pi update` 后桌面端要立刻用上新版本 | Pi 官方提供「指定 CLI 入口」的正规 API |
| 自己实现 RPC 客户端 | `electron/pi-rpc.ts` | 不想把整个 Pi 包拖进安装包；也不想因上游写死 `spawn("node")` 而要求用户装 Node | Pi 官方提供无依赖的 RPC 客户端 |
| 自己读写设置 / 软件包 / 技能 | `electron/pi-resources.ts` | 同上；只依赖 Pi 的磁盘约定（settings.json / `pi` 字段 / 目录布局） | Pi 把这些能力全部做成带 `--json` 的 CLI |
| 附件在发送前转换为文件和图片内容 | `electron/pi-host.ts` | 当前 RPC 提示接口接收文本和图片，不接收桌面端附件对象 | Pi 提示接口原生支持受控文件附件 |
| 界面缓存派生自 RPC 快照和事件 | `packages/ui/src/kernel` | 界面需要立即响应，但不能变成第二份会话记录 | 界面能直接订阅 Pi 的完整只读状态并仍满足响应要求 |
| `/` 命令由桌面端自己实现一遍 | `packages/ui/src/shared/pi-commands.ts`、`services/slash-commands.ts` | RPC 的 `get_commands` 只返回扩展 / 提示模板 / 技能三类，Pi 的 24 条内置命令都得自己接 | Pi 的 RPC 直接提供内置命令的枚举与执行 |
| 项目信任自己读写 `trust.json` | `electron/project-trust.ts` | Pi 在 RPC 模式下拿不到「信不信任这个目录」的回答，默认按不信任处理，项目级扩展 / 技能 / MCP 会静默不加载 | Pi 的 RPC 提供 trust 查询与设置 |
| 会话导入 / JSONL 导出自己实现 | `electron/pi-host.ts`（`importSession` / `exportSessionJsonl`） | RPC 只有 `export_html`，没有 import / jsonl 导出 | Pi 的 RPC 补齐这两条命令 |

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

只能在终端里做的命令仍然出现在 `/` 菜单末尾，标「需终端」；选中后在对话里给出一句说明（为什么没做 + 现在怎么做），**不会**把 `/login` 这样的文字发给模型。

### 项目信任（`/trust`）

Pi 只在项目里有「需要信任」的资源时才校验：`.pi/{settings.json,mcp.json,extensions,skills,prompts,themes,SYSTEM.md,APPEND_SYSTEM.md}`，或自己 / 祖先目录里的 `.agents/skills`。校验顺序是信任记录 → `defaultProjectTrust` 设置 → 弹窗询问。

桌面端走 RPC（没有 TUI），最后一步拿不到答案，于是**一律按不信任处理**——项目级扩展、技能、MCP 全部静默不加载，而「设置 → 扩展 → Skills」里的清单是按文件扫出来的，看起来一切正常。所以桌面端：

- 技能页在「需要信任但未生效」时显示横幅与「信任此项目」按钮；
- `/trust` 可以查看状态、写入信任 / 信任上一级目录 / 不信任，写入后自动重启 Pi 进程（资源在启动时加载，不重启不生效）。
