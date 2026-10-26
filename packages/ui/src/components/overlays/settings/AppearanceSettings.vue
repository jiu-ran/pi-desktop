<script setup lang="ts">
import { computed } from "vue";
import {
  ACCENTS,
  COLUMN_WIDTHS,
  RADIUS_PRESETS,
  THEME_MODES,
  emphasisColor,
  normalizeHex,
  type EmphasisMode,
} from "../../../shared/appearance.ts";
import { appSettings, DEFAULT_SETTINGS } from "../../../services/settings.ts";
import { icons } from "../../../shared/util.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";

/**
 * 外观与布局：配色、强调色、圆角、字号与面板宽度。
 *
 * 改任何一项都立即生效并保存；页里的「实时预览」用的是同一个文档，
 * 所以强调色 / 圆角 / 字号一变，预览立即跟着变。
 */
const { bus, workbench } = useKernel();
const state = workbench.state;

const themeModeHint = computed(() => {
  const mode = THEME_MODES.find((item) => item.id === appSettings.themeMode) ?? THEME_MODES[0];
  const actual = state.theme === "light" ? "浅色" : "深色";
  return mode.id === "system" ? `${mode.hint} · 当前 ${actual}` : mode.hint;
});
const accentCustom = computed(() => normalizeHex(appSettings.accentCustom, ACCENTS[0].color));
const accentColor = computed(() =>
  appSettings.accent === "custom"
    ? accentCustom.value
    : (ACCENTS.find((item) => item.id === appSettings.accent) ?? ACCENTS[0]).color,
);
const accentLabel = computed(() =>
  appSettings.accent === "custom"
    ? `自定义 ${accentCustom.value}`
    : (ACCENTS.find((item) => item.id === appSettings.accent) ?? ACCENTS[0]).label,
);
const EMPHASIS_MODES: Array<{ id: EmphasisMode; label: string; hint: string }> = [
  { id: "follow", label: "跟随强调色", hint: "和主强调色保持一致" },
  { id: "custom", label: "单独设置", hint: "对话里的强调文字用另一个颜色" },
];
const emphasisCustom = computed(() => normalizeHex(appSettings.emphasisCustom, appSettings.emphasis === "custom" ? accentColor.value : accentColor.value));
const emphasisResolved = computed(() => emphasisColor(appSettings.emphasis, appSettings.emphasisCustom, appSettings.accent, appSettings.accentCustom));
const emphasisLabel = computed(() => (appSettings.emphasis === "custom" ? `自定义 ${emphasisResolved.value}` : "跟随强调色"));

/** 自定义颜色只接受 #rrggbb，非法输入保留原值，同时把「自定义」选中 */
function onAccentCustom(event: Event): void {
  const value = normalizeHex((event.target as HTMLInputElement)?.value, accentCustom.value);
  appSettings.accentCustom = value;
  appSettings.accent = "custom";
}

function onEmphasisCustom(event: Event): void {
  const value = normalizeHex((event.target as HTMLInputElement)?.value, emphasisCustom.value);
  appSettings.emphasisCustom = value;
  appSettings.emphasis = "custom";
}
const radiusLabel = computed(() => (RADIUS_PRESETS.find((item) => item.id === appSettings.radius) ?? RADIUS_PRESETS[1]).label);

const ACTIVITY_DETAILS = [
  { id: "grouped", label: "时间线", hint: "按一次请求合成一行「执行了 N 步」，展开后按真实顺序列出每一步" },
  { id: "compact", label: "紧凑", hint: "同上，但去掉步骤序号与耗时，行更矮" },
  { id: "expanded", label: "展开", hint: "打开对话时直接展开每一步的细节" },
] as const;
const activityDetailLabel = computed(() => (ACTIVITY_DETAILS.find((item) => item.id === appSettings.activityDetail) ?? ACTIVITY_DETAILS[0]).label);
const columnWidthLabel = computed(
  () => (COLUMN_WIDTHS.find((item) => item.id === appSettings.columnWidth) ?? COLUMN_WIDTHS[1]).label,
);

/** 「恢复默认外观」只还原外观相关项：不动终端、Agent、MCP 等设置。 */
const APPEARANCE_KEYS = [
  "themeMode",
  "accent",
  "accentCustom",
  "emphasis",
  "emphasisCustom",
  "radius",
  "columnWidth",
  "reduceMotion",
  "messageDensity",
  "uiFontSize",
  "codeFontSize",
  "uiZoom",
] as const satisfies ReadonlyArray<keyof typeof DEFAULT_SETTINGS>;

function resetAppearanceNow(): void {
  for (const key of APPEARANCE_KEYS) {
    (appSettings as any)[key] = DEFAULT_SETTINGS[key];
  }
  bus.emit("notify", { level: "info", text: "已恢复默认外观" });
}

function resetAreaWidths(): void {
  workbench.setSidebarWidth(272);
  workbench.setStageWidth(520);
  workbench.setPanelWidth(320);
  bus.emit("notify", { level: "info", text: "已恢复各工作区面板默认宽度" });
}
</script>

<template>
    <div class="settings-group">
    <div class="settings-group-head">
      <span class="settings-group-title">主题</span>
      <button type="button" class="btn ghost small" @click="resetAppearanceNow">
        <span class="settings-inline-icon" v-html="icons.refresh" />恢复默认外观
      </button>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <strong>配色模式</strong>
        <span>{{ themeModeHint }}</span>
      </div>
      <div class="settings-theme-tiles">
        <button
v-for="item in THEME_MODES"
:key="item.id"
type="button"
class="settings-theme-tile"
:class="{ active: appSettings.themeMode === item.id }"
:title="item.hint"
@click="appSettings.themeMode = item.id"
        >
<!-- 缩略图就是「选出来会变成什么颜色」：深色黑底、浅色白底、跟随系统左右各一半 -->
<span class="settings-theme-art" :data-scheme="item.id">
  <span
    v-for="half in item.id === 'system' ? ['dark', 'light'] : ['auto']"
    :key="half"
    class="settings-theme-half"
    :class="`is-${half}`"
  >
    <span class="settings-theme-art-line" />
    <span class="settings-theme-art-line short" />
  </span>
</span>
{{ item.label }}
        </button>
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <strong>强调色</strong>
        <span>按钮、选中态、链接与高亮块的主色 · 当前 {{ accentLabel }}</span>
      </div>
      <div class="settings-swatches">
        <button
v-for="item in ACCENTS"
:key="item.id"
type="button"
class="settings-swatch"
:class="{ active: appSettings.accent === item.id }"
:style="{ background: item.color }"
:title="item.label"
:aria-label="item.label"
@click="appSettings.accent = item.id"
        />
        <!-- 自定义：色环上叠一个当前颜色，点一下开系统取色器 -->
        <label
class="settings-swatch settings-swatch-custom"
:class="{ active: appSettings.accent === 'custom' }"
:title="`自定义颜色（当前 ${accentCustom}）`"
        >
<span class="settings-swatch-chosen" :style="{ background: accentCustom }" />
<input
  type="color"
  :value="accentCustom"
  aria-label="自定义强调色"
  @input="onAccentCustom"
  @click="appSettings.accent = 'custom'"
/>
        </label>
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <strong>对话强调色</strong>
        <span>对话里行内代码等强调文字的颜色，可以和上面的界面强调色不一样 · 当前 {{ emphasisLabel }}</span>
      </div>
      <div class="settings-emphasis-row">
        <div class="settings-segments">
<button
  v-for="item in EMPHASIS_MODES"
  :key="item.id"
  type="button"
  class="settings-segment"
  :class="{ active: appSettings.emphasis === item.id }"
  :title="item.hint"
  @click="appSettings.emphasis = item.id"
>{{ item.label }}</button>
        </div>
        <label
v-if="appSettings.emphasis === 'custom'"
class="settings-swatch settings-swatch-custom small"
:style="{ background: emphasisCustom }"
:class="{ active: true }"
:title="`自定义对话强调色（当前 ${emphasisCustom}）`"
        >
<input
  type="color"
  :value="emphasisCustom"
  aria-label="自定义对话强调色"
  @input="onEmphasisCustom"
/>
        </label>
      </div>
    </div>

    <!-- 实时预览：这层在同一个文档里，强调色 / 圆角 / 字号一变它立刻跟着变 -->
    <div class="settings-preview">
      <div class="settings-preview-head">
        <span>实时预览</span>
        <span class="settings-preview-hint">改任何一项都会立即生效并保存</span>
      </div>
      <div class="settings-preview-body">
        <div class="settings-preview-row">
<span class="settings-preview-bubble">对话里的用户消息长这样</span>
        </div>
        <div class="settings-preview-row">
<span class="settings-preview-chip">强调色</span>
<span class="settings-preview-emphasis">对话强调文字</span>
<code>--emphasis: {{ emphasisResolved }}</code>
<span class="settings-preview-pill">就绪</span>
        </div>
        <div class="settings-preview-row">
<span class="settings-preview-card">工具调用卡片 · 圆角、边框与字号跟随设置</span>
        </div>
      </div>
    </div>
  </div>

  <div class="settings-group">
    <div class="settings-group-title">排版</div>

    <div class="settings-row">
      <div class="settings-row-info">
        <strong>界面字号</strong>
        <span>全局界面与对话正文字号 · 当前 {{ appSettings.uiFontSize }}px</span>
      </div>
      <div class="settings-segments">
        <button
v-for="sz in [12, 13, 14, 15]"
:key="sz"
type="button"
class="settings-segment"
:class="{ active: appSettings.uiFontSize === sz }"
@click="appSettings.uiFontSize = sz"
        >{{ sz }}</button>
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <strong>代码字号</strong>
        <span>代码块、Diff 视图与命令输出字号 · 当前 {{ appSettings.codeFontSize }}px</span>
      </div>
      <div class="settings-segments">
        <button
v-for="sz in [11.5, 12.5, 13.5, 14.5]"
:key="sz"
type="button"
class="settings-segment"
:class="{ active: appSettings.codeFontSize === sz }"
@click="appSettings.codeFontSize = sz"
        >{{ sz }}</button>
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <strong>消息密度</strong>
        <span>调整对话区消息与工具卡片的垂直间距</span>
      </div>
      <div class="settings-segments">
        <button
type="button"
class="settings-segment"
:class="{ active: appSettings.messageDensity === 'comfortable' }"
@click="appSettings.messageDensity = 'comfortable'"
        >舒适</button>
        <button
type="button"
class="settings-segment"
:class="{ active: appSettings.messageDensity === 'compact' }"
@click="appSettings.messageDensity = 'compact'"
        >紧凑</button>
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <strong>执行记录</strong>
        <span>对话里工具调用与思考的分组方式 · 当前 {{ activityDetailLabel }}</span>
      </div>
      <div class="settings-segments">
        <button
v-for="item in ACTIVITY_DETAILS"
:key="item.id"
type="button"
class="settings-segment"
:class="{ active: appSettings.activityDetail === item.id }"
:title="item.hint"
@click="appSettings.activityDetail = item.id"
        >{{ item.label }}</button>
      </div>
    </div>

    <label class="settings-row clickable">
      <div class="settings-row-info">
        <strong>合并连续同类步骤</strong>
        <span>连续几步只有参数不同（如 <code>npm run check -- 1/2/3</code>、同一模板写多个文件）时收成一行，点开再看每一步；关掉则只淡化相同前缀</span>
      </div>
      <input v-model="appSettings.activityMerge" type="checkbox" class="settings-switch" />
    </label>

    <div class="settings-row">
      <div class="settings-row-info">
        <strong>圆角</strong>
        <span>卡片、输入框、弹层的圆角大小 · 当前 {{ radiusLabel }}</span>
      </div>
      <div class="settings-segments">
        <button
v-for="item in RADIUS_PRESETS"
:key="item.id"
type="button"
class="settings-segment"
:class="{ active: appSettings.radius === item.id }"
@click="appSettings.radius = item.id"
        >{{ item.label }}</button>
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <strong>对话列宽</strong>
        <span>消息正文与输入框的最大宽度，窗口更宽时留白更多 · 当前 {{ columnWidthLabel }}</span>
      </div>
      <div class="settings-segments">
        <button
v-for="item in COLUMN_WIDTHS"
:key="item.id"
type="button"
class="settings-segment"
:class="{ active: appSettings.columnWidth === item.id }"
@click="appSettings.columnWidth = item.id"
        >{{ item.label }}</button>
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <strong>界面缩放</strong>
        <span>整体缩放比例，替代快捷键缩放 · 当前 {{ Math.round(appSettings.uiZoom * 100) }}%</span>
      </div>
      <div class="settings-segments">
        <button
v-for="z in [0.9, 1, 1.1, 1.25]"
:key="z"
type="button"
class="settings-segment"
:class="{ active: Math.abs(appSettings.uiZoom - z) < 0.001 }"
@click="appSettings.uiZoom = z"
        >{{ Math.round(z * 100) }}%</button>
      </div>
    </div>
  </div>

  <div class="settings-group">
    <div class="settings-group-title">动效</div>
    <label class="settings-row clickable">
      <div class="settings-row-info">
        <strong>关闭界面动效</strong>
        <span>去掉弹层过渡、加载动画与平滑滚动；系统开了「减少动态效果」时建议打开</span>
      </div>
      <input v-model="appSettings.reduceMotion" type="checkbox" class="settings-switch" />
    </label>
  </div>
<div class="settings-group">
    <div class="settings-group-head">
      <span class="settings-group-title">工作区面板布局宽度</span>
      <button type="button" class="btn ghost small" @click="resetAreaWidths">恢复默认宽度</button>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <strong>项目与会话栏（左侧导航栏）</strong>
        <span>管理工作区目录与并行任务会话 · 范围 180px – 480px，当前 {{ state.sidebarWidth }}px</span>
      </div>
      <input
        type="range"
        min="180"
        max="480"
        :value="state.sidebarWidth"
        class="settings-slider"
        @input="workbench.setSidebarWidth(Number(($event.target as HTMLInputElement).value))"
      />
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <strong>编辑器与详情视图（中部副舞台）</strong>
        <span>多标签代码编辑、变更 Diff 与提交详情 · 范围 240px – 1000px，当前 {{ state.stageWidth }}px</span>
      </div>
      <input
        type="range"
        min="240"
        max="1000"
        :value="state.stageWidth"
        class="settings-slider"
        @input="workbench.setStageWidth(Number(($event.target as HTMLInputElement).value))"
      />
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <strong>扩展工具面板（右侧插件面板）</strong>
        <span>展示项目文件树、变更汇总、Git 树等插件列表 · 范围 290px – 640px，当前 {{ state.panelWidth }}px</span>
      </div>
      <input
        type="range"
        min="200"
        max="640"
        :value="state.panelWidth"
        class="settings-slider"
        @input="workbench.setPanelWidth(Number(($event.target as HTMLInputElement).value))"
      />
    </div>
  </div>
</template>
