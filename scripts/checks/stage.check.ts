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

// 后台项目分支切换完成时，只清除那个项目的已保存标签，不影响当前项目。
stage.switchWorkspace("branch-old");
stage.open({ pluginId: "files", tabId: "old.txt", title: "old", data: { cwd: "branch-old" } });
stage.open({ pluginId: "files", tabId: "draft.txt", title: "draft", dirty: true, data: { cwd: "branch-old" } });
stage.switchWorkspace("branch-active");
stage.open({ pluginId: "files", tabId: "active.txt", title: "active", data: {} });
stage.closeWorkspaceTabs("branch-old", tab => !tab.dirty);
if (stage.activeTab.value?.tabId !== "active.txt") throw new Error("清理后台项目不应影响当前标签");
stage.switchWorkspace("branch-old");
if (Number(stage.tabs.length) !== 1 || !stage.tabs[0]?.dirty) throw new Error("后台项目应清除旧基线并保留草稿");
stage.clear();
stage.removeWorkspace("branch-active");
stage.removeWorkspace("branch-old");

// 多项目隔离：切走再切回保留页签与脏标记；移除项目必须一并丢弃存档，
// 否则同一路径重新加入项目会复活已删除项目的草稿。
stage.switchWorkspace("C:/a");
stage.open({ pluginId: "files", tabId: "a.txt", title: "a.txt", dirty: true, data: { cwd: "C:/a" } });
stage.switchWorkspace("C:/b");
if (Number(stage.tabs.length) !== 0) throw new Error("switchWorkspace should swap in the target project tabs");
stage.open({ pluginId: "files", tabId: "b.txt", title: "b.txt", data: { cwd: "C:/b" } });
stage.switchWorkspace("C:/a");
if (Number(stage.tabs.length) !== 1 || stage.tabs[0].title !== "a.txt" || !stage.tabs[0].dirty) {
  throw new Error("switchWorkspace should restore the previous project tabs");
}
if (stage.allTabs.value.length !== 2) throw new Error("allTabs should include every project's tabs");
stage.switchWorkspace("C:/b");
stage.removeWorkspace("C:/a");
if (stage.allTabs.value.some((tab) => tab.title === "a.txt")) throw new Error("removeWorkspace should drop the project tab archive");
stage.switchWorkspace("C:/a");
if (Number(stage.tabs.length) !== 0) throw new Error("removed project must not restore its old tabs");
stage.switchWorkspace("C:/b");
stage.removeWorkspace("C:/b");
if (Number(stage.tabs.length) !== 0 || stage.activeKey.value !== "") throw new Error("removing the active project should clear the stage");

// Windows 盘符大小写与斜杠分隔符差异不应导致舞台页签存档或分支切换清理失效
stage.switchWorkspace("C:\\Repo\\App\\");
stage.open({ pluginId: "files", tabId: "index.ts", title: "index.ts", dirty: false, data: { cwd: "C:\\Repo\\App" } });
stage.switchWorkspace("c:/repo/app");
if (Number(stage.tabs.length) !== 1) throw new Error("same project path with different casing/slashes should not swap out tabs");
stage.closeWorkspaceTabs("C:/REPO/APP/", (tab) => !tab.dirty);
if (Number(stage.tabs.length) !== 0) throw new Error("closeWorkspaceTabs should match workspace regardless of path casing/slashes");
stage.removeWorkspace("c:\\repo\\app");

console.log("stage OK");
