import { reactive } from "vue";

/** 快速打开文件（Ctrl / Cmd + P）的全局开关。 */
export const quickOpenState = reactive({
  open: false,
});

export function openQuickOpen(): void {
  quickOpenState.open = true;
}

export function closeQuickOpen(): void {
  quickOpenState.open = false;
}
