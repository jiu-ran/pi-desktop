import assert from "node:assert/strict";
import {
  THINKING_LEVELS,
  clampThinkingLevel,
  supportedThinkingLevels,
} from "../../packages/ui/src/shared/thinking-levels.ts";

assert.deepEqual([...THINKING_LEVELS], ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

// 拿不到能力信息时列全部（宁可多显示，真正不支持的由 Pi 钳制）
assert.deepEqual(supportedThinkingLevels(undefined), [...THINKING_LEVELS]);
assert.deepEqual(supportedThinkingLevels({}), [...THINKING_LEVELS]);

// 不支持推理的模型只有「关闭」
assert.deepEqual(supportedThinkingLevels({ reasoning: false }), ["off"]);

// 支持推理、没有 thinkingLevelMap：除 xhigh / max 之外都给
assert.deepEqual(supportedThinkingLevels({ reasoning: true }), ["off", "minimal", "low", "medium", "high"]);

// 映射成 null 的档位不支持
assert.deepEqual(
  supportedThinkingLevels({ reasoning: true, thinkingLevelMap: { minimal: null, low: null } }),
  ["off", "medium", "high"],
);

// xhigh / max 只有显式映射过才出现
assert.deepEqual(
  supportedThinkingLevels({ reasoning: true, thinkingLevelMap: { max: "max_thinking", xhigh: null } }),
  ["off", "minimal", "low", "medium", "high", "max"],
);

// 真实形态：只支持 low / high / max（用户机器上的 deepseek 模型就是这样）
assert.deepEqual(
  supportedThinkingLevels({ reasoning: true, thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" } }),
  ["off", "low", "high", "max"],
);

// 收敛：不支持的档位往更重的方向找，找不到再往更轻的找
assert.equal(clampThinkingLevel("high", ["off", "low"]), "low", "没有更重的档位就往轻的找最近的");
assert.equal(clampThinkingLevel("low", ["off", "low", "high"]), "low");
assert.equal(clampThinkingLevel("minimal", ["off", "low", "high"]), "low", "往更重的方向找最近的");
assert.equal(clampThinkingLevel("xhigh", ["off", "high"]), "high");
assert.equal(clampThinkingLevel("nonsense", ["off", "high"]), "off");
assert.equal(clampThinkingLevel("high", []), "off", "空列表兜底成 off");

console.log("thinking-levels OK 能力判断 / null 过滤 / xhigh-max 门槛 / 收敛");
