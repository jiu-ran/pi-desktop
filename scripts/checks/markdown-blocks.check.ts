import assert from "node:assert/strict";
import {
  rendersBlock,
  replaceMarkdownBlock,
  splitMarkdownBlocks,
} from "../../packages/ui/src/shared/markdown-blocks.ts";

const kinds = (source: string) => splitMarkdownBlocks(source).map((block) => block.kind);
const texts = (source: string) => splitMarkdownBlocks(source).map((block) => block.text);

// 基本结构：标题 / 段落 / 列表 / 代码 / 表格 / 引用 / 分割线
{
  const doc = [
    "# 标题",
    "",
    "第一段文字。",
    "",
    "- 甲",
    "- 乙",
    "",
    "```js",
    "const a = 1;",
    "",
    "const b = 2;",
    "```",
    "",
    "| 列 A | 列 B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "> 引用一行",
    "> 引用第二行",
    "",
    "---",
    "",
    "结尾段落。",
  ].join("\n");
  assert.deepEqual(
    kinds(doc),
    ["heading", "paragraph", "list", "code", "table", "quote", "hr", "paragraph"],
    `块类型切错了：${kinds(doc).join("/")}`,
  );
  assert.equal(splitMarkdownBlocks(doc).length, 8, "顶层块数量应与渲染节点一致");
  // 代码块里的空行不能把块切开
  assert.match(texts(doc)[3], /const a = 1;[\s\S]*const b = 2;/, "代码块应保持完整");
}

// setext 标题（下一行 === / ---）属于上一个块
{
  const doc = ["标题一", "=====", "", "标题二", "-----", "", "正文"].join("\n");
  assert.deepEqual(kinds(doc), ["heading", "heading", "paragraph"], `setext 切错了：${kinds(doc).join("/")}`);
}

// loose list：列表项之间的空行不切块
{
  const doc = ["- 甲", "", "- 乙", "", "- 丙", "", "正文"].join("\n");
  const blocks = splitMarkdownBlocks(doc);
  assert.equal(blocks.length, 2, `loose list 应是一个块，实际 ${blocks.length}：${blocks.map((b) => b.kind).join("/")}`);
  assert.equal(blocks[0].kind, "list");
}

// 列表后面的标题要断开
{
  const doc = ["- 甲", "- 乙", "## 小标题"].join("\n");
  assert.deepEqual(kinds(doc), ["list", "heading"], `列表后跟标题应断开：${kinds(doc).join("/")}`);
}

// 文档开头的 --- 是分割线，紧跟着的 --- 对上一行是 setext（和渲染器一致：
// markstream 不解析 YAML front matter，会渲染成「分割线 + 标题」）
{
  const doc = ["---", "title: 文档", "---", "", "# 正文标题"].join("\n");
  assert.deepEqual(kinds(doc), ["hr", "heading", "heading"], `开头 front matter 该按渲染器切：${kinds(doc).join("/")}`);
}

// 链接引用定义：连续几条算一块，且标记为「渲染结果里不占节点」
{
  const doc = ["正文见 [文档][d1]。", "", "[d1]: https://example.com", "[d2]: https://example.com/2", ""].join("\n");
  const blocks = splitMarkdownBlocks(doc);
  assert.deepEqual(blocks.map((block) => block.kind), ["paragraph", "linkref"], `链接定义切错了：${kinds(doc)}`);
  assert.equal(rendersBlock(blocks[0]), true, "正文块要参与对齐");
  assert.equal(rendersBlock(blocks[1]), false, "链接引用定义不占渲染节点，必须跳过");
  // 脚注定义是内容（会渲染成脚注区），不能被当成链接定义
  const footnote = ["正文[^1]。", "", "[^1]: 脚注内容"].join("\n");
  assert.deepEqual(splitMarkdownBlocks(footnote).map((block) => block.kind), ["paragraph", "paragraph"], "脚注定义不该被当成链接定义");
  // 链接定义夹在段落中间时仍属于同一块（渲染器也把它并进段落里去掉）
  const inline = ["正文一行", "[d3]: https://example.com/3", "", "下一段"].join("\n");
  assert.equal(splitMarkdownBlocks(inline).length, 2, "段落中间的链接定义不该切开段落");
}

// 段落内的软换行（没有空行）属于同一块
{
  const doc = ["第一行", "第二行", "", "另起一段"].join("\n");
  assert.equal(splitMarkdownBlocks(doc).length, 2, "软换行不该切块");
}

// 替换块：只改目标块，前后原文保持不变（含缩进与空行）
{
  const doc = ["# 标题", "", "第一段。", "", "第二段。", ""].join("\n");
  const blocks = splitMarkdownBlocks(doc);
  const next = replaceMarkdownBlock(doc, blocks[1], "改过的第一段。");
  assert.equal(next, ["# 标题", "", "改过的第一段。", "", "第二段。", ""].join("\n"), `替换结果不对：${JSON.stringify(next)}`);
  // 替换成多行也要保留结构
  const multi = replaceMarkdownBlock(doc, blocks[1], "第一行\n第二行");
  assert.equal(multi, ["# 标题", "", "第一行", "第二行", "", "第二段。", ""].join("\n"));
}

// 空文档 / 只有空行
assert.deepEqual(splitMarkdownBlocks(""), []);
assert.deepEqual(splitMarkdownBlocks("\n\n  \n"), []);

// CRLF 文档也要能对齐（偏移量按原文字符算）
{
  const doc = "# 标题\r\n\r\n段落。\r\n";
  const blocks = splitMarkdownBlocks(doc);
  assert.equal(blocks.length, 2, `CRLF 文档切块数量不对：${blocks.length}`);
  assert.equal(blocks[0].text, "# 标题");
  assert.equal(blocks[1].text, "段落。");
  const next = replaceMarkdownBlock(doc, blocks[1], "新段落。");
  assert.ok(next.includes("新段落。"), "替换应生效");
  assert.ok(next.endsWith("\r\n"), "块外的换行不能被吃掉");
}

console.log("markdown-blocks OK 切块 / setext / loose list / 链接引用定义 / 替换");
