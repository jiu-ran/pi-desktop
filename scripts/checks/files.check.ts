import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { PiHost } from "../../electron/pi-host.ts";

const root = await mkdtemp(path.join(tmpdir(), "pi-desktop-files-"));
const external = `${root}-outside.txt`;
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
  // 最小 1x1 PNG：验证图片按 data URL 预览，而不会当文本读出乱码
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(path.join(root, "logo.png"), png);
  const image = await host.readWorkspaceFile(root, "logo.png");
  assert(image.binary === true && image.content === "", "图片不应按文本读取");
  assert(image.preview?.mimeType === "image/png" && image.preview.dataUrl.startsWith("data:image/png;base64,"), "图片应返回 data URL 预览");
  assert(image.preview.dataUrl.split(",")[1] === png.toString("base64"), "图片预览内容应与文件一致");
  // 扩展名不可靠时按文件头识别
  await writeFile(path.join(root, "mislabeled.txt"), png);
  const sniffed = await host.readWorkspaceFile(root, "mislabeled.txt");
  assert(sniffed.preview?.mimeType === "image/png", "应按文件头识别图片类型");
  // 非图片的二进制文件只提示，不渲染乱码
  await writeFile(path.join(root, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x00, 0x33]));
  const blob = await host.readWorkspaceFile(root, "blob.bin");
  assert(blob.binary === true && blob.preview === undefined && blob.content === "", "二进制文件不应按文本读取");
  let imageSave = false;
  try { await host.writeWorkspaceFile(root, "logo.png", "text"); } catch { imageSave = true; }
  assert(imageSave, "图片不应允许在文本编辑器里覆盖保存");

  const opened = await host.readWorkspaceFile(root, "src/main.ts");
  assert(opened.content.includes("export {}"), "应读取文件内容");
  const saved = await host.writeWorkspaceFile(root, "src/main.ts", "export const changed = true;\n");
  assert(saved.content.includes("changed"), "保存应返回更新后的内容");
  const reopened = await host.readWorkspaceFile(root, "src/main.ts");
  assert(reopened.content.includes("changed"), "保存后磁盘文件应更新");

  await writeFile(external, "outside");
  const externalOpened = await host.readWorkspaceFile(root, external);
  assert(externalOpened.content === "outside" && externalOpened.path === external, "绝对路径文件应允许读取");
  const externalSaved = await host.writeWorkspaceFile(root, external, "outside changed");
  assert(externalSaved.content === "outside changed", "绝对路径文件应允许保存");
  assert(await host.openWorkspacePath(root, external) === external, "绝对路径文件应允许打开");

  let rejected = false;
  try { await host.writeWorkspaceFile(root, "../outside.txt", "nope"); } catch { rejected = true; }
  assert(rejected, "不应允许写入项目目录外路径");
  rejected = false;
  try { await host.prepareAttachments(root, [path.join(path.dirname(root), "outside.txt")]); } catch { rejected = true; }
  assert(rejected, "不应允许添加项目目录外附件");
  rejected = false;
  try { await host.listDirectory(root, "../"); } catch { rejected = true; }
  assert(rejected, "不应允许查看项目目录外的路径");
  rejected = false;
  try { await host.openWorkspacePath(root, "missing.ts"); } catch { rejected = true; }
  assert(rejected, "不存在的文件不应打开");
  const git = await host.gitOverview(process.cwd());
  assert(git.isRepo && git.commits.length > 0, "应读取 Git 仓库分支与提交树");
  const commitDetail = await host.gitInspect(process.cwd(), "commit", git.commits[0].hash);
  assert(commitDetail.kind === "commit" && commitDetail.meta.length > 0, "应读取 Git 提交详情");
  console.log("files", top.length, nested.length, "git", git.branch, git.commits.length);
  console.log("OK");
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(external, { force: true });
}
