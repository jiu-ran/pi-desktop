<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { GitActionName, GitActionPayload, GitBranch, GitOverview } from "../../env.d.ts";
import { useKernel } from "../../kernel/use-kernel.ts";
import { askPrompt } from "../../components/sidebar/ui.ts";
import { icons } from "../../shared/util.ts";

const props = defineProps<{ overview: GitOverview | null; busy: boolean }>();
const emit = defineEmits<{ action: [name: GitActionName, payload: GitActionPayload] }>();
const { workbench, bus } = useKernel();
const branches = ref<GitBranch[]>([]);
const query = ref("");
const loading = ref(false);
const error = ref("");
let request = 0;
const cwd = computed(() => workbench.state.activeCwd);
const writable = computed(() => props.overview?.canWrite && props.overview?.hasCommits && !props.busy);
const groups = computed(() => [
  { label: "本地分支", remote: false }, { label: "远程分支", remote: true },
].map(group => ({ ...group, items: branches.value.filter(branch => branch.remote === group.remote
  && `${branch.name} ${branch.subject} ${branch.upstream}`.toLowerCase().includes(query.value.trim().toLowerCase())) })));

async function load(): Promise<void> {
  const current = ++request;
  loading.value = true;
  error.value = "";
  try {
    const result = await workbench.gitBranches();
    if (current === request) branches.value = result;
  } catch (err: any) {
    if (current === request) error.value = err?.message || String(err);
  } finally { if (current === request) loading.value = false; }
}
watch([cwd, () => props.overview], () => { branches.value = []; void load(); }, { immediate: true });
onBeforeUnmount(() => { request++; });

async function create(): Promise<void> {
  if (!writable.value) return;
  const origin = cwd.value;
  const name = await askPrompt({ title: "新建并切换分支", message: "从当前 HEAD 创建分支。当前磁盘上的改动会保留；未保存的编辑器草稿必须先保存或关闭。", label: "分支名称", placeholder: "例如 feature/login", confirmLabel: "新建并切换" });
  if (!name || origin !== cwd.value) return;
  emit("action", "createBranch", { branch: name });
}

async function checkout(branch: GitBranch): Promise<void> {
  if (!writable.value || branch.current || branch.worktreePath) return;
  if (props.overview?.status.length) {
    bus.emit("notify", { level: "warning", text: "切换分支前请先提交或自行 stash 当前改动（包括未跟踪文件），不会自动丢弃改动。" });
    return;
  }
  const origin = cwd.value;
  let localName: string | undefined;
  if (branch.remote) {
    localName = await askPrompt({ title: "从远程分支创建本地跟踪分支", message: `将跟踪 ${branch.name} 并切换到新分支；不会修改已有同名本地分支。`, label: "本地分支名称", value: branch.name.slice(branch.name.indexOf("/") + 1), confirmLabel: "创建并切换" }) || undefined;
    if (!localName || origin !== cwd.value) return;
  }
  emit("action", "switchBranch", { branch: branch.ref, localName });
}
</script>

<template>
  <section class="git-branches">
    <div class="git-view-head"><strong>分支管理</strong><span class="git-sc-spacer" />
      <button class="icon-btn small" type="button" title="刷新分支" :disabled="loading || busy" @click="load" v-html="icons.refresh" />
      <button class="btn small" type="button" :disabled="!writable" @click="create"><span v-html="icons.plus" />新建分支</button>
    </div>
    <input v-model="query" class="git-branch-search" aria-label="搜索分支" placeholder="搜索分支名称或提交…" />
    <p class="git-view-hint">点击本地分支切换；远程分支将新建本地跟踪分支。切换不会自动丢弃或 stash 改动。</p>
    <p v-if="!overview?.hasCommits" class="git-view-hint">提交第一个版本后才能新建和切换分支。</p>
    <p v-else-if="!overview.canWrite" class="git-view-hint">当前项目不是仓库根目录，仅允许浏览分支。</p>
    <p v-if="error" class="git-error">{{ error }}</p>
    <div class="git-branch-list" :aria-busy="loading">
      <section v-for="group in groups" :key="group.label" class="git-branch-group">
        <h4>{{ group.label }} <span>{{ group.items.length }}</span></h4>
        <p v-if="!group.items.length" class="git-view-hint">{{ loading ? '读取中…' : query ? '没有匹配的分支' : group.remote ? '没有远程分支，可先获取更新' : '暂无本地分支' }}</p>
        <button v-for="branch in group.items" :key="branch.ref" class="git-branch-row" type="button" :class="{ current: branch.current }"
          :disabled="!writable || branch.current || Boolean(branch.worktreePath)" :aria-label="`${branch.current ? '当前分支' : '切换分支'} ${branch.name}`"
          :title="!branch.current && branch.worktreePath ? `已在工作区使用：${branch.worktreePath}` : `${branch.name}\n${branch.subject}\n${branch.upstream || '无上游分支'}`" @click="checkout(branch)">
          <span class="git-branch-icon" v-html="branch.current ? icons.check : icons.branch" />
          <span class="git-branch-main"><strong>{{ branch.name }}</strong><small>{{ branch.hash }} · {{ branch.subject }}</small><small v-if="branch.upstream">{{ branch.upstream }} {{ branch.tracking }}</small></span>
          <span class="git-branch-tag">{{ branch.current ? '当前' : branch.worktreePath ? '已占用' : branch.remote ? '跟踪…' : '切换' }}</span>
        </button>
      </section>
    </div>
  </section>
</template>
