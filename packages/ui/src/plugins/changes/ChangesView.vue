<script setup>
import { computed, reactive } from "vue";
import { useKernel } from "../../kernel/use-kernel.js";
import { icons } from "../../shared/util.js";
import DiffView from "../tools/DiffView.vue";
import { collectChanges, totals } from "./collect.js";

/** 任务变更（参考 Air 的 Task Changes）：按文件列出，展开看 Pi 给出的行级 diff。 */
const kernel = useKernel();
const ws = computed(() => kernel.workbench.active.value);
const files = computed(() => collectChanges(ws.value?.blocks));
const sum = computed(() => totals(files.value));
const open = reactive({});

function reveal(file) {
  const absolute = /^[a-zA-Z]:[\\/]|^\//.test(file.path) ? file.path : `${ws.value.cwd}/${file.path}`;
  kernel.bus.emit("changes:reveal", absolute);
}
</script>

<template>
  <div class="changes">
    <div v-if="files.length" class="changes-summary">
      <span>{{ files.length }} 个文件</span>
      <span class="stat-add">+{{ sum.added }}</span>
      <span class="stat-del">−{{ sum.removed }}</span>
    </div>
    <section v-for="file in files" :key="file.path" class="change-file" :class="{ open: open[file.path] }">
      <div class="change-row" role="button" tabindex="0" :title="file.path" @click="open[file.path] = !open[file.path]">
        <span class="step-caret" :class="{ open: open[file.path] }" v-html="icons.chevronRight" />
        <span class="change-kind" :data-kind="file.kind">{{ file.kind === "新增" ? "A" : "M" }}</span>
        <span class="change-name">{{ file.name }}</span>
        <span class="change-dir">{{ file.dir }}</span>
        <span class="stat-add">+{{ file.added }}</span>
        <span class="stat-del">−{{ file.removed }}</span>
        <button class="icon-btn small" title="在资源管理器中显示" @click.stop="reveal(file)" v-html="icons.reveal" />
      </div>
      <div v-if="open[file.path]" class="change-hunks">
        <DiffView v-for="hunk in file.hunks" :key="hunk.id" :lines="hunk.lines" />
      </div>
    </section>
    <p v-if="!files.length" class="list-empty">这个任务还没有修改文件。Pi 用 edit / write 改动的文件会出现在这里。</p>
  </div>
</template>
