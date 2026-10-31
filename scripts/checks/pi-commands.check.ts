import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DESKTOP_ONLY_COMMANDS,
  PI_BUILTIN_COMMANDS,
  PI_COMMANDS_VERSION,
  findPiCommand,
  terminalCommandNotice,
  terminalOnlyCommands,
} from "../../packages/ui/src/shared/pi-commands.ts";

/**
 * `/` 命令的适配清单。
 *
 * 三件事要钉住：
 * 1. Pi 每个内置命令都在表里（清单写死，Pi 升级加命令时这里必须跟着改）；
 * 2. 表里标 `desktop` 的命令在 `services/slash-commands.ts` 里真的有实现，
 *    标 `terminal` 的必须给用户一句能照做的话；
 * 3. 反方向：桌面端自己实现的命令不能漏进表里（否则菜单里会出现没人管的条目）。
 *
 * 第 2 条直接扫源码而不 import：那个模块会连带拉起 Vue 运行时，检查脚本里没必要。
 */

/** Pi 1.4.0 的 24 条内置命令（`dist/core/slash-commands.js`）。 */
const PI_1_4_NAMES = [
  "settings", "model", "tree", "thinking", "scoped-models", "export", "import", "share", "bug",
  "copy", "name", "session", "changelog", "hotkeys", "fork", "clone", "trust", "login", "logout",
  "new", "compact", "resume", "reload", "quit",
];

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const source = readFileSync(path.join(repo, "packages/ui/src/services/slash-commands.ts"), "utf8");

assert.equal(PI_COMMANDS_VERSION, "1.4.0");
assert.deepEqual(
  PI_BUILTIN_COMMANDS.map((command) => command.name).sort(),
  [...PI_1_4_NAMES].sort(),
  `Pi ${PI_COMMANDS_VERSION} 的内置命令应该是这 ${PI_1_4_NAMES.length} 条`,
);

// 每条都得有中文标题与描述，菜单里不能出现空行
for (const command of PI_BUILTIN_COMMANDS) {
  assert.ok(command.title.trim(), `/${command.name} 缺少标题`);
  assert.ok(command.description.trim(), `/${command.name} 缺少描述`);
  if (command.support === "terminal") {
    assert.ok(command.hint && command.hint.trim(), `/${command.name} 标了「只能终端」，必须写清原因与做法`);
    const notice = terminalCommandNotice(command);
    assert.ok(notice.includes(`/${command.name}`), `/${command.name} 的提示要带上命令名`);
    assert.ok(notice.includes("终端"), `/${command.name} 的提示要指向终端`);
  } else {
    // 标了桌面端支持，就必须真的在命令实现里出现（不能只写进表里）
    const implemented = new RegExp(`name: "${command.name}"`, "u").test(source);
    assert.ok(implemented, `/${command.name} 标了桌面端支持，但 slash-commands.ts 里没有实现`);
  }
}

// 反方向：本地实现里的命令都要有出处（Pi 内置，或明确列为桌面端专属）
const localNames = [...source.matchAll(/^\s+name: "([a-z-]+)"/gmu)].map((match) => match[1]);
const desktopSupport = PI_BUILTIN_COMMANDS.filter((command) => command.support === "desktop").length;
assert.ok(
  localNames.length >= desktopSupport,
  `本地命令只有 ${localNames.length} 条，少于表里标为桌面端支持的 ${desktopSupport} 条`,
);
for (const name of new Set(localNames)) {
  assert.ok(
    findPiCommand(name) || DESKTOP_ONLY_COMMANDS.includes(name),
    `本地命令 /${name} 既不在 Pi 的内置表里，也没登记为桌面端专属`,
  );
}
for (const name of DESKTOP_ONLY_COMMANDS) {
  assert.ok(localNames.includes(name), `桌面端专属命令 /${name} 没有实现`);
}

// 只能终端的命令集合与查询函数
const terminal = terminalOnlyCommands();
assert.equal(terminal.length, PI_BUILTIN_COMMANDS.filter((c) => c.support === "terminal").length);
assert.ok(terminal.every((command) => command.support === "terminal"));
assert.equal(findPiCommand("not-a-command"), undefined);
assert.equal(findPiCommand("login")?.support, "terminal");
assert.equal(findPiCommand("import")?.support, "desktop");

console.log(`pi-commands OK ${PI_BUILTIN_COMMANDS.length} 条内置（桌面端 ${PI_BUILTIN_COMMANDS.length - terminal.length} / 需终端 ${terminal.length}）、${DESKTOP_ONLY_COMMANDS.length} 条桌面专属`);
