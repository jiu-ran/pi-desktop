<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";

/**
 * 原生 title 提示在深色主题下会使用系统白底，和界面主题割裂。
 * 这里统一接管 title：悬停时暂时移走原生属性，用主题化的浮层展示；
 * 离开后恢复 title 与 aria-describedby，保留可访问性。
 */
const tip = reactive({
  visible: false,
  text: "",
  x: 0,
  y: 0,
});
const layer = ref<HTMLElement | null>(null);

const SHOW_DELAY = 380;
const HIDE_DELAY = 120;
const GAP = 8;
const EDGE = 8;
const MAX_TEXT = 2000;

let showTimer = 0;
let hideTimer = 0;
let pending: HTMLElement | null = null;
let active: HTMLElement | null = null;
let activeTitle = "";
let activeDescribedBy: string | null = null;
let activeAriaLabel: string | null = null;
let addedAriaLabel = false;

function clearShowTimer(): void {
  if (showTimer) window.clearTimeout(showTimer);
  showTimer = 0;
  pending = null;
}

function clearHideTimer(): void {
  if (hideTimer) window.clearTimeout(hideTimer);
  hideTimer = 0;
}

function restoreActive(): void {
  const element = active;
  if (!element) return;
  active = null;
  if (!element.isConnected) {
    activeTitle = "";
    activeDescribedBy = null;
    activeAriaLabel = null;
    addedAriaLabel = false;
    return;
  }
  if (activeTitle && !element.hasAttribute("title")) element.setAttribute("title", activeTitle);
  if (activeDescribedBy === null) {
    element.removeAttribute("aria-describedby");
  } else {
    element.setAttribute("aria-describedby", activeDescribedBy);
  }
  if (addedAriaLabel) {
    if (activeAriaLabel === null) {
      if (element.getAttribute("aria-label") === activeTitle) element.removeAttribute("aria-label");
    } else if (element.getAttribute("aria-label") === activeTitle) {
      element.setAttribute("aria-label", activeAriaLabel);
    }
  }
  activeTitle = "";
  activeDescribedBy = null;
  activeAriaLabel = null;
  addedAriaLabel = false;
}

function hideNow(): void {
  clearShowTimer();
  clearHideTimer();
  tip.visible = false;
  restoreActive();
}

function scheduleHide(): void {
  clearShowTimer();
  if (!active) return;
  clearHideTimer();
  hideTimer = window.setTimeout(() => {
    hideTimer = 0;
    hideNow();
  }, HIDE_DELAY);
}

function position(): void {
  const element = active;
  const node = layer.value;
  if (!element || !node || !tip.visible || !element.isConnected) return;
  const rect = element.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const maxX = Math.max(EDGE, window.innerWidth - box.width - EDGE);
  let x = rect.left + rect.width / 2 - box.width / 2;
  x = Math.min(maxX, Math.max(EDGE, x));
  let y = rect.bottom + GAP;
  if (y + box.height > window.innerHeight - EDGE) {
    const above = rect.top - GAP - box.height;
    y = above >= EDGE ? above : Math.max(EDGE, window.innerHeight - box.height - EDGE);
  }
  tip.x = Math.round(x);
  tip.y = Math.round(y);
}

function show(element: HTMLElement): void {
  const title = element.getAttribute("title")?.trim();
  if (!title || !element.isConnected) return;
  active = element;
  activeTitle = title;
  activeDescribedBy = element.getAttribute("aria-describedby");
  activeAriaLabel = element.getAttribute("aria-label");
  addedAriaLabel = false;
  element.removeAttribute("title");
  const hasName =
    (activeAriaLabel !== null && activeAriaLabel.trim().length > 0) ||
    element.hasAttribute("aria-labelledby") ||
    (element.textContent ?? "").trim().length > 0 ||
    (element instanceof HTMLImageElement && !!element.alt);
  if (!hasName) {
    element.setAttribute("aria-label", title);
    addedAriaLabel = true;
  }
  if (activeDescribedBy === null) {
    element.setAttribute("aria-describedby", "pi-tooltip");
  } else if (!activeDescribedBy.split(/\s+/).includes("pi-tooltip")) {
    element.setAttribute("aria-describedby", `${activeDescribedBy} pi-tooltip`);
  }
  tip.text = title.length > MAX_TEXT ? `${title.slice(0, MAX_TEXT).trimEnd()}\n…（内容过长，已截断）` : title;
  tip.visible = true;
  void nextTick(position);
}

function scheduleShow(element: HTMLElement): void {
  if (active === element) return;
  clearShowTimer();
  clearHideTimer();
  if (active) hideNow();
  pending = element;
  showTimer = window.setTimeout(() => {
    showTimer = 0;
    if (pending !== element) return;
    pending = null;
    if (element.isConnected && element.hasAttribute("title")) show(element);
  }, SHOW_DELAY);
}

function onMouseOver(event: MouseEvent): void {
  if (event.buttons !== 0) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (active?.contains(target)) {
    clearHideTimer();
    return;
  }
  const element = target.closest<HTMLElement>("[title]");
  if (!element || element.closest(".pi-tooltip")) return;
  scheduleShow(element);
}

function inTooltipGroup(element: HTMLElement, related: EventTarget | null): boolean {
  if (!(related instanceof Node)) return false;
  const group = element.closest<HTMLElement>("[data-tooltip-group]");
  return !!group && group.contains(related);
}

function onMouseOut(event: MouseEvent): void {
  const related = event.relatedTarget;
  if (active && related instanceof Node) {
    if (active.contains(related) || inTooltipGroup(active, related)) return;
  }
  // 允许鼠标移到浮层里滚动长内容；浮层自身离开时再收起。
  if (related instanceof Element && related.closest(".pi-tooltip")) return;
  if (pending && related instanceof Node) {
    if (pending.contains(related) || inTooltipGroup(pending, related)) return;
  }
  if (active) scheduleHide();
  if (pending) clearShowTimer();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") hideNow();
}

function onViewportChange(event?: Event): void {
  const target = event?.target;
  if (target instanceof Node && layer.value?.contains(target)) return;
  hideNow();
}

onMounted(() => {
  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);
  document.addEventListener("mousedown", hideNow, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("focusin", hideNow, true);
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("blur", onViewportChange);
});

onBeforeUnmount(() => {
  document.removeEventListener("mouseover", onMouseOver, true);
  document.removeEventListener("mouseout", onMouseOut, true);
  document.removeEventListener("mousedown", hideNow, true);
  document.removeEventListener("keydown", onKeyDown, true);
  document.removeEventListener("focusin", hideNow, true);
  window.removeEventListener("scroll", onViewportChange, true);
  window.removeEventListener("resize", onViewportChange);
  window.removeEventListener("blur", onViewportChange);
  hideNow();
});
</script>

<template>
  <div
    v-if="tip.visible"
    id="pi-tooltip"
    ref="layer"
    class="pi-tooltip"
    role="tooltip"
    :style="{ left: `${tip.x}px`, top: `${tip.y}px` }"
    @mouseenter="clearHideTimer"
    @mouseleave="scheduleHide"
  >{{ tip.text }}</div>
</template>
