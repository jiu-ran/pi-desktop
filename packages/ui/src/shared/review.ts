// 代码评审意见的纯数据与提示词构造。DiffView 只负责收集锚点，
// 真正的换行 / 排序 / 发送格式集中在这里，便于断言且不依赖 Vue。

export type ReviewSide = "old" | "new";

/** 单行代码进入提示词的上限，避免压缩后的 minified 文件一次塞进几十万字符。 */
export const REVIEW_CODE_MAX = 2000;

export interface ReviewCommentDraft {
  /** 在当前 DiffView 的可见行数组中的下标 */
  lineIndex: number;
  /** 显示的旧行号或新行号；工具块 diff 可能没有行号 */
  line: string;
  side: ReviewSide;
  /** 评论锚定的代码行内容 */
  text: string;
  /** 用户填写的评审意见 */
  body: string;
}

export interface ReviewComment extends ReviewCommentDraft {
  id: string;
  /** 仓库内相对路径；用于提示词和分组 */
  path: string;
}

/** Git diff 中一条可评论的行；meta / gap 不是代码行。 */
export function isReviewableLine(type: string): boolean {
  return type === "add" || type === "del" || type === "ctx";
}

/**
 * 把评审意见排成可直接放进输入的 Markdown。
 * 代码用缩进块而不是 ```，避免代码本身包含反引号时破坏格式。
 */
export function buildReviewPrompt(comments: readonly ReviewComment[]): string {
  if (!comments.length) return "";
  const lines = [
    "请根据以下代码评审意见修改当前工作区。逐条处理，并在完成后说明每条的修改结果；若某条不需要修改，请说明原因。",
    "",
  ];
  comments.forEach((comment, index) => {
    const side = comment.side === "old" ? "删除前版本" : "当前版本";
    const line = comment.line ? `第 ${comment.line} 行` : "未标行号";
    lines.push(`### ${index + 1}. ${comment.path}`);
    lines.push("");
    lines.push(`位置：${line}（${side}）`);
    if (comment.text) {
      lines.push("");
      lines.push("相关代码：");
      lines.push("");
      const code = comment.text.length > REVIEW_CODE_MAX
        ? `${comment.text.slice(0, REVIEW_CODE_MAX)}…（已截断）`
        : comment.text;
      for (const row of code.split(/\r?\n/)) lines.push(`    ${row}`);
    }
    lines.push("");
    lines.push("评审意见：");
    lines.push("");
    for (const row of comment.body.split(/\r?\n/)) lines.push(`    ${row}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

/** 把当前输入追加到已有草稿，避免覆盖用户正在写的内容。 */
export function appendDraft(existing: string, addition: string): string {
  const left = existing.trimEnd();
  const right = addition.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left}\n\n${right}`;
}
