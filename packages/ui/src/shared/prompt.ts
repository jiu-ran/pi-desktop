/**
 * 发送时拼给模型的提示词。
 *
 * 顺序：会话引用（别的对话的背景）→ 文件附件（内联内容）→ 用户这次打的字。
 * 用户的话永远在最后，模型才会把它当成「这次要做什么」而不是背景的一部分。
 */
export interface PromptParts {
  /** 引用的对话压成的上下文块（可能为空） */
  sessionText?: string;
  /** 文件 / 文件夹附件的内联内容（可能为空） */
  fileText?: string;
  /** 用户在输入框里打的字 */
  message?: string;
}

export function composePrompt({ sessionText = "", fileText = "", message = "" }: PromptParts): string {
  return [sessionText, fileText, message]
    .map((part) => String(part ?? "").replace(/\s+$/, ""))
    .filter(Boolean)
    .join("\n");
}
