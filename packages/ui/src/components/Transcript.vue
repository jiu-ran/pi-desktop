<script setup>
import MarkdownRender from "markstream-vue";
import "markstream-vue/index.css";

defineProps({
  messages: { type: Array, required: true },
  dark: { type: Boolean, required: true },
});

const codeTheme = {
  light: "vitesse-light",
  dark: "vitesse-dark",
};

function toolSummary(message) {
  const text = message.text || "";
  try {
    const value = JSON.parse(text);
    return value.command || value.path || value.query || message.name;
  } catch {
    const line = text.split(/\n/, 1)[0];
    return line.length > 120 ? `${line.slice(0, 120)}…` : line || message.name;
  }
}
</script>

<template>
  <section class="transcript">
    <article v-if="messages.length === 0" class="empty">
      <h2>开始这个会话</h2>
      <p>消息会发给当前工作区里的本机 Pi。这里还没有接上 CLI。</p>
    </article>
    <template v-for="message in messages" :key="message.id">
      <details v-if="message.role === 'thinking'" class="card thinking">
        <summary>思考</summary>
        <pre>{{ message.text }}</pre>
      </details>
      <details v-else-if="message.role === 'tool'" class="card tool">
        <summary>
          <b>{{ message.name }}</b>
          <code>{{ toolSummary(message) }}</code>
          <span>{{ message.state }}</span>
        </summary>
        <pre>{{ message.text }}</pre>
      </details>
      <article v-else class="bubble markdown" :class="message.role">
        <span class="who">{{ message.role === "user" ? "你" : "Pi" }}</span>
        <MarkdownRender
          mode="chat"
          :content="message.text || ''"
          :is-dark="dark"
          :code-block-props="{ theme: codeTheme }"
          final
        />
      </article>
    </template>
  </section>
</template>
