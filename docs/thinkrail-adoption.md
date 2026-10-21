# 参考 ThinkRail 的改进路线

[ThinkRail](https://github.com/JetBrains/thinkrail)（JetBrains，Apache-2.0）同样围绕
`@earendil-works/pi-coding-agent` 构建，但采用 React 19 + Bun/Turbo 的单仓架构。
本分支 `thinkrail` 挑选其中与本项目（Vue 3 + Electron + RPC 宿主）契合的做法逐步移植，
不改变现有产品边界：用量、Git 状态、会话状态仍以 pi / Git 为准，前端不自行累加或推断。

许可说明见仓库根目录的 [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md)。

## 已采纳（第一批）

| 能力 | 上游参考 | 本项目实现 |
| --- | --- | --- |
| 会话用量明细 | `SessionStatsBar.tsx` | 点击上下文环打开弹层；`shared/session-stats.ts` 纯函数 + `stats.check.ts` |
| 文件树 Git 标记 | Files 树的 live change marks | `FilesPanel.vue` / `FileTreeNode.vue` 复用 `overviewState`，字母与版本控制面板共享 `badgeCode` / `badgeKind` |
| 「只看变更」视图 | Files 树的 Changed 视图 | 文件面板工具栏切换为扁平变更列表，点击直接打开 |
| 回到最新 | reading band / follow 状态 | `AgentChat.vue` 的「回到最新」胶囊 + 未读数，点击恢复自动贴底 |
| 长消息折叠 | 用户消息 500 字折叠规则 | `UserMessage.vue` 折叠 + 展开全文，搜索时自动展开 |
| 技能调用卡片 | `skillInvocation.ts` + 折叠卡片 | `shared/skill-invocation.ts` 解析，`UserMessage.vue` 渲染技能名与可展开正文 |

## 后续候选（按价值 / 成本排序）

1. **转录虚拟滚动**：长会话只挂载可视区附近的行，配合上游的 `rowHeightEstimates` /
   `scrollGeometry` 纯函数思路；当前分页上限 240 条，先做基准测试再决定是否引入。
2. **轮次分组与活动面包屑**：把 assistant 的多次工具往返折叠成一轮，滚动时在顶部固定当前活动；
   上游的 `deriveRows` / `activityBreadcrumbs` 可作为算法参考。
3. **错误与重试卡片**：把 provider 错误、自动重试、上下文压缩从纯文本提示升级为可操作卡片
   （重试 / 查看压缩摘要），复用上游 `RetryIndicator` / `CompactionNotice` 的状态划分。
4. **技能调用卡片**：把 `<skill name="…">` 用户消息折叠成技能卡片，展开查看原始指令。
5. **评审评论**：在 diff 上添加行内评论并以结构化上下文发送给 Agent（需要新增会话消息格式）。
6. **工作区隔离**：用 `git worktree` 为每个任务创建独立工作区（改动面较大，涉及会话、Git、文件面板）。
7. **后台任务资源面板**：集中展示后台 bash、子 Agent、MCP 调用及其输出。
8. **编辑器体验**：标签溢出菜单、分屏编辑、行内 Git blame；上游的 workbench 布局可参考。

## 明确不采纳

- 不引入 React / Tailwind / Zustand：本项目已是 Vue 3 + 手写设计令牌，重写成本高于收益。
- 不引入 Bun / Turbo 单仓：现有 npm + vite + Electron 构建链已满足发布需求。
- 不复制上游的 Specs 工作流与 JetBrains AI 登录：属于 ThinkRail 的产品能力，不是通用 UI 改进。
- 不把 `pi` 直接 value-import 进渲染进程：仍通过 `electron/pi-host.ts` 的 RPC 边界调用，保持崩溃隔离。
