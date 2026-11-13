import assert from "node:assert/strict";
import {
  EMPTY_MODEL_DEFAULT,
  THINKING_LEVELS,
  applyModelDefault,
  effectiveModelDefault,
  hasModel,
  modelDefaultLabel,
  modelDefaultOf,
  normalizeThinkingLevel,
} from "../../electron/pi-model-defaults.ts";

// 思考等级只认 Pi 认识的那几个；其他值当成「没设置」，不要写进 settings.json
assert.deepEqual([...THINKING_LEVELS], ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
assert.equal(normalizeThinkingLevel("high"), "high");
assert.equal(normalizeThinkingLevel("  XHIGH "), "xhigh");
assert.equal(normalizeThinkingLevel("ultra"), "");
assert.equal(normalizeThinkingLevel(42), "");
assert.equal(normalizeThinkingLevel(undefined), "");

// 读设置：缺字段、类型不对、带空格都要能兜住
assert.deepEqual(modelDefaultOf(undefined), EMPTY_MODEL_DEFAULT);
assert.deepEqual(
  modelDefaultOf({ defaultProvider: " anthropic ", defaultModel: "claude-sonnet-4-5", defaultThinkingLevel: "Low" }),
  { provider: "anthropic", model: "claude-sonnet-4-5", thinkingLevel: "low" },
);
assert.deepEqual(modelDefaultOf({ defaultProvider: 1, defaultModel: {}, defaultThinkingLevel: "nonsense" }), EMPTY_MODEL_DEFAULT);
assert.equal(hasModel({ provider: "a", model: "b", thinkingLevel: "" }), true);
assert.equal(hasModel({ provider: "a", model: "", thinkingLevel: "" }), false, "只有 provider 不算设置好");

// 生效值：项目盖过全局，项目缺的那一项回落到全局
assert.deepEqual(
  effectiveModelDefault(
    { defaultProvider: "openai", defaultModel: "gpt-5", defaultThinkingLevel: "medium" },
    { defaultProvider: "anthropic", defaultModel: "claude-opus" },
  ),
  { provider: "anthropic", model: "claude-opus", thinkingLevel: "medium" },
);
assert.deepEqual(effectiveModelDefault({}, {}), EMPTY_MODEL_DEFAULT);

// 写设置：成对写、成对删；不改入参；其他键原样保留
const base = { theme: "dark", defaultTools: ["read"] };
const withModel = applyModelDefault(base, { provider: "anthropic", model: "claude-opus", thinkingLevel: "high" });
assert.deepEqual(withModel, {
  theme: "dark",
  defaultTools: ["read"],
  defaultProvider: "anthropic",
  defaultModel: "claude-opus",
  defaultThinkingLevel: "high",
});
assert.deepEqual(base, { theme: "dark", defaultTools: ["read"] }, "不能改调用方传进来的对象");

// 只给一半 → 两个键一起删，避免留下配不上的半套设置
const halfCleared = applyModelDefault(withModel, { provider: "anthropic", model: "" });
assert.equal(halfCleared.defaultProvider, undefined);
assert.equal(halfCleared.defaultModel, undefined);
assert.equal(halfCleared.defaultThinkingLevel, "high", "只改模型时不要动思考等级");

// 显式清空思考等级
const cleared = applyModelDefault(withModel, { provider: "", model: "", thinkingLevel: "" });
assert.deepEqual(Object.keys(cleared).sort(), ["defaultTools", "theme"]);
// 非法等级同样按「清除」处理，不写垃圾值
assert.equal(applyModelDefault(withModel, { thinkingLevel: "ultra" }).defaultThinkingLevel, undefined);
// 什么都不传 → 原样返回（深比较即可）
assert.deepEqual(applyModelDefault(withModel, {}), withModel);

// 展示文案
assert.equal(modelDefaultLabel(EMPTY_MODEL_DEFAULT), "跟随 Pi 默认");
assert.equal(modelDefaultLabel({ provider: "anthropic", model: "claude-opus", thinkingLevel: "" }), "claude-opus · anthropic");
assert.equal(
  modelDefaultLabel({ provider: "anthropic", model: "claude-opus", thinkingLevel: "" }, () => "Claude Opus"),
  "Claude Opus · anthropic",
);

console.log("pi-model-defaults OK 思考等级 / 读设置 / 生效值 / 成对写入与清除 / 展示文案");
