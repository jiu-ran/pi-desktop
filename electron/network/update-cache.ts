/**
 * 应用更新检查的缓存纯逻辑（不 import electron，方便单测）。
 *
 * 为什么需要它：GitHub 匿名 API 的配额是**按出口 IP** 每小时 60 次，
 * - 以前缓存只在内存里，重启应用就等于重新发一次请求；
 * - 被限流后 `blockedUntil` 也只活在内存里，重启又去踩一次。
 * 走代理时配额还跟代理出口 IP 上别的人共用，所以「自己的使用次数」根本说明不了问题，
 * 只能尽量少发、发得值：成功结果跨启动复用，被限流时记住恢复时间，能带条件请求就带
 * （304 不消耗配额）。
 */

/** 自动检查复用多久以内的结果 */
export const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** 手动点「检查更新」时最多复用多久以内的结果：避免连点把配额打光 */
export const MANUAL_UPDATE_CACHE_MS = 5 * 60 * 1000;

export interface UpdateCacheResult {
  current: string;
  latest: string;
  updateAvailable: boolean;
  url: string;
  assetName: string;
  sha256?: string;
}

export interface UpdateCacheState {
  /** 上一次真正拿到结果的时刻（304 也算一次「确认」） */
  at: number;
  /** 那次结果对应的本地版本：版本升级后缓存自动失效 */
  current: string;
  result: UpdateCacheResult;
  /** GitHub 的条件请求凭据 */
  etag?: string;
  lastModified?: string;
  /** 被限流时的恢复时间：这之前不要再发请求 */
  blockedUntil: number;
}

const EMPTY: UpdateCacheState = {
  at: 0,
  current: "",
  result: { current: "", latest: "", updateAvailable: false, url: "", assetName: "" },
  blockedUntil: 0,
};

/** 磁盘上的 JSON 可能被改坏、可能是老结构：一律退回空缓存，不抛错。 */
export function normalizeUpdateCache(raw: unknown): UpdateCacheState {
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  const value = raw as Record<string, any>;
  const result = value.result && typeof value.result === "object" ? value.result : {};
  const text = (input: unknown): string => (typeof input === "string" ? input : "");
  const time = (input: unknown): number => (typeof input === "number" && Number.isFinite(input) && input > 0 ? input : 0);
  return {
    at: time(value.at),
    current: text(value.current),
    result: {
      current: text(result.current),
      latest: text(result.latest),
      updateAvailable: Boolean(result.updateAvailable),
      url: text(result.url),
      assetName: text(result.assetName),
      sha256: typeof result.sha256 === "string" ? result.sha256 : undefined,
    },
    etag: typeof value.etag === "string" && value.etag ? value.etag : undefined,
    lastModified: typeof value.lastModified === "string" && value.lastModified ? value.lastModified : undefined,
    blockedUntil: time(value.blockedUntil),
  };
}

/** 限流还没到恢复时间：这段时间里不要再发请求。 */
export function blockedByCache(state: UpdateCacheState, now = Date.now()): boolean {
  return state.blockedUntil > now;
}

/** 缓存还能直接用吗：版本没变、没被限流、且在 TTL 内。 */
export function cacheIsFresh(
  state: UpdateCacheState,
  current: string,
  ttlMs: number,
  now = Date.now(),
): boolean {
  if (blockedByCache(state, now)) return false;
  if (!state.at || !state.result.latest) return false;
  if (state.current !== current || state.result.current !== current) return false;
  return ttlMs > 0 && now - state.at < ttlMs;
}

/** 条件请求头：有 ETag 用它（304 不消耗配额），否则退回 If-Modified-Since。 */
export function conditionalHeaders(state: UpdateCacheState): Record<string, string> {
  if (state.etag) return { "If-None-Match": state.etag };
  if (state.lastModified) return { "If-Modified-Since": state.lastModified };
  return {};
}

/** 304：内容没变，只需要把「确认时间」推到现在，结果与凭据保持不变。 */
export function cacheAfterNotModified(state: UpdateCacheState, now = Date.now()): UpdateCacheState {
  return { ...state, at: now, blockedUntil: 0 };
}

/** 200：把新结果与新的条件请求凭据一起存下来。 */
export function cacheAfterSuccess(
  state: UpdateCacheState,
  current: string,
  result: UpdateCacheResult,
  meta: { etag?: string; lastModified?: string },
  now = Date.now(),
): UpdateCacheState {
  return {
    at: now,
    current,
    result,
    etag: meta.etag ?? state.etag,
    lastModified: meta.lastModified ?? state.lastModified,
    blockedUntil: 0,
  };
}

/** 被限流：记下恢复时间，这之前不再发请求（重启也照样生效）。 */
export function cacheAfterRateLimit(state: UpdateCacheState, retryAt: number, now = Date.now()): UpdateCacheState {
  const until = Number.isFinite(retryAt) && retryAt > now ? retryAt : now + 60_000;
  return { ...state, blockedUntil: until };
}
