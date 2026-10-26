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

// 移除项目时要先兜住未保存草稿：二次确认取消后不能删除任何东西。
let hostCalls = 0;
const removeHost = {
  removeProject: async () => { hostCalls += 1; return { recent: [], deleted: 0, failed: 0 }; },
};
const guarded = createWorkbench({ host: removeHost as any, bus, beforeRemoveWorkspace: async () => false });
const cancelled = await guarded.removeProject("/project-a");
assert.equal(cancelled.cancelled, true, "取消后返回 cancelled 标记");
assert.equal(hostCalls, 0, "取消时不能调用宿主移除项目");
guarded.dispose();
workbench.dispose();
console.log("update-state OK");

// 检查失败不能被当成「已是最新」：以前限流（服务器限制请求频率）会显示成最新版本
{
  const { readFile } = await import("node:fs/promises");
  const workbench = await readFile("packages/ui/src/kernel/workbench.ts", "utf8");
  assert.ok(
    /if \(result\.error\) \{[\s\S]*?state\.appUpdate\.error = result\.error/.test(workbench),
    "检查失败必须记录 error，不能记 checkedAt",
  );
  assert.ok(
    /state\.appUpdate\.error = "";[\s\S]*?state\.appUpdate\.checkedAt = Date\.now\(\);/.test(workbench),
    "只有成功才更新 checkedAt",
  );
  // 状态文案拆到了「环境与快捷键」页（settings/EnvironmentSettings.vue）
  const settings = await readFile("packages/ui/src/components/overlays/settings/EnvironmentSettings.vue", "utf8");
  assert.ok(
    /if \(state\.appUpdate\.error\) return \{ tone: "warn", label: "检查失败" \}/.test(settings),
    "状态文案要区分「检查失败」和「已是最新」",
  );
  assert.ok(
    /if \(result\.error \|\| result\.updateAvailable\) return;/.test(settings),
    "失败时不能再弹「已是最新版本」",
  );
  const update = await readFile("electron/network/update.ts", "utf8");
  assert.ok(/AUTO_CHECK_CACHE_MS/.test(update) && /lastSuccess/.test(update), "成功结果要缓存，避免被限流");
  console.log("app update error OK 失败不报最新 / 成功才记时间 / 结果缓存");
}
