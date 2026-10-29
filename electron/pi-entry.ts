import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * 本机 Pi 的 JS 入口。
 *
 * 桌面端**不内置** Pi 的推理与工具执行：会话跑的是用户自己安装的 `pi`
 * （`docs/product-boundary.md` / README）。但 `RpcClient` 内部是
 * `spawn("node", [cliPath, "--mode", "rpc"])`，所以要给 `dist/cli.js`，
 * 而不是 PATH 上那个 `pi` shim（Windows 是 .cmd，Unix 是 shell 脚本）。
 *
 * 这个模块只做「从可执行文件反解出入口」这件事，纯同步、不跑子进程，
 * 方便单测（`scripts/checks/pi-entry.check.ts`）。
 */
export const PI_RUNTIME_PACKAGE = "@earendil-works/pi-coding-agent";

/** shim 一般只有几百字节；读太大的文件说明选错了东西 */
const SHIM_READ_LIMIT = 256 * 1024;

function isFile(target: string): boolean {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

function readSmallFile(target: string): string {
  try {
    if (statSync(target).size > SHIM_READ_LIMIT) return "";
    return readFileSync(target, "utf8");
  } catch {
    return "";
  }
}

/** 从 node_modules 目录推出 pi 的入口（npm / pnpm 的全局布局都是这个形状） */
export function piEntryFromNodeModulesDir(nodeModulesDir: string): string {
  if (!nodeModulesDir) return "";
  const entry = path.join(nodeModulesDir, PI_RUNTIME_PACKAGE, "dist", "cli.js");
  return isFile(entry) ? path.resolve(entry) : "";
}

/**
 * 从 shim 文本里抽 `…/pi-coding-agent/dist/cli.js`。
 * npm 的 Windows shim 写的是 `%~dp0\node_modules\…`，Unix 是相对 `$basedir` 或绝对路径，
 * 所以匹配到的片段一律按「绝对路径 → shim 目录 → shim 的上级」依次试。
 */
function entryFromShimText(shim: string): string {
  const text = readSmallFile(shim);
  if (!text) return "";
  const shimDir = path.dirname(shim);
  const pattern = /[^\s"'`=<>]*pi-coding-agent[/\\]dist[/\\]cli\.js/g;
  for (const match of text.match(pattern) ?? []) {
    const cleaned = match.replace(/^[)+]*/, "").replace(/[),;]+$/, "");
    if (!cleaned) continue;
    const candidates = path.isAbsolute(cleaned)
      ? [cleaned]
      : [path.resolve(shimDir, cleaned), path.resolve(path.dirname(shimDir), cleaned)];
    for (const candidate of candidates) {
      if (isFile(candidate)) return path.resolve(candidate);
    }
  }
  return "";
}

/**
 * 从一个 `pi` 可执行文件（或直接给 `dist/cli.js`）反解出 JS 入口。
 * 找不到返回空字符串 —— 由调用方决定是报错还是再试别的办法。
 */
export function piCliEntryFromExecutable(executable: string): string {
  const target = String(executable ?? "").trim().replace(/^"|"$/g, "");
  if (!target) return "";
  // 用户直接指定了入口文件
  if (target.endsWith(".js") && isFile(target)) return path.resolve(target);
  if (!isFile(target)) return "";

  const dir = path.dirname(target);
  const layouts = [
    path.join(dir, "node_modules"), // <prefix>/pi  +  <prefix>/node_modules
    path.join(dir, "..", "node_modules"),
    path.join(dir, "..", "lib", "node_modules"), // Unix：<prefix>/bin/pi + <prefix>/lib/node_modules
  ];
  for (const nodeModules of layouts) {
    const entry = piEntryFromNodeModulesDir(nodeModules);
    if (entry) return entry;
  }
  return entryFromShimText(target);
}

/**
 * 从「一个 pi 可执行文件 / PATH / npm 全局目录」里解析入口，找不到返回空字符串。
 * 不跑 `pi --version`（那是主进程 locatePi 的活儿），只做路径推导。
 */
export async function resolvePiEntryFromSystem(executable = ""): Promise<string> {
  const direct = piCliEntryFromExecutable(executable);
  if (direct) return direct;
  if (!executable) {
    const fromPath = piCliEntryFromExecutable(findExecutableOnPath("pi"));
    if (fromPath) return fromPath;
  }
  // 兜底：官方安装器 / 非标准 shim 里看不到路径时，问一下 npm 的全局目录
  const root = await new Promise<string>((resolve) => {
    execFile("npm root -g", { shell: true, timeout: 15000 }, (error, stdout) => {
      resolve(error ? "" : String(stdout ?? "").trim());
    });
  });
  const last = root.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
  return piEntryFromNodeModulesDir(last);
}

/** 按 PATH 找可执行文件（用来确认 `node` 在不在：RpcClient 是靠 node 启动 pi 的） */
export function findExecutableOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const isWin = process.platform === "win32";
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).map((item) => item.trim()).filter(Boolean);
  const exts = isWin
    ? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((ext) => ext.trim().toLowerCase())]
    : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${name}${ext}`);
      if (existsSync(candidate) && isFile(candidate)) return candidate;
    }
  }
  return "";
}
