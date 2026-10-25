import assert from "node:assert/strict";
import { parser, GFM } from "@lezer/markdown";
import { collectLiveSpans, type LiveRulesContext, type LiveSpan } from "../../packages/ui/src/plugins/markdown/live-preview-rules.ts";

/**
 * 实时预览的「标记收放」规则（纯函数）。
 * 这里断言的是：光标所在行显示标记、其它行收起标记、以及哪些内容套什么样式。
 */
const md = parser.configure(GFM);

function spansFor(doc: string, activeLine = -1): LiveSpan[] {
  const lines = doc.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const lineAt = (pos: number) => {
    let index = 0;
    for (let i = 0; i < lineStarts.length; i += 1) {
      if (pos >= lineStarts[i]) index = i;
    }
    const start = lineStarts[index];
    const text = lines[index] ?? "";
    return { from: start, to: start + text.length, number: index };
  };
  const ctx: LiveRulesContext = {
    isActiveLine: (pos) => (activeLine < 0 ? false : lineAt(pos).number === activeLine),
    isActiveRange: (from, to) => (activeLine < 0 ? false : lineAt(from).number <= activeLine && lineAt(to).number >= activeLine),
    lineAt,
    charAt: (pos) => (pos >= 0 && pos < doc.length ? doc[pos] : ""),
    slice: (from, to) => doc.slice(from, to),
  };
  return collectLiveSpans(md.parse(doc), ctx);
}

const hidden = (spans: LiveSpan[], doc: string) =>
  spans.filter((span) => span.hide).map((span) => doc.slice(span.from, span.to));
const classes = (spans: LiveSpan[]) => spans.filter((span) => span.cls).map((span) => span.cls);
const blocks = (spans: LiveSpan[]) => spans.filter((span) => span.block).map((span) => span.block);
const lineClasses = (spans: LiveSpan[]) => spans.filter((span) => span.line).map((span) => span.line);

// 标题：非活动行收起 `# `，活动行显示为淡色标记
{
  const doc = "# 标题\n\n正文";
  assert.deepEqual(hidden(spansFor(doc), doc), ["# "], `非活动行要收起标题标记：${JSON.stringify(hidden(spansFor(doc), doc))}`);
  assert.ok(lineClasses(spansFor(doc)).includes("cm-md-h1"), "标题行要带 h1 样式");
  const active = spansFor(doc, 0);
  assert.deepEqual(hidden(active, doc), [], "活动行不能收起标记");
  assert.ok(classes(active).includes("cm-md-mark"), "活动行的标记要变淡而不是消失");
}

// 加粗 / 斜体 / 删除线 / 行内代码：收起标记，内容套样式
{
  const doc = "文本 **粗** *斜* ~~删~~ `code` 结束";
  const spans = spansFor(doc);
  assert.deepEqual(hidden(spans, doc), ["**", "**", "*", "*", "~~", "~~", "`", "`"], `行内标记要收起：${JSON.stringify(hidden(spans, doc))}`);
  // 收起标记不能把词间的空格一起吃掉
  const visible = doc.replace(/\*\*|\*|~~|`/g, "");
  assert.ok(visible.includes("粗 斜"), `词间空格要保留：「${visible}」`);
  const cls = classes(spans);
  for (const need of ["cm-md-strong", "cm-md-em", "cm-md-strike", "cm-md-inlinecode"]) {
    assert.ok(cls.includes(need), `缺少 ${need}`);
  }
  const strong = spans.find((span) => span.cls === "cm-md-strong");
  assert.equal(doc.slice(strong.from, strong.to), "粗", "加粗样式要正好盖住内容");
}

// 链接：只留文字，地址收起；没解析到地址的 [xxx] 原样保留
{
  const doc = "看 [文档](https://example.com) 和 [0.3.2]";
  const spans = spansFor(doc);
  const hiddenText = hidden(spans, doc).join("");
  assert.ok(hiddenText.includes("https://example.com"), `链接地址要收起：${JSON.stringify(hidden(spans, doc))}`);
  const link = spans.find((span) => span.cls === "cm-md-link");
  assert.equal(doc.slice(link.from, link.to), "文档", "链接样式只盖住文字");
  const bracket = spans.filter((span) => span.hide && doc.slice(span.from, span.to) === "[");
  assert.equal(bracket.length, 1, "只有真链接的方括号才收起，[0.3.2] 要保留");
}

// 列表：无序列表的 `- ` 换成圆点，有序列表的序号保留
{
  const doc = "- 甲\n- 乙\n\n1. 丙";
  const spans = spansFor(doc);
  assert.equal(spans.filter((span) => span.widget === "bullet").length, 2, "两个无序列表项都要变成圆点");
  // 有序列表的 1. 既不能变成圆点，也不能被收起（否则看不到序号），只是变淡
  const afterOrdered = spans.filter((span) => span.from >= doc.indexOf("1."));
  assert.deepEqual(afterOrdered.filter((span) => span.widget || span.hide), [], "有序列表的序号既不该变圆点，也不该被收起");
  assert.ok(afterOrdered.some((span) => span.cls === "cm-md-mark"), "有序序号要用淡色标记");
}

// 代码块 / 表格 / 分割线：整块交给 widget，光标进去就回到源码
{
  const doc = "```ts\nconst a = 1;\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n---\n";
  const idle = spansFor(doc);
  assert.deepEqual(blocks(idle), ["code", "table", "hr"], `应有三处块级渲染：${JSON.stringify(blocks(idle))}`);
  const codeSpan = idle.find((span) => span.block === "code");
  assert.equal(codeSpan.lang, "ts", `代码块要带语言：${codeSpan.lang}`);

  const inCode = spansFor(doc, 1);
  assert.deepEqual(blocks(inCode), ["table", "hr"], "光标进代码块后不再用 widget");
  assert.ok(lineClasses(inCode).includes("cm-md-coderaw"), "光标在代码块里时按源码显示");

  const inTable = spansFor(doc, 5);
  assert.deepEqual(blocks(inTable), ["code", "hr"], "光标进表格后不再用 widget");
}

// 引用块：每行都带竖线样式，`>` 收起
{
  const doc = "> 第一行\n> 第二行";
  const spans = spansFor(doc);
  assert.equal(spans.filter((span) => span.line === "cm-md-quote").length, 2, "引用块每行都要带竖线样式");
  assert.deepEqual(hidden(spans, doc), ["> ", "> "], `引用标记要收起：${JSON.stringify(hidden(spans, doc))}`);
}

// setext 标题的 === / --- 单独占一行，收起来会留空行，所以保持淡色显示
{
  const doc = "标题\n===";
  const spans = spansFor(doc);
  assert.deepEqual(hidden(spans, doc), [], "setext 下划线不该被收起");
  assert.ok(lineClasses(spans).includes("cm-md-h1"), "setext 也要按 h1 排版");
}

// 裸链接（自动链接）是正文，不能当标记收起
{
  const doc = "见 https://example.com 说明";
  const spans = spansFor(doc);
  assert.equal(spans.some((span) => span.hide), false, "自动链接不能被收起");
}

console.log("live-preview OK 标记收放 / 行内样式 / 链接 / 列表 / 块级 widget / 引用 / setext");
