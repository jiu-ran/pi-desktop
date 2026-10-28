/**
 * 克隆目标目录的推导。
 *
 * 只做两件事：从仓库地址里取出目录名、把目录名拼到用户选的位置后面。
 * 之所以放在纯函数里：界面上要实时显示「将克隆到 …」，而真正落盘由主进程
 * 再用 `path.resolve` 复核一遍，两边不能各写一套规则。
 */

/** Windows / macOS 都不接受的文件名字符，以及控制字符 */
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;

/** 名字里不能出现的保留写法（`.git` 后缀由调用方先剥掉） */
function sanitize(name: string): string {
  const cleaned = name
    .replace(ILLEGAL, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\s-]+|[.\s]+$/g, "")
    .slice(0, 64)
    .replace(/[.\s]+$/g, "");
  return cleaned === "." || cleaned === ".." ? "" : cleaned;
}

/**
 * 从仓库地址里取目录名。
 *
 * 支持 `https://host/a/b.git`、`git@host:a/b.git`、`ssh://git@host:2222/a/b.git`、
 * `file:///d/work/repo.git` 与本地路径 `D:\work\repo`；查询串与末尾斜杠一并忽略。
 */
export function repoNameFromUrl(url: string): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  // 先去掉查询串与末尾斜杠，再剥掉 `scheme://`
  let value = raw.replace(/[?#].*$/, "").replace(/[/\\]+$/, "");
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value);
  value = scheme ? value.slice(scheme[0].length) : value;
  if (!value) return "";
  // 带 scheme 却只有主机名（`https://host/`）时取不出仓库名
  if (scheme && !/[/\\]/.test(value)) return "";
  // 剩下的开头可能是 `user@host:port`、scp 的 `user@host:` 或 Windows 的 `D:`：
  // 只有当冒号后面还有路径分隔符时才能确认它是前缀，否则冒号就是名字的一部分。
  const colon = value.indexOf(":");
  if (colon > 0 && !/[/\\]/.test(value.slice(0, colon))) {
    const rest = value.slice(colon + 1);
    if (/[/\\]/.test(rest)) value = rest;
  }
  const tail = value.split(/[/\\]/).filter(Boolean).at(-1) ?? "";
  return sanitize(tail.replace(/\.git$/i, ""));
}

/** 拼接父目录与名字，保留父目录原有的分隔符风格（Windows `\`、其它 `/`） */
export function joinPath(parent: string, name: string): string {
  const base = String(parent ?? "").replace(/[/\\]+$/, "");
  if (!base) return "";
  if (!name) return base;
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base}${sep}${name}`;
}

/** 克隆的目标目录：位置 + 由地址推导出的目录名；地址取不出名字时返回空串 */
export function cloneTargetPath(location: string, url: string): string {
  const name = repoNameFromUrl(url);
  return name ? joinPath(location, name) : "";
}
