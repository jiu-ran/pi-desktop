import assert from "node:assert/strict";
import {
  MANUAL_UPDATE_CACHE_MS,
  UPDATE_CACHE_TTL_MS,
  blockedByCache,
  cacheAfterNotModified,
  cacheAfterRateLimit,
  cacheAfterSuccess,
  cacheIsFresh,
  conditionalHeaders,
  normalizeUpdateCache,
  type UpdateCacheState,
} from "../../electron/network/update-cache.ts";

// 磁盘上的东西一律不可信：空、字符串、老结构、字段类型不对，都要退回空缓存
const empty = normalizeUpdateCache(null);
assert.equal(empty.at, 0);
assert.equal(empty.blockedUntil, 0);
assert.equal(empty.result.latest, "");
assert.deepEqual(normalizeUpdateCache("garbage"), normalizeUpdateCache(null));
const junk = normalizeUpdateCache({ at: "yesterday", result: 42, blockedUntil: -5 });
assert.equal(junk.at, 0, "时间不是数字就当没查过");
assert.equal(junk.blockedUntil, 0, "负数恢复时间无意义，退回 0");
assert.equal(junk.result.latest, "", "result 不是对象时退回空结果");

const good = normalizeUpdateCache({
  at: 1000,
  current: "0.8.10",
  result: { current: "0.8.10", latest: "0.9.0", updateAvailable: true, url: "https://x", assetName: "a.exe", sha256: "ab" },
  etag: 'W/"abc"',
  lastModified: "Wed, 05 Nov 2026 00:00:00 GMT",
  blockedUntil: 2000,
});
assert.equal(good.at, 1000);
assert.equal(good.result.latest, "0.9.0");
assert.equal(good.etag, 'W/"abc"');

// TTL：自动 6 小时、手动 5 分钟
assert.equal(UPDATE_CACHE_TTL_MS, 6 * 60 * 60 * 1000);
assert.equal(MANUAL_UPDATE_CACHE_MS, 5 * 60 * 1000);
const fresh: UpdateCacheState = { ...good, blockedUntil: 0, at: 1_000_000 };
assert.equal(cacheIsFresh(fresh, "0.8.10", UPDATE_CACHE_TTL_MS, 1_000_000 + 60_000), true);
assert.equal(cacheIsFresh(fresh, "0.8.10", MANUAL_UPDATE_CACHE_MS, 1_000_000 + 10 * 60_000), false, "手动检查 5 分钟后要真的再查");
assert.equal(cacheIsFresh(fresh, "0.8.11", UPDATE_CACHE_TTL_MS, 1_000_000 + 60_000), false, "版本变了缓存就当失效");
assert.equal(cacheIsFresh(fresh, "0.8.10", 0, 1_000_000), false, "TTL 为 0 时不复用");
assert.equal(cacheIsFresh({ ...fresh, at: 0 }, "0.8.10", UPDATE_CACHE_TTL_MS, 1_000_000), false, "没查过就没有缓存");

// 限流：恢复时间之前一律不发请求；过期后恢复
assert.equal(blockedByCache({ ...fresh, blockedUntil: 2_000_000 }, 1_900_000), true);
assert.equal(blockedByCache({ ...fresh, blockedUntil: 2_000_000 }, 2_100_000), false);
assert.equal(cacheIsFresh({ ...fresh, blockedUntil: 2_000_000 }, "0.8.10", UPDATE_CACHE_TTL_MS, 1_900_000), false, "被限流时不要拿缓存假装检查过");

// 条件请求头：优先 ETag，其次 If-Modified-Since
assert.deepEqual(conditionalHeaders(fresh), { "If-None-Match": 'W/"abc"' });
assert.deepEqual(conditionalHeaders({ ...fresh, etag: undefined }), { "If-Modified-Since": "Wed, 05 Nov 2026 00:00:00 GMT" });
assert.deepEqual(conditionalHeaders({ ...fresh, etag: undefined, lastModified: undefined }), {});

// 304：只把确认时间推到现在，结果与凭据保持
const after304 = cacheAfterNotModified({ ...fresh, blockedUntil: 5 }, 3_000_000);
assert.equal(after304.at, 3_000_000);
assert.equal(after304.result.latest, "0.9.0");
assert.equal(after304.etag, 'W/"abc"');
assert.equal(after304.blockedUntil, 0, "304 说明网络是通的，顺手清掉限流记录");

// 200：新结果 + 新凭据，清掉限流
const after200 = cacheAfterSuccess(fresh, "0.8.10", { ...fresh.result, latest: "1.0.0" }, { etag: 'W/"new"' }, 4_000_000);
assert.equal(after200.at, 4_000_000);
assert.equal(after200.result.latest, "1.0.0");
assert.equal(after200.etag, 'W/"new"');
assert.equal(after200.blockedUntil, 0);
const keepEtag = cacheAfterSuccess(fresh, "0.8.10", fresh.result, {}, 4_000_000);
assert.equal(keepEtag.etag, 'W/"abc"', "服务器没给新 ETag 时沿用旧的");

// 限流：记下恢复时间；给不出恢复时间就至少冷却一分钟
const limited = cacheAfterRateLimit(fresh, 9_000_000, 1_000_000);
assert.equal(limited.blockedUntil, 9_000_000);
assert.equal(limited.result.latest, "0.9.0", "限流不该把上次结果冲掉");
const noReset = cacheAfterRateLimit(fresh, 0, 1_000_000);
assert.equal(noReset.blockedUntil, 1_060_000);
const pastReset = cacheAfterRateLimit(fresh, 500, 1_000_000);
assert.equal(pastReset.blockedUntil, 1_060_000, "恢复时间已经过去同样要冷却一分钟");

console.log("update-cache OK 归一化 / TTL / 限流 / 条件请求 / 304 / 200 / 限流落盘");
