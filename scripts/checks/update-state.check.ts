import assert from "node:assert/strict";
import { createEventBus } from "../../packages/ui/src/kernel/event-bus.ts";
import { createWorkbench } from "../../packages/ui/src/kernel/workbench.ts";

const bus = createEventBus();
const notices: Array<{ level: string; text: string }> = [];
bus.on("notify", (notice: { level: string; text: string }) => { notices.push(notice); });

let rejectDownload: ((error: Error) => void) | null = null;
const host = {
  downloadAppUpdate: () => new Promise<never>((_resolve, reject) => { rejectDownload = reject; }),
  cancelAppUpdate: () => true,
};
const workbench = createWorkbench({ host, bus });

const download = workbench.downloadAppUpdate();
assert.equal(workbench.state.appUpdate.phase, "downloading", "开始下载后进入 downloading");
assert.equal(workbench.cancelAppUpdate(), true, "下载中允许取消");
assert.notEqual(workbench.state.appUpdate.phase, "downloading", "取消后立即复位，按钮可重试");
assert.equal(workbench.cancelAppUpdate(), false, "非下载状态不能重复取消");

rejectDownload?.(new Error("下载更新失败：已取消"));
assert.equal(await download, false, "取消后下载返回失败");
assert.equal(workbench.state.appUpdate.phase, "idle", "取消后回到可重试状态");
assert.deepEqual(notices.at(-1), { level: "info", text: "已取消下载更新" }, "取消不应报成错误 Toast");
workbench.dispose();
console.log("update-state OK");
