# Pi Desktop

基于本机 **Pi Agent CLI** 的跨平台桌面 GUI 客户端（Vue 3 + Vite）。

界面只负责交互与状态呈现，推理、工具、扩展与会话完全复用系统已安装的 `pi`，不另造一套 agent。

---

## 核心设计原则

1. **完全基于本机 Pi CLI**：不内置、不静默下载 Pi，不另存配置文件，所有模型、API Key、MCP、Skills、扩展与会话均沿用 `~/.pi/agent` 和各项目的 `.pi/`。
2. **多工作区进程隔离**：每个打开的工作区对应一个独立的 `pi --mode rpc` 子进程，工作目录即为项目根目录。
3. **关闭即收尾**：应用关闭时自动结束拉起的 Pi 进程，所有对话记录保存在 Pi 的原生 JSONL 会话文件中，下次打开可直接继续。
4. **MIT 开源协议**：宽松自由，详见 [LICENSE](./LICENSE)。

---

## 目录结构

```text
pi-desktop/
├── 大纲.md               # 详细设计与协议大纲
├── LICENSE               # MIT 开源许可证
└── packages/
    └── ui/               # Vue 3 前端界面
        ├── index.html
        ├── package.json
        ├── vite.config.js
        └── src/
            ├── App.vue   # 桌面主框架（三栏布局）
            ├── styles.css
            ├── data.js
            └── components/
                ├── WorkspaceList.vue  # 左侧：工作区列表与状态指示
                ├── SessionList.vue    # 中间：会话管理与新建
                ├── Transcript.vue     # 主区：对话流、折叠思考与工具卡片
                ├── Composer.vue       # 底部：输入框、流式排队队列与中止
                ├── TopBar.vue         # 顶栏：工作区信息、模型选择与思考等级
                ├── SidePanel.vue      # 右侧栏：文件变更与进程终端
                └── EmptyState.vue     # 未检测到 Pi 时的引导提示
```

---

## 运行方式（前端界面预览）

```bash
cd packages/ui
npm install
npm run dev
```

在浏览器打开 `http://localhost:1420` 即可预览完整的三栏客户端界面。
