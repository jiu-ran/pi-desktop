import assert from "node:assert/strict";
import { cloneTargetPath, joinPath, repoNameFromUrl } from "../../packages/ui/src/shared/repo-url.ts";

/**
 * 克隆目标目录的推导规则。
 *
 * 这段逻辑决定「文件会落到哪里」，错了就是往别人目录里写东西，所以逐条钉住：
 * 常见 URL 形态、带端口 / 查询串 / 末尾斜杠、以及 Windows 分隔符。
 */

const names: Array<[string, string]> = [
  ["https://github.com/jiu-ran/pi-desktop.git", "pi-desktop"],
  ["https://github.com/jiu-ran/pi-desktop", "pi-desktop"],
  ["https://github.com/jiu-ran/pi-desktop/", "pi-desktop"],
  ["https://github.com/jiu-ran/pi-desktop.git?ref=main", "pi-desktop"],
  ["git@github.com:jiu-ran/pi-desktop.git", "pi-desktop"],
  ["ssh://git@github.com:2222/jiu-ran/pi-desktop.git", "pi-desktop"],
  ["file:///D:/work/repo.git", "repo"],
  ["D:\\work\\repo", "repo"],
  ["/home/u/repo.git", "repo"],
  ["  https://host/a/b.git  ", "b"],
  // 不合法字符换成连字符，避免落盘时被系统拒绝；空格本身合法，保留
  ["https://host/a/my repo.git", "my repo"],
  ["https://host/a/re:po.git", "re-po"],
  ["", ""],
  ["   ", ""],
  ["https://host/", ""],
];

for (const [url, expected] of names) {
  assert.equal(repoNameFromUrl(url), expected, `目录名推导不符：${JSON.stringify(url)}`);
}

// 分隔符跟随父目录，不要在一串反斜杠里混进正斜杠
assert.equal(joinPath("C:\\Users\\jiuran\\air", "repo"), "C:\\Users\\jiuran\\air\\repo");
assert.equal(joinPath("C:\\Users\\jiuran\\air\\", "repo"), "C:\\Users\\jiuran\\air\\repo");
assert.equal(joinPath("/home/u/projects", "repo"), "/home/u/projects/repo");
assert.equal(joinPath("/home/u/projects/", "repo"), "/home/u/projects/repo");
assert.equal(joinPath("", "repo"), "");
assert.equal(joinPath("/home/u/projects", ""), "/home/u/projects");

assert.equal(cloneTargetPath("C:\\Users\\jiuran\\air", "https://host/a/demo.git"), "C:\\Users\\jiuran\\air\\demo");
assert.equal(cloneTargetPath("/tmp/work", "git@host:a/demo.git"), "/tmp/work/demo");
// 地址还填不出名字时不要拼出一个「位置本身」当作目标
assert.equal(cloneTargetPath("/tmp/work", ""), "");

console.log(`repo-url OK ${names.length} 种地址形态 / 分隔符跟随父目录`);
