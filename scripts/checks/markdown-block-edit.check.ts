import assert from "node:assert/strict";
import {
  appendTableRow,
  codeFenceParts,
  parseMarkdownTable,
  replaceCodeFenceBody,
  serializeMarkdownTable,
  setTableCell,
  splitTableRow,
} from "../../packages/ui/src/shared/markdown-block-edit.ts";

// 拆行：首尾竖线去掉，单元格 trim
assert.deepEqual(splitTableRow("| a | b |"), ["a", "b"]);
assert.deepEqual(splitTableRow("a | b"), ["a", "b"]);
assert.deepEqual(splitTableRow("| 只有一列 |"), ["只有一列"]);

// 解析：表头 / 对齐 / 数据行
const source = ["| 名字 | 说明 | 数量 |", "| :--- | :---: | ---: |", "| 甲 | 第一个 | 3 |", "| 乙 | 第二个 | 4 |"].join("\n");
const table = parseMarkdownTable(source);
assert.ok(table, "应能解析 GFM 表格");
assert.deepEqual(table.header, ["名字", "说明", "数量"]);
assert.deepEqual(table.aligns, ["left", "center", "right"]);
assert.deepEqual(table.rows, [["甲", "第一个", "3"], ["乙", "第二个", "4"]]);

// 不是表格
assert.equal(parseMarkdownTable("| a | b |"), null, "缺少分隔行");
assert.equal(parseMarkdownTable("| a | b |\n| --- |"), null, "分隔行列数不一致");
assert.equal(parseMarkdownTable("普通段落"), null);

// 序列化后能再解析回来（幂等）
const round = parseMarkdownTable(serializeMarkdownTable(table));
assert.deepEqual(round, table, "序列化后结构不变");

// 改单元格：表头（row=-1）与数据行
const renamed = parseMarkdownTable(setTableCell(source, -1, 0, "名称"))!;
assert.equal(renamed.header[0], "名称", "表头应改掉");
assert.deepEqual(renamed.rows, table.rows, "其它单元格不能被改");
const edited = parseMarkdownTable(setTableCell(source, 0, 2, "30"))!;
assert.equal(edited.rows[0]![2], "30", "数据行应改掉");
assert.equal(edited.rows[0]![1], "第一个", "同一行其它单元格不变");
assert.equal(setTableCell(source, 9, 0, "越界"), source, "越界行原样返回");
assert.equal(setTableCell(source, 0, 9, "越界"), source, "越界列原样返回");

// 单元格里写竖线要转义，写换行压成空格
const piped = setTableCell(source, 1, 1, "a | b");
assert.ok(piped.includes("a \\| b"), `竖线要转义：${piped}`);
assert.equal(parseMarkdownTable(piped)!.rows[1]![1], "a | b", "转义后解析回来还是原文");
const multiline = setTableCell(source, 1, 1, "第一行\n第二行");
assert.equal(parseMarkdownTable(multiline)!.rows[1]![1], "第一行 第二行", "单元格里的换行压成空格");

// 追加一行
const appended = appendTableRow(source);
assert.equal(appended.row, 2, "追加行的下标");
assert.equal(parseMarkdownTable(appended.source)!.rows.length, 3, "应多出一行");
assert.deepEqual(parseMarkdownTable(appended.source)!.rows[2], ["", "", ""], "新行是空单元格");

// 行宽不足时补齐（手写的表格常有）
const ragged = parseMarkdownTable(["| a | b |", "| --- | --- |", "| 1 |"].join("\n"));
assert.deepEqual(ragged!.rows[0], ["1", ""], "缺列要补齐");

// 围栏代码块：拆出围栏 / 语言 / 正文
const code = ["```ts", "const a = 1;", "const b = 2;", "```"].join("\n");
const parts = codeFenceParts(code);
assert.equal(parts.fence, "```");
assert.equal(parts.lang, "ts");
assert.equal(parts.body, "const a = 1;\nconst b = 2;");
assert.equal(codeFenceParts("```\n\n```").body, "", "空代码块正文为空");
assert.equal(codeFenceParts("````md\n```\n````").lang, "md", "四反引号围栏也要认");

// 只替换正文，围栏与语言不动
const updated = replaceCodeFenceBody(code, "const a = 3;");
assert.equal(updated, ["```ts", "const a = 3;", "```"].join("\n"), `应只改正文：${updated}`);
assert.equal(replaceCodeFenceBody(code, "第一行\n第二行\n\n"), ["```ts", "第一行", "第二行", "```"].join("\n"), "多行正文，去掉尾部空行");
assert.equal(replaceCodeFenceBody(code, ""), ["```ts", "```"].join("\n"), "清空正文");

console.log("markdown-block-edit OK 表格解析/序列化/改单元格/追加行/围栏正文替换");
