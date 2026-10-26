<script setup lang="ts">
// 活动折叠头参考 ThinkRail（Apache-2.0）的 ActivityGroup，见 THIRD-PARTY-NOTICES.md。
import { computed } from "vue";
import type { ActivityGroup as ActivityGroupModel } from "../../shared/activity.ts";
import { activityCountLabel } from "../../shared/activity.ts";
import { icons } from "../../shared/util.ts";

const props = defineProps<{
  /** 旧的活动组与新的执行记录组共用这套折叠头 */
  group: Pick<
    ActivityGroupModel,
    "id" | "entries" | "toolCount" | "thinkingCount" | "live" | "errored" | "failedCount" | "summary" | "detail"
  >;
  expanded: boolean;
  /** 折叠头前缀文案：执行记录用「执行」，旧的活动组用「活动」 */
  label?: string;
  /** 右侧耗时文案（不足 1 秒传空串） */
  duration?: string;
  /** 是否显示「N 工具 · M 思考」这组计数（执行记录已把步数写进摘要） */
  showCounts?: boolean;
  /** 当前搜索命中该组内的块：强制展开并高亮 */
  searchHit?: boolean;
}>();

defineEmits<{ toggle: [] }>();

const counts = computed(() => activityCountLabel(props.group));
</script>

<template>
  <section
    class="activity-group"
    :class="{ expanded, live: group.live, errored: group.errored, 'search-hit': searchHit }"
    :data-activity-id="group.id"
    :data-live="group.live"
    :data-errored="group.errored"
  >
    <button
      type="button"
      class="activity-head"
      :aria-expanded="expanded"
      :aria-label="`${expanded ? '收起' : '展开'}${label || '活动'}，${counts}：${group.summary}${duration ? ` · ${duration}` : ''}`"
      :title="group.detail || counts"
      @click="$emit('toggle')"
    >
      <span class="activity-caret" :class="{ open: expanded }" v-html="icons.chevronRight" />
      <span class="activity-icon" v-html="icons.events" />
      <span class="activity-title">{{ label || "活动" }}</span>
      <span v-if="showCounts ?? true" class="activity-count">{{ counts }}</span>
      <span class="activity-summary">{{ group.summary }}</span>
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
