import { readStorage, writeStorage } from "./storage.ts";

/**
 * 输入框草稿持久化（正文 + 附件）。
 *
 * 草稿按「项目 + 会话文件」分键保存，重启应用后可以接着写：
 * - 同一项目不同会话互不影响；
 * - 附件只存路径与名称，恢复时重新向主进程校验（文件被删掉就跳过并提示）；
 * - 发送成功（正文清空、附件转交）时删除键，不留下无主草稿；
 * - 会话删除时一并清理。
 */
const PREFIX = "pi-desktop.composer-draft:";
/** 最多保留的草稿条数，避免 localStorage 累积过期草稿。 */
const MAX_DRAFTS = 40;

export interface StoredAttachment {
  path: string;
  name?: string;
  kind?: string;
}

export interface ComposerDraft {
  text: string;
  attachments: StoredAttachment[];
}

const EMPTY: ComposerDraft = { text: "", attachments: [] };

export function composerDraftKey(cwd: string, sessionFile: string): string {
  return `${PREFIX}${cwd}|${sessionFile}`;
}

function listDraftKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
  } catch {
    /* localStorage 不可用时不做裁剪 */
  }
  return keys;
}

/** 超出上限时按「最近写入」保留，旧草稿直接丢弃。 */
function trimDrafts(keep: string): void {
  const keys = listDraftKeys();
  if (keys.length <= MAX_DRAFTS) return;
  for (const key of keys) {
    if (key === keep) continue;
    if (keys.length <= MAX_DRAFTS) break;
    try {
      localStorage.removeItem(key);
      keys.splice(keys.indexOf(key), 1);
    } catch {
      /* ignore */
    }
  }
}

/** 兼容旧格式：以前只存纯文本。 */
function parseDraft(raw: string | null): ComposerDraft {
  if (!raw) return { ...EMPTY };
  if (!raw.startsWith("{")) return { text: raw, attachments: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<ComposerDraft>;
    const text = typeof parsed.text === "string" ? parsed.text : "";
    const attachments = Array.isArray(parsed.attachments)
      ? parsed.attachments
          .filter((item): item is StoredAttachment => Boolean(item && typeof item.path === "string" && item.path))
          .slice(0, 20)
          .map((item) => ({ path: item.path, name: item.name, kind: item.kind }))
      : [];
    return { text, attachments };
  } catch {
    return { ...EMPTY };
  }
}

export function readComposerDraft(cwd: string, sessionFile: string): ComposerDraft {
  if (!cwd) return { ...EMPTY };
  return parseDraft(readStorage(composerDraftKey(cwd, sessionFile)));
}

export function writeComposerDraft(cwd: string, sessionFile: string, draft: ComposerDraft): void {
  if (!cwd) return;
  const key = composerDraftKey(cwd, sessionFile);
  const text = draft.text ?? "";
  const attachments = Array.isArray(draft.attachments) ? draft.attachments : [];
  if (!text && !attachments.length) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    return;
  }
  writeStorage(key, JSON.stringify({ text, attachments }));
  trimDrafts(key);
}

export function clearComposerDraft(cwd: string, sessionFile: string): void {
  if (!cwd) return;
  try {
    localStorage.removeItem(composerDraftKey(cwd, sessionFile));
  } catch {
    /* ignore */
  }
}
