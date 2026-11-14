// 项目路径去重：同一目录的斜杠、大小写和末尾分隔符差异不应产生两个侧栏分组。
import { projectPathKey } from "../../packages/ui/src/shared/util.ts";
import { assert, assertEqual } from "./support/harness.ts";

assertEqual(
  projectPathKey("C:\\Users\\jiuran\\Desktop\\pi-desktop\\"),
  "c:/users/jiuran/desktop/pi-desktop",
  "Windows 路径应统一分隔符并忽略大小写",
);
assertEqual(
  projectPathKey("c:/users/jiuran/desktop/pi-desktop"),
  "c:/users/jiuran/desktop/pi-desktop",
  "Windows 正斜杠路径应保持一致",
);
assertEqual(projectPathKey("C:\\"), "c:", "Windows 盘符根目录应保留可比较值");
assertEqual(projectPathKey("/home/jiuran/project/"), "/home/jiuran/project", "POSIX 末尾分隔符应去掉");
assert(projectPathKey("/home/jiuran/project") !== projectPathKey("/home/jiuran/Project"), "POSIX 路径应保留大小写");
assertEqual(projectPathKey("  /home/jiuran/project  "), "/home/jiuran/project", "两端空白应去掉");
assertEqual(projectPathKey(""), "", "空路径应得到空串");
