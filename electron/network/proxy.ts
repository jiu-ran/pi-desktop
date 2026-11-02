/**
 * 出网方案（代理）的纯逻辑，主进程用。
 *
 * 渲染层有一份同样的实现（`packages/ui/src/shared/network-mode.ts`），两边的 tsconfig
 * rootDir 不同、不能互相 import，所以这里刻意保持一致，并由
 * `scripts/checks/network-mode.check.ts` 把两边放在同一张表上逐项对齐 —— 改一边忘了另一边会直接红。
 *
 * 为什么不共用：`electron/` 的 tsconfig 只包含 `electron/**`，`packages/ui` 只包含自己的 src；
 * 把纯逻辑挪到第三个目录会同时破坏两边的 outDir 布局。
 */

export type NetworkMode = "auto" | "system" | "direct" | "custom";
export type ProxySource = "env" | "system" | "custom" | "none";

export interface ProxyPlan {
  mode: NetworkMode;
  proxy: string;
  source: ProxySource;
}

export const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
] as const;

export function normalizeNetworkMode(value: unknown): NetworkMode {
  const text = String(value ?? "").trim();
  return text === "system" || text === "direct" || text === "custom" ? text : "auto";
}

export function normalizeProxyUrl(value: unknown): string {
  let text = String(value ?? "").trim();
  if (!text) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`;
  try {
    const url = new URL(text);
    const protocol = url.protocol.toLowerCase();
    if (!["http:", "https:", "socks:", "socks4:", "socks5:"].includes(protocol)) return "";
    if (!url.hostname) return "";
    const auth = url.username ? `${url.username}${url.password ? `:${url.password}` : ""}@` : "";
    return `${protocol}//${auth}${url.host}`;
  } catch {
    return "";
  }
}

export function envProxyOf(env: Record<string, string | undefined> = {}): string {
  const keys = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
  for (const key of keys) {
    const value = normalizeProxyUrl(env[key]);
    if (value) return value;
  }
  return "";
}

export function resolveProxyPlan(
  mode: NetworkMode,
  customProxy: string,
  env: Record<string, string | undefined> = {},
  systemProxy = "",
): ProxyPlan {
  const normalizedMode = normalizeNetworkMode(mode);
  const custom = normalizeProxyUrl(customProxy);
  const system = normalizeProxyUrl(systemProxy);
  if (normalizedMode === "direct") return { mode: "direct", proxy: "", source: "none" };
  if (normalizedMode === "custom") {
    return custom ? { mode: "custom", proxy: custom, source: "custom" } : { mode: "custom", proxy: "", source: "none" };
  }
  if (normalizedMode === "system") {
    return system ? { mode: "system", proxy: system, source: "system" } : { mode: "system", proxy: "", source: "none" };
  }
  const fromEnv = envProxyOf(env);
  if (fromEnv) return { mode: "auto", proxy: fromEnv, source: "env" };
  if (system) return { mode: "auto", proxy: system, source: "system" };
  return { mode: "auto", proxy: "", source: "none" };
}

export function applyProxyEnv(
  env: Record<string, string | undefined>,
  plan: ProxyPlan,
): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = { ...env };
  for (const key of PROXY_ENV_KEYS) delete next[key];
  if (!plan.proxy) {
    next.NO_PROXY = "*";
    return next;
  }
  next.HTTP_PROXY = plan.proxy;
  next.HTTPS_PROXY = plan.proxy;
  next.http_proxy = plan.proxy;
  next.https_proxy = plan.proxy;
  return next;
}
