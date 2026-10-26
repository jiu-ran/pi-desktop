<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { PiSkillsOverview } from "../../../env.d.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";
import { icons } from "../../../shared/util.ts";
import SelectMenu from "../../shared/SelectMenu.vue";

const { workbench, bus } = useKernel();
const state = workbench.state;

const skillScopeLabels: Record<string, string> = { user: "全局", project: "当前项目", temporary: "临时" };
const skillOriginLabels: Record<string, string> = { package: "软件包", "top-level": "本地目录" };

const skillsLoading = ref(false);
const skillsData = ref<PiSkillsOverview | null>(null);
const skillsFilter = ref<"all" | "user" | "project" | "temporary">("all");

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
onMounted(loadSkillsOverview);
watch(() => state.activeCwd, loadSkillsOverview);
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
