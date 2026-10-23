// 项目路径去重：同一目录的斜杠、大小写和末尾分隔符差异不应产生两个侧栏分组。
import { projectPathKey } from "../../packages/ui/src/shared/util.ts";

function expectEqual(actual: string, expected: string, message: string): void {
  if (actual !== expected) throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

function expectNotEqual(actual: string, expected: string, message: string): void {
  if (actual === expected) throw new Error(`${message}: 不应相等`);
}

expectEqual(projectPathKey("C:\\Users\\jiuran\\Desktop\\pi-desktop\\"), "c:/users/jiuran/desktop/pi-desktop", "Windows 路径应统一分隔符并忽略大小写");
expectEqual(projectPathKey("c:/users/jiuran/desktop/pi-desktop"), "c:/users/jiuran/desktop/pi-desktop", "Windows 正斜杠路径应保持一致");
expectEqual(projectPathKey("C:\\"), "c:", "Windows 盘符根目录应保留可比较值");
expectEqual(projectPathKey("/home/jiuran/project/"), "/home/jiuran/project", "POSIX 路径应去掉末尾分隔符");
expectNotEqual(projectPathKey("/home/jiuran/project"), projectPathKey("/home/jiuran/Project"), "POSIX 路径应保留大小写");
expectEqual(projectPathKey("  /home/jiuran/project  "), "/home/jiuran/project", "路径首尾空白应忽略");
expectEqual(projectPathKey(""), "", "空路径应保持为空");

console.log("project-path OK");
