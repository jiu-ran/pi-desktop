<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";

/**
 * 原生 title 提示在深色主题下会使用系统白底，和界面主题割裂。
 * 这里统一接管 title：用主题化的浮层展示，离开后把 title 写回，保留可访问性。
 *
 * 注意 title 常来自响应式绑定（例如活动卡片的 :title="group.detail"）。
 * 流式更新时 Vue 会把属性重新写回；只在显示瞬间摘一次会让浏览器同时弹出
 * 系统白底提示，出现「白色 + 两个」的重复浮层。因此：
 *   1. 悬停立即摘掉 title（不等 380ms 延迟），不给原生提示留窗口；
 *   2. 展示期间用 MutationObserver 持续接管，属性被写回时再次摘掉并同步文案。
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
let pendingTitle = "";
let active: HTMLElement | null = null;
let activeTitle = "";
let activeDescribedBy: string | null = null;
let activeAriaLabel: string | null = null;
let addedAriaLabel = false;
let observer: MutationObserver | null = null;
let watcher: MutationObserver | null = null;
let probeTimer = 0;
/** 自己写回 title 时记下值，避免被全局观察器当成「新的原生提示」再摘一次。 */
const selfWrites = new WeakMap<Element, string>();
/** 最近的指针位置与悬停目标：用来判断某个元素此刻是不是在指针下面。 */
let pointerX = Number.NaN;
let pointerY = Number.NaN;
let hovered: Element | null = null;

function clearShowTimer(): void {
  if (showTimer) window.clearTimeout(showTimer);
  showTimer = 0;
}

function clearHideTimer(): void {
  if (hideTimer) window.clearTimeout(hideTimer);
  hideTimer = 0;
}

/** 摘掉原生 title，返回原值（没有属性时返回空串）。 */
function takeTitle(element: Element): string {
  const title = element.getAttribute("title");
  if (title === null) return "";
  element.removeAttribute("title");
  return title;
}

function restoreTitle(element: Element, value: string): void {
  if (!value || !element.isConnected) return;
  if (element.hasAttribute("title")) return;
  selfWrites.set(element, value);
  element.setAttribute("title", value);
}

function stopObserver(): void {
  observer?.disconnect();
  observer = null;
}

function restoreActive(): void {
  const element = active;
  if (!element) return;
  active = null;
  const title = activeTitle;
  const describedBy = activeDescribedBy;
  const ariaLabel = activeAriaLabel;
  const added = addedAriaLabel;
  activeTitle = "";
  activeDescribedBy = null;
  activeAriaLabel = null;
  addedAriaLabel = false;
  if (!element.isConnected) return;
  restoreTitle(element, title);
  if (describedBy === null) {
    element.removeAttribute("aria-describedby");
  } else {
    element.setAttribute("aria-describedby", describedBy);
  }
  if (added) {
    if (ariaLabel === null) {
      if (element.getAttribute("aria-label") === title) element.removeAttribute("aria-label");
    } else if (element.getAttribute("aria-label") === title) {
      element.setAttribute("aria-label", ariaLabel);
    }
  }
}

/** 还没展示就离开：立刻把 title 写回，避免元素永久丢失提示文本。 */
function cancelPending(): void {
  if (!pending) return;
  const element = pending;
  const title = pendingTitle;
  pending = null;
  pendingTitle = "";
  clearShowTimer();
  restoreTitle(element, title);
}

function hideNow(): void {
  clearShowTimer();
  clearHideTimer();
  stopObserver();
  tip.visible = false;
  restoreActive();
  cancelPending();
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
  const maxY = Math.max(EDGE, window.innerHeight - box.height - EDGE);
  let y = rect.bottom + GAP;
  // 下方放不下时优先翻到上方；最后统一夹进视口，避免锚点滚出视口后浮层跑到屏幕外。
  if (y + box.height > window.innerHeight - EDGE) {
    const above = rect.top - GAP - box.height;
    if (above >= EDGE) y = above;
  }
  y = Math.min(Math.max(EDGE, y), maxY);
  tip.x = Math.round(x);
  tip.y = Math.round(y);
}

function applyText(title: string): void {
  tip.text = title.length > MAX_TEXT ? `${title.slice(0, MAX_TEXT).trimEnd()}\n…（内容过长，已截断）` : title;
}

/** 展示期间持续接管 title：响应式更新把属性写回时再次摘掉，并同步浮层文案。 */
function watchTitle(element: HTMLElement): void {
  stopObserver();
  observer = new MutationObserver(() => {
    if (active !== element) return;
    const next = element.getAttribute("title");
    // 我们自己摘除属性也会触发回调，此时读到 null，忽略。
    if (next === null) return;
    element.removeAttribute("title");
    activeTitle = next;
    applyText(next);
    void nextTick(position);
  });
  observer.observe(element, { attributes: true, attributeFilter: ["title"] });
}

function show(element: HTMLElement, title: string): void {
  active = element;
  activeTitle = title;
  activeDescribedBy = element.getAttribute("aria-describedby");
  activeAriaLabel = element.getAttribute("aria-label");
  addedAriaLabel = false;
  takeTitle(element);
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
  applyText(title);
  tip.visible = true;
  void nextTick(position);
  watchTitle(element);
}

function scheduleShow(element: HTMLElement): void {
  if (active === element) return;
  clearHideTimer();
  if (active) hideNow();
  cancelPending();
  const raw = element.getAttribute("title");
  // 空 title 无需接管，否则会被白丢。
  if (raw === null || !raw.trim()) return;
  element.removeAttribute("title");
  pending = element;
  pendingTitle = raw;
  clearShowTimer();
  showTimer = window.setTimeout(() => {
    showTimer = 0;
    if (pending !== element) return;
    const value = pendingTitle;
    pending = null;
    pendingTitle = "";
    if (element.isConnected && value) show(element, value);
    else restoreTitle(element, value);
  }, SHOW_DELAY);
}

/** 元素此刻是否在指针下方：:hover、最近一次悬停目标，或命中指针坐标。 */
function underPointer(element: Element): boolean {
  if (element.matches?.(":hover")) return true;
  if (hovered) {
    if (element === hovered || element.contains(hovered) || hovered.contains(element)) return true;
  }
  if (Number.isNaN(pointerX) || Number.isNaN(pointerY)) return false;
  const rect = element.getBoundingClientRect();
  if (!rect.width && !rect.height) return false;
  return pointerX >= rect.left && pointerX <= rect.right && pointerY >= rect.top && pointerY <= rect.bottom;
}

/**
 * 全局兜底：title 常常是在指针已经停在那里之后才被写回的（Vue 重渲染、插件列表刷新），
 * 这时不会再有 mouseover，浏览器照旧弹原生白底提示。这里按指针位置接管，
 * 把「指针下面新出现的 title」也走主题化浮层。
 */
function onGlobalMutations(records: MutationRecord[]): void {
  for (const record of records) {
    if (record.type === "attributes") {
      const element = record.target;
      if (!(element instanceof Element)) continue;
      const title = element.getAttribute("title");
      if (!title || !title.trim()) continue;
      if (selfWrites.get(element) === title) {
        selfWrites.delete(element);
        continue;
      }
      if (element.closest(".pi-tooltip")) continue;
      if (!underPointer(element)) continue;
      if (element === active) {
        takeTitle(element);
        activeTitle = title;
        applyText(title);
        void nextTick(position);
        continue;
      }
      if (element === pending) {
        takeTitle(element);
        pendingTitle = title;
        continue;
      }
      if (element instanceof HTMLElement) scheduleShow(element);
    }
  }
}

function onPointerMove(event: PointerEvent): void {
  pointerX = event.clientX;
  pointerY = event.clientY;
}

/**
 * 指针停住时元素可能被整体替换（Vue 换新节点、列表重排），新节点自带 title 却没有
 * 新的 mouseover，浏览器就会弹原生白底提示。这里按指针坐标低频探测一次：
 * 没有命中就不写 DOM，成本恒定，也不受终端这类高频 DOM 抖动影响。
 */
function probeUnderPointer(): void {
  if (Number.isNaN(pointerX) || Number.isNaN(pointerY)) return;
  if (document.visibilityState !== "visible") return;
  const target = document.elementFromPoint(pointerX, pointerY);
  if (!(target instanceof Element) || target.closest(".pi-tooltip")) return;
  const element = target.closest<HTMLElement>("[title]");
  if (!element || element === active || element === pending) return;
  const title = element.getAttribute("title");
  if (!title || !title.trim()) return;
  scheduleShow(element);
}

/** 松开鼠标后重新看一眼指针下面：按住拖动期间不弹提示，松手才接管。 */
function onPointerUp(event: PointerEvent): void {
  pointerX = event.clientX;
  pointerY = event.clientY;
  probeUnderPointer();
}

function onMouseOver(event: MouseEvent): void {
  pointerX = event.clientX;
  pointerY = event.clientY;
  const target = event.target;
  if (!(target instanceof Element)) return;
  hovered = target;
  if (event.buttons !== 0) return;
  if (active?.contains(target)) {
    clearHideTimer();
    return;
  }
  if (pending?.contains(target)) {
    // 指针仍在待展示元素内：保持原计时器，不因内部子元素移动而重置延迟。
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
  // 指针已经移走：同步坐标，否则按坐标探测会误以为还停在被移出的元素上。
  pointerX = event.clientX;
  pointerY = event.clientY;
  hovered = related instanceof Element ? related : null;
  if (active && related instanceof Node) {
    if (active.contains(related) || inTooltipGroup(active, related)) return;
  }
  // 允许鼠标移到浮层里滚动长内容；浮层自身离开时再收起。
  if (related instanceof Element && related.closest(".pi-tooltip")) return;
  if (pending && related instanceof Node) {
    if (pending.contains(related) || inTooltipGroup(pending, related)) return;
  }
  if (active) scheduleHide();
  cancelPending();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") hideNow();
}

function onViewportChange(event?: Event): void {
  const target = event?.target;
  if (target instanceof Node && layer.value?.contains(target)) return;
  // 锚点还在指针下面（活动栏、表头这类固定元素）：滚动不该把提示收掉，只重新定位。
  // 冒烟/流式场景里列表持续滚动，否则固定元素的提示会被反复收起，看起来像「偶尔不显示」。
  const anchor = active ?? pending;
  if (anchor?.isConnected && underPointer(anchor)) {
    if (active) void nextTick(position);
    return;
  }
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
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerup", onPointerUp, true);
  watcher = new MutationObserver(onGlobalMutations);
  // 只盯 title 变化：子节点变化在高频场景（终端 DOM 渲染）里太密集，改用指针探测。
  watcher.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["title"] });
  probeTimer = window.setInterval(probeUnderPointer, 300);
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
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp, true);
  watcher?.disconnect();
  watcher = null;
  if (probeTimer) window.clearInterval(probeTimer);
  probeTimer = 0;
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
