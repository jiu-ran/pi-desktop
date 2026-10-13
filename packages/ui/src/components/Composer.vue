<script setup>
defineProps({
  draft: { type: String, required: true },
  running: { type: Boolean, required: true },
  queue: { type: Array, required: true },
});

defineEmits(["update:draft", "send", "stop"]);
</script>

<template>
  <form class="composer" @submit.prevent="$emit('send')">
    <div v-if="queue.length" class="queue">
      <span>待发送 {{ queue.length }}</span>
      <span v-for="(item, index) in queue" :key="index">{{ item }}</span>
    </div>
    <textarea
      :value="draft"
      rows="3"
      placeholder="发给本机 Pi。Shift+Enter 换行，Enter 发送。"
      @input="$emit('update:draft', $event.target.value)"
      @keydown.enter.exact.prevent="$emit('send')"
    />
    <div class="composer-actions">
      <p>{{ running ? "运行中再次发送会排队" : "空闲" }}</p>
      <button type="button" :disabled="!running && !queue.length" @click="$emit('stop')">
        停止
      </button>
      <button class="primary" type="submit" :disabled="!draft.trim()">发送</button>
    </div>
  </form>
</template>
