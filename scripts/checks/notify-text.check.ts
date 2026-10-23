import { localizeNotification } from "../../packages/ui/src/shared/notify-text.ts";

const cases: Array<[string, string, string]> = [
  [
    "Error invoking remote method 'pi:read-workspace-file': Error: 文件超过 20 MB，暂不支持在桌面端预览",
    "error",
    "文件超过 20 MB，暂不支持在桌面端预览",
  ],
  ["Error: 已保存 README.md", "info", "已保存 README.md"],
  [
    "Error invoking remote method 'pi:read-workspace-file': Error: ENOENT: no such file or directory, open 'C:\\work\\docs\\missing.md'",
    "error",
    "文件或目录不存在：C:\\work\\docs\\missing.md",
  ],
  [
    "EACCES: permission denied, open 'C:\\work\\secret.md'",
    "error",
    "没有权限访问：C:\\work\\secret.md",
  ],
  ["EISDIR: illegal operation on a directory, read", "error", "目标是一个目录，无法作为文件打开"],
  ["net::ERR_CONNECTION_REFUSED", "error", "网络请求失败，请检查网络或代理设置后重试"],
  ["Unknown error", "error", "未知错误，请稍后重试"],
];

for (const [input, level, expected] of cases) {
  const actual = localizeNotification(input, level);
  if (actual !== expected) {
    throw new Error(`通知本地化不符合预期\n输入: ${input}\n期望: ${expected}\n实际: ${actual}`);
  }
}

const generic = localizeNotification("spawn failed", "error");
if (!generic.startsWith("操作失败：")) throw new Error(`未知错误应带中文前缀：${generic}`);
if (/Error invoking remote method/.test(generic)) throw new Error("不应保留 Electron IPC 前缀");

console.log("notify-text OK");
