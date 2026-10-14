# Pi Desktop

基于本机 **Pi Agent CLI** 的跨平台桌面客户端（Electron + Vue 3 + TypeScript）。界面布局与配色参考 JetBrains Air：深色窗框上的圆角“岛”、按项目分组的任务列表、标题栏面包屑、中央多标签文件编辑器、右侧多面板文件树与变更审查，以及底栏带模型与思考等级的输入框。

界面只负责交互与呈现。推理、工具、扩展、Skills、MCP 与会话全部由用户已安装的 `pi` 处理，桌面端不内置 Pi，也不读写 `~/.pi/agent` 与项目 `.pi/`。

## 下载与安装（v0.1.0）

- **预构建安装包 / 便携包**：前往 [GitHub Releases (v0.1.0)](https://github.com/jiu-ran/pi-desktop/releases/tag/v0.1.0) 下载对应系统版本（Windows `.exe` / `.zip`、macOS `.dmg` / `.zip`、Linux `.AppImage` / `.tar.gz`）。
- **前置条件**：本机需已安装并可在命令行运行 `pi`（`@earendil-works/pi-coding-agent`）。

## 从源码运行与打包

```bash
npm install
npm install --prefix packages/ui
npm run dev          # 开发模式（编译 Electron TS + Vite + Electron）
npm run build        # 构建 Electron 主进程与前端静态资源
npm start            # 直接启动桌面端
npm run dist         # 打包当前系统安装包与便携包（输出到 dist/）
npm run check        # TypeScript 类型检查 + 投影层、diff、宿主进程池、删除、附件、文件树与保存自检
```

## 架构

分四层，全部使用 TypeScript 实现，上层只依赖下层的公开接口：

```text
plugins/   功能插件：所有可见功能都是插件
shell/     工作台骨架：只摆放插槽，不含业务
kernel/    内核：事件总线、贡献点、插件管理、工作区状态、会话投影
electron/  宿主：每个工作区一个 pi --mode rpc，只经官方 RpcClient 通信
```

| 模块 | 文件 | 职责 |
|---|---|---|
| 宿主 | `electron/pi-host.ts` | 进程池、会话目录、白名单 RPC、回写 `extension_ui_response` |
| 宿主 | `electron/main.ts` / `preload.cts` | 窗口与 IPC；所有返回值纯化为 JSON |
| 内核 | `kernel/transcript.ts` | 把 Pi 消息与流式事件折叠成统一的「块」 |
| 内核 | `kernel/workbench.ts` | 多工作区状态、事件分发、发送 / 停止 / 切换会话 |
| 内核 | `kernel/contributions.ts` | 15 个贡献点 |
| 内核 | `kernel/plugin-manager.ts` | 注册、启用、停用；停用时撤销全部贡献与订阅 |
| 骨架 | `shell/Shell.vue` | 标题栏 / 侧栏岛 / 主舞台岛 / 编辑器岛 / 多面板岛 / 右侧工具条 / 浮层 |

## 许可

MIT，见 [LICENSE](./LICENSE)。
