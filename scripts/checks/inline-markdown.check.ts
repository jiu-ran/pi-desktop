import assert from "node:assert/strict";
import { escapeHtml, hasInlineMarkdown, renderInlineMarkdown } from "../../packages/ui/src/shared/inline-markdown.ts";

// 加粗：表格里 `**配色模式**` 必须变成 <strong>，不能原样露出星号
assert.equal(renderInlineMarkdown("**配色模式**"), "<strong>配色模式</strong>");
assert.equal(renderInlineMarkdown("取值 **加粗** 混排"), "取值 <strong>加粗</strong> 混排");
assert.equal(renderInlineMarkdown("__下划线加粗__"), "<strong>下划线加粗</strong>");

// 斜体 / 删除线
assert.equal(renderInlineMarkdown("*斜体*"), "<em>斜体</em>");
assert.equal(renderInlineMarkdown("~~删掉~~"), "<del>删掉</del>");
// 加粗优先，不能被拆成两个斜体
assert.equal(renderInlineMarkdown("**粗** 和 *斜*"), "<strong>粗</strong> 和 <em>斜</em>");

// 行内代码：内容是原样文本，里面的星号不参与解析
assert.equal(renderInlineMarkdown("`--accent`"), "<code>--accent</code>");
assert.equal(renderInlineMarkdown("`a*b*c`"), "<code>a*b*c</code>");
assert.equal(renderInlineMarkdown("`x` 与 **粗**"), "<code>x</code> 与 <strong>粗</strong>");
assert.equal(
  renderInlineMarkdown("`--accent`", { codeClass: "cm-md-inlinecode" }),
  '<code class="cm-md-inlinecode">--accent</code>',
);

// 链接：只放行 http(s) / mailto / 锚点 / 相对路径
assert.equal(renderInlineMarkdown("[文档](https://example.com/a)"), '<a href="https://example.com/a">文档</a>');
assert.equal(renderInlineMarkdown("[锚](#标题)"), '<a href="#标题">锚</a>');
assert.equal(renderInlineMarkdown("[文件](./a.md)"), '<a href="./a.md">文件</a>');
assert.equal(renderInlineMarkdown("[坏](javascript:alert(1))"), "[坏](javascript:alert(1))", "危险链接不解析");
assert.equal(
  renderInlineMarkdown("[**粗体链接**](https://example.com)"),
  '<a href="https://example.com"><strong>粗体链接</strong></a>',
);

// 图片：地址安全才渲染
assert.equal(renderInlineMarkdown("![图](./a.png)"), '<img alt="图" src="./a.png">');

// 注入防护：任何输入都不能变成标签
assert.equal(renderInlineMarkdown("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
assert.equal(renderInlineMarkdown('**<b>x</b>**'), "<strong>&lt;b&gt;x&lt;/b&gt;</strong>");
assert.equal(renderInlineMarkdown("a & b"), "a &amp; b");
assert.equal(escapeHtml('"x" & <y>'), "&quot;x&quot; &amp; &lt;y&gt;");

// 没写完整/不成对的标记保持原样（不能把星号吃掉）
assert.equal(renderInlineMarkdown("2 * 3 = 6"), "2 * 3 = 6");
assert.equal(renderInlineMarkdown("** 空 **"), "** 空 **");
assert.equal(renderInlineMarkdown("snake_case_name"), "snake_case_name", "标识符里的下划线不加斜体");
assert.equal(renderInlineMarkdown(""), "");

// hasInlineMarkdown：用来判断编辑时要不要露源码
assert.equal(hasInlineMarkdown("纯文本"), false);
assert.equal(hasInlineMarkdown("**加粗**"), true);

console.log("inline-markdown OK");
