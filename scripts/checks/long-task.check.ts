import assert from "node:assert/strict";
import {
  LONG_TASK_MIN_INTERVAL_MS,
  LONG_TASK_THRESHOLD_MS,
  longTaskLabel,
  shouldReportLongTask,
} from "../../packages/ui/src/shared/long-task.ts";

// 只记真正长的任务：1 秒以下不打扰
assert.equal(shouldReportLongTask(999, 0, 10_000), false, "低于阈值不应上报");
assert.equal(shouldReportLongTask(1000, 0, 10_000), true, "达到阈值应上报");
assert.equal(shouldReportLongTask(5000, 0, 10_000), true, "长的任务一定上报");

// 连续卡顿时不能把自己刷成日志洪水
assert.equal(shouldReportLongTask(2000, 10_000, 10_500), false, "同一秒内只记一条");
assert.equal(shouldReportLongTask(2000, 10_000, 11_000), true, "过了间隔再记");

// 非数值不能进来
assert.equal(shouldReportLongTask(Number.NaN, 0, 10_000), false, "非数值不上报");

assert.equal(LONG_TASK_THRESHOLD_MS, 1000);
assert.equal(LONG_TASK_MIN_INTERVAL_MS, 1000);

// 长任务的 name 基本是自链接标记，没有信息量就不写进日志
assert.equal(longTaskLabel({ name: "self" }), "");
assert.equal(longTaskLabel({ name: "" }), "");
assert.equal(longTaskLabel({ name: "unknown" }), "");
assert.equal(longTaskLabel({ name: "https://example.com/x.js" }), "https://example.com/x.js");

// 没有 PerformanceObserver 的环境（node / 老浏览器）也要安全地什么都不做
const dispose = (await import("../../packages/ui/src/shared/long-task.ts")).installLongTaskReporter({
  report: () => assert.fail("node 环境不应有长任务上报"),
});
assert.equal(typeof dispose, "function", "总要返回一个可调用的卸载函数");
dispose();

console.log("long-task.check ok 阈值 / 节流 / 标签 / 无环境兜底");

// 心跳看门狗：卡 3 秒以上才记，且 10 秒内不重复记
{
  const { shouldReportLag } = await import("../../packages/ui/src/shared/long-task.ts");
  assert.equal(shouldReportLag(200, 0, 1e12), false, "低于阈值不报");
  assert.equal(shouldReportLag(3200, 0, 1e12), true, "卡 3.2 秒要报");
  assert.equal(shouldReportLag(3200, 1e12 - 5000, 1e12), false, "10 秒内不重复");
  assert.equal(shouldReportLag(NaN, 0, 1e12), false, "非法值不报");
  console.log("lag watchdog OK 阈值 / 去重");
}
