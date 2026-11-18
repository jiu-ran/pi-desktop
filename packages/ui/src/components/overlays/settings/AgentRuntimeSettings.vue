<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useKernel } from "../../../kernel/use-kernel.ts";
import PiCliSettings from "./PiCliSettings.vue";
import PiModelDefaults from "./PiModelDefaults.vue";
import SelectMenu from "../../shared/SelectMenu.vue";
import { icons } from "../../../shared/util.ts";

/**
 * 设置 → 智能体：列表 + 单个 Agent 的详情。
 *
 * 只维护桌面端启动 CLI 所需的东西（路径、默认模型 / 思考档位、登录入口），
 * 不改写 Agent 自己的系统提示词、MCP 与技能配置；这些仍由各自 CLI 管理。
 */
const { workbench, bus } = useKernel();
const state = workbench.state;
const ws = computed(() => workbench.active.value);

const agents = computed<any[]>(() => state.agents?.agents ?? []);
const selectedKind = ref("");
const selected = computed<any>(() => agents.value.find((agent: any) => agent?.kind === selectedKind.value) ?? null);
const models = ref<any[]>([]);
const modelsLoading = ref(false);
const modelDraft = ref("");
const thinkingDraft = ref("");
const editing = ref(false);
const pathDraft = ref("");
const busy = ref("");

const descriptions: Record<string, string> = {
  pi: "极简、可自我扩展的终端 Agent：四个工具、极短系统提示，运行你在「模型」里登记的模型",
  antigravity: "Google Antigravity 官方 CLI，通过 ACP v1 接入；流式回答、工具确认与会话历史沿用桌面端",
};

const modelOptions = computed(() => [
  { value: "", label: "自动选择可用型号", hint: "优先 Hydrogen / Flash" },
  ...models.value.map((model: any) => ({
    value: String(model.id),
    label: String(model.name || model.id),
    hint: String(model.id),
  })),
]);

const thinkingOptions = [
  { value: "", label: "跟随 CLI", hint: "使用 Antigravity 的默认档位" },
  { value: "low", label: "低", hint: "更快，思考更少" },
  { value: "medium", label: "中", hint: "速度与深度平衡" },
  { value: "high", label: "高", hint: "更深，耗时更长" },
];

function prettyModelId(id: string): string {
  // 模型列表还在加载时先给一个可读的兜底，避免把 gemini-3.8-flash 原样摆进设置页。
  return id
    .split("-")
    .map((part) => {
      if (part === "gemini") return "Gemini";
      if (part === "claude") return "Claude";
      if (part === "gpt") return "GPT";
      if (part === "oss") return "OSS";
      return part ? part[0].toUpperCase() + part.slice(1) : part;
    })
    .join(" ");
}

function modelLabel(agent: any): string {
  if (!agent?.found) return "—";
  if (agent.kind === "pi") return "会话内选择";
  const id = String(agent.model || "");
  if (!id) return "自动";
  return models.value.find((model: any) => model.id === id)?.name || prettyModelId(id);
}

function accountLabel(agent: any): string {
  if (!agent?.found) return "未找到";
  return agent.kind === "antigravity" ? "Google 账号" : "CLI 管理";
}

async function refresh(): Promise<void> {
  await workbench.refreshAgents(ws.value?.cwd || "");
  await loadModels();
}

async function loadModels(): Promise<void> {
  const antigravity = agents.value.find((agent: any) => agent.kind === "antigravity");
  if (!antigravity?.found || modelsLoading.value) return;
  modelsLoading.value = true;
  try {
    models.value = (await window.piDesktop!.agentModels("antigravity")) || [];
  } catch {
    models.value = [];
  } finally {
    modelsLoading.value = false;
  }
}

onMounted(refresh);
watch(() => ws.value?.cwd, refresh);

async function redetect(): Promise<void> {
  busy.value = "detect";
  try {
    await refresh();
    bus.emit("notify", { level: "info", text: "已重新检测本机 Agent" });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    busy.value = "";
  }
}

function openDetail(kind: string): void {
  selectedKind.value = kind;
  editing.value = false;
  pathDraft.value = "";
  const agent = agents.value.find((item: any) => item.kind === kind);
  modelDraft.value = String(agent?.model ?? "");
  thinkingDraft.value = String(agent?.thinking ?? "");
  if (kind === "antigravity") void loadModels();
}

function backToList(): void {
  selectedKind.value = "";
  editing.value = false;
  pathDraft.value = "";
}

async function toggleDefault(agent: any, event: Event): Promise<void> {
  const checked = (event.target as HTMLInputElement).checked;
  busy.value = `default-${agent.kind}`;
  try {
    await window.piDesktop!.setAgentDefault(checked ? agent.kind : "");
    await refresh();
    bus.emit("notify", {
      level: "info",
      text: checked ? `新项目默认使用 ${agent.label}` : "新项目将先询问使用哪个 Agent",
    });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
    await refresh();
  } finally {
    busy.value = "";
  }
}

async function login(): Promise<void> {
  if (!selected.value) return;
  busy.value = "login";
  try {
    await window.piDesktop!.agentLogin(selected.value.kind);
    bus.emit("notify", {
      level: "info",
      text: "已打开登录流程：在浏览器 / 终端里完成后，新建或重启会话即可",
    });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    busy.value = "";
  }
}

async function applyModel(): Promise<void> {
  if (!selected.value) return;
  busy.value = "model";
  try {
    await window.piDesktop!.setAgentModel(selected.value.kind, modelDraft.value);
    await refresh();
    bus.emit("notify", {
      level: "info",
      text: modelDraft.value ? `默认模型已设为 ${modelLabel(selected.value)}` : "新会话将自动选择可用模型",
    });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    busy.value = "";
  }
}

async function applyThinking(): Promise<void> {
  if (!selected.value) return;
  busy.value = "thinking";
  try {
    await window.piDesktop!.setAgentThinking(selected.value.kind, thinkingDraft.value);
    await refresh();
    bus.emit("notify", {
      level: "info",
      text: thinkingDraft.value ? `新会话的默认思考档位已设为 ${thinkingDraft.value}` : "新会话跟随 Antigravity 的默认思考档位",
    });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    busy.value = "";
  }
}

function editPath(): void {
  if (!selected.value || selected.value.kind !== "antigravity") return;
  editing.value = true;
  pathDraft.value = String(selected.value.path ?? "");
}

function cancelEdit(): void {
  editing.value = false;
  pathDraft.value = "";
}

async function choosePath(): Promise<void> {
  try {
    const file = await window.piDesktop!.chooseAgentExecutable();
    if (file) pathDraft.value = file;
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

async function applyPath(): Promise<void> {
  if (!selected.value || selected.value.kind !== "antigravity") return;
  const input = pathDraft.value.trim();
  busy.value = "path-antigravity";
  try {
    const result = await window.piDesktop!.locateAgent("antigravity", input);
    if (!result?.found) {
      throw new Error(String(result?.error || "该路径无法运行 agy --version，请检查后重试"));
    }
    editing.value = false;
    await refresh();
    const refreshed = await workbench.restartIdleWorkspaces();
    const suffix = refreshed.skipped ? `；${refreshed.skipped} 个正在输出的任务结束后生效` : "";
    bus.emit("notify", { level: "info", text: `Agent 路径已更新${suffix}` });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    busy.value = "";
  }
}

async function clearPath(): Promise<void> {
  editing.value = true;
  pathDraft.value = "";
  await applyPath();
}
</script>

<template>
  <div class="agent-settings-page">
    <!-- 列表：对应「设置 → 智能体」的总览 -->
    <template v-if="!selectedKind">
      <header class="agent-page-head">
        <div class="agent-page-head-copy">
          <p class="agent-page-count">{{ agents.length }} 个已检测 · 选择后按项目记住</p>
        </div>
        <button type="button" class="btn ghost small agent-redetect" :disabled="busy === 'detect'" @click="redetect">
          <span v-if="busy === 'detect'" class="mini-spinner" />
          <span v-else class="agent-redetect-icon" v-html="icons.refresh" />
          重新检测
        </button>
      </header>

      <div class="agent-table" role="table" aria-label="智能体列表">
        <div class="agent-table-head" role="row">
          <span>智能体</span>
          <span>默认模型</span>
          <span>账号</span>
          <span>新项目默认</span>
          <span aria-hidden="true" />
        </div>
        <div
          v-for="agent in agents"
          :key="agent.kind"
          class="agent-table-row"
          :class="{ 'is-missing': !agent.found }"
          role="row"
          tabindex="0"
          :title="agent.error || agent.path"
          @click="openDetail(agent.kind)"
          @keydown.enter.prevent="openDetail(agent.kind)"
        >
          <div class="agent-identity">
            <span class="agent-logo" :class="`is-${agent.kind}`" aria-hidden="true">
              <svg v-if="agent.kind === 'pi'" viewBox="0 0 32 32" width="30" height="30">
                <rect width="32" height="32" rx="8" fill="currentColor" />
                <path d="M9 9h6.6c3.4 0 5.5 1.8 5.5 4.7 0 2.1-1.1 3.6-3 4.3V23h-3v-4.3H12V23H9V9Zm3 2.7v4.5h3.3c1.5 0 2.5-.8 2.5-2.2 0-1.4-1-2.3-2.5-2.3H12Z" fill="#fff" />
                <circle cx="22.5" cy="10.5" r="1.7" fill="#fff" />
              </svg>
              <svg v-else viewBox="0 0 32 32" width="30" height="30">
                <path d="M16 3 29 26H3L16 3Z" fill="#4f7cff" />
                <path d="M16 9 24.5 24h-17L16 9Z" fill="#7aa2ff" />
                <path d="M16 14.5 20.5 23h-9L16 14.5Z" fill="#b7ccff" />
              </svg>
            </span>
            <div class="agent-identity-copy">
              <div class="agent-name-line">
                <strong>{{ agent.label }}</strong>
                <span v-if="state.agents.default === agent.kind" class="agent-badge is-default">默认</span>
                <span v-if="!agent.found" class="agent-badge is-muted">未找到</span>
              </div>
              <span class="agent-subline">
                <template v-if="agent.found">v{{ agent.version }} · {{ agent.path }}</template>
                <template v-else>{{ agent.error || "未检测到可执行文件" }}</template>
              </span>
              <span class="agent-description">{{ descriptions[agent.kind] }}</span>
            </div>
          </div>

          <div class="agent-cell">
            <span class="agent-cell-main">{{ modelLabel(agent) }}</span>
            <span class="agent-cell-sub">{{ agent.kind === "pi" ? "默认值在 Pi 详情设置" : "新会话默认值" }}</span>
          </div>
          <div class="agent-cell">
            <span class="agent-cell-main">{{ accountLabel(agent) }}</span>
            <span class="agent-cell-sub">{{ agent.kind === "antigravity" ? "本机登录" : "本机 CLI" }}</span>
          </div>
          <div class="agent-cell agent-cell-toggle" @click.stop>
            <input
              class="settings-switch"
              type="checkbox"
              :checked="state.agents.default === agent.kind"
              :disabled="!agent.found || Boolean(busy)"
              :aria-label="`将 ${agent.label} 设为新项目默认 Agent`"
              @click.stop
              @keydown.stop
              @change="toggleDefault(agent, $event)"
            />
          </div>
          <span class="agent-row-chevron" aria-hidden="true" v-html="icons.chevronRight" />
        </div>
      </div>

      <p class="settings-note agent-list-note">
        「新项目默认」只影响还没有单独选过 Agent 的项目；正在运行的任务不会被切换。
        目前支持 Pi 与 Antigravity，更多 ACP Agent 会按同一套方式接入。
      </p>
    </template>

    <!-- 详情：对应截图里的单个智能体页面 -->
    <template v-else-if="selected">
      <button type="button" class="agent-back" @click="backToList">‹ 全部智能体</button>

      <header class="agent-detail-head">
        <span class="agent-logo is-large" :class="`is-${selected.kind}`" aria-hidden="true">
          <svg v-if="selected.kind === 'pi'" viewBox="0 0 32 32" width="42" height="42">
            <rect width="32" height="32" rx="8" fill="currentColor" />
            <path d="M9 9h6.6c3.4 0 5.5 1.8 5.5 4.7 0 2.1-1.1 3.6-3 4.3V23h-3v-4.3H12V23H9V9Zm3 2.7v4.5h3.3c1.5 0 2.5-.8 2.5-2.2 0-1.4-1-2.3-2.5-2.3H12Z" fill="#fff" />
            <circle cx="22.5" cy="10.5" r="1.7" fill="#fff" />
          </svg>
          <svg v-else viewBox="0 0 32 32" width="42" height="42">
            <path d="M16 3 29 26H3L16 3Z" fill="#4f7cff" />
            <path d="M16 9 24.5 24h-17L16 9Z" fill="#7aa2ff" />
            <path d="M16 14.5 20.5 23h-9L16 14.5Z" fill="#b7ccff" />
          </svg>
        </span>
        <div class="agent-detail-copy">
          <div class="agent-name-line">
            <h3>{{ selected.label }}</h3>
            <span v-if="state.agents.default === selected.kind" class="agent-badge is-default">默认</span>
            <span v-if="!selected.found" class="agent-badge is-muted">未找到</span>
          </div>
          <span class="agent-subline">
            <template v-if="selected.found">v{{ selected.version }} · {{ selected.path }}</template>
            <template v-else>{{ selected.error || "未检测到可执行文件" }}</template>
          </span>
          <p class="agent-description">{{ descriptions[selected.kind] }}</p>
        </div>
        <button type="button" class="btn ghost small agent-redetect" :disabled="busy === 'detect'" @click="redetect">
          <span v-if="busy === 'detect'" class="mini-spinner" />
          <span v-else class="agent-redetect-icon" v-html="icons.refresh" />
          重新检测
        </button>
      </header>

      <section class="agent-section">
        <div class="agent-section-head">
          <h4>账号与登录</h4>
        </div>
        <div class="agent-card">
          <div class="agent-setting-row">
            <div class="agent-setting-copy">
              <strong>{{ selected.kind === "antigravity" ? "Google 账号" : "CLI 登录" }}</strong>
              <span v-if="selected.kind === 'antigravity'">登录凭据由 Antigravity CLI 自己保存；桌面端不读取、不上传</span>
              <span v-else>由 Pi CLI 自己管理；在对话里使用 <code>/login</code> 登录</span>
            </div>
            <button
              v-if="selected.kind === 'antigravity'"
              type="button"
              class="btn ghost small"
              :disabled="!selected.found || busy === 'login'"
              @click="login"
            >
              <span v-if="busy === 'login'" class="mini-spinner" />打开登录
            </button>
          </div>
        </div>
      </section>

      <section class="agent-section">
        <div class="agent-section-head">
          <div>
            <h4>模型与推理</h4>
            <span>{{ selected.kind === "pi" ? "模型、思考与写入位置" : "以下设置对之后新建的会话生效" }}</span>
          </div>
        </div>
        <div v-if="selected.kind === 'antigravity'" class="agent-card">
          <div class="agent-setting-row">
            <div class="agent-setting-copy">
              <strong>默认模型</strong>
              <span>新会话默认使用的型号；会话里仍可临时切换</span>
            </div>
            <SelectMenu
              v-model="modelDraft"
              size="sm"
              align="right"
              aria-label="Antigravity 默认模型"
              :disabled="!selected.found || Boolean(busy)"
              :options="modelOptions"
              @change="applyModel"
            />
          </div>
          <div class="agent-setting-row">
            <div class="agent-setting-copy">
              <strong>推理强度</strong>
              <span>思考档位越高，回答越深入，耗时也越长</span>
            </div>
            <SelectMenu
              v-model="thinkingDraft"
              size="sm"
              align="right"
              aria-label="Antigravity 默认思考档位"
              :disabled="!selected.found || Boolean(busy)"
              :options="thinkingOptions"
              @change="applyThinking"
            />
          </div>
        </div>
        <PiModelDefaults v-else-if="selected.kind === 'pi'" />
        <div v-else class="agent-card">
          <div class="agent-setting-row">
            <div class="agent-setting-copy">
              <span>这个 Agent 的模型与推理由它自己的配置管理。</span>
            </div>
          </div>
        </div>
      </section>

      <section v-if="selected.kind === 'pi'" class="agent-section">
        <div class="agent-section-head">
          <div>
            <h4>运行与更新</h4>
            <span>Pi 的路径、版本与更新由 Pi CLI 自己处理</span>
          </div>
        </div>
        <PiCliSettings embedded />
      </section>

      <section v-if="selected.kind === 'antigravity'" class="agent-section">
        <div class="agent-section-head">
          <h4>启动方式</h4>
        </div>
        <div class="agent-card">
          <div class="agent-setting-row">
            <div class="agent-setting-copy">
              <strong>命令 / 可执行文件</strong>
              <span class="agent-path">{{ selected.path || "从系统 PATH 自动识别" }}</span>
            </div>
            <button v-if="!editing" type="button" class="btn ghost small" @click="editPath">修改</button>
            <button v-else type="button" class="btn ghost small" @click="cancelEdit">取消</button>
          </div>
          <div v-if="editing" class="agent-command-editor">
            <label class="agent-command-label" :for="`agent-path-${selected.kind}`">可执行文件</label>
            <input
              :id="`agent-path-${selected.kind}`"
              v-model="pathDraft"
              class="search"
              placeholder="粘贴 agy / agy.exe 的完整路径"
              spellcheck="false"
              @keydown.enter.prevent="applyPath"
              @keydown.esc.prevent="cancelEdit"
            />
            <div class="agent-command-actions">
              <button type="button" class="btn ghost small" @click="choosePath">选择文件…</button>
              <button type="button" class="btn ghost small" :disabled="Boolean(busy)" @click="applyPath">
                <span v-if="busy.startsWith('path-')" class="mini-spinner" />检测并使用
              </button>
              <button type="button" class="btn ghost small" :disabled="Boolean(busy)" @click="clearPath">恢复自动</button>
            </div>
            <p class="agent-command-hint">
              留空 = 从系统 PATH 自动识别。修改后只重启空闲的工作区；正在输出的任务结束后生效。
            </p>
          </div>
          <div class="agent-setting-row">
            <div class="agent-setting-copy">
              <strong>版本与更新</strong>
              <span>Antigravity CLI 的更新由 <code>agy update</code> 自己完成</span>
            </div>
          </div>
        </div>
        <p class="settings-note">
          桌面端只负责启动本机 CLI 并转译协议，不注入系统提示词，也不修改它的 MCP、技能和权限配置。
        </p>
      </section>
    </template>
  </div>
</template>
