// 最近打开文件的轻量记录，只用于快速打开的默认列表。
// 按项目 cwd 分开存储，避免切换项目后看到另一个项目的路径。

const KEY_PREFIX = "pi-desktop:recent-files:";
const MAX_RECENT = 20;

function keyFor(cwd: string): string {
  return `${KEY_PREFIX}${cwd}`;
}

export function loadRecentFiles(cwd: string): string[] {
  if (!cwd) return [];
  try {
    const raw = localStorage.getItem(keyFor(cwd));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function rememberRecentFile(cwd: string, relative: string): void {
  const value = String(relative ?? "").trim();
  if (!cwd || !value || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return;
  try {
    const next = [value, ...loadRecentFiles(cwd).filter((item) => item !== value)].slice(0, MAX_RECENT);
    localStorage.setItem(keyFor(cwd), JSON.stringify(next));
  } catch {
    // localStorage 在隐私模式 / 配额满时可能不可用；最近文件不是关键功能。
  }
}
