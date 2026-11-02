/**
 * 「上次更新结果」与更新完成提示的措辞。
 *
 * `from === to` 只说明 Pi 本体版本没变：`scope = all` 时扩展包可能刚被更新过，
 * 这时说「无需更新」会把事情整个吞掉（用户以为点了没反应）。抽成纯函数是为了
 * 让检查脚本能逐条盯住这几种措辞。
 */

export interface PiUpdateRecordLike {
  from: string;
  to: string;
  scope?: "self" | "all";
  /** false 表示这是一次失败记录；不填按成功处理（兼容旧记录） */
  ok?: boolean;
}

/** 一句话概括这次更新的结果。currentVersion 是没拿到 to 时的兜底版本号。 */
export function piUpdateSummary(update: PiUpdateRecordLike, currentVersion = ""): string {
  const version = update.to || currentVersion || "未知版本";
  if (update.ok === false) return `上次更新失败（仍是 ${version}）`;
  if (update.from !== update.to) {
    return `已从 ${update.from || "未知版本"} 更新到 ${update.to || version}`;
  }
  return update.scope === "all"
    ? `Pi 本体已是最新（${version}）；扩展包已按 update --all 检查`
    : `已确认最新（${version}）`;
}

/** 更新完成任务提示里用的句子（比设置页多一句「无需更新」的肯定说法）。 */
export function piUpdateToast(update: PiUpdateRecordLike, currentVersion = ""): string {
  const version = update.to || currentVersion || "未知版本";
  if (update.from !== update.to) {
    return `Pi 已从 ${update.from || "未知版本"} 更新到 ${update.to || version}`;
  }
  return update.scope === "all"
    ? `Pi 本体已是最新（${version}）；扩展包已按 update --all 检查`
    : `Pi 已是最新（${version}），无需更新`;
}

/**
 * 更新失败时说的话。
 *
 * `pi update`（尤其 `--all`）失败时会把好几层信息一起吐出来：
 * `Extensions are skipped. Run pi update --extensions ...` 只是**后果**，
 * 真正的原因在后面那句 —— 直接把原文塞进提示条，用户看到的就是一段英文，
 * 既不知道发生了什么，也不知道下一步做什么。这里把常见原因归成一句中文，
 * 原始输出仍然留给设置页的「查看输出」。
 */
export interface PiUpdateFailure {
  kind: "network" | "permission" | "unknown";
  /** 一句话说明发生了什么（不含原始英文） */
  title: string;
  /** 一句「可以怎么办」；没有可操作建议时为空串 */
  hint: string;
  /** 这次是否连带跳过了扩展包更新（Pi 本体没变时尤其要说明） */
  extensionsSkipped: boolean;
}

/** Pi 够不着版本源时的几种说法（含 node fetch / undici 的错误码）。 */
const NETWORK =
  /could not (?:determine|fetch)[^\n]*version|aborted due to timeout|operation was aborted|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|fetch failed|socket hang up|network error|getaddrinfo/i;
const PERMISSION = /EACCES|EPERM|permission denied|access is denied|operation not permitted/i;

/** 去掉 ANSI 与前后空白，方便匹配与展示。 */
function cleanLog(log: string): string {
  return String(log ?? "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001B[@-_]/g, "")
    .trim();
}

/** 最后一行有内容的输出，去掉 `Error:` 前缀，过长时截断。 */
export function piUpdateLastLine(log: string, limit = 120): string {
  const lines = cleanLog(log)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = (lines.at(-1) ?? "").replace(/^error:\s*/i, "").trim();
  if (last.length <= limit) return last;
  return `${last.slice(0, limit - 1)}…`;
}

/** 把一次失败的输出归类成「发生了什么 + 怎么办」。 */
export function piUpdateFailure(log: string): PiUpdateFailure {
  const text = cleanLog(log);
  const extensionsSkipped = /extensions are skipped/i.test(text);
  if (NETWORK.test(text)) {
    return {
      kind: "network",
      title: "无法从网络获取 Pi 最新版本",
      hint: "检查网络或代理后重试",
      extensionsSkipped,
    };
  }
  if (PERMISSION.test(text)) {
    return {
      kind: "permission",
      title: "没有权限写入 Pi 的安装目录",
      hint: "换有权限的账号，或按 Pi 的文档换一种安装方式",
      extensionsSkipped,
    };
  }
  return { kind: "unknown", title: piUpdateLastLine(log) || "未知错误", hint: "", extensionsSkipped };
}

/** 失败提示条的一句话：不用原始英文，不含换行。 */
export function piUpdateFailureToast(log: string): string {
  const failure = piUpdateFailure(log);
  const notes = [failure.hint, failure.extensionsSkipped ? "扩展包这次没有更新" : ""].filter(Boolean);
  return notes.length ? `${failure.title}（${notes.join("；")}）` : failure.title;
}
