<script setup>
defineProps({
  workspaces: { type: Array, required: true },
  activeId: { type: String, required: true },
  version: { type: String, required: true },
});

defineEmits(["open", "choose"]);

const labels = { idle: "空闲", working: "运行", done: "完成", failed: "失败" };
</script>

<template>
  <aside class="workspaces">
    <div class="brand">
      <strong>Pi Desktop</strong>
      <span>本机 CLI {{ version }}</span>
    </div>
    <section>
      <p class="section-label">工作区</p>
      <ul>
        <li v-for="item in workspaces" :key="item.id">
          <button
            class="row"
            :class="{ active: item.id === activeId }"
            @click="$emit('open', item.id)"
          >
            <span class="dot" :data-status="item.status" />
            <span class="row-copy">
              {{ item.name }}
              <small>{{ labels[item.status] }}</small>
            </span>
          </button>
        </li>
      </ul>
    </section>
    <button class="add" @click="$emit('choose')">打开目录</button>
  </aside>
</template>
