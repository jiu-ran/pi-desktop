/**
 * 对话里的 markdown 图片：哪些能直接交给浏览器，哪些要自己去读盘。
 *
 * 背景：`![](C:\Users\me\shot.png)` 这种地址在 Chromium 里会被当成相对 URL，
 * 结果是「Image failed to load」。应用是桌面程序、路径是用户自己贴的，
 * 所以先把本地图片读成 data URL 再交给 markstream 渲染。
 *
 * 为什么必须在渲染前换：markstream 拿到加载失败的地址会直接渲染成
 * 「加载失败」占位，DOM 里连 `<img>` 都不留，事后补不回来。
 */

export type ImageRef =
  /** 浏览器自己加载：http(s) / data: / blob: / 锚点 / 协议相对地址 */
  | { kind: "remote" }
  /** 本地文件：`path` 原样交给主进程（绝对路径会被当成工作区外的外部文件） */
  | { kind: "local"; path: string; absolute: boolean };

const REMOTE = /^(?:https?:|data:|blob:|about:|mailto:|javascript:|#)/i;

/** 像域名的 `//cdn.example.com/a.png` 是协议相对地址，别当成 UNC 路径 */
const PROTOCOL_RELATIVE = /^\/\/[^/]+\.[^/]+(?:\/|$)/;

/** 图片语法：`![alt](url)`、`![alt](url "title")`、`![alt](<带空格的 url>)` */
const IMAGE_PATTERN = /!\[[^\]]*\]\(\s*(<[^<>]*>|[^()\s]+)(?:[ \t]+(?:"[^"]*"|'[^']*'))?\s*\)/g;

function decode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/** Windows 盘符 / UNC（`\\\\srv` 或 `//srv`）/ POSIX 绝对路径 */
function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^[\\/]{2}/.test(value) || value.startsWith("/");
}

/** `file:///C:/a%20b.png` → `C:/a b.png`；`file:///home/u/a.png` → `/home/u/a.png` */
function fromFileUrl(url: string): string {
  const rest = url.replace(/^file:\/\//i, "");
  // 网络位置：file://server/share/a.png → //server/share/a.png
  if (!rest.startsWith("/") && !/^[a-zA-Z]:/.test(rest)) return decode(`//${rest}`);
  const value = decode(rest);
  // file:///C:/… 会剩一个前导斜杠
  return /^\/[a-zA-Z]:[\\/]/.test(value) ? value.slice(1) : value;
}

/** 判断一个 markdown 图片地址该怎么处理 */
export function imageRef(src: string): ImageRef {
  const value = String(src ?? "").trim();
  if (!value) return { kind: "remote" };
  if (REMOTE.test(value)) return { kind: "remote" };
  if (PROTOCOL_RELATIVE.test(value)) return { kind: "remote" };
  if (/^file:\/\//i.test(value)) {
    const path = fromFileUrl(value);
    return path ? { kind: "local", path, absolute: isAbsolutePath(path) } : { kind: "remote" };
  }
  return { kind: "local", path: value, absolute: isAbsolutePath(value) };
}

/** 一张图片地址在 markdown 原文里的位置（只覆盖 URL 本身，不含尖括号） */
export interface ImageTarget {
  src: string;
  start: number;
  end: number;
}

/** 找出 markdown 里所有图片地址 */
export function imageTargets(markdown: string): ImageTarget[] {
  const text = String(markdown ?? "");
  const found: ImageTarget[] = [];
  for (const match of text.matchAll(IMAGE_PATTERN)) {
    const raw = match[1] ?? "";
    const angled = raw.startsWith("<") && raw.endsWith(">");
    const src = (angled ? raw.slice(1, -1) : raw).trim();
    if (!src) continue;
    const offset = (match.index ?? 0) + match[0].indexOf(raw) + (angled ? 1 : 0);
    found.push({ src, start: offset, end: offset + src.length });
  }
  return found;
}

/** 按位置替换地址（从后往前改，前面的偏移不受影响） */
export function replaceImageTargets(
  markdown: string,
  replacements: Array<{ target: ImageTarget; text: string }>,
): string {
  let result = String(markdown ?? "");
  for (const item of [...replacements].sort((a, b) => b.target.start - a.target.start)) {
    result = `${result.slice(0, item.target.start)}${item.text}${result.slice(item.target.end)}`;
  }
  return result;
}
