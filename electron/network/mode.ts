/**
 * 主进程的出网状态：把用户选的模式落成两件事 ——
 * 1. Electron session 的代理（应用自己的请求：检查更新、下载安装包）；
 * 2. 子进程的代理环境变量（Pi：模型请求、MCP、`pi update`；以及 npm/git 探测）。
 *
 * 系统代理不自己解析注册表，而是问 Chromium：`session.resolveProxy()` 返回
 * `PROXY host:port` / `SOCKS5 host:port` / `DIRECT`，跨平台口径一致。
 */

import { session } from "electron";
import {
  applyProxyEnv,
  normalizeNetworkMode,
  resolveProxyPlan,
  type NetworkMode,
  type ProxyPlan,
} from "./proxy.ts";

/** 用哪个地址去问系统代理：GitHub API 与 npm registry 都走它，够代表性。 */
const PROXY_PROBE_URL = "https://api.github.com";

let mode: NetworkMode = "auto";
let customProxy = "";
let plan: ProxyPlan = { mode: "auto", proxy: "", source: "none" };
let systemProxyCache: { at: number; proxy: string } = { at: 0, proxy: "" };
const SYSTEM_PROXY_TTL_MS = 15_000;

/** 把 Chromium 的 `PROXY 127.0.0.1:7890; DIRECT` 解析成可用的代理地址（只取第一条）。 */
export function parseResolvedProxy(value: string): string {
  const text = String(value ?? "").trim();
  if (!text || /^DIRECT$/i.test(text)) return "";
  for (const entry of text.split(";")) {
    const item = entry.trim();
    const match = /^(PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+(.+)$/i.exec(item);
    if (!match) continue;
    const kind = (match[1] ?? "").toUpperCase();
    const host = (match[2] ?? "").trim();
    if (!host) continue;
    if (kind.startsWith("SOCKS5")) return `socks5://${host}`;
    if (kind.startsWith("SOCKS4")) return `http://${host}`;
    if (kind.startsWith("SOCKS")) return `http://${host}`;
    return `http://${host}`;
  }
  return "";
}

async function systemProxy(): Promise<string> {
  const now = Date.now();
  if (now - systemProxyCache.at < SYSTEM_PROXY_TTL_MS) return systemProxyCache.proxy;
  let proxy = "";
  try {
    const resolved = await session.defaultSession.resolveProxy(PROXY_PROBE_URL);
    proxy = parseResolvedProxy(resolved);
  } catch {
    proxy = "";
  }
  systemProxyCache = { at: now, proxy };
  return proxy;
}

/** 当前方案（子进程 spawn 时读它）。 */
export function currentProxyPlan(): ProxyPlan {
  return plan;
}

/** 子进程要用的环境变量（复制一份，不动 process.env）。 */
export function childEnv(base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  return applyProxyEnv(base, plan);
}

/** 子进程环境补丁：只返回被我们改动的键，便于和别的 env 合并。 */
export function proxyEnvPatch(base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const patch: Record<string, string | undefined> = {};
  const next = childEnv(base);
  for (const [key, value] of Object.entries(next)) {
    if (base[key] !== value) patch[key] = value;
  }
  for (const key of Object.keys(base)) {
    if (!(key in next)) patch[key] = undefined;
  }
  return patch;
}

async function applySessionProxy(next: ProxyPlan): Promise<void> {
  const target = session.defaultSession;
  try {
    if (next.mode === "direct") {
      await target.setProxy({ mode: "direct" });
    } else if (next.mode === "auto" && next.source === "none") {
      // 自动 + 没检测到代理：交给系统（也就是 Chromium 默认行为）
      await target.setProxy({ mode: "system" });
    } else if (next.proxy) {
      await target.setProxy({ proxyRules: next.proxy });
    } else {
      await target.setProxy({ mode: "system" });
    }
    // 已经建立的连接仍用旧代理，换模式后必须断开重连
    await target.closeAllConnections();
  } catch {
    // 代理设置失败不该拖垮应用：下一次请求仍会按系统默认走
  }
}

export interface NetworkStatus {
  mode: NetworkMode;
  custom: string;
  proxy: string;
  source: ProxyPlan["source"];
  /** 系统里检测到的代理（界面用来解释「自动」会走哪条路） */
  systemProxy: string;
}

/** 应用一次设置：记住模式、算方案、落到 session，并把结果回给界面。 */
export async function applyNetworkMode(nextMode: unknown, nextCustom: unknown): Promise<NetworkStatus> {
  mode = normalizeNetworkMode(nextMode);
  customProxy = String(nextCustom ?? "");
  const system = await systemProxy();
  plan = resolveProxyPlan(mode, customProxy, process.env, system);
  await applySessionProxy(plan);
  return { mode, custom: customProxy, proxy: plan.proxy, source: plan.source, systemProxy: system };
}

/** 只读当前状态，不改任何设置（设置页打开时用）。 */
export async function networkStatus(): Promise<NetworkStatus> {
  const system = await systemProxy();
  const plan = resolveProxyPlan(mode, customProxy, process.env, system);
  return { mode, custom: customProxy, proxy: plan.proxy, source: plan.source, systemProxy: system };
}

/** 启动时按已保存的模式初始化（渲染层就绪后会再同步一次）。 */
export async function initNetworkMode(): Promise<void> {
  await applyNetworkMode(mode, customProxy);
}
