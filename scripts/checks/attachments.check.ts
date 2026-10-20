import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PiHost } from "../../electron/pi-host.ts";

const root = await mkdtemp(path.join(tmpdir(), "pi-desktop-attach-"));
const project = path.join(root, "project");
const folder = path.join(project, "sample");
await mkdir(path.join(folder, "src"), { recursive: true });
await mkdir(path.join(folder, "node_modules"), { recursive: true });
await writeFile(path.join(folder, "README.md"), "hello attachment");
await writeFile(path.join(folder, "src", "main.ts"), "export const ok = true;");
await writeFile(path.join(folder, "node_modules", "ignored.js"), "skip");
const text = path.join(project, "note.md");
const image = path.join(project, "cover.png");
const binary = path.join(project, "archive.bin");
await writeFile(text, "# hello\nbody");
await writeFile(image, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
await writeFile(binary, Buffer.from([0, 1, 2, 255]));
// 所有文本文件都只传路径，不再内联内容（无论大小）
const large = path.join(project, "large.log");
await writeFile(large, "error line\n".repeat(6000));
const parts = [1, 2, 3, 4].map((index) => path.join(project, `part${index}.log`));
for (const [index, part] of parts.entries()) await writeFile(part, String(index + 1).repeat(30 * 1024));

try {
  const host = new PiHost({ emit() {} });
  const prepared = await host.prepareAttachments(project, [text, image, folder, binary]);
  const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
  assert(prepared.items.length === 4, "应保留 4 个附件标签");
  assert(prepared.items[0].kind === "file", "文本文件类型应为 file");
  assert(!prepared.text.includes("# hello\nbody"), "小文本文件也不应把内容写进上下文");
  assert(prepared.text.includes(text) && prepared.text.includes('inline="false"'), "小文本文件应只传路径并标记未内联");
  assert(prepared.items[0].inlined === false, "小文本文件也应标记为未内联");
  assert(prepared.images.length === 1 && prepared.images[0].mimeType === "image/png", "PNG 应作为 image 传递");
  assert(prepared.text.includes("src\\main.ts") || prepared.text.includes("src/main.ts"), "文件夹附件应含递归目录树");
  assert(!prepared.text.includes("ignored.js"), "目录树应跳过 node_modules");
  assert(prepared.text.includes("二进制文件"), "二进制文件应有说明而非解码成乱码");
  assert(prepared.items[3].inlined === false, "二进制文件应标记为未内联");

  const big = await host.prepareAttachments(project, [large]);
  assert(big.items[0].inlined === false, "大文本不应内联");
  assert(big.items[0].size === 66000, "附件大小应回传前端");
  assert(!big.text.includes("error line"), "大文件内容不应进入上下文");
  assert(big.text.includes('inline="false"') && big.text.includes("read 工具"), "大文件应提示模型用工具读取");
  assert(big.text.includes(large), "大文件仍应带上完整路径");

  const many = await host.prepareAttachments(project, parts);
  assert(many.items.every((item) => item.inlined === false), "所有文本附件都应标记为未内联");
  assert(parts.every((part, index) => !many.text.includes(String(index + 1).repeat(30 * 1024))), "任何文件内容都不应进入上下文");
  assert(parts.every((part) => many.text.includes(part)), "每个附件都应带上完整路径");
  assert(many.text.includes("read 工具"), "每个文本附件都应提示用 read 工具读取");
  assert(!/你是|系统提示|隐藏指令|ignore previous instructions/i.test(prepared.text), "附件文本不得包含桌面端添加的任务指令");
  assert(prepared.text.startsWith("<file ") || prepared.text.startsWith("<directory "), "附件文本只能以文件或目录边界开始");
  let rejected = false;
  try { await host.prepareAttachments(project, [path.join(project, "missing.txt")]); } catch { rejected = true; }
  assert(rejected, "不存在的附件应返回错误");
  console.log("attachments", prepared.items.length, "images", prepared.images.length);
  console.log("OK");
} finally {
  await rm(root, { recursive: true, force: true });
}
