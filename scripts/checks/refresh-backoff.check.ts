import assert from "node:assert/strict";
import {
  nextRefreshDelay,
  REFRESH_BASE_DELAY,
  REFRESH_MAX_DELAY,
  type RefreshBackoff,
} from "../../packages/ui/src/shared/refresh-backoff.ts";

// 会话列表刷新的重排节奏：最小间隔 + 连续退避，安静后回到基础间隔。
// 之前用 0ms 重排，事件密集时会「刷新 → 写回 → 再刷新」把主线程刷满。
const now = 1_000_000;
let state: RefreshBackoff = { streak: 0 };

const first = nextRefreshDelay(now, state, 0);
assert.equal(first.delay, REFRESH_BASE_DELAY, "首次重排用基础间隔");
state = first.state;

const second = nextRefreshDelay(now + 10, state, now);
assert.equal(second.delay, REFRESH_BASE_DELAY * 2, "连续重排应退避");
state = second.state;

const third = nextRefreshDelay(now + 20, state, now);
assert.equal(third.delay, REFRESH_BASE_DELAY * 4, "继续退避");
state = third.state;

let delay = 0;
for (let i = 0; i < 10; i += 1) {
  const step = nextRefreshDelay(now + 30 + i, state, now);
  state = step.state;
  delay = step.delay;
}
assert.equal(delay, REFRESH_MAX_DELAY, "退避有上限，不会无限增长");

// 安静 3 秒后认为这轮风暴结束，回到基础间隔。
const quiet = nextRefreshDelay(now + 10_000, state, now);
assert.equal(quiet.delay, REFRESH_BASE_DELAY, "安静后应回到基础间隔");

// 从未完成过刷新（lastDone=0）时也按基础间隔起步。
const cold = nextRefreshDelay(now, { streak: 2 }, 0);
assert.equal(cold.delay, REFRESH_BASE_DELAY, "没有完成记录时不应该直接退避");

console.log("refresh-backoff OK 基础间隔 / 退避 / 上限 / 安静后恢复");
