<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";

/**
 * 原生 title 提示在深色主题下会使用系统白底，和界面主题割裂。
 * 这里统一接管 title：用主题化的浮层展示，离开后把 title 写回，保留可访问性。
 *
 * 注意 title 常来自响应式绑定（例如活动卡片的 :title="group.detail"）。
 * 流式更新时 Vue 会把属性重新写回；只在显示瞬间摘一次会让浏览器同时弹出
 * 系统白底提示，出现「白色 + 两个」的重复浮层。因此：
 *   1. 悬停立即摘掉 title（不等 SHOW_DELAY），不给原生提示留窗口；
 *   2. 展示期间用 MutationObserver 持续接管，属性被写回时再次摘掉并同步文案。
 */
const tip = reactive({
  visible: false,
  text: "",
  x: 0,
  y: 0,
});
const layer = ref<HTMLElement | null>(null);

/**
 * 悬停多久才弹提示。380ms 太急，指针扫过去就冒出来；700ms 是「停一下才出现」的手感，
 * 和系统原生 title（约 1s）接近但不至于等得久。
 */
const SHOW_DELAY = 700;
/** 移开多久收起：留一点缓冲，指针擦过边缘时不闪。 */
const HIDE_DELAY = 180;
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
/**
 * 子元素接管提示期间，祖先节点上的原生 title 也必须一并暂存摘除：
 * 1) 否则子元素摘掉 title 后，浏览器会顺着 DOM 向上找到祖先的 title 并弹出系统白底提示；
 * 2) 300ms 的指针探测 `target.closest("[title]")` 也会误命中祖先，导致子级与父级提示反复来回切换。
 */
const suppressedAncestors = new Map<HTMLElement, string>();
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

function restoreSuppressedAncestors(keepFor?: HTMLElement | null): void {
  for (const [anc, title] of [...suppressedAncestors.entries()]) {
    if (keepFor && anc.isConnected && anc !== keepFor && anc.contains(keepFor)) continue;
    suppressedAncestors.delete(anc);
    restoreTitle(anc, title);
  }
}

function suppressAncestors(element: HTMLElement): void {
  restoreSuppressedAncestors(element);
  let parent = element.parentElement;
  while (parent) {
    const t = parent.getAttribute("title");
    if (t !== null) {
      parent.removeAttribute("title");
      if (t.trim()) suppressedAncestors.set(parent, t);
    }
    parent = parent.parentElement;
  }
}

function stopObserver(): void {
  observer?.disconnect();
  observer = null;
}

function restoreActive(keepFor?: HTMLElement | null): void {
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
  if (keepFor && element !== keepFor && element.contains(keepFor)) {
    if (title.trim()) suppressedAncestors.set(element, title);
  } else {
    restoreTitle(element, title);
  }
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
function cancelPending(keepFor?: HTMLElement | null): void {
  if (!pending) return;
  const element = pending;
  const title = pendingTitle;
  pending = null;
  pendingTitle = "";
  clearShowTimer();
  if (keepFor && element.isConnected && element !== keepFor && element.contains(keepFor)) {
    if (title.trim()) suppressedAncestors.set(element, title);
  } else {
    restoreTitle(element, title);
  }
}

function hideForNext(keepFor: HTMLElement): void {
  clearShowTimer();
  clearHideTimer();
  stopObserver();
  tip.visible = false;
  restoreActive(keepFor);
  cancelPending(keepFor);
  restoreSuppressedAncestors(keepFor);
}

function hideNow(): void {
  clearShowTimer();
  clearHideTimer();
  stopObserver();
  tip.visible = false;
  restoreActive();
  cancelPending();
  restoreSuppressedAncestors();
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
  let raw = element.getAttribute("title");
  if ((raw === null || !raw.trim()) && suppressedAncestors.has(element)) {
    raw = suppressedAncestors.get(element) ?? null;
    suppressedAncestors.delete(element);
  }
  // 空 title 无需接管，否则会被白丢。
  if (raw === null || !raw.trim()) return;
  // 已经在显示浮层（在相邻元素之间移动）：立刻换文案，不再等一轮延迟。
  // 否则旧浮层还挂着、新元素带着原生 title，浏览器会先弹出白底提示。
  if (tip.visible && active) {
    element.removeAttribute("title");
    hideForNext(element);
    suppressAncestors(element);
    show(element, raw);
    return;
  }
  if (active) hideForNext(element);
  cancelPending(element);
  element.removeAttribute("title");
  suppressAncestors(element);
  pending = element;
  pendingTitle = raw;
  clearShowTimer();
  showTimer = window.setTimeout(() => {
    showTimer = 0;
    if (pending !== element) return;
    const value = pendingTitle;
    pending = null;
    pendingTitle = "";
    if (element.isConnected && value) {
      suppressAncestors(element);
      show(element, value);
    } else {
      restoreTitle(element, value);
      restoreSuppressedAncestors();
    }
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
/**
 * 全局 title 监听：**回调里绝不直接写 DOM**。
 *
 * 踩过的坑：回调里调 scheduleShow / restoreTitle 会写回 title，写回又触发新的
 * mutation 记录 → 回调再跑 → 再写……形成微任务乒乓，主线程被占满（日志里抓到的
 * 栈就在这条链上：#0 restoreTitle ← #1 restoreActive ← #2 scheduleShow ← #3 回调）。
 *
 * 所以这里只「收集」目标元素，去重后放到下一个宏任务里处理；每批最多处理
 * MAX_PER_FLUSH 个，处理过程中产生的新记录留到下一批——即使还有来回写，
 * 主线程也能在批次之间喘口气，界面不会整片卡死。
 */
const pendingTitles = new Set<Element>();
let titleFlushTimer = 0;
/** 每批最多处理多少个元素 */
const MAX_PER_FLUSH = 40;
/** 一批记录最多收集多少条，超出的丢弃（剩下的交给 300ms 指针探测） */
const MAX_RECORDS_PER_BATCH = 4000;
/** 一批里最多安排几次「显示浮层」：指针下同时只会有一个元素 */
const MAX_SHOW_PER_BATCH = 2;

function scheduleTitleFlush(): void {
  if (titleFlushTimer) return;
  titleFlushTimer = window.setTimeout(flushTitles, 0);
}

function flushTitles(): void {
  titleFlushTimer = 0;
  if (!pendingTitles.size) return;
  const batch = [...pendingTitles].slice(0, MAX_PER_FLUSH);
  for (const element of batch) pendingTitles.delete(element);
  handleTitleTargets(batch);
  if (pendingTitles.size) scheduleTitleFlush();
}

function onGlobalMutations(records: MutationRecord[]): void {
  const limit = Math.min(records.length, MAX_RECORDS_PER_BATCH);
  for (let index = 0; index < limit; index += 1) {
    const record = records[index]!;
    if (record.type !== "attributes") continue;
    if (record.attributeName && record.attributeName !== "title") continue;
    const target = record.target;
    if (target instanceof Element) pendingTitles.add(target);
  }
  if (pendingTitles.size) scheduleTitleFlush();
}

/** 真正处理一批元素：判断是否在指针下、要不要接管。 */
function handleTitleTargets(targets: Element[]): void {
  // 指针下到底是谁：每批只量一次（elementFromPoint 会触发一次布局），
  // 之后都用树上的包含关系判断，不再逐条 getBoundingClientRect。
  let hit: Element | null | undefined;
  let shows = 0;
  for (const element of targets) {
    const title = element.getAttribute("title");
    if (!title || !title.trim()) continue;
    if (selfWrites.get(element) === title) {
      selfWrites.delete(element);
      continue;
    }
    if (element.closest(".pi-tooltip")) continue;
    // 先做不触发布局的判断：命中指针本身，或命中它的祖先容器（容器被写回 title）。
    // 不能反过来用 hovered.contains(element)：hovered 可能是 body，那样整批元素
    // 都会被当成「在悬停链上」，又退回逐条量几何。
    if (element !== hovered && !element.contains(hovered as Node)) {
      if (hit === undefined) {
        hit = null;
        if (!Number.isNaN(pointerX) && !Number.isNaN(pointerY)) {
          const node = document.elementFromPoint(pointerX, pointerY);
          hit = node instanceof Element ? node : null;
        }
      }
      const under = Boolean(hit && (hit === element || hit.contains(element) || element.contains(hit)));
      if (!under) continue;
    }
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
    const currentAnchor = active ?? pending;
    if (currentAnchor && element !== currentAnchor && element.contains(currentAnchor)) {
      takeTitle(element);
      if (element instanceof HTMLElement) suppressedAncestors.set(element, title);
      continue;
    }
    if (element instanceof HTMLElement && shows < MAX_SHOW_PER_BATCH) {
      shows += 1;
      scheduleShow(element);
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
  const currentAnchor = active ?? pending;
  if (currentAnchor?.isConnected && currentAnchor.contains(target)) {
    const inner = target.closest<HTMLElement>("[title]");
    if (inner && inner !== currentAnchor && currentAnchor.contains(inner)) {
      scheduleShow(inner);
    }
    return;
  }
  restoreSuppressedAncestors();
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
  // 指针进入了当前锚点的子元素：如果那个子元素自己也有 title（例如排队卡片里的
  // 编辑/撤回按钮），必须切过去接管，否则父级浮层一直挂着、子元素的原生白底提示照样弹。
  // 注意必须校验 active.contains(inner)：当前锚点自身 title 已被摘除，target.closest("[title]")
  // 若不加限制会向上越过当前子锚点找到祖先，导致父子提示反复乒乓切换。
  if (active?.contains(target)) {
    const inner = target.closest<HTMLElement>("[title]");
    if (inner && inner !== active && active.contains(inner) && !inner.closest(".pi-tooltip")) {
      scheduleShow(inner);
      return;
    }
    clearHideTimer();
    return;
  }
  if (pending?.contains(target)) {
    const inner = target.closest<HTMLElement>("[title]");
    if (inner && inner !== pending && pending.contains(inner) && !inner.closest(".pi-tooltip")) {
      scheduleShow(inner);
      return;
    }
    // 指针仍在待展示元素内：保持原计时器，不因内部子元素移动而重置延迟。
    clearHideTimer();
    return;
  }
  restoreSuppressedAncestors();
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
  if (!active) restoreSuppressedAncestors();
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
  if (titleFlushTimer) window.clearTimeout(titleFlushTimer);
  titleFlushTimer = 0;
  pendingTitles.clear();
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
