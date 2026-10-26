<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import type { McpExposureMode, McpOverview, McpServerItem } from "../../../env.d.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";
import { icons } from "../../../shared/util.ts";
import SelectMenu from "../../shared/SelectMenu.vue";

const { workbench, bus } = useKernel();
const state = workbench.state;

/** MCP 服务的工具暴露策略 */
const exposureOptions: Array<{ value: McpExposureMode; label: string; hint: string }> = [
  { value: "codemode", label: "Codemode（推荐）", hint: "通过脚本按需检索并调用工具，节省上下文" },
  { value: "direct", label: "Direct（直接暴露）", hint: "所有工具直接声明给模型调用" },
  { value: "deferred", label: "Deferred（按需加载）", hint: "由 tool_search 搜索后再加载" },
  { value: "hidden", label: "Hidden（隐藏）", hint: "仅注册服务但不向模型暴露工具" },
];

// ==================== MCP 服务配置逻辑 ====================
const mcpLoading = ref(false);
const mcpProbing = ref(false);
const mcpSaving = ref(false);
const mcpData = ref<McpOverview | null>(null);
const expandedTools = reactive<Record<string, boolean>>({});

const mcpFormOpen = ref(false);
const mcpJsonImportOpen = ref(false);
const mcpJsonScope = ref<"global" | "project">("global");
const mcpJsonText = ref("");

const mcpForm = reactive({
  editingName: "",
  scope: "global" as "global" | "project",
  name: "",
  type: "stdio" as "stdio" | "http",
  command: "npx",
  argsText: "-y @modelcontextprotocol/server-filesystem .",
  envText: "",
  cwd: "",
  url: "",
  headersText: "",
  exposure: "codemode" as McpExposureMode,
  description: "",
  enabled: true,
});

async function loadMcpOverview(): Promise<void> {
  mcpLoading.value = true;
  try {
    mcpData.value = await workbench.mcpOverview();
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    mcpLoading.value = false;
  }
}

async function runMcpProbe(): Promise<void> {
  if (mcpProbing.value) return;
  mcpProbing.value = true;
  try {
    mcpData.value = await workbench.mcpProbe();
    bus.emit("notify", { level: "info", text: "已完成 MCP 服务连接与工具检测" });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    mcpProbing.value = false;
  }
}

function openAddMcpForm(): void {
  mcpJsonImportOpen.value = false;
  mcpForm.editingName = "";
  mcpForm.scope = "global";
  mcpForm.name = "";
  mcpForm.type = "stdio";
  mcpForm.command = "npx";
  mcpForm.argsText = "";
  mcpForm.envText = "";
  mcpForm.cwd = "";
  mcpForm.url = "";
  mcpForm.headersText = "";
  mcpForm.exposure = "codemode";
  mcpForm.description = "";
  mcpForm.enabled = true;
  mcpFormOpen.value = true;
}

function openEditMcpForm(item: McpServerItem): void {
  mcpJsonImportOpen.value = false;
  mcpForm.editingName = item.name;
  mcpForm.scope = item.scope;
  mcpForm.name = item.name;
  mcpForm.type = item.type;
  mcpForm.command = item.command ?? "npx";
  mcpForm.argsText = (item.args ?? []).join(" ");
  mcpForm.envText = Object.entries(item.env ?? {})
    .map(([k, v]) => `${k}=${v === "••••••" ? "" : v}`)
    .join("\n");
  mcpForm.cwd = item.cwd ?? "";
  mcpForm.url = item.url ?? "";
  mcpForm.headersText = Object.entries(item.headers ?? {})
    .map(([k, v]) => `${k}: ${v === "••••••" ? "" : v}`)
    .join("\n");
  mcpForm.exposure = item.exposure ?? "codemode";
  mcpForm.description = item.description ?? "";
  mcpForm.enabled = item.enabled !== false;
  mcpFormOpen.value = true;
}

function parseKeyValueLines(text: string, sep: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = sep === ":" ? line.indexOf(":") : line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function parseArgsText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.includes("\n")) {
    return trimmed
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const matches = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((token) => token.replace(/^["']|["']$/g, ""));
}

async function submitMcpForm(): Promise<void> {
  if (mcpSaving.value) return;
  mcpSaving.value = true;
  try {
    const config: Record<string, any> = {
      exposure: mcpForm.exposure,
      enabled: mcpForm.enabled,
      description: mcpForm.description.trim() || undefined,
    };
    if (mcpForm.type === "http") {
      config.url = mcpForm.url.trim();
      const headers = parseKeyValueLines(mcpForm.headersText, ":");
      if (Object.keys(headers).length) config.headers = headers;
    } else {
      config.command = mcpForm.command.trim();
      const args = parseArgsText(mcpForm.argsText);
      if (args.length) config.args = args;
      const env = parseKeyValueLines(mcpForm.envText, "=");
      if (Object.keys(env).length) config.env = env;
      if (mcpForm.cwd.trim()) config.cwd = mcpForm.cwd.trim();
    }
    mcpData.value = await workbench.mcpSaveServer({
      scope: mcpForm.scope,
      name: mcpForm.name.trim(),
      previousName: mcpForm.editingName || undefined,
      config,
    });
    mcpFormOpen.value = false;
    bus.emit("notify", {
      level: "info",
      text: mcpForm.editingName ? `已更新 MCP 服务「${mcpForm.name}」` : `已添加 MCP 服务「${mcpForm.name}」`,
    });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    mcpSaving.value = false;
  }
}

async function submitMcpJsonImport(): Promise<void> {
  if (!mcpJsonText.value.trim() || mcpSaving.value) return;
  mcpSaving.value = true;
  try {
    mcpData.value = await workbench.mcpImportJson({
      scope: mcpJsonScope.value,
      jsonText: mcpJsonText.value,
    });
    mcpJsonImportOpen.value = false;
    mcpJsonText.value = "";
    bus.emit("notify", { level: "info", text: "已成功导入 MCP 服务配置" });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    mcpSaving.value = false;
  }
}

async function toggleMcpServerEnabled(item: McpServerItem, enabled: boolean): Promise<void> {
  try {
    mcpData.value = await workbench.mcpUpdateServer({
      scope: item.scope,
      name: item.name,
      patch: { enabled },
    });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

async function changeMcpServerExposure(item: McpServerItem, exposure: McpExposureMode): Promise<void> {
  try {
    mcpData.value = await workbench.mcpUpdateServer({
      scope: item.scope,
      name: item.name,
      patch: { exposure },
    });
    bus.emit("notify", { level: "info", text: `已将「${item.name}」暴露策略设为 ${exposure}` });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

async function deleteMcpServer(item: McpServerItem): Promise<void> {
  try {
    mcpData.value = await workbench.mcpRemoveServer({
      scope: item.scope,
      name: item.name,
    });
    bus.emit("notify", { level: "info", text: `已移除 MCP 服务「${item.name}」` });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

async function toggleAutoCodemode(enabled: boolean): Promise<void> {
  try {
    mcpData.value = await workbench.mcpSetAutoCodemode({ scope: "global", enabled });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

function mcpTransportText(item: McpServerItem): string {
  if (item.type === "http") return item.url || "";
  return [item.command, ...(item.args ?? [])].filter(Boolean).join(" ");
}

function mcpStatusMeta(item: McpServerItem): { label: string; tone: "ok" | "warn" | "err" | "muted" } {
  if (!item.enabled) return { label: "已禁用", tone: "muted" };
  if (item.state === "connected") {
    const count = item.tools?.length ?? 0;
    return { label: count ? `已连接 · ${count} 工具` : "已连接", tone: "ok" };
  }
  if (item.state === "error" || item.error) return { label: "连接异常", tone: "err" };
  if (item.state === "needs_auth") return { label: "需 OAuth 授权", tone: "warn" };
  return { label: "已配置", tone: "muted" };
}

function toggleToolsExpand(key: string): void {
  expandedTools[key] = !expandedTools[key];
}

// 打开设置页时加载；切项目后重拉（项目级服务会变）
onMounted(loadMcpOverview);
watch(() => state.activeCwd, loadMcpOverview);
</script>

<template>
  <div class="settings-group">
    <div class="settings-group-head">
      <span class="settings-group-title">
        已配置的 MCP 服务（{{ mcpData?.servers.length ?? 0 }}）
      </span>
      <div class="settings-toolbar-actions">
        <button
          type="button"
          class="btn ghost small"
          :disabled="mcpProbing"
          @click="runMcpProbe"
        >
          <span v-if="mcpProbing" class="mini-spinner" />
          <span v-else class="settings-inline-icon" v-html="icons.refresh" />
          {{ mcpProbing ? "正在检测…" : "检测连接与工具" }}
        </button>
        <button
          type="button"
          class="btn ghost small"
          @click="mcpJsonImportOpen = !mcpJsonImportOpen; mcpFormOpen = false"
        >
          <span class="settings-inline-icon" v-html="icons.json" />
          粘贴 JSON 导入
        </button>
        <button type="button" class="btn small" @click="openAddMcpForm">
          <span class="settings-inline-icon" v-html="icons.plus" />
          新增服务
        </button>
      </div>
    </div>

    <!-- 粘贴 JSON 导入面板 -->
    <div v-if="mcpJsonImportOpen" class="settings-card-form">
      <div class="settings-form-head">
        <strong>从 JSON 导入 MCP 服务配置</strong>
        <SelectMenu
          v-model="mcpJsonScope"
          size="sm"
          align="right"
          aria-label="导入到哪份配置"
          :options="[
            { value: 'global', label: '全局配置' },
            { value: 'project', label: '当前项目 (.pi/mcp.json)', disabled: !state.activeCwd, hint: state.activeCwd ? '' : '未打开项目' },
          ]"
        />
      </div>
      <textarea
        v-model="mcpJsonText"
        rows="5"
        class="settings-textarea mono"
        placeholder='粘贴标准 mcpServers JSON，例如：&#10;{&#10;  "mcpServers": {&#10;    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }&#10;  }&#10;}'
        spellcheck="false"
      />
      <div class="settings-form-foot">
        <button type="button" class="btn ghost small" @click="mcpJsonImportOpen = false">取消</button>
        <button
          type="button"
          class="btn small"
          :disabled="!mcpJsonText.trim() || mcpSaving"
          @click="submitMcpJsonImport"
        >
          解析并写入配置
        </button>
      </div>
    </div>

    <!-- 新增 / 编辑 MCP 服务表单 -->
    <div v-if="mcpFormOpen" class="settings-card-form">
      <div class="settings-form-head">
        <strong>{{ mcpForm.editingName ? `编辑服务「${mcpForm.editingName}」` : "新增 MCP 服务" }}</strong>
        <SelectMenu
          v-model="mcpForm.scope"
          size="sm"
          align="right"
          aria-label="写入哪份配置"
          :options="[
            { value: 'global', label: '全局', hint: '~/.pi/agent/mcp.json' },
            { value: 'project', label: '当前项目', hint: '.pi/mcp.json', disabled: !state.activeCwd },
          ]"
        />
      </div>

      <div class="settings-form-grid">
        <label class="settings-field">
          <span>服务名称 *</span>
          <input
            v-model="mcpForm.name"
            type="text"
            class="settings-input mono"
            placeholder="例如：filesystem、github、postgres"
          />
        </label>

        <div class="settings-field">
          <span>传输类型</span>
          <SelectMenu
            v-model="mcpForm.type"
            width="100%"
            aria-label="传输类型"
            :options="[
              { value: 'stdio', label: 'STDIO 本地进程' },
              { value: 'http', label: 'HTTP 远程服务' },
            ]"
          />
        </div>
      </div>

      <template v-if="mcpForm.type === 'stdio'">
        <div class="settings-form-grid">
          <label class="settings-field">
            <span>启动命令 (command) *</span>
            <input
              v-model="mcpForm.command"
              type="text"
              class="settings-input mono"
              placeholder="npx / node / uvx / python"
            />
          </label>
          <label class="settings-field">
            <span>命令参数 (args，空格分隔)</span>
            <input
              v-model="mcpForm.argsText"
              type="text"
              class="settings-input mono"
              placeholder="-y @modelcontextprotocol/server-filesystem ."
            />
          </label>
        </div>
        <label class="settings-field">
          <span>环境变量 (env，每行一个 KEY=VALUE，可选)</span>
          <textarea
            v-model="mcpForm.envText"
            rows="2"
            class="settings-textarea mono"
            placeholder="API_KEY=your_key_here"
            spellcheck="false"
          />
        </label>
      </template>

      <template v-else>
        <label class="settings-field">
          <span>远程 Streamable HTTP 地址 (url) *</span>
          <input
            v-model="mcpForm.url"
            type="text"
            class="settings-input mono"
            placeholder="https://api.githubcopilot.com/mcp/"
          />
        </label>
        <label class="settings-field">
          <span>请求头 (headers，每行一个 Header: Value，可选)</span>
          <textarea
            v-model="mcpForm.headersText"
            rows="2"
            class="settings-textarea mono"
            placeholder="Authorization: Bearer ${TOKEN}"
            spellcheck="false"
          />
        </label>
      </template>

      <div class="settings-form-grid">
        <label class="settings-field">
          <span>工具暴露模式 (exposure)</span>
          <SelectMenu v-model="mcpForm.exposure" width="100%" aria-label="工具暴露模式" :options="exposureOptions" />
        </label>
        <label class="settings-field">
          <span>服务功能描述（可选，提示给系统提示词）</span>
          <input
            v-model="mcpForm.description"
            type="text"
            class="settings-input"
            placeholder="简述该 MCP 服务提供的能力"
          />
        </label>
      </div>

      <div class="settings-form-foot">
        <button type="button" class="btn ghost small" @click="mcpFormOpen = false">取消</button>
        <button
          type="button"
          class="btn small"
          :disabled="!mcpForm.name.trim() || mcpSaving"
          @click="submitMcpForm"
        >
          保存 MCP 服务
        </button>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="mcpData?.errors?.length" class="settings-alert err">
      <div v-for="(err, idx) in mcpData.errors" :key="idx">{{ err }}</div>
    </div>

    <!-- MCP 服务列表 -->
    <div v-if="mcpLoading && !mcpData" class="settings-empty-card">
      <span class="mini-spinner" /> 正在读取 MCP 配置文件…
    </div>
    <div v-else-if="!mcpData?.servers.length" class="settings-empty-card">
      <span>尚未配置任何 MCP 服务。点击右上角「新增服务」或「粘贴 JSON 导入」即可快速接入。</span>
    </div>
    <div v-else class="settings-card-list">
      <div
        v-for="srv in mcpData.servers"
        :key="`${srv.scope}:${srv.name}`"
        class="settings-item-card"
        :class="{ 'is-disabled': !srv.enabled }"
      >
        <div class="settings-item-top">
          <div class="settings-item-main">
            <span class="settings-plugin-icon" v-html="srv.type === 'http' ? icons.globe : icons.mcp" />
            <div class="settings-row-info">
              <strong>
                {{ srv.name }}
                <span class="settings-plugin-tag">{{ srv.scope === "project" ? "当前项目" : "全局" }}</span>
                <span class="settings-plugin-tag mono">{{ srv.type.toUpperCase() }}</span>
                <span class="settings-status-pill" :class="mcpStatusMeta(srv).tone">
                  {{ mcpStatusMeta(srv).label }}
                </span>
              </strong>
              <span class="settings-mono-line" :title="mcpTransportText(srv)">
                {{ mcpTransportText(srv) }}
              </span>
              <span v-if="srv.description">{{ srv.description }}</span>
              <span v-if="srv.error" class="settings-err-text">{{ srv.error }}</span>
            </div>
          </div>

          <div class="settings-item-controls">
            <SelectMenu
              :model-value="srv.exposure"
              size="sm"
              align="right"
              title="工具暴露策略"
              aria-label="工具暴露策略"
              :options="[
                { value: 'codemode', label: 'Codemode' },
                { value: 'direct', label: 'Direct' },
                { value: 'deferred', label: 'Deferred' },
                { value: 'hidden', label: 'Hidden' },
              ]"
              @change="changeMcpServerExposure(srv, $event as McpExposureMode)"
            />
            <button
              type="button"
              class="btn ghost small"
              title="编辑此服务"
              @click="openEditMcpForm(srv)"
            >
              编辑
            </button>
            <button
              type="button"
              class="icon-btn small"
              title="删除此服务"
              @click="deleteMcpServer(srv)"
              v-html="icons.trash"
            />
            <input
              type="checkbox"
              class="settings-switch"
              :checked="srv.enabled"
              title="启用或禁用此 MCP 服务"
              @change="toggleMcpServerEnabled(srv, ($event.target as HTMLInputElement).checked)"
            />
          </div>
        </div>

        <!-- 工具列表折叠区 -->
        <div v-if="srv.tools?.length" class="settings-item-sub">
          <button
            type="button"
            class="settings-link-btn"
            @click="toggleToolsExpand(`${srv.scope}:${srv.name}`)"
          >
            <span
              class="settings-inline-icon"
              v-html="expandedTools[`${srv.scope}:${srv.name}`] ? icons.chevronDown : icons.chevronRight"
            />
            {{ expandedTools[`${srv.scope}:${srv.name}`] ? "收起工具列表" : `查看已挂载的 ${srv.tools.length} 个工具` }}
          </button>
          <div v-if="expandedTools[`${srv.scope}:${srv.name}`]" class="settings-tool-chips">
            <span v-for="toolName in srv.tools" :key="toolName" class="settings-tool-chip">
              {{ toolName }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="settings-group">
    <div class="settings-group-title">Codemode 与配置文件路径</div>

    <label class="settings-row clickable">
      <div class="settings-row-info">
        <strong>自动启用 Codemode（autoEnableCodemode）</strong>
        <span>当有暴露模式为 Codemode 的 MCP 服务连接时，自动激活 codemode 工具以按需检索和调用</span>
      </div>
      <input
        type="checkbox"
        class="settings-switch"
        :checked="mcpData?.autoEnableCodemode ?? true"
        @change="toggleAutoCodemode(($event.target as HTMLInputElement).checked)"
      />
    </label>

    <div v-if="mcpData?.globalConfigPath" class="settings-row">
      <div class="settings-row-info">
        <strong>全局 MCP 配置文件</strong>
        <span class="settings-mono-line">{{ mcpData.globalConfigPath }}</span>
      </div>
      <button
        type="button"
        class="btn ghost small"
        @click="workbench.reveal(mcpData.globalConfigPath)"
      >
        在文件夹中显示
      </button>
    </div>
  </div>
</template>
