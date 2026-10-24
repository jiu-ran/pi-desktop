/** 会话文件路径的比较键：统一分隔符与大小写，避免 Windows 路径大小写不一致。 */
export function sessionKey(file = ""): string {
  return (file || "__default__").replace(/\\/g, "/").toLowerCase();
}

/**
 * 把一个会话的新名称应用到列表项上（纯函数，不修改入参）。
 * 没有名称或路径时保持列表原样，避免把空名称误写为标题。
 */
export function applySessionName<T extends { path: string; title?: string; empty?: boolean }>(
  sessions: T[],
  sessionFile: string,
  name: string,
): T[] {
  if (!sessionFile || !name) return sessions;
  const key = sessionKey(sessionFile);
  return sessions.map((item) =>
    sessionKey(item.path) === key ? { ...item, title: name, empty: false } : item,
  );
}
