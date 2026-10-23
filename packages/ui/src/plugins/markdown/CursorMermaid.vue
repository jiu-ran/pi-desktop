<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { MermaidBlockNode } from "markstream-vue";
import { layoutCursorFlow } from "./cursor-layout.ts";
import type { CursorDiagram } from "./cursor-layout.ts";

const props = defineProps<{ node: { code?: string }; isDark?: boolean }>();
// markstream 的 NodeRenderer 会把整组预览 / 交互开关一起透传过来，
// 本组件只关心 node / isDark，且根节点是多根片段，不去继承这些属性，
// 避免开发模式下刷出 Extraneous non-props attributes 警告。
defineOptions({ inheritAttrs: false });
const diagram = ref<CursorDiagram | null>(null);
const error = ref("");
const mode = ref<"preview" | "source">("preview");
const baseZoom = 0.8;
const zoom = ref(baseZoom);
const zoomPercent = computed(() => Math.round((zoom.value / baseZoom) * 100));
const fullscreen = ref(false);
const dragging = ref(false);
const panX = ref(0);
const panY = ref(0);
let dragX = 0;
let dragY = 0;
let panStartX = 0;
let panStartY = 0;
const markerId = `cursor-arrow-${Math.random().toString(36).slice(2)}`;
let generation = 0;

const code = computed(() => props.node?.code ?? "");
// 非流程图不能用简化解析器输出空图，交给 Mermaid 原生渲染。
const isFlow = computed(() => /^\s*(?:%%[^\n]*\n)*\s*(?:flowchart|graph)\b/i.test(code.value));
const width = computed(() => diagram.value?.width ?? 320);
const height = computed(() => diagram.value?.height ?? 120);

async function render(): Promise<void> {
  const current = ++generation;
  error.value = "";
  if (!code.value.trim() || !isFlow.value) {
    diagram.value = null;
    return;
  }
  try {
    const next = await layoutCursorFlow(code.value);
    if (current === generation) diagram.value = next;
  } catch (cause) {
    if (current !== generation) return;
    diagram.value = null;
    error.value = cause instanceof Error ? cause.stack || cause.message : String(cause);
  }
}

watch(code, () => void render(), { immediate: true });

function path(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
}

function lines(label: string): string[] {
  return label.replace(/<br\s*\/?>/gi, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
}

function lineY(node: { y: number; height: number }, index: number, count: number): number {
  const start = node.y + node.height / 2 - ((count - 1) * 18) / 2;
  return start + index * 18;
}

async function copySource(): Promise<void> {
  await navigator.clipboard.writeText(code.value);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") fullscreen.value = false;
}

function onDragStart(event: PointerEvent): void {
  if (event.button !== 0) return;
  dragging.value = true;
  dragX = event.clientX;
  dragY = event.clientY;
  panStartX = panX.value;
  panStartY = panY.value;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onDragMove(event: PointerEvent): void {
  if (!dragging.value) return;
  panX.value = panStartX + event.clientX - dragX;
  panY.value = panStartY + event.clientY - dragY;
}

function onDragEnd(): void {
  dragging.value = false;
}

function onFullscreenWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const next = zoom.value + (event.deltaY < 0 ? 0.1 : -0.1);
  zoom.value = Math.min(baseZoom * 2, Math.max(baseZoom * 0.5, Number(next.toFixed(2))));
}

watch(fullscreen, (open) => {
  window.removeEventListener("keydown", onKeydown);
  if (open) window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <MermaidBlockNode v-if="!isFlow" :node="{ ...node, type: 'code_block', language: 'mermaid', code, raw: code }" :is-dark="isDark" />
  <section v-else class="cursor-diagram" :data-scheme="isDark ? 'dark' : 'light'">
    <header>
      <span>Mermaid</span>
      <div>
        <button type="button" :class="{ active: mode === 'preview' }" @click="mode = 'preview'">图表</button>
        <button type="button" :class="{ active: mode === 'source' }" @click="mode = 'source'">源码</button>
        <button type="button" @click="copySource">复制</button>
        <button type="button" @click="zoom = Math.max(baseZoom * 0.5, zoom - 0.1)">-</button>
        <button type="button" @click="zoom = baseZoom">{{ zoomPercent }}%</button>
        <button type="button" @click="zoom = Math.min(baseZoom * 2, zoom + 0.1)">+</button>
        <button type="button" title="全屏" aria-label="全屏" @click="fullscreen = true">⛶</button>
      </div>
    </header>
    <pre v-if="mode === 'source'">{{ code }}</pre>
    <div v-else-if="error" class="cursor-diagram-error"><strong>图表渲染失败</strong><pre>{{ code }}</pre></div>
    <div v-else class="cursor-diagram-view">
      <svg
        v-if="diagram"
        :viewBox="`0 0 ${width} ${height}`"
        :style="{ width: `${width * zoom}px`, height: `${height * zoom}px` }"
      >
        <defs>
          <marker :id="markerId" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1.2 L 8 5 L 0 8.8 z" />
          </marker>
        </defs>
        <g v-for="cluster in diagram.clusters" :key="cluster.id">
          <rect class="cursor-cluster-rect" :x="cluster.x" :y="cluster.y" :width="cluster.width" :height="cluster.height" rx="12" />
          <text class="cursor-cluster-label" :x="cluster.labelX" :y="cluster.labelY">{{ cluster.label }}</text>
        </g>
        <g v-for="edge in diagram.edges" :key="edge.id" class="cursor-edge">
          <path :d="path(edge.points)" :marker-end="`url(#${markerId})`" />
          <g v-if="edge.label">
            <rect class="cursor-edge-label" :x="edge.labelX - edge.labelWidth / 2" :y="edge.labelY - edge.labelHeight / 2" :width="edge.labelWidth" :height="edge.labelHeight" rx="6" />
            <text :x="edge.labelX" :y="edge.labelY">{{ edge.label }}</text>
          </g>
        </g>
        <g v-for="node in diagram.nodes" :key="node.id" class="cursor-node">
          <rect :x="node.x" :y="node.y" :width="node.width" :height="node.height" rx="10" />
          <text :x="node.x + node.width / 2" :y="lineY(node, 0, lines(node.label).length)">
            <tspan
              v-for="(line, index) in lines(node.label)"
              :key="index"
              :x="node.x + node.width / 2"
              :y="lineY(node, index, lines(node.label).length)"
            >{{ line }}</tspan>
          </text>
        </g>
      </svg>
    </div>
  </section>
  <Teleport to="body">
    <div v-if="fullscreen" class="cursor-diagram-fullscreen" @click.self="fullscreen = false" @wheel="onFullscreenWheel">
      <section class="cursor-diagram" :data-scheme="isDark ? 'dark' : 'light'">
        <header>
          <span>Mermaid 全屏</span>
          <div>
            <button type="button" @click="zoom = Math.max(baseZoom * 0.5, zoom - 0.1)">-</button>
            <button type="button" @click="zoom = baseZoom">{{ zoomPercent }}%</button>
            <button type="button" @click="zoom = Math.min(baseZoom * 2, zoom + 0.1)">+</button>
            <button type="button" @click="fullscreen = false">关闭</button>
          </div>
        </header>
        <div
          class="cursor-diagram-view"
          :class="{ dragging }"
          @pointerdown="onDragStart"
          @pointermove="onDragMove"
          @pointerup="onDragEnd"
          @pointercancel="onDragEnd"
        >
          <svg v-if="diagram" :viewBox="`0 0 ${width} ${height}`" :style="{ width: `${width * zoom}px`, height: `${height * zoom}px`, transform: `translate(${panX}px, ${panY}px)` }">
            <defs>
              <marker :id="`${markerId}-full`" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1.2 L 8 5 L 0 8.8 z" />
              </marker>
            </defs>
            <g v-for="cluster in diagram.clusters" :key="cluster.id">
              <rect class="cursor-cluster-rect" :x="cluster.x" :y="cluster.y" :width="cluster.width" :height="cluster.height" rx="12" />
              <text class="cursor-cluster-label" :x="cluster.labelX" :y="cluster.labelY">{{ cluster.label }}</text>
            </g>
            <g v-for="edge in diagram.edges" :key="edge.id" class="cursor-edge">
              <path :d="path(edge.points)" :marker-end="`url(#${markerId}-full)`" />
              <g v-if="edge.label">
                <rect class="cursor-edge-label" :x="edge.labelX - edge.labelWidth / 2" :y="edge.labelY - edge.labelHeight / 2" :width="edge.labelWidth" :height="edge.labelHeight" rx="6" />
                <text :x="edge.labelX" :y="edge.labelY">{{ edge.label }}</text>
              </g>
            </g>
            <g v-for="node in diagram.nodes" :key="node.id">
              <rect :x="node.x" :y="node.y" :width="node.width" :height="node.height" rx="10" />
              <text :x="node.x + node.width / 2" :y="lineY(node, 0, lines(node.label).length)">
                <tspan v-for="(line, index) in lines(node.label)" :key="index" :x="node.x + node.width / 2" :y="lineY(node, index, lines(node.label).length)">{{ line }}</tspan>
              </text>
            </g>
          </svg>
        </div>
      </section>
    </div>
  </Teleport>
</template>
