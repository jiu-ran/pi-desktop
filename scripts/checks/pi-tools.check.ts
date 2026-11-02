import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PI_DEFAULT_TOOL_NAMES,
  PI_TOOL_CATALOG,
  describeTools,
  extraToolEntries,
  hasToolSelection,
  mergeToolEntries,
  resolveSettingsTools,
  resolveToolEntries,
  scopeBaseEntries,
  toolModifierArguments,
  toggleToolEntries,
} from "../../electron/pi-tools.ts";

/**
 * 工具开关：`defaultTools` 的解析 / 合并 / 写入，以及启动参数的校正。
 *
 * 这些规则必须和 Pi 一致，否则「界面上关了，Pi 里还开着」：
 * - 普通名单替换默认值，只有 `+name` / `-name` 才叠加；
 * - 空数组表示全部停用；
 * - 项目普通名单替换全局，项目只写 `+/-` 时叠加在全局之上；
 * - 会话恢复时 Pi 用 `--tools` 的 `+/-` 叠加到记录里的工具集上。
 */

// ---- 1. 目录与默认值 ----
const catalogNames = PI_TOOL_CATALOG.map((tool) => tool.name);
assert.equal(new Set(catalogNames).size, catalogNames.length, "工具目录不能重名");
for (const name of PI_DEFAULT_TOOL_NAMES) {
  assert.ok(catalogNames.includes(name), `Pi 的默认工具 ${name} 必须在目录里`);
}
assert.deepEqual(resolveToolEntries(undefined), ["read", "bash", "edit", "write"], "没配置时是 Pi 的默认工具");

// ---- 2. 解析规则 ----
assert.deepEqual(resolveToolEntries([]), [], "空数组表示全部停用");
assert.deepEqual(resolveToolEntries(["read", "grep"]), ["read", "grep"], "普通名单替换默认值");
assert.deepEqual(
  resolveToolEntries(["+codemode", "-write"]),
  ["read", "bash", "edit", "codemode"],
  "+name / -name 叠加在默认工具上",
);
assert.deepEqual(
  resolveToolEntries(["-write", "+grep"]),
  ["read", "bash", "edit", "grep"],
  "按顺序应用修饰符",
);
assert.deepEqual(resolveToolEntries(["+grep", "-grep"]), ["read", "bash", "edit", "write"], "后一个修饰符覆盖前一个");
assert.deepEqual(resolveToolEntries(["read", "grep", "-read"]), ["grep"], "普通名单与修饰符可以混用（设置文件里允许）");
assert.deepEqual(resolveToolEntries([1, null, "read"]), ["read"], "非字符串条目忽略");

// ---- 3. 两层设置合并 ----
assert.deepEqual(mergeToolEntries(["+codemode"], ["-write"]), ["+codemode", "-write"], "项目只写修饰符时追加到全局");
assert.deepEqual(mergeToolEntries(["read"], ["read", "grep"]), ["read", "grep"], "项目普通名单替换全局");
assert.deepEqual(mergeToolEntries(["read"], []), ["read"], "空数组全是修饰符：继承全局（与 Pi 一致）");
assert.deepEqual(mergeToolEntries(undefined, []), [], "全局没配置、项目空数组：全部停用");
assert.deepEqual(
  resolveSettingsTools({ defaultTools: ["+codemode"] }, { defaultTools: ["-write"] }),
  ["read", "bash", "edit", "codemode"],
  "全局加 codemode、项目去掉 write",
);
assert.deepEqual(
  resolveSettingsTools({ defaultTools: ["+codemode"] }, { defaultTools: ["read"] }),
  ["read"],
  "项目普通名单替换全局（不会继承 codemode）",
);

// ---- 4. 作用域判断 ----
assert.equal(hasToolSelection(undefined), false);
assert.equal(hasToolSelection({}), false);
assert.equal(hasToolSelection({ defaultTools: [] }), true, "空数组也是一次显式选择");
assert.equal(hasToolSelection({ defaultTools: ["read"] }), true);

assert.deepEqual(scopeBaseEntries("global", ["+codemode"], ["-write"], true), ["read", "bash", "edit", "write", "codemode"]);
assert.deepEqual(
  scopeBaseEntries("project", ["+codemode"], ["-write"], true),
  ["read", "bash", "edit", "codemode"],
  "项目只写修饰符：从全局选择出发",
);
assert.deepEqual(scopeBaseEntries("project", ["+codemode"], ["read"], true), ["read"], "项目普通名单替换全局");
assert.deepEqual(
  scopeBaseEntries("project", ["read", "grep"], [], false),
  ["read", "grep"],
  "项目还没配置：从全局选择出发，而不是空数组（空数组会停用全部）",
);

// ---- 5. 开关写入 ----
assert.deepEqual(
  toggleToolEntries({ scope: "global", globalEntries: undefined, projectEntries: undefined, projectConfigured: false, name: "grep", enabled: true }),
  ["read", "bash", "edit", "write", "grep"],
  "没配置时打开 grep：写出完整普通名单",
);
assert.deepEqual(
  toggleToolEntries({ scope: "global", globalEntries: undefined, projectEntries: undefined, projectConfigured: false, name: "write", enabled: false }),
  ["read", "bash", "edit"],
  "关掉默认工具",
);
assert.deepEqual(
  toggleToolEntries({
    scope: "project",
    globalEntries: ["+codemode"],
    projectEntries: ["-write"],
    projectConfigured: true,
    name: "grep",
    enabled: true,
  }),
  ["read", "bash", "edit", "codemode", "grep"],
  "在项目修饰符的基础上打开 grep",
);
assert.deepEqual(
  toggleToolEntries({
    scope: "global",
    globalEntries: ["read", "bash", "edit", "write", "mcp__radius__*", "myext"],
    projectEntries: undefined,
    projectConfigured: false,
    name: "write",
    enabled: false,
  }),
  ["read", "bash", "edit", "mcp__radius__*", "myext"],
  "目录外的条目（扩展工具 / MCP 模式）原样保留",
);
assert.deepEqual(
  toggleToolEntries({ scope: "project", globalEntries: ["read"], projectEntries: undefined, projectConfigured: false, name: "grep", enabled: true }),
  ["read", "grep"],
  "项目第一次保存：从全局选择出发，写完整清单",
);
assert.throws(
  () => toggleToolEntries({ scope: "global", globalEntries: [], projectEntries: [], projectConfigured: true, name: "read,write", enabled: true }),
  /工具名不合法/,
  "带逗号的名字会把 --tools 拆坏，必须拒绝",
);
assert.throws(
  () => toggleToolEntries({ scope: "global", globalEntries: [], projectEntries: [], projectConfigured: true, name: "+read", enabled: true }),
  /工具名不合法/,
  "写入的是普通名单，不接受 +/- 名字",
);

// ---- 6. 启动参数：用 +/- 校正已有会话 ----
const winArgs = toolModifierArguments(["read", "bash", "edit", "write"], "win32");
assert.deepEqual(winArgs[0], "--tools");
const winEntries = winArgs[1]!.split(",");
for (const name of ["read", "bash", "edit", "write"]) assert.ok(winEntries.includes(`+${name}`), `启用 ${name}`);
for (const name of ["powershell", "grep", "find", "ls", "codemode", "tool_search"]) {
  assert.ok(winEntries.includes(`-${name}`), `未启用的 ${name} 要显式关掉`);
}
const linuxEntries = toolModifierArguments(["read"], "linux")[1]!.split(",");
assert.ok(!linuxEntries.some((entry) => entry.endsWith("powershell")), "非 Windows 不传 powershell");
assert.ok(linuxEntries.includes("+read") && linuxEntries.includes("-bash"), "全量校正目录里的工具");
assert.deepEqual(
  toolModifierArguments([], "win32")[1]!.split(",").filter((entry) => entry.startsWith("+")),
  [],
  "全部停用时没有任何 +name",
);

// ---- 7. 设置页数据 ----
const plain = describeTools({ globalSettings: {}, projectSettings: {}, agentDir: "/agent", globalSettingsPath: "/agent/settings.json" });
assert.equal(plain.effectiveScope, "default");
assert.equal(plain.tools.find((tool) => tool.name === "read")?.enabled, true);
assert.equal(plain.tools.find((tool) => tool.name === "codemode")?.enabled, false);
assert.deepEqual(plain.extraEntries, []);
assert.equal(
  plain.tools.some((tool) => tool.name === "powershell"),
  process.platform === "win32",
  "powershell 只在 Windows 的目录里",
);
assert.ok(
  !describeTools({ globalSettings: {}, projectSettings: {}, platform: "linux" }).tools.some((tool) => tool.name === "powershell"),
  "非 Windows 不显示 powershell",
);

const fromProject = describeTools({
  globalSettings: { defaultTools: ["+codemode"] },
  projectSettings: { defaultTools: ["read", "mcp__radius__*"] },
});
assert.equal(fromProject.effectiveScope, "project");
assert.deepEqual(fromProject.enabledNames, ["read", "mcp__radius__*"], "项目普通名单覆盖全局");
assert.deepEqual(fromProject.extraEntries, ["mcp__radius__*"], "目录外条目单独列出来");
assert.equal(fromProject.tools.find((tool) => tool.name === "read")?.enabled, true);
assert.equal(fromProject.tools.find((tool) => tool.name === "codemode")?.enabled, false);

assert.deepEqual(extraToolEntries(["+codemode"], ["-write", "myext"]), ["myext"], "目录外的普通条目");

const untrusted = describeTools({ globalSettings: {}, projectSettings: {}, projectTrusted: false, projectWritable: false });
assert.equal(untrusted.projectTrusted, false);
assert.equal(untrusted.projectWritable, false, "未信任项目不能写项目级设置");

// ---- 8. 接线：宿主 / RPC / IPC / 设置页 ----
const root = path.resolve(import.meta.dirname, "../..");
const host = await readFile(path.join(root, "electron/pi-host.ts"), "utf8");
assert.ok(host.includes("toolModifierArguments(resolveSettingsTools"), "宿主启动参数要使用解析后的工具选择");
assert.ok(host.includes("projectTrustInfo"), "项目级设置要经过项目信任检查");
assert.equal(
  host.match(/args: await this\.toolArgs\(cwd\)/g)?.length,
  2,
  "正常 worker 与温备 worker 都要带工具校正参数",
);
assert.ok(host.includes("async toolsOverview(") && host.includes("async toolsSet("), "宿主应提供读 / 写工具开关的入口");

const rpc = await readFile(path.join(root, "electron/pi-rpc.ts"), "utf8");
assert.ok(rpc.includes("...(this.options.args ?? [])"), "RPC 客户端要把启动参数传给 Pi");

const main = await readFile(path.join(root, "electron/main.ts"), "utf8");
assert.ok(main.includes('"pi:tools-overview"') && main.includes('"pi:tools-set"'), "主进程要登记工具开关 IPC");

const preload = await readFile(path.join(root, "electron/preload.cts"), "utf8");
assert.ok(preload.includes("pi:tools-overview") && preload.includes("pi:tools-set"), "preload 要暴露工具开关");

const modal = await readFile(path.join(root, "packages/ui/src/components/overlays/SettingsModal.vue"), "utf8");
assert.ok(modal.includes("ToolSettings"), "设置页要挂上工具开关组件");

console.log(`pi-tools OK ${PI_TOOL_CATALOG.length} 个工具 / defaultTools 解析、合并、写入与启动参数`);
