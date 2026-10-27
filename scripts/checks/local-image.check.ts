import assert from "node:assert/strict";
import { imageRef, imageTargets, replaceImageTargets } from "../../packages/ui/src/shared/local-image.ts";

/**
 * 聊天里贴本地图片：`![](C:\Users\…\a.png)` 以前被 Chromium 当成相对 URL，
 * 结果是「Image failed to load」。这里钉住「哪些算本地文件、路径怎么归一」。
 */

// 1) 远程地址原样交给浏览器
for (const src of [
  "https://example.com/a.png",
  "http://example.com/a.png",
  "//cdn.example.com/a.png",
  "data:image/png;base64,AAAA",
  "blob:http://localhost/xxxx",
  "#anchor",
  "",
  "   ",
]) {
  assert.deepEqual(imageRef(src), { kind: "remote" }, `应交给浏览器：${src}`);
}

// 2) Windows 绝对路径（反斜杠 / 正斜杠 / 小写盘符）
for (const src of [
  "C:\\Users\\jiuran\\Desktop\\a.png",
  "C:/Users/jiuran/Desktop/a.png",
  "d:\\work\\shot 1.png",
]) {
  const ref = imageRef(src);
  assert.equal(ref.kind, "local", `应是本地文件：${src}`);
  assert.equal(ref.absolute, true, `应是绝对路径：${src}`);
  assert.equal(ref.path, src, `路径不该被改写：${src}`);
}

// 3) UNC 路径（反斜杠与正斜杠两种写法都当绝对路径）
for (const src of ["\\\\server\\share\\a.png", "//server/share/a.png"]) {
  const ref = imageRef(src);
  assert.equal(ref.kind, "local", `UNC 应是本地文件：${src}`);
  assert.equal(ref.absolute, true, `UNC 应是绝对路径：${src}`);
}

// 4) POSIX 绝对路径
{
  const ref = imageRef("/home/me/a.png");
  assert.deepEqual(ref, { kind: "local", path: "/home/me/a.png", absolute: true });
}

// 5) file:// URL → 普通路径（含百分号转义与 drive 前的多余斜杠）
function local(src: string) {
  const ref = imageRef(src);
  assert.equal(ref.kind, "local", `应是本地文件：${src}`);
  if (ref.kind !== "local") throw new Error("unreachable");
  return ref;
}
assert.equal(local("file:///C:/Users/me/a%20b.png").path, "C:/Users/me/a b.png");
assert.equal(local("file:///C:/Users/me/a%20b.png").absolute, true);
assert.equal(local("file:///home/me/a.png").path, "/home/me/a.png");
assert.equal(local("file://server/share/a.png").path, "//server/share/a.png");
assert.equal(local("file://server/share/a.png").absolute, true);
// 转义坏了也不能炸
assert.equal(local("file:///C:/a%E0%A4%A.png").kind, "local");

// 6) 相对路径：留给主进程按工作区解析，不能自己拼
for (const src of ["images/a.png", "./a.png", "../shared/a.png"]) {
  const ref = imageRef(src);
  assert.equal(ref.kind, "local", `相对路径也是本地文件：${src}`);
  assert.equal(ref.absolute, false, `相对路径不该被当成绝对：${src}`);
  assert.equal(ref.path, src);
}

console.log("local-image OK 远程 vs 本地 / 盘符 / UNC / POSIX / file URL / 相对路径");

// 7) 从 markdown 里挑出图片地址：位置要准，换回去不能伤到别的字符
{
  const winPath = String.raw`C:\a\b.png`;
  const spacedPath = String.raw`C:\x y\c.png`;
  const md = `前言 ![图一](${winPath}) 中间 ![图二](<${spacedPath}> "标题") ![远程](https://e.com/d.png)`;
  const targets = imageTargets(md);
  assert.deepEqual(
    targets.map((item) => item.src),
    [winPath, spacedPath, "https://e.com/d.png"],
    `地址要按顺序挑干净：${JSON.stringify(targets)}`,
  );
  for (const target of targets) {
    assert.equal(md.slice(target.start, target.end), target.src, `位置要正好盖住 URL：${JSON.stringify(target)}`);
  }
  // 只换本地的两张；替换后其它文字与远程图原样保留
  const replaced = replaceImageTargets(
    md,
    targets
      .filter((item) => imageRef(item.src).kind === "local")
      .map((target) => ({ target, text: "data:image/png;base64,AA" })),
  );
  assert.equal(
    replaced,
    // 带尖括号的写法只换括号里的地址（base64 里没有空格，渲染一样）
    `前言 ![图一](data:image/png;base64,AA) 中间 ![图二](<data:image/png;base64,AA> "标题") ![远程](https://e.com/d.png)`,
    `只换本地图片，其它不动：${replaced}`,
  );
  assert.deepEqual(imageTargets("没有图片的 ![文字] 段落"), [], "不是图片语法就什么都不返回");
  assert.deepEqual(imageTargets("![空]()").length, 0, "空地址跳过");
}
