<script setup>
defineProps({
  panel: { type: String, required: true },
  changes: { type: Array, required: true },
  lines: { type: Array, required: true },
});
</script>

<template>
  <aside class="panel">
    <p class="section-label">{{ panel === "changes" ? "这次会话改过的文件" : "进程输出" }}</p>
    <ul v-if="panel === 'changes'" class="changes">
      <li v-if="changes.length === 0" class="hint">这次会话还没有文件变更。</li>
      <li v-for="change in changes" :key="change.path" class="change">
        <b>{{ change.kind }}</b>
        <span>{{ change.path }}</span>
        <small>+{{ change.additions }} −{{ change.deletions }}</small>
      </li>
    </ul>
    <pre v-else>{{ lines.join("\n") }}</pre>
  </aside>
</template>
