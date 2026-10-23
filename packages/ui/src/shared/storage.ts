/** 存储被禁用或配额耗尽时不让界面启动 / 主题切换失败。 */
export function readStorage(key: string): string | null {
  try { return typeof localStorage === "undefined" ? null : localStorage.getItem(key); }
  catch { return null; }
}
export function writeStorage(key: string, value: string): void {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(key, value); }
  catch { /* 本次会话仍使用内存设置 */ }
}
