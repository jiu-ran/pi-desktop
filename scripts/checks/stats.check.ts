import { contextBar, formatCost, usageParts } from "../../packages/ui/src/shared/session-stats.ts";
import { LONG_USER_TEXT, shouldCollapseUserText } from "../../packages/ui/src/shared/chat-text.ts";

if (formatCost(0) !== "$0.000") throw new Error("零费用格式错误");
if (formatCost(0.0004) !== "<$0.001") throw new Error("极小费用应提示 <$0.001");
if (formatCost(0.0123) !== "$0.012") throw new Error("费用应保留 3 位");

const parts = usageParts({
  tokens: { input: 1234, output: 2000, cacheRead: 850, cacheWrite: 120 },
  cost: 0.0123,
});
if (parts.join(" ") !== "↑1.2k ↓2.0k R850 W120 $0.012") throw new Error(`用量片段错误: ${parts.join(" ")}`);
if (usageParts({}).length !== 0) throw new Error("空用量不应产生片段");

if (contextBar(42) !== "▰▰▰▰▱▱▱▱▱▱") throw new Error(`42% 应填充 4 格: ${contextBar(42)}`);
if (contextBar(100) !== "▰▰▰▰▰▰▰▰▰▰") throw new Error("100% 应填满");
if (contextBar(null) !== "▱▱▱▱▱▱▱▱▱▱") throw new Error("空百分比应全空");
if (contextBar(120) !== contextBar(100)) throw new Error("超过 100% 应钳制");

if (shouldCollapseUserText("x".repeat(LONG_USER_TEXT + 1), false)) throw new Error("最后一条消息不应折叠");
if (!shouldCollapseUserText("x".repeat(LONG_USER_TEXT + 1), true)) throw new Error("超长消息应折叠");
if (shouldCollapseUserText("x".repeat(LONG_USER_TEXT), true)) throw new Error("500 字整不应折叠");
if (shouldCollapseUserText("  " + "x".repeat(LONG_USER_TEXT) + "  ", true)) throw new Error("两侧空白不计入长度");

console.log("OK");
