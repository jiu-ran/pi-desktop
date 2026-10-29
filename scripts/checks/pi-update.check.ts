import assert from "node:assert/strict";
import { piUpdateSummary, piUpdateToast } from "../../packages/ui/src/shared/pi-update.ts";

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

console.log("pi-update OK scope=all / self / 版本变化 / 缺失版本号");
