<script setup>
import { ref } from "vue";

defineProps({
  workspace: { type: Object, required: true },
  running: { type: Boolean, required: true },
  model: { type: String, required: true },
  thinking: { type: String, required: true },
  models: { type: Array, required: true },
  levels: { type: Array, required: true },
  panel: { type: String, required: true },
});

const emit = defineEmits(["panel", "model", "thinking"]);
const openMenu = ref("");

function choose(kind, value) {
  emit(kind, value);
  openMenu.value = "";
}

function toggle(kind) {
  openMenu.value = openMenu.value === kind ? "" : kind;
}
</script>

<template>
  <header>
    <div class="title-block">
      <h1>{{ workspace.name }}</h1>
      <div class="meta">{{ workspace.path }}</div>
    </div>
    <div class="controls">
      <span class="status" :class="{ live: running }">
        <span class="dot" :data-status="running ? 'working' : 'idle'" />
        {{ running ? "运行中" : "空闲" }}
      </span>

      <div class="menu">
        <button :class="{ active: openMenu === 'model' }" @click="toggle('model')">
          {{ model }}
        </button>
        <div v-if="openMenu === 'model'" class="menu-list">
          <button
            v-for="item in models"
            :key="item"
            :class="{ active: item === model }"
            @click="choose('model', item)"
          >
            {{ item }}
          </button>
        </div>
      </div>

      <div class="menu">
        <button :class="{ active: openMenu === 'thinking' }" @click="toggle('thinking')">
          {{ thinking }}
        </button>
        <div v-if="openMenu === 'thinking'" class="menu-list">
          <button
            v-for="item in levels"
            :key="item"
            :class="{ active: item === thinking }"
            @click="choose('thinking', item)"
          >
            {{ item }}
          </button>
        </div>
      </div>

      <button :class="{ active: panel === 'changes' }" @click="$emit('panel', 'changes')">
        变更
      </button>
      <button :class="{ active: panel === 'terminal' }" @click="$emit('panel', 'terminal')">
        终端
      </button>
    </div>
  </header>
</template>
