/**
 * 出网方式（代理）的选择。
 *
 * 桌面端有两条独立的网络路径，必须一起管：
 * 1. 应用自己：Electron 的 `net` / 渲染层请求（检查更新、下载安装包）；
 * 2. Pi 子进程：模型请求、MCP、`pi update` —— Pi 用 undici 的 `EnvHttpProxyAgent`，
 *    **只认 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量**，系统代理设置它看不见。
 *
 * 所以这里把「用户选哪种」和「最终用哪个代理」分开：先算出 `ProxyPlan`，
 * 再分别喂给 Electron 的 session 和子进程的 env。纯函数便于逐条核对。
 */

export type NetworkMode = "auto" | "system" | "direct" | "custom";

export interface NetworkModeMeta {
  value: NetworkMode;
  label: string;
  hint: string;
}

export const NETWORK_MODES: readonly NetworkModeMeta[] = [
  { value: "auto", label: "自动", hint: "有代理环境变量就沿用，否则跟随系统设置" },
  { value: "system", label: "系统代理", hint: "使用操作系统里的代理设置" },
  { value: "direct", label: "直连", hint: "不用任何代理（忽略环境变量与系统设置）" },
  { value: "custom", label: "自定义", hint: "手动填一个代理地址，例如 127.0.0.1:7890" },
];

export const NETWORK_MODE_DEFAULT: NetworkMode = "auto";

/** 代理从哪来（决定界面上怎么解释当前状态）。 */
export type ProxySource = "env" | "system" | "custom" | "none";

export interface ProxyPlan {
  mode: NetworkMode;
  /** 最终要用的代理；空串表示直连 */
  proxy: string;
  source: ProxySource;
}

export function normalizeNetworkMode(value: unknown): NetworkMode {
  const text = String(value ?? "").trim();
  return NETWORK_MODES.some((meta) => meta.value === text) ? (text as NetworkMode) : NETWORK_MODE_DEFAULT;
}

/**
 * 规整用户填的代理地址：允许省略协议（`127.0.0.1:7890` → `http://127.0.0.1:7890`）。
 * 只接受 http / https / socks，其它一律当没填（返回空串），避免把奇怪的字符串塞给 Pi。
 */
export function normalizeProxyUrl(value: unknown): string {
  let text = String(value ?? "").trim();
  if (!text) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`;
  try {
    const url = new URL(text);
    const protocol = url.protocol.toLowerCase();
    if (!["http:", "https:", "socks:", "socks4:", "socks5:"].includes(protocol)) return "";
    if (!url.hostname) return "";
    // 只保留协议 + 主机 + 端口（可能带认证），丢掉路径与查询
    const auth = url.username ? `${url.username}${url.password ? `:${url.password}` : ""}@` : "";
    return `${protocol}//${auth}${url.host}`;
  } catch {
    return "";
  }
}

/** 环境变量里的代理（大小写都认，HTTPS 优先）。 */
export function envProxyOf(env: Record<string, string | undefined> = {}): string {
  const keys = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
  for (const key of keys) {
    const value = normalizeProxyUrl(env[key]);
    if (value) return value;
  }
  return "";
}

/**
 * 算出这次到底走哪个代理。
 *
 * - `auto`：环境变量优先，其次系统代理，都没有就直连；
 * - `system`：只用系统设置（拿不到就当直连，不再回落到环境变量）；
 * - `direct`：直连；
 * - `custom`：用填的地址；地址不合法时退回直连，不偷偷换别的路。
 */
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

/** 会被我们接管的代理变量；直连时要把继承来的这些统统删掉。 */
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

/**
 * 把方案落到子进程环境上（返回新对象，不改入参）。
 *
 * 直连必须**删掉**继承来的代理变量：只设 `NO_PROXY=*` 不够，
 * undici 的 EnvHttpProxyAgent 见到 `HTTPS_PROXY` 就还是会用。
 */
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

/** 设置页里描述「现在实际怎么走」的一句话。 */
export function proxyPlanLabel(plan: ProxyPlan): string {
  if (!plan.proxy) {
    if (plan.mode === "custom") return "未填有效的代理地址，当前直连";
    return "当前直连（没有检测到代理）";
  }
  const source =
    plan.source === "env" ? "环境变量" : plan.source === "system" ? "系统代理" : "自定义";
  return `${source}：${plan.proxy}`;
}
