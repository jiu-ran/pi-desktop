# 参考 ThinkRail 的改进路线

[ThinkRail](https://github.com/JetBrains/thinkrail)（JetBrains，Apache-2.0）同样围绕
`@earendil-works/pi-coding-agent` 构建，但采用 React 19 + Bun/Turbo 的单仓架构。
本分支 `thinkrail` 挑选其中与本项目（Vue 3 + Electron + RPC 宿主）契合的做法逐步移植，
不改变现有产品边界：用量、Git 状态、会话状态仍以 pi / Git 为准，前端不自行累加或推断。

许可说明见仓库根目录的 [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md)。

## 已采纳

| 能力 | 上游参考 | 本项目实现 |
| --- | --- | --- |
| 会话用量明细 | `SessionStatsBar.tsx` | 点击上下文环打开弹层；`shared/session-stats.ts` 纯函数 + `stats.check.ts` |
| 文件树 Git 标记 | Files 树的 live change marks | `FilesPanel.vue` / `FileTreeNode.vue` 复用 `overviewState`，字母与版本控制面板共享 `badgeCode` / `badgeKind` |
| 「只看变更」视图 | Files 树的 Changed 视图 | 文件面板工具栏切换为扁平变更列表，点击直接打开 |
| 回到最新 | reading band / follow 状态 | `AgentChat.vue` 的「回到最新」胶囊 + 未读数，点击恢复自动贴底 |
| 长消息折叠 | 用户消息 500 字折叠规则 | `UserMessage.vue` 折叠 + 展开全文，搜索时自动展开 |
| 技能调用卡片 | `skillInvocation.ts` + 折叠卡片 | `shared/skill-invocation.ts` 解析，`UserMessage.vue` 渲染技能名与可展开正文 |
| 自动重试 / 压缩卡片 | `RetryIndicator.tsx` / `CompactionTurn.tsx` | `NoticeBlock.vue` 按 `retry` / `compaction` 渲染状态图标、延迟条与可展开摘要；事件归并放在 `kernel/transcript.ts` |
| 隔离工作区 | `packages/server/src/workspaces` | `PiHost` 用 `git worktree` 创建 `pi/<任务名>` 分支，`GitPanel.vue` 管理主 / 隔离 / 外部工作区 |
| 活动分组与吸顶头 | `ActivityGroup.tsx` / `activityBreadcrumbs.tsx` | 连续 4 步以上思考 / 常规工具折叠成活动组（单组最多 20 步，超长工具链自动拆分）；折叠头显示工具与思考数量、动作摘要、运行中 / 失败状态，并在组内吸顶。编辑 / 写入 / 需要用户回答的工具保持独立。纯逻辑在 `shared/activity.ts`，断言在 `activity.check.ts` |
| Diff 行内评审 | `reviewPackage.ts` / `planView.ts` | 实时 Git diff 的每一行都可添加评审意见；行内展示意见并支持删除，顶部汇总条把文件、行号、侧别、相关代码和意见一起加入输入框。提示词由 `shared/review.ts` 纯函数构造，断言在 `review.check.ts`；已提交 Commit 和会话快照不提供评论入口 |

## 隔离工作区的实现边界

- 只有「仓库根目录等于当前项目目录」且已有 HEAD 提交时才能创建；目录固定放在应用数据目录的
  `worktrees/` 下，分支前缀为 `pi/`，名称会去重。
- 列表以 `git worktree list --porcelain` 为准：主工作区、Pi Desktop 管理的隔离工作区、外部 worktree
  分开标记。外部 worktree 可以打开和定位，但不会在这里被删除。
- 移除只允许 Pi Desktop 管理的非主工作区，且不能是当前使用中的工作区；先关闭对应 Pi 进程，
  再删除目录并 `prune`，分支保留，未合并的提交不会丢失。Windows 上文件短暂占用时会重试删除。
- 工作区根目录由主进程注入，渲染进程只能传任务名和已有 worktree 路径，不能指定任意目录。

## 后续候选（按价值 / 成本排序）

1. **转录虚拟滚动**：长会话只挂载可视区附近的行，配合上游的 `rowHeightEstimates` /
   `scrollGeometry` 纯函数思路；当前分页上限 240 条，先做基准测试再决定是否引入。
2. **轮次分组与全局活动面包屑**：活动组已支持组内吸顶；下一步可按 user 轮次分组，并在滚动时于对话区顶部固定「当前轮次 / 当前活动」的全局面包屑。上游的 `deriveRows` / `activityBreadcrumbs` 可作为算法参考。
3. **后台任务资源面板**：集中展示后台 bash、子 Agent、MCP 调用及其输出。
4. **编辑器体验**：分屏编辑、行内 Git blame；标签溢出菜单与未保存关闭保护已落地，上游的 workbench 布局可参考。

## 明确不采纳

- 不引入 React / Tailwind / Zustand：本项目已是 Vue 3 + 手写设计令牌，重写成本高于收益。
- 不引入 Bun / Turbo 单仓：现有 npm + vite + Electron 构建链已满足发布需求。
- 不复制上游的 Specs 工作流与 JetBrains AI 登录：属于 ThinkRail 的产品能力，不是通用 UI 改进。
- 不把 `pi` 直接 value-import 进渲染进程：仍通过 `electron/pi-host.ts` 的 RPC 边界调用，保持崩溃隔离。
