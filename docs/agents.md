# 多 Agent 接入（ACP）

桌面端默认驱动本机 **Pi Coding Agent**（`pi --mode rpc`）。从 0.10 起，还可以按项目切换到其它本机 CLI Agent；第一个接入的是 **Antigravity CLI**（`agy`）。两者共用同一套对话、工具卡片、模型选择与会话面板，区别只在协议层。

## 为什么用 ACP，而不是再写一套私有协议

Antigravity 自带 `agy acp`：一个基于 stdio 的 [Agent Client Protocol](https://agentclientprotocol.com) v1 服务器，Zed / JetBrains / Xcode 等编辑器已经用它。桌面端只做三件事：

1. 启动本机 `agy acp` 子进程；
2. 按行收发 JSON-RPC；
3. 把 ACP 的 `session/update` 翻译成界面已经在用的 Pi 风格事件 / 消息。

**不注入提示词**：`initialize` 只声明客户端能力（不读不写文件、不开终端），`session/new` 只传 `cwd` 和空的 `mcpServers`。Agent 的系统提示词、技能、MCP 配置全部来自 `agy` 自己。

## 选择与进程模型

- **打开目录不启动 Agent**：目录第一次打开、`agents.json` 里没有记录时，只创建空闲工作区，**不启动任何 Agent**（也不会默认连接 Pi），更不会弹选择器。输入框左侧的 Agent 菜单用来为新会话选 Agent；选完才开始新会话。
- **默认仍是「每次询问」**：可以在「设置 → 智能体」里为新项目指定默认值；项目自己的选择优先，选过之后记在**项目目录**下，后续新会话沿用。
- 标题栏左侧的 Agent 胶囊随时可以切换当前项目的 Agent，输入框里的 Agent 菜单用于当前 / 新会话；两个入口共用同一份选择。
- 「设置 → 智能体」提供智能体列表和详情：查看版本 / 路径、重新检测、设置新项目默认值、修改启动命令、打开登录；Antigravity 还能设置新会话的默认模型与思考档位。Pi 的路径 / 版本 / 更新在 Pi 详情里，不再单开「Pi CLI」页。
- 每个启用了 Antigravity 的项目各跑一个 `agy acp` 进程；项目关闭 / 应用退出时一起结束（Windows 放进 Job，Unix 用进程组）。
- 切换 Agent 会先关掉旧进程；有任务在跑时必须先停止。

## 协议映射

| ACP | 桌面端表现 |
|---|---|
| `session/new` / `session/load` | 会话；`session/load` 回放的消息直接进历史，不再发实时事件 |
| `agent_message_chunk` | 流式正文（`text_delta`） |
| `agent_thought_chunk` | 思考块（`thinking_delta`） |
| `tool_call` / `tool_call_update` | 工具卡片开始 / 更新 / 结束；`read_file`→`read`、`run_command`→`bash`、`write_file`→`write`、`edit_file`→`edit` |
| `usage_update` | 输入框右侧上下文占用环 |
| `available_commands_update` | `/` 菜单里的 Agent 命令 |
| `session_info_update` | 会话标题 |
| `config_option_update` | 模型 / 思考档位 |
| `session/request_permission` | 桌面端权限弹窗（允许 / 拒绝），10 分钟无人响应自动取消 |
| `session/cancel` | 「停止」按钮 |

会话在界面里用 `antigravity://<sessionId>` 作为 `sessionFile`，所以现有的会话线程、草稿、用量缓存不需要为 ACP 单独开一套。

## 模型与默认值

- 模型列表来自 `session/new` 的 `configOptions`（`model` / `thought_level` / `mode`）。
- **默认模型兼容处理**：`agy 1.5.11` 的 `session/new` 默认给 `gemini-4-argon`，在本机实测 90 秒内没有任何 `session/update`（`agy -p` 也会卡住）；`gemini-4-hydrogen` / `gemini-3.8-flash` 十几秒内正常回复。所以新会话会优先落到氢 / Flash；默认值只由设置页写入 `agents.json` 的 `models`，会话里临时切换不会改默认值。
- 「设置 → 智能体 → Antigravity」可以固定新会话的默认模型与思考档位，写入桌面端的 `agents.json`，不改 Antigravity 自己的配置。Pi 的默认模型仍在「对话与 Agent」页管理。

## 已知限制

- 会话名由 CLI 生成，桌面端不支持重命名；删除会话也不可用（`session/list` 里没有删除接口）。
- 不支持 fork / clone / `/tree` / 导出 HTML。
- 对话里的 `!` 命令由桌面端在本机 shell 执行并显示结果，**不会**进入 Antigravity 的上下文（Pi 会话里由 Pi 记录）。
- ACP 没有按文件分页读取历史的接口，`session/load` 一次性回放，`messagePage` 返回全量（`startIndex = 0`）。
- 本地模式和远程模式都以 CLI 自己的权限设置为准；桌面端只在 CLI 主动请求时弹确认。

## 验证

```bash
# 纯映射 / 会话身份 / 配置解析（不联网）
go test ./internal/host -run 'TestAntigravity|TestNormalizeAcp|TestAcpUsage'

# 真实 ACP 一轮（会调用一次本机 Antigravity，消耗少量配额）
PI_ACP_TEST=1 go test -tags integration ./internal/host -run TestAntigravityTurn -v -timeout 240s
```

## 再接入一个 Agent

1. 确认它的 CLI 提供 ACP stdio 模式（例如 `xxx acp`）。
2. 在 `internal/host/antigravity.go` 里复用 `acpClient`，新增一个工作区实现：`initialize → session/new/load → prompt`，把 update 翻成同一组事件。
3. 在 `Agents` / `SetAgent` / `LocateAgent` 注册 kind 与探测命令，标题栏会自动出现新条目。
4. 若它没有 ACP，只剩 `-p` / NDJSON 之类的一次性输出，不建议接入：会话、工具确认和历史回放都要自己补，等于再写一个 Agent。
