import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  retryCountdownLabel,
  retryNoticeText,
  retryRemainingMs,
  retryResultText,
} from "../../packages/ui/src/shared/retry-notice.ts";

/**
 * 自动重连提示的倒计时与文案。
 *
 * 这个提示的「动态效果」曾经有两处问题：正文里写死「3.0 秒后重试」（时间在走、
 * 数字不动，第二次重试还沿用旧值），以及进度条在换下一条重试时不重新开始。
 * 文案部分在这里钉住，动画部分由 Electron 探针检查。
 */

// 1. 倒计时：向上取整、到点归零
assert.equal(retryRemainingMs(1000, 0), 1000);
assert.equal(retryRemainingMs(0, 500), 0, "过点后不能出现负数");
assert.equal(retryCountdownLabel(3000, 0), "3 秒后重试");
assert.equal(retryCountdownLabel(3000, 1500), "2 秒后重试", "1.5 秒应向上取整为 2，不能抖成 1");
assert.equal(retryCountdownLabel(3000, 2999), "1 秒后重试");
assert.equal(retryCountdownLabel(3000, 3000), "正在重试…");
assert.equal(retryCountdownLabel(3000, 9000), "正在重试…", "超时后停在「正在重试」而不是负数");

// 2. 正文不再出现「X.X 秒后重试」这种死数字
const text = retryNoticeText(2, 5);
assert.equal(text, "连接中断，正在重试（2/5）");
assert.ok(!/\d\.\d\s*秒/.test(text), "正文里不能再写死带小数的秒数");

// 3. 收尾文案
assert.equal(retryResultText(true, 2, 5, ""), "已重新连接（第 2 次重试）");
assert.equal(retryResultText(false, 5, 5, "网络连接失败"), "重试 5/5 失败：网络连接失败");
assert.equal(retryResultText(false, 5, 5, ""), "重试 5/5 失败：未知错误");

// 4. transcript 里确实用了这两个函数，事件里也带了 deadline
const here = path.dirname(fileURLToPath(import.meta.url));
const transcript = readFileSync(path.resolve(here, "../../packages/ui/src/kernel/transcript.ts"), "utf8");
assert.ok(transcript.includes("retryNoticeText("), "transcript 要用共享文案");
assert.ok(transcript.includes("deadlineAt: Date.now() + delay"), "事件处理里要记录下一次重试的时间点");
assert.ok(!transcript.includes("toFixed(1)} 秒后重试"), "不能再往正文里写死秒数");

// 5. 进度条换了重试就重来：模板里要按 attempt 换 key
const notice = readFileSync(path.resolve(here, "../../packages/ui/src/components/chat/messages/NoticeBlock.vue"), "utf8");
assert.ok(notice.includes(':key="block.retry.attempt"'), "进度条要按 attempt 换 key，否则换条后不会重新走");
assert.ok(notice.includes("notice-spin"), "重连期间图标要转起来");

console.log("retry-notice OK 倒计时取整 / 文案 / 收尾 / deadline / 进度条重启");
