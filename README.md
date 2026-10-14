# Pi Desktop

基于本机 **Pi Agent CLI** 的跨平台桌面客户端（Electron + Vue 3）。界面布局与配色参考 JetBrains Air：深色窗框上的圆角“岛”、按项目分组的任务列表、标题栏面包屑、底栏带模型与思考等级的输入框。

界面只负责交互与呈现。推理、工具、扩展、Skills、MCP 与会话全部由用户已安装的 `pi` 处理，桌面端不内置 Pi，也不读写 `~/.pi/agent` 与项目 `.pi/`。

## 下载与安装（v0.1.0）

- **预构建安装包 / 便携包**：前往 [GitHub Releases (v0.1.0)](https://github.com/jiu-ran/pi-desktop/releases/tag/v0.1.0) 下载对应系统版本（Windows `.exe` / `.zip`、macOS `.dmg` / `.zip`、Linux `.AppImage` / `.tar.gz`）。
- **前置条件**：本机需已安装并可在命令行运行 `pi`（`@earendil-works/pi-coding-agent`）。

## 从源码运行与打包

```bash
npm install
npm install --prefix packages/ui
npm run dev          # 开发模式（Vite + Electron）
npm run build        # 构建前端静态资源
npm start            # 直接启动桌面端（使用已构建的 packages/ui/dist）
npm run dist         # 打包当前系统安装包与便携包（输出到 dist/）
npm run check        # 投影层、diff、宿主进程池、删除、附件、文件树与保存自检
npm run check:smoke  # 真实 Electron 冒烟测试（需先启动 Vite）
```

## 架构

分四层，上层只依赖下层的公开接口。

```text
plugins/   功能插件：所有可见功能都是插件
shell/     工作台骨架：只摆放插槽，不含业务
kernel/    内核：事件总线、贡献点、插件管理、工作区状态、会话投影
electron/  宿主：每个工作区一个 pi --mode rpc，只经官方 RpcClient 通信
```

| 模块 | 文件 | 职责 |
|---|---|---|
| 宿主 | `electron/pi-host.js` | 进程池、会话目录、白名单 RPC、回写 `extension_ui_response` |
| 宿主 | `electron/main.js` / `preload.cjs` | 窗口与 IPC；所有返回值纯化为 JSON |
| 内核 | `kernel/transcript.js` | 把 Pi 消息与流式事件折叠成统一的「块」 |
| 内核 | `kernel/workbench.js` | 多工作区状态、事件分发、发送 / 停止 / 切换会话 |
| 内核 | `kernel/contributions.js` | 15 个贡献点 |
| 内核 | `kernel/plugin-manager.js` | 注册、启用、停用；停用时撤销全部贡献与订阅 |
| 骨架 | `shell/Shell.vue` | 标题栏 / 侧栏岛 / 主舞台岛 / 编辑器岛 / 多面板岛 / 右侧工具条 / 浮层（支持拖拽调整宽度与双击恢复默认） |

## 内置插件

| 插件 | 贡献点 | 功能 |
|---|---|---|
| `pi.core.conversation` | views.main, titlebar | 按回合分组的对话时间线、输入框（模型 / 思考 / 排队或引导）、标题栏面包屑、欢迎页；用 `@` 内联选择器或 `+` 添加文件 / 文件夹附件 |
| `pi.builtin.files` | views.editor, views.panel, commands | 右侧项目文件树（限定在当前工作区内、跳过符号链接与 `.git`/`.pi`）+ 中央多标签页纯文本带行号文件编辑器（支持修改、脏状态指示、`Ctrl+S` 保存、系统默认程序打开） |
| `pi.builtin.messages` | messageRenderers | Markdown（markstream-vue）、思考块、提示 |
| `pi.builtin.tool-cards` | toolRenderers | 一行式工具步骤（Ran / Read / Edited +N −M），展开看终端输出、diff、MCP 参数与结果 |
| `pi.builtin.slash` | slash | 输入框 `/` 命令：用 RPC 实现 Pi 的内置命令（/new /resume /model /thinking /compact /name /session /copy /export /fork /clone /reload /hotkeys），并和 Pi 的扩展命令、提示模板、技能分组展示；/settings /login 等只能在终端界面用的命令不展示 |
| `pi.builtin.tasks` | views.sidebar, titlebar, overlays, commands | 按项目分组的任务（会话）列表，未启动的项目也能浏览历史；搜索、切换、新建；右键或 ⋯ 菜单删除任务、删除项目全部任务、移除项目（会话文件移入系统回收站，项目目录本身不动） |
| `pi.builtin.changes` | views.panel, timeline.footer | 对话末尾的 +N −M 摘要，面板里逐文件审查 diff |
| `pi.builtin.events` | views.panel | RPC 事件流调试 |
| `pi.builtin.extension-ui` | overlays, statusbar, composer.addons | Pi 扩展弹窗、通知、状态项、小组件 |
| `pi.builtin.status` | statusbar | 标题栏右侧：上下文占用、费用、连接状态 |
| `pi.builtin.command-palette` | overlays, commands, toolstrip | Ctrl+K 命令面板与快捷键分发 |
| `pi.builtin.themes` | themes, toolstrip | Air 配色的深色 / 浅色主题，同步系统标题栏颜色 |
| `pi.core.plugins` | views.panel | 插件管理：运行时启停，状态持久化 |

## 编写插件

```js
export default {
  id: "me.hello",
  name: "示例",
  activate(ctx) {
    // 向贡献点注册；停用插件时自动撤销
    ctx.contribute("statusbar", { id: "hello", component: HelloStatus });
    ctx.contribute("toolRenderers", { id: "grep", priority: 10, match: (name) => name === "grep", component: GrepCard });
    ctx.contribute("commands", { id: "me.hello", title: "打招呼", keybinding: "Ctrl+Shift+H", run: () => ctx.emit("notify", { text: "hi" }) });
    // 订阅 Pi 事件
    ctx.on("pi:event", ({ cwd, event }) => {});
    // 白名单 RPC
    ctx.rpc("getSessionStats");
  },
};
```

然后加入 `packages/ui/src/plugins/index.js` 的清单。内核与骨架不需要改。

贡献点：`views.sidebar` `views.main` `views.editor` `views.panel` `titlebar` `toolstrip` `timeline.footer` `statusbar` `messageRenderers` `toolRenderers` `composer.addons` `overlays` `commands` `slash` `themes`。

## 字体

内置 [Inter](https://rsms.me/inter/) 与 [JetBrains Mono](https://www.jetbrains.com/lp/mono/)（与 Air 相同），均为 SIL Open Font License 1.1，许可证随字体放在 `packages/ui/src/assets/fonts/`。

## 许可

MIT，见 [LICENSE](./LICENSE)。
