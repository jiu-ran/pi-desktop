/**
 * 通知文本统一中文化。
 *
 * Electron IPC 抛出的错误会带有
 *   Error invoking remote method 'pi:read-workspace-file': Error: ...
 * 前缀；Node 文件系统错误又常常是 ENOENT / EACCES 等英文。
 * 这里只处理通知层，不改变错误对象本身，方便日志继续保留技术细节。
 */

const IPC_PREFIX = /^Error invoking remote method '[^']+':\s*/i;
const IPC_ANYWHERE = /Error invoking remote method '[^']+':\s*/gi;
const ERROR_PREFIX = /^Error:\s*/i;

const NODE_ERROR = /^(ENOENT|EACCES|EPERM|EISDIR|ENOTDIR|ENOSPC|EBUSY|EMFILE|ENFILE|EEXIST|ELOOP|ENAMETOOLONG)\b[:\s]*(.*)$/i;

function stripTechnicalPrefixes(value: string): string {
  let text = String(value ?? "").replace(IPC_ANYWHERE, "").trim();
  for (let i = 0; i < 4; i += 1) {
    const before = text;
    text = text.replace(IPC_PREFIX, "").replace(ERROR_PREFIX, "").trim();
    if (text === before) break;
  }
  return text;
}

function quotedPath(text: string): string {
  const quoted = /['"]([^'"]+)['"]/.exec(text);
  return quoted?.[1]?.trim() ?? "";
}

function withPath(prefix: string, file: string): string {
  return file ? `${prefix}：${file}` : prefix;
}

/**
 * 把任意通知/错误文本转换成适合界面展示的中文。
 * 已包含中文时只去掉 IPC 包装，不重复翻译。
 */
export function localizeNotification(value: unknown, level = "info"): string {
  const raw = stripTechnicalPrefixes(
    value instanceof Error ? value.message : typeof value === "string" ? value : String(value ?? ""),
  );
  if (!raw) return level === "error" ? "操作失败，请稍后重试" : "操作已完成";

  // 宿主和界面自己的中文提示保持原样（最多剥掉外层 IPC 前缀）。
  if (/[\u3400-\u9fff]/.test(raw)) return raw;

  const node = NODE_ERROR.exec(raw);
  if (node) {
    const code = node[1].toUpperCase();
    const rest = node[2] ?? "";
    const file = quotedPath(rest);
    switch (code) {
      case "ENOENT":
        return withPath("文件或目录不存在", file);
      case "EACCES":
      case "EPERM":
        return withPath("没有权限访问", file);
      case "EISDIR":
        return "目标是一个目录，无法作为文件打开";
      case "ENOTDIR":
        return withPath("路径中的某一级不是目录", file);
      case "ENOSPC":
        return "磁盘空间不足，请清理空间后重试";
      case "EBUSY":
        return withPath("文件正被占用，请关闭占用程序后重试", file);
      case "EMFILE":
      case "ENFILE":
        return "同时打开的文件过多，请稍后重试";
      case "EEXIST":
        return withPath("目标已存在", file);
      case "ELOOP":
        return withPath("符号链接层级过多", file);
      case "ENAMETOOLONG":
        return withPath("文件路径过长", file);
      default:
        break;
    }
  }

  if (/net::ERR_|failed to fetch|networkerror|fetch failed|econnreset|etimedout/i.test(raw)) {
    return "网络请求失败，请检查网络或代理设置后重试";
  }
  if (/operation was aborted|aborterror/i.test(raw)) return "操作已取消";
  if (/unknown error/i.test(raw)) return "未知错误，请稍后重试";

  // 无法识别的外部错误保留原文，至少保证通知开头是中文，便于定位。
  if (level === "error") return `操作失败：${raw}`;
  if (level === "warning") return `注意：${raw}`;
  return `提示：${raw}`;
}
