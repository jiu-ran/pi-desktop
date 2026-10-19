import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PI_RPC_ALLOWLIST } from "../../electron/pi-rpc-allowlist.ts";

const root = path.resolve(import.meta.dirname, "../..");
const boundaryDoc = path.join(root, "docs/product-boundary.md");
const failures: string[] = [];

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(target);
    return /\.(?:ts|vue|cts)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

function fail(file: string, reason: string): void {
  failures.push(`${path.relative(root, file)}: ${reason}`);
}

const requiredRules = [
  "渲染进程不得导入 Node.js",
  "不得直接调用模型服务",
  "不得读写系统提示词",
  "只能使用明确列出的 RPC 方法",
  "不得根据消息内容自行计算 token",
];
const document = await readFile(boundaryDoc, "utf8");
for (const rule of requiredRules) {
  if (!document.includes(rule)) failures.push(`docs/product-boundary.md: 缺少规则“${rule}”`);
}

const rendererFiles = await files(path.join(root, "packages/ui/src"));
const forbiddenRenderer = [
  { pattern: /from\s+["'](?:node:|electron|@earendil-works\/pi-)/, reason: "渲染进程导入了受限制模块" },
  { pattern: /\b(?:openai|anthropic|createAgentSession|systemPrompt)\b/, reason: "渲染进程出现模型或提示词控制代码" },
  { pattern: /\b(?:child_process|ipcRenderer|spawn|execFile)\b/, reason: "渲染进程出现进程或 IPC 控制代码" },
];
for (const file of rendererFiles) {
  const source = await readFile(file, "utf8");
  for (const rule of forbiddenRenderer) {
    if (rule.pattern.test(source)) fail(file, rule.reason);
  }
}

const hostFile = path.join(root, "electron/pi-host.ts");
const hostSource = await readFile(hostFile, "utf8");
if (!hostSource.includes("PI_RPC_ALLOWLIST")) failures.push("electron/pi-host.ts: 未使用唯一 RPC 白名单");
const ignoredClientMethods = new Set(["onEvent", "start", "stop", "dispose"]);
const listed = [...hostSource.matchAll(/client\.([A-Za-z]+)\(/g)].map((match) => match[1]).filter((method) => !ignoredClientMethods.has(method));
for (const method of new Set(listed)) {
  if (!PI_RPC_ALLOWLIST.includes(method)) failures.push(`electron/pi-host.ts: RPC 方法 ${method} 不在锁定白名单中`);
}

const usageFiles = [...rendererFiles, ...await files(path.join(root, "electron"))];
for (const file of usageFiles) {
  const source = await readFile(file, "utf8");
  if (/\b(?:usage|tokens|cost)\b[^\n]*\+=|\b(?:usage|tokens|cost)\b[^\n]*\+\s*(?:usage|tokens|cost)\b/.test(source)) fail(file, "不得自行累加 token 或费用");
}

const electronFiles = await files(path.join(root, "electron"));
for (const file of electronFiles) {
  if (path.resolve(file) === hostFile) continue;
  const source = await readFile(file, "utf8");
  if (/@earendil-works\/pi-coding-agent/.test(source)) fail(file, "只有 Pi 宿主可以直接导入 Pi SDK");
  if (/\bcreateAgentSession\b/.test(source)) fail(file, "不得创建第二套 Agent 会话");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("product boundary OK");
