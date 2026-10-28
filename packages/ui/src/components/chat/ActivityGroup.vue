<script setup lang="ts">
// 活动折叠头参考 ThinkRail（Apache-2.0）的 ActivityGroup，见 THIRD-PARTY-NOTICES.md。
import { computed } from "vue";
import { icons } from "../../shared/util.ts";

const props = defineProps<{
  /** 一次用户请求对应的一条执行记录 */
  group: {
    id: string;
    live: boolean;
    errored: boolean;
    failedCount: number;
    summary: string;
    detail: string;
    steps: unknown[];
  };
  expanded: boolean;
  /** 折叠头前缀文案：执行记录用「执行」 */
  label?: string;
  /** 右侧耗时文案（不足 1 秒传空串） */
  duration?: string;
  /** 整组的增删行数总计（null = 这一组没有改动，不显示） */
  added?: number | null;
  removed?: number | null;
  /** 当前搜索命中该组内的块：强制展开并高亮 */
}>();

defineEmits<{ toggle: [] }>();

/** 给读屏用的增删行数文案；没有改动时为空串 */
const statText = computed(() => {
  const parts: string[] = [];
  if (props.added != null) parts.push(`新增 ${props.added} 行`);
  if (props.removed != null) parts.push(`删除 ${props.removed} 行`);
  return parts.length ? ` · ${parts.join(' · ')}` : '';
});
</script>

<template>
  <section
    class="activity-group"
    :class="{ expanded, live: group.live, errored: group.errored }"
    :data-activity-id="group.id"
    :data-live="group.live"
    :data-errored="group.errored"
  >
    <button
      type="button"
      class="activity-head"
      :aria-expanded="expanded"
      :aria-label="`${expanded ? '收起' : '展开'}${label || '活动'}（${group.steps.length} 步）：${group.summary}${statText}${duration ? ` · ${duration}` : ''}`"
      :title="group.detail"
      @click="$emit('toggle')"
    >
      <span class="activity-caret" :class="{ open: expanded }" v-html="icons.chevronRight" />
      <span class="activity-icon" v-html="icons.events" />
      <span class="activity-title">{{ label || "活动" }}</span>
      <span class="activity-summary">{{ group.summary }}</span>
      <!-- 整组的增删行数：和右侧耗时排在一起，和下面每一行的「+N −N 耗时」同一种读法 -->
      <span v-if="added != null || removed != null" class="activity-stat">
        <span v-if="added != null" class="stat-add">+{{ added }}</span>
        <span v-if="removed != null" class="stat-del">−{{ removed }}</span>
      </span>
      <span v-if="duration" class="activity-duration">{{ duration }}</span>
      <span v-if="group.live" class="mini-spinner activity-live" aria-hidden="true" />
      <!-- 以失败收尾才标红；中途失败但随后恢复，只留一个弱提示，不继续报警。 -->
      <span v-if="group.errored" class="activity-error">失败</span>
      <span v-else-if="group.failedCount" class="activity-error warn">失败 ×{{ group.failedCount }}</span>
    </button>
    <div v-if="expanded" class="activity-body" :data-activity-body="group.id">
      <slot />
    </div>
  </section>
</template>
