# 第三方代码声明

本项目包含参考或改编自以下开源项目的代码。

## ThinkRail

- 来源：<https://github.com/JetBrains/thinkrail>
- 版权：Copyright JetBrains s.r.o.
- 许可：Apache License 2.0（全文见 [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt)）
- 使用范围：
  - `packages/ui/src/shared/session-stats.ts`：会话用量格式化（`formatCost` / `usageParts` / `contextBar`），
    改编自 `apps/web/src/chat/SessionStatsBar.tsx`。
  - `packages/ui/src/components/chat/messages/UserMessage.vue`：长用户消息折叠规则（超过 500 字且已有后续内容时折叠）。
  - `packages/ui/src/components/chat/AgentChat.vue`：「回到最新」提示与未读数思路（reading band / follow 状态）。
  - `packages/ui/src/plugins/files/FilesPanel.vue`、`FileTreeNode.vue`：文件树 Git 状态标记与「只看变更」视图。
  - `packages/ui/src/plugins/git/GitPanel.vue`：变更状态字母（`M` / `A` / `D` / `R` / `U`）的推导方式。
  - `packages/ui/src/components/chat/Composer.vue`：点击上下文占用环查看会话用量的交互。
  - `packages/ui/src/shared/skill-invocation.ts`：pi 技能调用块的解析，改编自 `apps/web/src/lib/skillInvocation.ts`。
  - `packages/ui/src/components/chat/messages/UserMessage.vue`：技能调用卡片（名称常显、正文按需展开）的呈现方式。
- 修改说明：上游为 React 19 + Zustand + Tailwind，本项目为 Vue 3 + TypeScript + 手写 CSS；
  移植时改写为 Vue 组合式 API，纯逻辑拆分为可测试函数（见 `scripts/checks/stats.check.ts`、`scripts/checks/git.check.ts`），
  并适配本项目既有的事件模型与安全边界。数据仍由 pi 的 `getSessionStats` / `git status` 提供。

Apache License 2.0 要求保留版权与许可声明；分发本项目时请一并保留本文件与 `licenses/Apache-2.0.txt`。
