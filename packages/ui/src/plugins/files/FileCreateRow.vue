<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { entryNamePlaceholder, validateEntryName } from "../../shared/entry-name.ts";
import FileIcon from "../../components/shared/FileIcon.vue";
import { cancelCreate } from "./inline-create.ts";
import { openFileInStage } from "./state.ts";

/**
 * 文件树里的就地新建行（仿 VS Code）。
 *
 * 输入框直接长在目标目录里，不进模态框：Enter 创建、Esc 取消、失焦提交（有名字时）。
 * 名字不合法就停在原地并给一句原因，不打断输入。
 */
const props = defineProps<{
  /** 父目录相对路径，根目录为空串 */
  parent: string;
  kind: "file" | "folder";
  /** 树里的层级，用来对齐缩进 */
  level: number;
}>();

const { workbench, stage, bus } = useKernel();
const value = ref("");
const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const error = ref("");
/**
 * 这一行是否已经结束（提交成功或按了 Esc）。
 * 必须显式记：行被移除时输入框会触发 blur，而 blur 是「提交」——不做标记的话
 * 按 Esc 取消反而会把刚输入的名字建出来。
 */
let finished = false;

const placeholder = computed(() => entryNamePlaceholder(props.kind));
const check = computed(() => validateEntryName(value.value));

onMounted(() => {
  void nextTick(() => {
    input.value?.focus();
  });
});

async function commit(): Promise<void> {
  if (finished || busy.value) return;
  const name = value.value.trim();
  if (!name) {
    finished = true;
    cancelCreate();
    return;
  }
  const verdict = validateEntryName(name);
  if (!verdict.ok) {
    error.value = verdict.reason;
    input.value?.focus();
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const created = await workbench.createEntry(props.parent, name, props.kind);
    finished = true;
    bus.emit("files:changed", { directory: props.parent });
    cancelCreate();
    if (props.kind === "file") await openFileInStage(workbench, stage, bus, created.relative);
  } catch (reason: any) {
    error.value = reason?.message ?? String(reason);
    input.value?.focus();
  } finally {
    busy.value = false;
  }
}

function onBlur(): void {
  // 点别处：有名字就提交，空着就当取消（VS Code 也是这个行为）；
  // 已经取消 / 已经建完的那次 blur 不算数
  if (finished) return;
  void commit();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    event.preventDefault();
    void commit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    finished = true;
    cancelCreate();
  }
}

</script>

<template>
  <div class="file-create">
    <div class="file-create-row" :style="{ paddingLeft: `${8 + level * 14}px` }">
      <span class="file-tree-caret" />
      <FileIcon :name="kind === 'folder' ? 'folder' : ''" :is-folder="kind === 'folder'" />
      <input
        ref="input"
        v-model="value"
        class="file-create-input"
        :placeholder="placeholder"
        spellcheck="false"
        autocomplete="off"
        :disabled="busy"
        :aria-label="kind === 'folder' ? '新建文件夹名称' : '新建文件名称'"
        @keydown="onKeydown"
        @blur="onBlur"
      />
      <span v-if="busy" class="mini-spinner" />
    </div>
    <div v-if="error" class="file-create-error" :style="{ paddingLeft: `${32 + level * 14}px` }">
      {{ error }}
    </div>
    <div v-else-if="!check.ok" class="file-create-error" :style="{ paddingLeft: `${32 + level * 14}px` }">
      {{ check.reason }}
    </div>
  </div>
</template>
