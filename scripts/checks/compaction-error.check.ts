import assert from "node:assert/strict";
import {
  compactionFailureText,
  explainCompactionFailure,
} from "../../packages/ui/src/shared/compaction-error.ts";

/**
 * 压缩失败提示的翻译。
 *
 * 上游报的是 `Summarization failed: generation hit the token cap …` 这种英文，
 * 用户看不懂也不知道下一步做什么；这里断言几条常见失败都能翻成「原因 + 建议」，
 * 并且**匹配不上时保留原文**（不瞎猜）。
 */

// ---- 1. 输出上限截断（就是截图里那条） ----
const capped = explainCompactionFailure(
  "Compaction failed: Summarization failed: generation hit the token cap and the summary is incomplete",
);
assert.ok(capped, "输出上限截断要被识别");
assert.match(capped!.reason, /输出上限/, `原因要指出是输出上限：${capped!.reason}`);
assert.match(capped!.hint, /思考等级/, `建议要提到思考等级：${capped!.hint}`);
assert.ok(capped!.hint.includes("/compact"), `要点明只有手动 /compact 会重试：${capped!.hint}`);
assert.match(capped!.hint, /自动压缩不会/, `不能对自动压缩谎称会重试：${capped!.hint}`);

// ---- 2. 自动压缩（上游会加前缀）也要能翻成中文 ----
for (const prefix of ["Auto-compaction failed: ", "Context overflow recovery failed: "]) {
  const auto = explainCompactionFailure(`${prefix}Compaction failed: Summarization failed: generation hit the token cap and the summary is incomplete`);
  assert.ok(auto, `自动压缩失败要能识别：${prefix}`);
  assert.match(auto!.reason, /输出上限/, `自动压缩里也是输出上限这条原因：${auto!.reason}`);
  const generic = explainCompactionFailure(`${prefix}model returned 500`);
  assert.ok(generic, `认不出的自动压缩错误也要给「自动压缩」这个方向：${prefix}`);
  assert.match(generic!.reason, /自动压缩/, `${prefix} → ${generic!.reason}`);
}

// ---- 2b. 摘要调用失败 / 上下文过大 / 取消 ----
assert.match(explainCompactionFailure("Summarization failed: 401 Unauthorized")?.reason ?? "", /模型调用失败/);
assert.match(explainCompactionFailure("context window exceeded")?.reason ?? "", /超出模型/);
assert.match(explainCompactionFailure("Compaction aborted by user")?.reason ?? "", /取消/);

// ---- 3. 认不出来的错误保留原文，别瞎解释 ----
assert.equal(explainCompactionFailure("some brand new upstream error"), null, "未知错误不解释");
assert.equal(explainCompactionFailure(""), null);
assert.equal(explainCompactionFailure(null), null);

// ---- 4. 给界面用的整句 ----
const text = compactionFailureText(
  "Compaction failed: Summarization failed: generation hit the token cap and the summary is incomplete",
);
assert.ok(text.startsWith("上下文压缩失败："), `要以中文前缀开头：${text}`);
assert.match(text, /输出上限/);
assert.match(text, /思考等级|换成/, `要带上可操作的建议：${text}`);
assert.equal(text.includes("Summarization failed"), false, "已知错误不该把英文原文直接甩给用户");

const unknown = compactionFailureText("weird failure");
assert.equal(unknown, "上下文压缩失败：weird failure", "未知错误保留原文便于排查");
assert.equal(compactionFailureText(""), "上下文压缩失败", "没有错误信息时只报失败");
assert.equal(compactionFailureText(undefined), "上下文压缩失败");

console.log("[compaction-error] ok");
