import assert from "node:assert/strict";
import { thinkingLabel } from "../../packages/ui/src/shared/util.ts";

for (const [level, label] of Object.entries({
  off: "关闭", minimal: "极简", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高",
})) {
  assert.equal(thinkingLabel(level), label, `${level} 应显示中文标签`);
}
assert.equal(thinkingLabel("future-level"), "future-level", "未知协议等级应保留原值");
assert.equal(thinkingLabel(""), "", "空等级应安全回退");
console.log("thinking-label OK");
