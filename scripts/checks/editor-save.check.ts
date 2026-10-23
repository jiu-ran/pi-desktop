import assert from "node:assert/strict";
import { createStage } from "../../packages/ui/src/kernel/stage.ts";
import { saveFileTab } from "../../packages/ui/src/plugins/files/save.ts";
import type { FileStageData } from "../../packages/ui/src/plugins/files/state.ts";

const stage = createStage();
stage.switchWorkspace("/project-a");
const tab = stage.open<FileStageData>({ pluginId: "files", tabId: "same.txt", title: "same.txt", dirty: true,
  data: { cwd: "/project-a", path: "/project-a/same.txt", relative: "same.txt", name: "same.txt", size: 1, content: "old", savedContent: "old", draft: "first", loading: false, error: "", revision: "v1" } });
let resolveWrite: (value: any) => void;
const writes: any[] = [];
const workbench: any = { state: { activeCwd: "/project-b" }, writeFile: (...args: any[]) => { writes.push(args); return new Promise(resolve => { resolveWrite = resolve; }); } };
const first = saveFileTab(workbench, tab);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(writes[0][0], "/project-a/same.txt", "保存绑定原文件绝对路径");
assert.equal(writes[0][3], "/project-a", "切换工作区时不能写入另一个同名文件");
tab.data.draft = "second";
resolveWrite({ content: "first", size: 5, revision: "v2" });
await first;
assert.equal(tab.dirty, true, "保存期间新输入不能被清空");
assert.equal(tab.data.revision, "v2");
const second = saveFileTab(workbench, tab);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(writes[1][1], "second");
assert.equal(writes[1][2], "v2", "第二次保存应使用更新后的磁盘版本");
resolveWrite({ content: "second", size: 6, revision: "v3" });
await second;
assert.equal(tab.dirty, false);

tab.data.draft = "draft-never-lost"; tab.dirty = true;
await assert.rejects(saveFileTab({ writeFile: async () => { throw new Error("冲突"); } } as any, tab));
assert.equal(tab.data.draft, "draft-never-lost");
assert.equal(tab.dirty, true);
assert.equal(tab.data.saving, false);

stage.switchWorkspace("/project-b");
const other = stage.open({ pluginId: "files", tabId: "same.txt", title: "same.txt", data: { content: "b" } });
assert.notEqual(other, tab, "项目隔离的同名标签不应复用");
assert.ok(stage.allTabs.value.includes(tab), "切换项目保留草稿");
stage.switchWorkspace("/project-a");
assert.equal(stage.activeTab.value, tab, "回到项目应恢复原标签");
assert.equal(tab.data.draft, "draft-never-lost");
console.log("editor-save OK");
