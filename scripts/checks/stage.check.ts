import { createStage } from "../../packages/ui/src/kernel/stage.ts";

const stage = createStage();
const first = stage.open({
  pluginId: "files",
  tabId: "README.md",
  title: "README.md",
  data: { content: "old" },
});
if (stage.activeTab.value !== first || stage.tabs.length !== 1) throw new Error("stage should open and activate a tab");

const reopened = stage.open({
  pluginId: "files",
  tabId: "README.md",
  title: "README (updated).md",
  dirty: true,
  data: { content: "new" },
});
if (reopened !== first || stage.tabs.length !== 1 || !stage.activeTab.value?.dirty) {
  throw new Error("stage should update an existing tab instead of duplicating it");
}

stage.open({ pluginId: "git", tabId: "abc", title: "Commit abc", data: null });
stage.open({ pluginId: "files", tabId: "notes.md", title: "notes.md", data: null });
stage.activate("files:README.md");
stage.update("files:README.md", { title: "README", dirty: false });
if (stage.activeTab.value?.title !== "README" || stage.activeTab.value?.dirty) {
  throw new Error("stage should update and activate a tab by key");
}

stage.closeByPlugin("files");
if (stage.tabs.some((tab) => tab.pluginId === "files") || stage.activeTab.value?.pluginId !== "git") {
  throw new Error("stage should close all tabs owned by a plugin");
}
stage.close();
if (Number(stage.tabs.length) !== 0 || stage.activeKey.value !== "") throw new Error("stage should clear the active tab after closing the last tab");

stage.open({ pluginId: "git", tabId: "def", title: "Commit def", data: null });
stage.clear();
if (Number(stage.tabs.length) !== 0 || stage.activeKey.value !== "") throw new Error("stage clear should remove tabs and active key");

console.log("stage OK");
