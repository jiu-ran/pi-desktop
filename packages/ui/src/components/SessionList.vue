<script setup>
defineProps({
  sessions: { type: Array, required: true },
  activeId: { type: String, default: "" },
});

defineEmits(["open", "create"]);

const labels = { idle: "空闲", working: "运行", done: "完成", failed: "失败" };
</script>

<template>
  <section class="session-pane">
    <div class="pane-head">
      <p class="section-label">会话</p>
      <button class="text" @click="$emit('create')">新建</button>
    </div>
    <ul>
      <li v-for="session in sessions" :key="session.id">
        <button
          class="row"
          :class="{ active: session.id === activeId }"
          @click="$emit('open', session.id)"
        >
          <span class="dot" :data-status="session.status" />
          <span class="row-copy">
            {{ session.title }}
            <small>{{ labels[session.status] }} · {{ session.updated }}</small>
          </span>
        </button>
      </li>
    </ul>
    <p v-if="sessions.length === 0" class="hint">这个工作区还没有会话。</p>
  </section>
</template>
