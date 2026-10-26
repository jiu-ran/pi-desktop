/**
 * 排队消息编辑时用到的提示词拼装。
 *
 * 背景：Pi 的队列里存的是**完整提示词**（前面是 `<file>` / `<directory>` / `<session>`
 * 上下文块，后面才是用户写的话）。编辑框里只能出现「用户写的话」，如果把展示用的
 * `[文件: C:\…\a.png]` 标签一起预填进去，保存后提示词就变成
 *   <file name="…a.png"></file>
 *   [文件: C:\…\a.png]        ← 多出来的一份
 *   用户的话
 * 气泡上于是出现两条一模一样的图片路径。这里把「块」与「文字」彻底分开：
 * 编辑只改文字，块原样保留（或由用户粘贴新增）。
 */

export interface PromptBlock {
  /** 原始标记文本，写回提示词时原样使用 */
  raw: string;
  kind: "file" | "directory" | "session";
  /** 未转义的绝对路径 */
  path: string;
  /** 展示用文件名 */
  name: string;
}

const BLOCK_PATTERN = /<(file|directory|session) name="([^"]*)"[^>]*>[\s\S]*?<\/\1>/g;

function unescapeAttr(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function baseName(value: string): string {
  const parts = String(value ?? "").split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || String(value ?? "");
}

/** 拆成「上下文块」与「用户写的话」；顺序保持原样。 */
export function splitPromptBlocks(prompt: string): { blocks: PromptBlock[]; message: string } {
  const text = String(prompt ?? "");
  const blocks: PromptBlock[] = [];
  for (const match of text.matchAll(BLOCK_PATTERN)) {
    const path = unescapeAttr(match[2] ?? "");
    blocks.push({
      raw: match[0],
      kind: (match[1] ?? "file") as PromptBlock["kind"],
      path,
      name: baseName(path),
    });
  }
  return { blocks, message: splitPromptMessage(text).message };
}

/**
 * 把提示词拆成「自动附带的上下文」与「用户写的文字」。
 *
 * 按最后一个 `</file>` / `</directory>` / `</session>` 切开：这样即使上下文里有
 * 多块、块之间还有说明文字，也只会替换末尾那段用户文字。
 */
export function splitPromptMessage(prompt: string): { prefix: string; message: string } {
  const text = String(prompt ?? "");
  let lastEnd = -1;
  for (const match of text.matchAll(/<\/(?:file|directory|session)>/g)) {
    lastEnd = (match.index ?? 0) + match[0].length;
  }
  if (lastEnd < 0) return { prefix: "", message: text.trim() };
  return { prefix: text.slice(0, lastEnd), message: text.slice(lastEnd).trim() };
}

/** 用「上下文（块）+ 新文字」重新拼提示词：每块恰好一份，不会重复。 */
export function joinPromptBlocks(blocks: PromptBlock[], message: string): string {
  const head = (blocks ?? []).map((block) => block.raw).filter(Boolean).join("\n");
  const tail = String(message ?? "").replace(/\r\n/g, "\n").trim();
  return [head, tail].filter(Boolean).join("\n");
}

/**
 * 编辑后的完整提示词：保留原上下文（必要时按 keepPaths 过滤）+ 新粘贴附件的标记
 * + 新文字。`addedText` 是主进程 prepareAttachments 回传的标记文本（已含 `<file>` 块）。
 *
 * 关键：用户写的文字只出现一次 —— 展示用的 `[文件: …]` 标签永远不进提示词。
 */
export function rebuildPrompt(
  original: string,
  message: string,
  keepPaths: string[] | undefined,
  addedText: string,
): string {
  const text = String(original ?? "");
  const added = String(addedText ?? "").trim();
  const tail = String(message ?? "").replace(/\r\n/g, "\n").trim();
  const parts: string[] = [];
  if (keepPaths) {
    // 用户显式移除了某些附件：按剩下的块逐块拼（保持原顺序）
    const { blocks } = splitPromptBlocks(text);
    const kept = blocks.filter((block) => keepPaths.includes(block.path));
    parts.push(...kept.map((block) => block.raw), added, tail);
  } else {
    const { prefix } = splitPromptMessage(text);
    parts.push(prefix, added, tail);
  }
  return parts.filter(Boolean).join("\n");
}

/**
 * 编辑排队中的消息：把末尾那段用户文字换成新文字，上下文块原样保留。
 * 纯附件的消息（没有用户文字）也能直接改。
 */
export function replacePromptMessage(prompt: string, newMessage: string): string {
  return rebuildPrompt(prompt, newMessage, undefined, "");
}
