import assert from "node:assert/strict";
import { piUpdateFailure, piUpdateFailureToast, piUpdateSummary, piUpdateToast } from "../../packages/ui/src/shared/pi-update.ts";

/**
 * 更新结果的措辞。
 *
 * 这两种情况必须能分清：
 * - 本体是最新、但 `update --all` 也扫了扩展 → 不能说「无需更新」（用户会以为没跑）；
 * - 只有 `pi update`（只看本体）→ 说「无需更新」是对的。
 */

const unchangedAll = { from: "1.4.0", to: "1.4.0", scope: "all" as const };
const unchangedSelf = { from: "1.4.0", to: "1.4.0", scope: "self" as const };
const changed = { from: "1.2.0", to: "1.4.0", scope: "all" as const };

assert.equal(piUpdateSummary(unchangedAll), "Pi 本体已是最新（1.4.0）；扩展包已按 update --all 检查");
assert.equal(piUpdateSummary(unchangedSelf), "已确认最新（1.4.0）");
assert.equal(piUpdateSummary(changed), "已从 1.2.0 更新到 1.4.0");

assert.equal(piUpdateToast(unchangedAll), "Pi 本体已是最新（1.4.0）；扩展包已按 update --all 检查");
assert.equal(piUpdateToast(unchangedSelf), "Pi 已是最新（1.4.0），无需更新");
assert.equal(piUpdateToast(changed), "Pi 已从 1.2.0 更新到 1.4.0");

// 「无需更新」只能出现在「只看本体且版本没变」这一种情况里
assert.ok(!piUpdateToast(unchangedAll).includes("无需更新"), "scope=all 时不能说「无需更新」");
assert.ok(!piUpdateSummary(unchangedAll).includes("无需更新"));

// 版本号缺失时不能出现 "更新到 undefined"
assert.equal(piUpdateSummary({ from: "", to: "" }, "1.4.0"), "已确认最新（1.4.0）");
assert.equal(piUpdateSummary({ from: "1.2.0", to: "" }, "1.4.0"), "已从 1.2.0 更新到 1.4.0");

// 失败提示：pi 的英文原文不能出现在提示条里，要说清「发生了什么 + 怎么办」
const timeoutLog =
  "Extensions are skipped. Run pi update --extensions to update extensions.\n" +
  "Error: Could not determine latest pi version: The operation was aborted due to timeout";
assert.equal(piUpdateFailure(timeoutLog).kind, "network");
assert.equal(piUpdateFailure(timeoutLog).extensionsSkipped, true, "要认出扩展包被跳过");
assert.equal(
  piUpdateFailureToast(timeoutLog),
  "无法从网络获取 Pi 最新版本（检查网络或代理后重试；扩展包这次没有更新）",
);
assert.ok(!/Could not determine|Extensions are skipped/.test(piUpdateFailureToast(timeoutLog)), "提示条不能出现原始英文");
assert.equal(
  piUpdateFailure("npm ERR! code EACCES\nnpm ERR! EACCES: permission denied, open '/usr/lib/node_modules'").kind,
  "permission",
);
assert.equal(piUpdateFailureToast("line 1\nError: boom"), "boom", "认不出原因时给最后一行，并去掉 Error: 前缀");
assert.equal(piUpdateFailureToast(""), "未知错误", "空输出也要有话说");
assert.ok(!piUpdateFailureToast(timeoutLog).includes("\n"), "提示条不能换行");
assert.ok(piUpdateFailure("x".repeat(400)).title.length <= 120, "认不出的长行要截断");
assert.equal(
  piUpdateSummary({ from: "1.4.0", to: "1.4.0", scope: "all", ok: false }, "1.4.0"),
  "上次更新失败（仍是 1.4.0）",
  "失败记录要在设置页说清「还是这个版本」",
);

console.log("pi-update OK scope=all / self / 版本变化 / 缺失版本号");
