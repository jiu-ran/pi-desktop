# Pi Desktop 产品边界

Pi Desktop 是本机 Pi Coding Agent 的桌面工作台。Pi 是唯一的 Agent，桌面端只提供窗口、项目、编辑器、审查界面和 RPC 桥接。

## 桌面端永远不能做

- 渲染进程不得导入 Node.js、Electron 主进程模块、Pi SDK，也不得自行启动 Pi。
- 除 `electron/pi-host.ts` 外，不得导入或操作 Pi SDK。
- 应用代码不得直接调用模型服务，也不得创建第二个 Agent 会话。
- 应用代码不得读写系统提示词、提示词模板或 Pi 的配置。
- 渲染进程只能通过 `window.piDesktop` 使用预先声明的宿主能力。
- 宿主调用 Pi 时只能使用明确列出的 RPC 方法，白名单位于 `electron/pi-host.ts`。
- 桌面端不得根据消息内容自行计算 token、费用或压缩结果，这些数据只能展示 Pi 返回的结果。
- 附件只能作为用户明确选择的文件内容或图片交给 Pi，不能追加隐藏任务指令。

## 允许的职责

- Electron 主进程负责窗口、系统对话框、文件权限和 Pi 进程生命周期。
- `electron/pi-host.ts` 负责工作区隔离、RPC 白名单、会话 Worker 和受控文件操作。
- Vue 界面可以维护由 RPC 快照和 Pi 事件派生的临时视图状态。
- 设置界面可以管理桌面端自己的显示、编辑和更新偏好。

## 自动检查

`scripts/checks/product-boundary.check.ts` 会扫描应用源码及边界文档。新增一个上述禁止项时，必须同时说明它属于哪一项例外；不能静默扩大桌面端的职责。
