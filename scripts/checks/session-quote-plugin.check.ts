import assert from "node:assert/strict";
import {
  filterCrossProjectSessions,
  sessionHint,
} from "../../packages/ui/src/plugins/session-quote/summary.ts";

const other = (title: string, cwd: string, path = `/sessions/x/${title}.jsonl`, timestamp = Date.now()) => ({
  path,
  title,
  cwd,
  project: cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd,
  timestamp,
});

// 当前项目的会话不进来（核心候选已经列了本项目）
{
  const rows = filterCrossProjectSessions(
    [
      other("本项目 A", "C:\\work\\alpha"),
      other("别的项目 B", "C:\\work\\beta"),
    ],
    { currentCwd: "C:\\work\\alpha" },
  );
  assert.deepEqual(rows.map((row) => row.title), ["别的项目 B"], "应排除当前项目的会话");
}

// 路径分隔符 / 盘符大小写不同也要认成同一个项目
{
  const rows = filterCrossProjectSessions(
    [other("本项目", "C:\\Work\\Alpha")],
    { currentCwd: "c:/work/alpha/" },
  );
  assert.equal(rows.length, 0, "同一项目的大小写/分隔符差异应被识别");
}

// 关键词过滤：按标题、项目名、完整路径都能命中；多个词要全部命中
{
  const list = [other("修报表导出", "C:\\work\\beta"), other("改登录", "C:\\work\\gamma")];
  assert.deepEqual(
    filterCrossProjectSessions(list, { query: "报表" }).map((row) => row.title),
    ["修报表导出"],
  );
  assert.deepEqual(
    filterCrossProjectSessions(list, { query: "gamma" }).map((row) => row.title),
    ["改登录"],
    "按项目名应能命中",
  );
  assert.deepEqual(filterCrossProjectSessions(list, { query: "登录 gamma" }).map((row) => row.title), ["改登录"]);
  assert.equal(filterCrossProjectSessions(list, { query: "登录 报表" }).length, 0, "多个词要全部命中");
}

// 数量上限与去重
{
  const list = Array.from({ length: 20 }, (_, i) => other(`会话 ${i}`, `C:\\work\\p${i}`));
  assert.equal(filterCrossProjectSessions(list, { limit: 6 }).length, 6, "应截断到 limit");
  const dup = filterCrossProjectSessions([list[0], { ...list[0] }], { limit: 6 });
  assert.equal(dup.length, 1, "同一路径不应重复出现");
}

// 没有 cwd 的历史数据：不能因为「不知道属于哪个项目」就丢掉
{
  const rows = filterCrossProjectSessions([{ path: "/x/legacy.jsonl", title: "老会话" }], { currentCwd: "C:\\work\\alpha" });
  assert.equal(rows.length, 1, "缺少 cwd 的会话仍应可作为候选");
}

// 右侧说明：项目名 + 相对时间
{
  const now = Date.UTC(2026, 9, 25, 12, 0, 0);
  assert.equal(sessionHint(other("a", "C:\\work\\beta", "/x/a.jsonl", now - 3 * 3600_000), now), "beta · 今天");
  assert.equal(sessionHint(other("a", "C:\\work\\beta", "/x/a.jsonl", now - 30 * 3600_000), now), "beta · 昨天");
  assert.equal(sessionHint(other("a", "C:\\work\\beta", "/x/a.jsonl", now - 5 * 86_400_000), now), "beta · 5 天前");
  assert.equal(sessionHint({ path: "/x/a.jsonl", title: "a" }), "", "没有时间与项目时留空");
}

console.log("session-quote-plugin.check ok 排除本项目 / 关键词 / 上限 / 提示文案");
