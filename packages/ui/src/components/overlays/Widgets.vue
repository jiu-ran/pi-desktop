<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { extState } from "../../services/extension-ui.ts";
import {
  ASYNC_WIDGET_KEY,
  INSPECT_WIDGET_KEY,
  parseAsyncSnapshot,
  snapshotClock,
  snapshotNodeDetail,
  snapshotStateLabel,
  snapshotStateTone,
  snapshotSummary,
} from "../../shared/subagent-widget.ts";

const { workbench } = useKernel();

/**
 * 扩展 widget（`ctx.ui.setWidget`）的展示。
 *
 * 两类 widget 是给宿主看数据的，不能原样打印：
 * - `subagent-async`：内容是 `PI_SUBAGENT_ASYNC_JSON:` 快照，改成任务清单，原始 JSON 折叠备查；
 * - `subagent-inspect`：扩展文档要求宿主**不要渲染**，只在内存里按 requestId 缓冲。
 */
const widgets = computed(() =>
  Object.entries(extState.widgets[workbench.state.activeCwd] ?? {})
    .filter(([key]) => key !== INSPECT_WIDGET_KEY)
    .map(([key, widget]) => ({
      key,
      lines: widget.lines,
      snapshot: key === ASYNC_WIDGET_KEY || widget.lines.some((line) => parseAsyncSnapshot([line])) ? parseAsyncSnapshot(widget.lines) : null,
    })),
);
</script>

<template>
  <div v-if="widgets.length" class="ext-widgets">
    <div v-for="item in widgets" :key="item.key" class="ext-widget">
      <!-- 子代理后台状态：一行一个任务，状态用颜色区分 -->
      <template v-if="item.snapshot">
        <span class="ext-widget-key">
          子代理进度 · {{ snapshotSummary(item.snapshot) }}
          <template v-if="item.snapshot.generatedAt"> · 更新 {{ snapshotClock(item.snapshot.generatedAt) }}</template>
        </span>
        <div class="ext-subagent-runs">
          <div v-for="run in item.snapshot.runs" :key="run.id" class="ext-subagent-run">
            <span class="ext-subagent-state" :data-tone="snapshotStateTone(run.state)">{{ snapshotStateLabel(run.state) }}</span>
            <span class="ext-subagent-label">{{ run.label || run.agent || run.kind }}</span>
            <span v-if="snapshotNodeDetail(run)" class="ext-subagent-detail">{{ snapshotNodeDetail(run) }}</span>
            <div v-if="run.children.length" class="ext-subagent-children">
              <span v-for="child in run.children" :key="child.id" class="ext-subagent-child" :data-tone="snapshotStateTone(child.state)">
                <span class="ext-subagent-state" :data-tone="snapshotStateTone(child.state)">{{ snapshotStateLabel(child.state) }}</span>
                {{ child.label || child.agent || child.id }}
              </span>
            </div>
          </div>
        </div>
        <details class="ext-widget-raw">
          <summary>原始数据</summary>
          <pre>{{ item.lines.join("\n") }}</pre>
        </details>
      </template>

      <template v-else>
        <span class="ext-widget-key">{{ item.key }}</span>
        <pre>{{ item.lines.join("\n") }}</pre>
      </template>
    </div>
  </div>
</template>
