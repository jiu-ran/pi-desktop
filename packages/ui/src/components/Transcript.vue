<script setup>
defineProps({
  messages: { type: Array, required: true },
});
</script>

<template>
  <section class="transcript">
    <article v-if="messages.length === 0" class="empty">
      <h2>开始这个会话</h2>
      <p>消息会发给当前工作区里的本机 Pi。这里还没有接上 CLI。</p>
    </article>
    <template v-for="message in messages" :key="message.id">
      <details v-if="message.role === 'thinking'" class="card thinking" open>
        <summary>思考</summary>
        <p>{{ message.text }}</p>
      </details>
      <article v-else-if="message.role === 'tool'" class="card tool">
        <div>
          <b>{{ message.name }}</b>
          <span>{{ message.state }}</span>
        </div>
        <p>{{ message.text }}</p>
      </article>
      <article v-else class="bubble" :class="message.role">
        <span class="who">{{ message.role === "user" ? "你" : "Pi" }}</span>
        {{ message.text }}
      </article>
    </template>
  </section>
</template>
