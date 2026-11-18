<script setup lang="ts">
import { computed, ref } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";

/**
 * 打开项目后的第一次 Agent 选择。
 *
 * 以前没有 agents.json 时默认按 Pi 打开项目；支持多 Agent 之后不能再替用户
 * 拉起任何一个（尤其不能在启动时自动连接 Pi）。这里只负责问一次，选择写进
 * 项目级设置，之后标题栏的 Agent 胶囊用来切换。
 */
const { workbench, bus } = useKernel();
const state = workbench.state;
const choice = computed(() => state.agentChoice);
const busy = ref("");

async function pick(kind: string): Promise<void> {
  if (!kind || busy.value) return;
  busy.value = kind;
  try {
    await workbench.chooseAgent(kind);
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <div v-if="choice" class="overlay agent-choice-overlay" @mousedown.self="workbench.cancelAgentChoice()">
    <div class="agent-choice-dialog" role="dialog" aria-modal="true" aria-label="选择 Agent">
      <header class="agent-choice-head">
        <div>
          <strong>选择 Agent</strong>
          <p>为项目「{{ choice.name }}」选择这次使用的本机 Agent</p>
        </div>
        <span class="agent-choice-badge">按项目记住</span>
      </header>

      <div class="agent-choice-list">
        <button
          v-for="agent in choice.agents"
          :key="agent.kind"
          type="button"
          class="agent-choice-card"
          :class="{ disabled: !agent.found || Boolean(busy) }"
          :disabled="!agent.found || Boolean(busy)"
          :title="agent.error || agent.path"
          @click="pick(agent.kind)"
        >
          <span class="agent-choice-main">
            <span class="agent-choice-title">
              <strong>{{ agent.label }}</strong>
              <span v-if="busy === agent.kind" class="mini-spinner" />
              <span v-else-if="agent.found" class="agent-choice-version">v{{ agent.version }}</span>
              <span v-else class="agent-choice-missing">未安装</span>
            </span>
            <span class="agent-choice-path">{{ agent.path || agent.error }}</span>
          </span>
          <span class="agent-choice-go" aria-hidden="true">→</span>
        </button>
        <p v-if="!choice.agents.length" class="agent-choice-empty">正在检测本机 Agent…</p>
      </div>

      <p class="agent-choice-hint">
        Pi 需要本机能运行 <code>pi</code>；Antigravity 使用 <code>agy acp</code>，第一次先在终端运行
        <code>agy acp --login</code>。选择后可在标题栏左侧随时切换。
      </p>

      <footer class="agent-choice-actions">
        <button type="button" class="btn ghost" @click="workbench.cancelAgentChoice()">取消</button>
      </footer>
    </div>
  </div>
</template>
