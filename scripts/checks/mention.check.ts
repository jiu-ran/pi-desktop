import { applyMention, buildMention, parseMentionToken } from "../../packages/ui/src/shared/mentions.ts";

const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
const equal = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\n  实际: ${JSON.stringify(actual)}\n  预期: ${JSON.stringify(expected)}`);
  }
};

// 普通 @ 引用
const plain = parseMentionToken("看看 @src/ma");
assert(plain !== null, "应识别普通 @ 引用");
equal(plain, { start: 3, query: "src/ma", quoted: false }, "普通 @ 引用解析不正确");
equal(parseMentionToken("@"), { start: 0, query: "", quoted: false }, "只输入 @ 时也应解析");
assert(parseMentionToken("a@b") === null, "前面没有边界的 @ 不应触发补全");
assert(parseMentionToken("@a b") === null, "带空格的未加引号路径不应解析");

// 引号路径
equal(parseMentionToken('@"my dir/'), { start: 0, query: "my dir/", quoted: true }, "未闭合引号解析不正确");
equal(
  parseMentionToken('x @"my dir/a.ts"'),
  { start: 2, query: "my dir/a.ts", quoted: true },
  "已闭合引号解析不正确",
);

// 插入文本
equal(buildMention("src/a.ts", false), { text: "@src/a.ts ", cursor: 10, keepOpen: false }, "文件引用格式不正确");
equal(buildMention("src/", true), { text: "@src/", cursor: 5, keepOpen: true }, "目录引用格式不正确");
equal(
  buildMention("my dir/a.ts", false),
  { text: '@"my dir/a.ts" ', cursor: 15, keepOpen: false },
  "含空格路径应加引号",
);

// 替换输入框末尾的 @query
const fileToken = parseMentionToken("看看 @src/ma")!;
equal(
  applyMention("看看 @src/ma", fileToken, "src/main.ts", false),
  { text: "看看 @src/main.ts ", cursor: 16, keepOpen: false },
  "文件引用替换结果不正确",
);
const quotedToken = parseMentionToken('@"my dir/a')!;
equal(
  applyMention('@"my dir/a', quotedToken, "my dir/a.ts", false),
  { text: '@"my dir/a.ts" ', cursor: 15, keepOpen: false },
  "引号引用替换结果不正确",
);

console.log("mention.check ok");

// 带空格的目录：引号内的光标要停在右引号前，方便继续补全子路径
equal(
  buildMention("my dir/", true),
  { text: '@"my dir/"', cursor: 9, keepOpen: true },
  "含空格目录的引用与光标位置不正确",
);
const quotedDir = parseMentionToken('@"my dir/')!;
equal(
  applyMention('@"my dir/', quotedDir, "my dir/sub/", true),
  { text: '@"my dir/sub/"', cursor: 13, keepOpen: true },
  "带引号目录的替换结果不正确",
);
