import assert from "node:assert/strict";
import { activeOutlineIndex } from "../../packages/ui/src/shared/outline.ts";

// 右侧大纲高亮：滚到底必须是最后一轮，内容短或活动组折叠时也一样。
const tops = [0, 400, 900];
assert.equal(activeOutlineIndex(tops, 0, 600, 1400), 0, "顶部时高亮第一轮");
assert.equal(activeOutlineIndex(tops, 350, 600, 1400), 0, "第一轮还没越过顶边时仍是第一轮");
assert.equal(activeOutlineIndex(tops, 500, 600, 1400), 1, "越过第二轮顶部后高亮第二轮");
// 滚到底：即使最后一条用户消息的顶部没越过视口顶边，也要点亮它。
assert.equal(activeOutlineIndex(tops, 800, 600, 1400), 2, "到底时应高亮最后一轮");
assert.equal(activeOutlineIndex(tops, 796, 600, 1400), 2, "距底 4px 内算到底");
// 内容不足一屏（scrollHeight == clientHeight）同样按最后一轮处理。
assert.equal(activeOutlineIndex([0, 120], 0, 600, 600), 1, "短会话到底时高亮最后一轮");
assert.equal(activeOutlineIndex([], 0, 600, 1400), -1, "没有用户消息时不返回索引");

console.log("outline OK 顶部 / 中间 / 到底 / 短会话");
