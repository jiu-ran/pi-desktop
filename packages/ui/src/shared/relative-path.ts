/**
 * markdown 里的图片 / 链接地址解析（纯函数）。
 *
 * 文档里的 `![](images/a.png)` 是相对当前文件所在目录的，而读文件用的是
 * 「工作区相对路径」；这里负责两者之间的换算，以及判断哪些地址根本不用读盘。
 */

/** 是否是可远程/内联地址（直接塞进 img src 即可） */
export function isRemoteSource(src: string): boolean {
  return /^(?:https?:|data:|blob:|file:)/i.test(String(src ?? "").trim());
}

/** 取目录部分：`docs/a.md` → `docs`；`a.md` → `` */
export function dirOf(relative: string): string {
  const value = String(relative ?? "").replace(/\\/g, "/");
  const index = value.lastIndexOf("/");
  return index < 0 ? "" : value.slice(0, index);
}

/** 是否是绝对路径（POSIX 根目录 / Windows 盘符 / UNC） */
export function isAbsolutePath(value: string): boolean {
  const text = String(value ?? "");
  return /^[\\/]/.test(text) || /^[A-Za-z]:[\\/]/.test(text) || /^\\\\/.test(text);
}

/**
 * 归一化「工作区相对路径」：统一斜杠、消掉 `.` 与 `..`。
 * 越过根目录的 `..` 会被保留成前缀，调用方据此判断是否跑到工作区外面。
 */
export function normalizeRelative(value: string): string {
  const text = String(value ?? "").replace(/\\/g, "/");
  const parts: string[] = [];
  for (const part of text.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else parts.push("..");
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

/** 以 `baseDir` 为基准解析相对地址（绝对路径原样归一化，不在这里处理） */
export function resolveFrom(baseDir: string, target: string): string {
  const value = String(target ?? "").trim().replace(/\\/g, "/");
  if (!value) return "";
  if (isAbsolutePath(value)) return normalizeRelative(value);
  const base = normalizeRelative(baseDir);
  return normalizeRelative(base ? `${base}/${value}` : value);
}

/** 绝对路径转成工作区相对路径；不在工作区内返回空串 */
export function relativize(cwd: string, absolute: string): string {
  const root = normalizeRelative(String(cwd ?? "").replace(/^[A-Za-z]:[\\/]?/, "/"));
  const target = normalizeRelative(String(absolute ?? "").replace(/^[A-Za-z]:[\\/]?/, "/"));
  if (!root || !target) return "";
  if (target === root) return "";
  return target.startsWith(`${root}/`) ? target.slice(root.length + 1) : "";
}

/**
 * markdown 里的图片/文件地址 → 工作区相对路径。
 * 远程地址、空地址、跑到工作区外面的路径一律返回空串（调用方据此不读盘）。
 */
export function workspaceRelative(cwd: string, baseDir: string, src: string): string {
  const value = String(src ?? "").trim();
  if (!value || isRemoteSource(value)) return "";
  if (isAbsolutePath(value)) return relativize(cwd, value);
  const resolved = resolveFrom(baseDir, value);
  return resolved.startsWith("..") ? "" : resolved;
}

/** `#常见问题` 这类文档内锚点 */
export function isAnchorLink(href: string): boolean {
  return /^#/.test(String(href ?? "").trim());
}

/** 锚点去掉 `#` 并做 URL 解码 */
export function anchorOf(href: string): string {
  const value = String(href ?? "").trim().replace(/^#/, "");
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 锚点比较用：忽略大小写、空白与常见标点，`常见问题` 与 `常见-问题` 视为同一个。
 * （GitHub 用 `-` 拼 slug，中文标题手写锚点常常直接写文字。）
 */
export function normalizeAnchor(text: string): string {
  return String(text ?? "")
    .replace(/^#+\s*/, "")
    .replace(/[`*_~\-[\]()<>"'“”‘’。，、：；！？.,:;!?/\\|@#$%^&+=–—]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}
