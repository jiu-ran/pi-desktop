# 更新日志

本项目的所有重要变更都记录在此文件中。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.1.0] - 2026-10-20

首个公开版本。

### 新增

- 多项目工作区：每个项目对应独立的 Pi RPC 工作区，可保留多个 Worker 并行执行任务，空闲 Worker 数量可在设置中调整（1–8）。
- 流式对话：实时渲染文本、思考、工具调用与通知块；支持新建任务、切换历史会话、中止运行中的任务。
- 消息分页加载：每次加载 8 条，滚动至距顶部约 100 px 时自动加载更早消息，500 ms 节流去重；分页数据直接读取会话 JSONL 文件，不受接口返回条数限制，向前插入后滚动位置保持稳定。
- Markdown 渲染：使用 `markstream-vue` 渲染对话与 `.md` 文件，助手消息支持一键复制 Markdown 源文。
- 语法高亮：Shiki 按语言高亮代码块，跟随深色 / 浅色主题；Markdown 文件源码视图同样高亮。
- Mermaid 图表：对话与 Markdown 文件中的 ` ```mermaid ` 代码块渲染为图表，并按 SVG 实际宽高比调整预览高度。
- 项目文件：文件树浏览、搜索与刷新，多标签编辑器、未保存状态、自动保存、Markdown 预览；支持拖拽文件到输入框作为附件。
- 文件操作：打开、重命名、复制绝对 / 相对路径、在文件管理器中显示、移入回收站；项目根目录支持新建文件与文件夹。
- 文件变更与 Git：按会话汇总修改文件并提供行级 Diff；Git 插件展示提交历史、工作区状态与 Commit / Diff 详情。
- RPC 事件：实时查看 Pi 子进程的 JSON-RPC 事件与完整载荷，可复制 JSON。
- 插件管理：按「对话区域 / 文件区域 / 扩展工具」分组启停插件，核心插件不可停用，选择保存在本地。
- 主题与设置：深色 / 浅色主题，发送快捷键、消息密度、自动保存、Worker 上限、自动压缩 / 重试、Pi 软件包、Skills、MCP 与插件配置。
- 软件更新：启动时检查 GitHub Release，发现新版本后在标题栏与设置页提示，由用户手动打开下载页。
- 主进程网络层：使用 Electron `net.fetch`（Chromium 网络栈）替代 Node `fetch`，自动继承系统代理；更新包流式下载，失败重试 3 次（指数退避），完成后进行 SHA-256 校验；网络异常统一转换为中文提示。
- 自检脚本：`npm run check` 覆盖 TypeScript 类型检查与 transcript、Diff、宿主、删除、附件、文件树、Mermaid 高度等 12 项检查。

### 变更

- 宿主层隐藏 `.git`、`node_modules`、`.pi` 等目录，所有项目路径经过工作区边界校验；文件预览上限 2 MB，保存上限 20 MB。
- IPC 参数与返回值统一净化为可结构化克隆的 JSON，前端响应式 Proxy 不跨越进程边界。

### 修复

- 会话消息此前只显示部分内容：改为从会话 JSONL 直接分页读取，历史消息可完整回溯。

### 已知问题

- 安装包未进行商业代码签名：Windows 触发 SmartScreen 提示，macOS 需右键打开或移除 quarantine 属性。
- macOS 仅提供 arm64 产物，Intel Mac 需从源码构建。
- 自动更新尚未接入签名校验链，更新检查依赖 GitHub Releases。

[未发布]: https://github.com/jiu-ran/pi-desktop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jiu-ran/pi-desktop/releases/tag/v0.1.0
