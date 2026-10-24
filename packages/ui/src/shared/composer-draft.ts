import { readStorage, writeStorage } from "./storage.ts";

/**
 * 输入框草稿持久化。
 *
 * 草稿按「项目 + 会话文件」分键保存，重启应用后可以接着写：
 * - 同一项目不同会话互不影响；
 * - 发送成功（正文清空）时删除键，不留下无主草稿；
 * - 会话删除时一并清理。
 */
const PREFIX = "pi-desktop.composer-draft:";
/** 最多保留的草稿条数，避免 localStorage 累积过期草稿。 */
const MAX_DRAFTS = 40;

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

export function readComposerDraft(cwd: string, sessionFile: string): string {
  if (!cwd) return "";
  return readStorage(composerDraftKey(cwd, sessionFile)) ?? "";
}

export function writeComposerDraft(cwd: string, sessionFile: string, text: string): void {
  if (!cwd) return;
  const key = composerDraftKey(cwd, sessionFile);
  if (!text) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    return;
  }
  writeStorage(key, text);
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
