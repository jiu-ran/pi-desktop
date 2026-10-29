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
}

/** 一句话概括这次更新的结果。currentVersion 是没拿到 to 时的兜底版本号。 */
export function piUpdateSummary(update: PiUpdateRecordLike, currentVersion = ""): string {
  const version = update.to || currentVersion || "未知版本";
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
