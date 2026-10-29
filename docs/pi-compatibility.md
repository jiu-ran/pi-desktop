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

## 自己实现部分的已知差异

这些是「不再复用 Pi 的 SDK」后由本项目维护的规则，升级 Pi 后需要抽查（`npm run check` 里的 `pi-*` 检查覆盖了纯函数部分）：

- **逐项启用 / 停用**：`pi config` 是 TUI，桌面端没有对应实现。设置里写成对象（`{source, autoload, skills, …}`）时按白名单处理，不列出具体项就全部启用/禁用，不能再细到单个资源。
- **资源类型判定**按扩展名收集：扩展 `.js/.mjs/.cjs/.ts`、技能 `SKILL.md`、提示词 `.md`、主题 `.json`。Pi 如果新增类型，这里要跟着改。
- **自动发现范围**：`<agentDir>/{extensions,skills,prompts,themes}`、`<cwd>/.pi/{extensions,skills,prompts,themes}`，以及用户级 `~/.agents/skills`；项目祖先目录里的 `.agents/skills` 只在 `skillsOverview` 的目录列表里展示，不参与资源合并。
- **安装位置**：npm 包在 `<agentDir>/npm/node_modules/<名>`（项目级在 `<cwd>/.pi/npm/…`），git 源在 `<agentDir>/git/<host>/<path>`。老版本 Pi 用的全局 npm 目录不再识别。
- **安装 / 卸载 / 更新**走本机 `pi install|remove|update`，失败时把 `pi` 的输出尾部反馈到界面。
