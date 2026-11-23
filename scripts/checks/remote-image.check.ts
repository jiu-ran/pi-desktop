import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderInlineMarkdown } from "../../packages/ui/src/shared/inline-markdown.ts";
import { buildSessionBlock, extractSessionBody } from "../../packages/ui/src/shared/session-block.ts";

/**
 * 远程图片与几处「不要让界面自作主张」的约定：
 * - 对话 / 表格里的 http(s) 图片默认只给占位，点一下才加载（否则一条消息就能把本机 IP、
 *   Referer、阅读行为送给任意图床）；
 * - CSP 的 img-src 不再放行明文 http:；
 * - 设置项默认关闭，且真的存在；
 * - transcript 的有上限累积 / 本地图片读取失败不缓存，这些容易被后续重构悄悄改掉。
 */

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

// 1) 表格单元格（行内 markdown）：远程图片默认不加载
{
  const blocked = renderInlineMarkdown("![shot](https://img.example.com/a.png)");
  assert.match(blocked, /class="md-remote-image"/, blocked);
  assert.match(blocked, /data-remote-url="https:\/\/img\.example\.com\/a\.png"/, blocked);
  assert.match(blocked, /点击加载远程图片 \(img\.example\.com\)/, blocked);
  assert.ok(!blocked.includes("<img"), `默认不该输出 <img>：${blocked}`);

  // 协议相对地址同样是外网请求
  const protocolRelative = renderInlineMarkdown("![x](//cdn.example.com/b.png)");
  assert.ok(!protocolRelative.includes("<img"), protocolRelative);

  // 设置里打开「自动加载远程图片」后才直接输出 <img>
  const allowed = renderInlineMarkdown("![shot](https://img.example.com/a.png)", { allowRemoteImages: true });
  assert.match(allowed, /<img alt="shot" src="https:\/\/img\.example\.com\/a\.png">/, allowed);

  // data: 本来就不在白名单里（SAFE_HREF 只放行 http(s)/mailto/#/相对路径），保持原样
  assert.equal(renderInlineMarkdown("![a](data:image/png;base64,AA)"), "![a](data:image/png;base64,AA)");
  // 工作区里的相对路径不受影响：由宿主按工作区读盘
  assert.match(renderInlineMarkdown("![a](./a.png)"), /<img alt="a" src="\.\/a\.png">/);
}

// 2) CSP：img-src 保留 https: / data: / blob:，但不给 http:
{
  const html = read("packages/ui/index.html");
  const meta = /content="([^"]*img-src[^"]*)"/.exec(html);
  assert.ok(meta, "index.html 里应有 CSP");
  const imgSrc = /img-src([^;]*);/.exec(meta![1]!)![1]!.trim();
  assert.ok(imgSrc.split(/\s+/).includes("https:"), `img-src 应放行 https：${imgSrc}`);
  assert.ok(!imgSrc.split(/\s+/).includes("http:"), `img-src 不该放行明文 http：${imgSrc}`);
  for (const scheme of ["data:", "blob:", "'self'"]) {
    assert.ok(imgSrc.split(/\s+/).includes(scheme), `img-src 应保留 ${scheme}：${imgSrc}`);
  }
}

// 3) 设置项：默认关闭、可持久化
{
  const settings = read("packages/ui/src/services/settings.ts");
  assert.match(settings, /autoLoadRemoteImages: boolean/, "AppSettings 里应有 autoLoadRemoteImages");
  assert.match(settings, /autoLoadRemoteImages: false,/, "远程图片自动加载默认必须关闭");
  assert.match(settings, /typeof parsed\.autoLoadRemoteImages === "boolean"/, "读取设置时要校验类型");
  assert.match(read("packages/ui/src/components/overlays/settings/ConversationSettings.vue"), /自动加载远程图片/);
}

// 4) 界面接上新的宿主接口，并且读失败不缓存
{
  const body = read("packages/ui/src/plugins/markdown/MarkdownBody.vue");
  assert.match(body, /workbench\s*\.readLocalImage\(/, "对话图片应走专用的 ReadLocalImage");
  assert.ok(!/workbench[\s\S]{0,40}readWorkspaceFile\(imagePath\)/.test(body), "不该再用 ReadWorkspaceFile 读图");
  assert.match(body, /imageCache\.delete\(imagePath\)/, "读失败的结果要被移出缓存");
  assert.match(body, /点击加载远程图片/, "MarkdownBody 也要有远程图片占位");
}

// 5) transcript：bash 输出只留最后 1MB，工具参数累积到 256KB 就停
{
  const transcript = read("packages/ui/src/kernel/transcript.ts");
  assert.match(transcript, /const BASH_OUTPUT_MAX = 1024 \* 1024;/, "bash 输出上限应为 1MB");
  assert.match(transcript, /const STREAMED_ARGS_MAX = 256 \* 1024;/, "流式参数上限应为 256KB");
  assert.match(transcript, /next\.slice\(next\.length - BASH_OUTPUT_MAX\)/, "应保留最后 1MB 并截掉前面");
  assert.match(transcript, /block\.truncated = true/, "截断后要标记 truncated");
  assert.ok(!/\{\s*\.\.\.\(block\.details \?\? \{\}\), streamedArgs/.test(transcript), "不该每帧复制整个 details");
}

// 6) MCP 表单的「留空即保留」说明
{
  const mcp = read("packages/ui/src/components/overlays/settings/McpSettings.vue");
  const hits = mcp.split("留空表示保留原值；要清除某项请删除整行。").length - 1;
  assert.equal(hits, 2, `env 与 headers 两个输入框都要带说明，实际 ${hits} 处`);
}

// 7) 引用会话块：正文里的 </session> 被宿主转义后，前端仍能完整取回正文
{
  const body = '第一行\n后面提到 &lt;/session&gt; 但不能提前结束\n最后一行';
  const block = buildSessionBlock({ file: "C:/sessions/a.jsonl", title: "旧", body, messages: 3 });
  assert.equal(block.split("</session>").length - 1, 1, "正文里的转义片段不能变成真的结束标签");
  assert.equal(extractSessionBody(block), body, "前端解析应拿回完整正文");
}

console.log("[check] remote-image: ok");
