<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { captionGlyphs } from "./caption-glyphs.ts";

/**
 * 自绘窗口按钮（Windows / Linux）。
 *
 * 之前用的是 `titleBarOverlay` 的系统按钮：它由 DWM 画在网页之上，悬停没有高亮、
 * 按下没有反馈，颜色还得靠 IPC 通知主进程——永远是「慢一步」。
 * 自己画之后悬停 / 按下 / 关闭变红全部由 CSS 控制，顺带也不再有配色同步问题。
 *
 * macOS 保留系统红绿灯，不渲染这里。
 */
const maximized = ref(false);
const bridge = (globalThis as any).piDesktop?.windowControls as
  | {
      minimize: () => Promise<boolean>;
      toggleMaximize: () => Promise<boolean>;
      close: () => Promise<boolean>;
      state: () => Promise<{ maximized: boolean }>;
      onChange: (listener: (state: { maximized: boolean }) => void) => () => void;
    }
  | undefined;

let off: (() => void) | undefined;

onMounted(async () => {
  if (!bridge) return;
  try {
    const state = await bridge.state();
    maximized.value = Boolean(state?.maximized);
  } catch {
    // 拿不到状态就用默认的「最大化」
  }
  off = bridge.onChange((state) => {
    maximized.value = Boolean(state?.maximized);
  });
});

onBeforeUnmount(() => off?.());
</script>

<template>
  <div v-if="bridge" class="wc-group no-drag">
    <button class="wc-btn" title="最小化" aria-label="最小化" @click="bridge.minimize()" v-html="captionGlyphs.minimize" />
    <button
      class="wc-btn"
      :title="maximized ? '向下还原' : '最大化'"
      :aria-label="maximized ? '向下还原' : '最大化'"
      @click="bridge.toggleMaximize()"
      v-html="maximized ? captionGlyphs.restore : captionGlyphs.maximize"
    />
    <button class="wc-btn wc-close" title="关闭" aria-label="关闭" @click="bridge.close()" v-html="captionGlyphs.close" />
  </div>
</template>
