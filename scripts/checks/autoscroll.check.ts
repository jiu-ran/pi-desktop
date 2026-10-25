import assert from "node:assert/strict";
import {
  FOLLOW_THRESHOLD_PX,
  canScroll,
  isAtBottom,
  isSelfScroll,
  shouldRunFollowFrame,
  wantsToPauseFollow,
} from "../../packages/ui/src/shared/autoscroll.ts";

// 贴底判定：阈值内算贴底
assert.equal(isAtBottom(1000, 2000, 1000), true, "scrollTop 到底部时应算贴底");
assert.equal(isAtBottom(960, 2000, 1000), true, `${FOLLOW_THRESHOLD_PX}px 以内仍算贴底`);
assert.equal(isAtBottom(900, 2000, 1000), false, "已经离开 100px 就不算贴底");
assert.equal(isAtBottom(0, 500, 900), true, "内容比视口短：天然贴底");
assert.equal(isAtBottom(0, 0, 0), true, "还没测量时按贴底处理，避免误判成用户上翻");

// 自己滚的还是用户滚的
assert.equal(isSelfScroll(1200, 1200), true, "位置没变 = 自己滚的");
assert.equal(isSelfScroll(1200.5, 1200), true, "亚像素抖动也算自己滚的");
assert.equal(isSelfScroll(980, 1200), false, "位置差 220px = 用户滚的");
assert.equal(isSelfScroll(500, Number.NaN), false, "还没程序化滚过时不能当成自己滚的");

// 上滑暂停跟随
assert.equal(wantsToPauseFollow(-120, 800, 2000, 1000), true, "向上滚且内容可滚动 → 停止跟随");
assert.equal(wantsToPauseFollow(120, 800, 2000, 1000), false, "向下滚不暂停");
assert.equal(wantsToPauseFollow(-120, 0, 900, 1000), false, "内容不够高时不上滑，别乱暂停");
assert.equal(wantsToPauseFollow(0, 800, 2000, 1000), false);
assert.equal(canScroll(0, 2000, 1000), true);
assert.equal(canScroll(0, 1000, 1000), false);

// 排队中的贴底帧：期间用户上滑过就作废
assert.equal(
  shouldRunFollowFrame({ forced: false, stick: true, epochAtSchedule: 3, epoch: 3 }),
  true,
  "没被打断时正常贴底",
);
assert.equal(
  shouldRunFollowFrame({ forced: false, stick: true, epochAtSchedule: 3, epoch: 4 }),
  false,
  "排队期间用户上滑了 —— 这一帧必须作废，否则画面又弹回底部",
);
assert.equal(
  shouldRunFollowFrame({ forced: true, stick: true, epochAtSchedule: 3, epoch: 4 }),
  false,
  "即便是「回到底部」的强贴底，用户又自己上滑了也不该抢",
);
assert.equal(
  shouldRunFollowFrame({ forced: false, stick: false, epochAtSchedule: 3, epoch: 3 }),
  false,
  "非强制且已不贴底时不滚",
);
assert.equal(
  shouldRunFollowFrame({ forced: true, stick: false, epochAtSchedule: 5, epoch: 5 }),
  true,
  "强制贴底（点「回到底部」）照常执行",
);

console.log("autoscroll OK");
