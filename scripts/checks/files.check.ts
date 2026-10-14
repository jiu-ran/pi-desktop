import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PiHost } from "../../electron/pi-host.ts";

const root = await mkdtemp(path.join(tmpdir(), "pi-desktop-files-"));
try {
  await mkdir(path.join(root, "src", "nested"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "hello");
  await writeFile(path.join(root, "src", "main.ts"), "export {};");
  const host = new PiHost({ emit() {} });
  const top = await host.listDirectory(root, "");
  const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
  assert(top[0].kind === "folder" && top[0].name === "src", "目录应排在文件前");
  assert(top.some((item) => item.name === "README.md"), "应列出根目录文件");
  const nested = await host.listDirectory(root, "src");
  assert(nested.some((item) => item.relative === "src/main.ts"), "应列出子目录文件");
  const opened = await host.readWorkspaceFile(root, "src/main.ts");
  assert(opened.content.includes("export {}"), "应读取文件内容");
  const saved = await host.writeWorkspaceFile(root, "src/main.ts", "export const changed = true;\n");
  assert(saved.content.includes("changed"), "保存应返回更新后的内容");
  const reopened = await host.readWorkspaceFile(root, "src/main.ts");
  assert(reopened.content.includes("changed"), "保存后磁盘文件应更新");
  let rejected = false;
  try { await host.writeWorkspaceFile(root, "../outside.txt", "nope"); } catch { rejected = true; }
  assert(rejected, "不应允许写入项目目录外路径");
  rejected = false;
  try { await host.listDirectory(root, "../"); } catch { rejected = true; }
  assert(rejected, "不应允许查看项目目录外的路径");
  rejected = false;
  try { await host.openWorkspacePath(root, "missing.ts"); } catch { rejected = true; }
  assert(rejected, "不存在的文件不应打开");
  console.log("files", top.length, nested.length);
  console.log("OK");
} finally {
  await rm(root, { recursive: true, force: true });
}
