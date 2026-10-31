<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { PiSkillsOverview } from "../../../env.d.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";
import { icons } from "../../../shared/util.ts";
import SelectMenu from "../../shared/SelectMenu.vue";

const { workbench, bus } = useKernel();
const state = workbench.state;

const skillScopeLabels: Record<string, string> = { user: "全局", project: "当前项目" };
const skillOriginLabels: Record<string, string> = { package: "软件包", "top-level": "本地目录" };

const skillsLoading = ref(false);
const skillsData = ref<PiSkillsOverview | null>(null);
const skillsFilter = ref<"all" | "user" | "project">("all");

/**
 * 项目信任状态。
 *
 * 桌面端走 RPC，Pi 没法弹窗问「信不信任这个目录」，默认就按不信任处理 ——
 * 于是项目级技能 / 扩展 / MCP 全都不加载，而下面这个列表是按文件扫出来的，
 * 看起来一切正常。不把这件事显式说出来，用户会以为是自己配置错了。
 */
const trust = ref<{ needsTrust: boolean; effective: boolean; decision: boolean | null; recordedAt: string } | null>(null);
const trustSaving = ref(false);

async function loadTrust(): Promise<void> {
  const cwd = state.activeCwd;
  if (!cwd) return;
  try {
    trust.value = await (globalThis as any).piDesktop.projectTrust(cwd);
  } catch {
    trust.value = null;
  }
}

async function trustProject(): Promise<void> {
  const cwd = state.activeCwd;
  if (!cwd) return;
  trustSaving.value = true;
  try {
    await (globalThis as any).piDesktop.setProjectTrust(cwd, "trust");
    await workbench.restart();
    await Promise.all([loadTrust(), loadSkillsOverview()]);
    bus.emit("notify", { level: "info", text: "已信任此项目，项目级资源已重新加载" });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    trustSaving.value = false;
  }
}

const visibleSkills = computed(() => {
  const list = skillsData.value?.skills ?? [];
  return skillsFilter.value === "all" ? list : list.filter((skill) => skill.scope === skillsFilter.value);
});

async function loadSkillsOverview(): Promise<void> {
  skillsLoading.value = true;
  try {
    skillsData.value = await workbench.skillsOverview();
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    skillsLoading.value = false;
  }
}

// 打开设置页时加载；切项目后重拉（项目级技能会变）
onMounted(() => {
  void loadTrust();
  void loadSkillsOverview();
});
watch(() => state.activeCwd, () => {
  void loadTrust();
  void loadSkillsOverview();
});
</script>

<template>
  <div class="settings-group">
    <div class="settings-group-head">
      <span class="settings-group-title">已加载的技能（{{ visibleSkills.length }}）</span>
      <div class="settings-toolbar-actions">
        <SelectMenu
          v-model="skillsFilter"
          size="sm"
          align="right"
          aria-label="技能作用域"
          :options="[
            { value: 'all', label: '全部' },
            { value: 'user', label: '全局' },
            { value: 'project', label: '当前项目' },
          ]"
        />
        <button type="button" class="btn ghost small" :disabled="skillsLoading" @click="loadSkillsOverview">
          <span class="settings-inline-icon" v-html="icons.refresh" />
          刷新
        </button>
      </div>
    </div>

    <div v-if="trust?.needsTrust && !trust.effective" class="settings-alert err">
      <div>
        这个项目有需要信任的资源（.pi 配置 / 扩展 / 技能 / MCP），但当前未被信任：桌面端通过 RPC 启动 Pi，
        拿不到「是否信任」的确认，这些项目级内容现在不会加载。
      </div>
      <div class="settings-toolbar-actions">
        <button type="button" class="btn small" :disabled="trustSaving" @click="trustProject">
          {{ trustSaving ? "处理中…" : "信任此项目" }}
        </button>
      </div>
    </div>

    <div v-if="skillsData?.diagnostics?.length" class="settings-alert err">
      <div v-for="(err, idx) in skillsData.diagnostics" :key="idx">{{ err }}</div>
    </div>

    <div v-if="skillsLoading && !skillsData" class="settings-empty-card">
      <span class="mini-spinner" /> 正在扫描技能目录…
    </div>
    <div v-else-if="!visibleSkills.length" class="settings-empty-card">
      <span>未发现技能。将 SKILL.md 放入全局或项目的 skills 目录即可被 Pi 加载，并可通过 /skill:名称 调用。</span>
    </div>
    <div v-else class="settings-card-list">
      <div v-for="skill in visibleSkills" :key="skill.filePath" class="settings-item-card">
        <div class="settings-item-top">
          <div class="settings-item-main">
            <span class="settings-plugin-icon" v-html="icons.brain" />
            <div class="settings-row-info">
              <strong>
                {{ skill.name }}
                <span class="settings-plugin-tag">{{ skillScopeLabels[skill.scope] || skill.scope }}</span>
                <span class="settings-plugin-tag">{{ skillOriginLabels[skill.origin] || skill.origin }}</span>
                <span class="settings-status-pill" :class="skill.disableModelInvocation ? 'muted' : 'ok'">
                  {{ skill.disableModelInvocation ? "仅手动调用" : "可自动调用" }}
                </span>
              </strong>
              <span v-if="skill.description">{{ skill.description }}</span>
              <span class="settings-mono-line" :title="skill.filePath">{{ skill.filePath }}</span>
            </div>
          </div>
          <div class="settings-item-controls">
            <button
              type="button"
              class="btn ghost small"
              title="在文件夹中显示技能文件"
              @click="workbench.reveal(skill.filePath)"
            >
              定位文件
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div v-if="skillsData" class="settings-group">
    <div class="settings-group-title">技能目录</div>
    <div v-for="dir in skillsData.directories" :key="dir.path" class="settings-row">
      <div class="settings-row-info">
        <strong>{{ dir.label }}</strong>
        <span class="settings-mono-line">{{ dir.path }}</span>
      </div>
      <button type="button" class="btn ghost small" @click="workbench.reveal(dir.path)">
        在文件夹中显示
      </button>
    </div>
  </div>
</template>
