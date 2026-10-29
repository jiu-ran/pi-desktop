import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findExecutableOnPath, piCliEntryFromExecutable, piEntryFromNodeModulesDir } from "../../electron/pi-entry.ts";

/**
 * 从本机 `pi` 反解 `dist/cli.js` 的规则。
 *
 * 这段逻辑决定桌面端到底跑哪一份 Pi（`docs/product-boundary.md`：不内置，只用用户装的）。
 * 解错了要么启动不了会话，要么退回打包里的那份，所以三种真实安装布局都要钉住：
 * npm 全局（Windows shim 写 `%~dp0\node_modules\…`）、Unix（`<prefix>/bin/pi` ↔ `<prefix>/lib/node_modules`）、
 * 以及用户直接指定 `dist/cli.js`。
 */

const root = mkdtempSync(path.join(tmpdir(), "pi-entry-check-"));
const pkgEntry = (nodeModules: string) => path.join(nodeModules, "@earendil-works", "pi-coding-agent", "dist", "cli.js");

function writeFile(file: string, content = ""): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
  return file;
}

try {
  // 1) npm 全局：<prefix>/pi.cmd + <prefix>/node_modules/…
  const prefix = path.join(root, "npm-global");
  const shim = writeFile(path.join(prefix, "pi.cmd"), `@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe" "%~dp0\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js" %*\r\n)`);
  const npmEntry = writeFile(pkgEntry(path.join(prefix, "node_modules")));
  assert.equal(piCliEntryFromExecutable(shim), npmEntry, "npm 全局布局要能反解到 dist/cli.js");
  assert.equal(piEntryFromNodeModulesDir(path.join(prefix, "node_modules")), npmEntry, "从 node_modules 目录直接取入口");

  // 2) Unix 布局：<prefix>/bin/pi（sh 脚本）+ <prefix>/lib/node_modules/…
  const unixPrefix = path.join(root, "unix");
  const unixShim = writeFile(
    path.join(unixPrefix, "bin", "pi"),
    "#!/bin/sh\nbasedir=$(dirname \"$(echo \"$0\" | sed -e 's,\\\\,/,g')\")\nexec node \"$basedir/../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js\" \"$@\"\n",
  );
  const unixEntry = writeFile(pkgEntry(path.join(unixPrefix, "lib", "node_modules")));
  assert.equal(piCliEntryFromExecutable(unixShim), unixEntry, "Unix 的 bin ↔ lib/node_modules 要能反解");

  // 3) 直接指定入口文件
  assert.equal(piCliEntryFromExecutable(npmEntry), npmEntry, "直接给 dist/cli.js 就原样返回");

  // 4) 指到别的东西 / 不存在：返回空，交给调用方提示安装
  const stray = writeFile(path.join(root, "stray", "pi"), "#!/bin/sh\nexec node /opt/other/cli.js\n");
  assert.equal(piCliEntryFromExecutable(stray), "", "shim 里没有 pi-coding-agent 就当找不到");
  assert.equal(piCliEntryFromExecutable(path.join(root, "nope", "pi")), "", "路径不存在返回空");
  assert.equal(piCliEntryFromExecutable(""), "", "空路径返回空");
  assert.equal(piEntryFromNodeModulesDir(""), "", "空目录返回空");

  // 5) PATH 查找（判断 node 在不在）
  const bin = path.join(root, "bin");
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  const nodePath = writeFile(path.join(bin, nodeName));
  assert.equal(findExecutableOnPath("node", { PATH: bin } as NodeJS.ProcessEnv), nodePath, "PATH 里能找到 node");
  assert.equal(findExecutableOnPath("node", { PATH: path.join(root, "empty") } as NodeJS.ProcessEnv), "", "PATH 里没有就是空");
  assert.equal(findExecutableOnPath("node", { PATH: "" } as NodeJS.ProcessEnv), "", "空 PATH 返回空");

  console.log("pi-entry OK npm 全局 / Unix bin-lib / 直接入口 / 找不到 / PATH 查找");
} finally {
  rmSync(root, { recursive: true, force: true });
}
