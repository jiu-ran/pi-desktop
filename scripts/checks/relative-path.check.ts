import assert from "node:assert/strict";
import {
  anchorOf,
  dirOf,
  isAbsolutePath,
  isAnchorLink,
  isRemoteSource,
  normalizeAnchor,
  normalizeRelative,
  relativize,
  resolveFrom,
  workspaceRelative,
} from "../../packages/ui/src/shared/relative-path.ts";

const cwd = "C:\\Users\\me\\proj";

// 目录与相对路径归一化
assert.equal(dirOf("docs/guide/a.md"), "docs/guide");
assert.equal(dirOf("a.md"), "");
assert.equal(dirOf("docs\\win\\a.md"), "docs/win", "反斜杠也要认");
assert.equal(normalizeRelative("a/./b/../c"), "a/c");
assert.equal(normalizeRelative("../x/y"), "../x/y", "越过根目录的 .. 要保留，便于调用方判断");
assert.equal(normalizeRelative("/a//b/"), "a/b");

// 以文件所在目录解析
assert.equal(resolveFrom("docs/guide", "images/a.png"), "docs/guide/images/a.png");
assert.equal(resolveFrom("docs/guide", "../img/a.png"), "docs/img/a.png");
assert.equal(resolveFrom("", "a.png"), "a.png");

// 绝对路径 → 工作区相对路径
assert.equal(isAbsolutePath("C:\\x\\y"), true);
assert.equal(isAbsolutePath("/x/y"), true);
assert.equal(isAbsolutePath("docs/a.md"), false);
assert.equal(relativize(cwd, "C:\\Users\\me\\proj\\img\\a.png"), "img/a.png");
assert.equal(relativize(cwd, "D:\\other\\a.png"), "", "工作区外的绝对路径要返回空");
assert.equal(relativize(cwd, "C:\\Users\\me\\proj"), "", "工作区根目录本身不是文件");

// 图片地址 → 工作区相对路径
assert.equal(workspaceRelative(cwd, "docs", "images/a.png"), "docs/images/a.png");
assert.equal(workspaceRelative(cwd, "", "img/a.png"), "img/a.png");
assert.equal(workspaceRelative(cwd, "docs", "../../outside.png"), "", "跑到工作区外面不读盘");
assert.equal(workspaceRelative(cwd, "docs", "https://x.com/a.png"), "", "远程地址不走读盘");
assert.equal(workspaceRelative(cwd, "docs", "data:image/png;base64,AAA"), "", "内联地址不走读盘");
assert.equal(workspaceRelative(cwd, "docs", "C:\\Users\\me\\proj\\a.png"), "a.png");

// 哪些地址可以直接放进 img src
assert.equal(isRemoteSource("https://x.com/a.png"), true);
assert.equal(isRemoteSource("data:image/png;base64,AAA"), true);
assert.equal(isRemoteSource("images/a.png"), false);

// 文档内锚点
assert.equal(isAnchorLink("#常见问题"), true);
assert.equal(isAnchorLink("https://x.com#a"), false);
assert.equal(anchorOf("#%E5%B8%B8%E8%A7%81"), "常见", "锚点要 URL 解码");
assert.equal(normalizeAnchor("## 常见 问题"), normalizeAnchor("常见-问题"));
assert.equal(normalizeAnchor("`code` 用法"), normalizeAnchor("code-用法"));
assert.equal(normalizeAnchor("中文，标点！"), normalizeAnchor("中文标点"));

console.log("relative-path OK 目录 / 相对路径 / 工作区换算 / 远程地址 / 锚点");
