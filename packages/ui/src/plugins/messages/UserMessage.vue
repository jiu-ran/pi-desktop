<script setup>
defineProps({ block: { type: Object, required: true } });
</script>

<template>
  <div class="msg user">
    <div class="msg-user-bubble">
      <div class="msg-user-text">{{ block.text }}</div>
      <span v-if="block.images" class="msg-attach">{{ block.images }} 张图片</span>
    </div>
  </div>
</template>
