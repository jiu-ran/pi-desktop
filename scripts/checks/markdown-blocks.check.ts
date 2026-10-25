import assert from "node:assert/strict";
import {
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

// front matter 单独一块
{
  const doc = ["---", "title: 文档", "---", "", "# 正文标题"].join("\n");
  assert.deepEqual(kinds(doc), ["frontmatter", "heading"], `front matter 切错了：${kinds(doc).join("/")}`);
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

console.log("markdown-blocks OK 切块 / setext / loose list / front matter / 替换");
