<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { PiToolItem, PiToolsOverview } from "../../../env.d.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";

/**
 * 工具开关。
 *
 * 开关写到 Pi 的 `defaultTools`（`settings.json`），因此终端里的 `pi` 也认同一份选择；
 * 桌面端启动 Pi 时再用 `--tools +name/-name` 校正当前会话 —— Pi 恢复会话时会保留
 * 当时的工具记录，只改设置文件对已有会话不生效。MCP 工具不在这张表里，它的暴露
 * 方式在 MCP 页单独控制。
 */

const { workbench, bus } = useKernel();
const state = workbench.state;

const loading = ref(false);
const data = ref<PiToolsOverview | null>(null);
const scope = ref<"global" | "project">("global");
const scopeTouched = ref(false);
const saving = ref("");
const applying = ref(false);
const trusting = ref(false);
const pendingApply = ref(false);

const builtinTools = computed(() => (data.value?.tools ?? []).filter((tool) => tool.group === "builtin"));
const extensionTools = computed(() => (data.value?.tools ?? []).filter((tool) => tool.group === "extension"));
const enabledCount = computed(() => (data.value?.tools ?? []).filter((tool) => tool.enabled).length);
const noneEnabled = computed(() => Boolean(data.value) && enabledCount.value === 0);
const projectHasPlainList = computed(() =>
  (data.value?.projectEntries ?? []).some((entry) => !entry.startsWith("+") && !entry.startsWith("-")),
);

const scopeLabel = computed(() => (scope.value === "project" ? "当前项目" : "全局"));
const projectAvailable = computed(() => Boolean(data.value?.projectSettingsPath));
const switchesDisabled = computed(() => Boolean(saving.value) || (scope.value === "project" && !data.value?.projectWritable));

const scopeHint = computed(() => {
  if (!data.value) return "";
  if (scope.value === "project") {
    if (!data.value.projectSettingsPath) return "先打开一个项目，才能写项目级工具开关。";
    if (!data.value.projectWritable) return "项目级工具设置需要先信任此项目：Pi 不会加载未信任项目的 .pi/settings.json。";
    if (data.value.projectConfigured && data.value.projectEntries.length === 0) {
      return "当前项目显式设置了空的工具清单：全局有配置时继承全局，全局也没配置时表示全部停用。重新打开任一开关会把它改成完整清单。";
    }
    if (!data.value.projectConfigured) {
      return "保存后会在这个项目的 .pi/settings.json 里写一份完整清单：之后这个项目不再跟随全局，全局开关仍影响其它项目与终端。";
    }
    return "";
  }
  if (projectHasPlainList.value) {
    return "当前项目有自己的工具清单（.pi/settings.json），会覆盖全局设置；要改这个项目，请切到「当前项目」。";
  }
  if (data.value.projectConfigured && data.value.projectEntries.length === 0) {
    return "当前项目显式设置了空的工具清单：全局有配置时继承全局，全局也没配置时表示全部停用。";
  }
  if (data.value.projectConfigured) {
    return "当前项目用 +name / -name 在全局选择上增减工具；这里保存后，项目仍会再应用一次自己的增减。";
  }
  return "";
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const next = await workbench.toolsOverview();
    data.value = next;
    if (!scopeTouched.value) scope.value = next.projectConfigured && next.projectWritable ? "project" : "global";
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    loading.value = false;
  }
}

function chooseScope(value: "global" | "project"): void {
  scope.value = value;
  scopeTouched.value = true;
}

async function toggleTool(tool: PiToolItem, enabled: boolean): Promise<void> {
  if (saving.value) return;
  saving.value = tool.name;
  try {
    const next = await workbench.toolsSet({ scope: scope.value, name: tool.name, enabled });
    data.value = next;
    pendingApply.value = true;
    const actual = next.tools.find((item) => item.name === tool.name)?.enabled;
    if (actual !== enabled) {
      bus.emit("notify", {
        level: "warning",
        text: `已保存到${scopeLabel.value}设置，但当前项目的工具清单覆盖了它，这一项实际仍是${actual ? "启用" : "停用"}`,
      });
    }
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
    // 失败时重新读一次，开关回到真实状态
    await load();
  } finally {
    saving.value = "";
  }
}

/** 设置只在新进程启动时读取；已有 worker 需要重启才会用上新工具。 */
async function applyRestart(): Promise<void> {
  if (applying.value) return;
  applying.value = true;
  try {
    const result = await workbench.restartIdleWorkspaces();
    pendingApply.value = false;
    const parts = [`已重启 ${result.restarted} 个空闲会话`];
    if (result.skipped) parts.push(`${result.skipped} 个正在输出的会话会在本轮结束后才用上新工具`);
    bus.emit("notify", { level: "info", text: parts.join("；") });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    applying.value = false;
  }
}

/**
 * 项目级开关的前提是信任项目：Pi 不会加载未信任项目的 .pi/settings.json。
 * 信任与「设置 → Skills」里的按钮走同一条路径，写完重启一次让资源重新加载。
 */
async function trustProject(): Promise<void> {
  const cwd = state.activeCwd;
  if (!cwd || trusting.value) return;
  trusting.value = true;
  try {
    const bridge = (globalThis as any).piDesktop;
    await bridge.setProjectTrust(cwd, "trust");
    await workbench.restart();
    await load();
    bus.emit("notify", { level: "info", text: "已信任此项目，现在可以保存项目级工具开关" });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    trusting.value = false;
  }
}

onMounted(load);
watch(
  () => state.activeCwd,
  () => {
    scopeTouched.value = false;
    pendingApply.value = false;
    void load();
  },
);
</script>

<template>
  <div class="settings-group">
    <div class="settings-group-title">写入位置</div>

    <div class="settings-row">
      <div class="settings-row-info">
        <strong>工具开关写到哪里</strong>
        <span>
          这些开关写入 Pi 的 <code>defaultTools</code>，终端里的 <code>pi</code> 也使用同一份选择。
          桌面端启动 Pi 时会用 <code>--tools</code> 校正当前会话，所以已有会话也会按这里的开关生效；
          MCP 工具不在这张表里，由 MCP 页的暴露模式单独控制。
        </span>
      </div>
      <div class="settings-segments" role="group" aria-label="工具开关写入位置">
        <button
          type="button"
          class="settings-segment"
          :class="{ active: scope === 'global' }"
          @click="chooseScope('global')"
        >
          全局
        </button>
        <button
          type="button"
          class="settings-segment"
          :class="{ active: scope === 'project' }"
          :disabled="!projectAvailable"
          @click="chooseScope('project')"
        >
          当前项目
        </button>
      </div>
    </div>

    <div v-if="data" class="settings-row">
      <div class="settings-row-info">
        <strong>{{ scope === "project" ? "项目设置文件" : "全局设置文件" }}</strong>
        <span class="settings-mono-line" :title="scope === 'project' ? data.projectSettingsPath : data.globalSettingsPath">
          {{ scope === "project" ? data.projectSettingsPath : data.globalSettingsPath }}
        </span>
      </div>
      <button
        type="button"
        class="btn ghost small"
        :disabled="!(scope === 'project' ? data.projectSettingsPath : data.globalSettingsPath)"
        @click="workbench.reveal(scope === 'project' ? data.projectSettingsPath : data.globalSettingsPath)"
      >
        在文件夹中显示
      </button>
    </div>

    <div v-if="scopeHint" class="settings-alert warn">{{ scopeHint }}</div>

    <div v-if="data && scope === 'project' && !data.projectWritable" class="settings-alert warn">
      <div>
        项目级工具设置需要先信任此项目：Pi 不会加载未信任项目的 .pi/settings.json，保存进去也不会生效。
      </div>
      <div class="settings-toolbar-actions">
        <button type="button" class="btn small" :disabled="trusting" @click="trustProject">
          {{ trusting ? "处理中…" : "信任此项目" }}
        </button>
      </div>
    </div>

    <div v-if="pendingApply" class="settings-alert warn">
      <div>
        开关已保存。Pi 在启动时读取工具选择，需要重启会话才会生效；正在输出的会话会在本轮结束之后再应用。
      </div>
      <div class="settings-toolbar-actions">
        <button type="button" class="btn small" :disabled="applying" @click="applyRestart">
          {{ applying ? "正在重启…" : "重启空闲会话" }}
        </button>
      </div>
    </div>

    <div v-if="data?.diagnostics?.length" class="settings-alert err">
      <div v-for="(item, index) in data.diagnostics" :key="index">{{ item }}</div>
    </div>

    <div v-if="noneEnabled" class="settings-alert err">
      当前没有启用任何内置工具：模型不能读写文件或执行命令（配置文件里的其它工具条目不受影响）。
    </div>
  </div>

  <div v-if="loading && !data" class="settings-empty-card">
    <span class="mini-spinner" /> 正在读取工具设置…
  </div>

  <template v-else-if="data">
    <div class="settings-group">
      <div class="settings-group-head">
        <span class="settings-group-title">内置工具（{{ builtinTools.filter((tool) => tool.enabled).length }} / {{ builtinTools.length }}）</span>
      </div>
      <label v-for="tool in builtinTools" :key="tool.name" class="settings-row clickable">
        <div class="settings-row-info">
          <strong>
            {{ tool.label }}
            <span class="settings-plugin-tag">{{ tool.name }}</span>
            <span v-if="tool.defaultEnabled" class="settings-status-pill muted">默认启用</span>
          </strong>
          <span>{{ tool.description }}</span>
        </div>
        <input
          type="checkbox"
          class="settings-switch"
          :checked="tool.enabled"
          :disabled="switchesDisabled"
          :aria-label="`${tool.enabled ? '停用' : '启用'} ${tool.name}`"
          @change="toggleTool(tool, ($event.target as HTMLInputElement).checked)"
        />
      </label>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">按需工具（Pi 内置扩展）</div>
      <label v-for="tool in extensionTools" :key="tool.name" class="settings-row clickable">
        <div class="settings-row-info">
          <strong>
            {{ tool.label }}
            <span class="settings-plugin-tag">{{ tool.name }}</span>
          </strong>
          <span>{{ tool.description }}</span>
        </div>
        <input
          type="checkbox"
          class="settings-switch"
          :checked="tool.enabled"
          :disabled="switchesDisabled"
          :aria-label="`${tool.enabled ? '停用' : '启用'} ${tool.name}`"
          @change="toggleTool(tool, ($event.target as HTMLInputElement).checked)"
        />
      </label>
    </div>

    <div v-if="data.extraEntries.length" class="settings-group">
      <div class="settings-group-title">配置文件里的其它条目</div>
      <div class="settings-row">
        <div class="settings-row-info">
          <strong>这些条目不在桌面端的工具目录里</strong>
          <span>
            扩展工具名或 <code>mcp__*</code> 通配模式会原样保留在设置文件中，不会被这里的开关覆盖。
          </span>
          <div class="settings-tool-chips">
            <span v-for="entry in data.extraEntries" :key="entry" class="settings-tool-chip">{{ entry }}</span>
          </div>
        </div>
      </div>
    </div>
  </template>
</template>
