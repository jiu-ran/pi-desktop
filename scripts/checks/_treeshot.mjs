/**
 * 手工探针：文件树的图标（文件夹 vs 文件）截图核对。
 *
 * 手工跑：npx electron scripts/checks/_treeshot.mjs
 */
import { app, BrowserWindow } from "electron";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PI_DESKTOP_PROFILE ||= "Pi Desktop Tree Shot";
if (!process.env.PI_CODING_AGENT_DIR) process.env.PI_CODING_AGENT_DIR = path.join(tmpdir(), "pi-treeshot-agent");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.disableHardwareAcceleration();

setTimeout(() => {
  console.error("[tree] FAIL 超时");
  app.exit(1);
}, 120_000);

await import("../../dist-electron/main.js");

app.whenReady().then(async () => {
  try {
    let win = null;
    for (let i = 0; i < 100 && !win; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      win = BrowserWindow.getAllWindows()[0] ?? null;
    }
    const ev = (x) => win.webContents.executeJavaScript(x, true);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const ws = await mkdtemp(path.join(tmpdir(), "pi-tree-ws-"));
    const dirs = ["dist/win-unpacked/locales", "dist/win-unpacked/resources", "build", ".github/workflows", "src/styles", "node_modules/foo"];
    for (const dir of dirs) await mkdir(path.join(ws, dir), { recursive: true });
    const files = {
      "dist/chrome_100_percent.pak": "x",
      "dist/chrome_200_percent.pak": "x",
      "build/icon.png": "x",
      ".github/workflows/release.yml": "x",
      "src/app.ts": "x",
      "src/App.vue": "x",
      "src/styles/base.css": "x",
      "package.json": "{}\n",
      "README.md": "# hi\n",
    };
    for (const [name, content] of Object.entries(files)) await writeFile(path.join(ws, name), content);

    await ev(`window.__piDesktop.workbench.open(${JSON.stringify(ws)}).then(() => true)`);
    for (let i = 0; i < 100; i += 1) {
      if ((await ev(`window.__piDesktop.workbench.active.value?.status`)) === "ready") break;
      await wait(150);
    }
    await wait(600);

    // 展开 dist / win-unpacked，让「普通文件夹」出现在视野里
    const expand = async (name) => {
      await ev(`(() => {
        const row = [...document.querySelectorAll('.file-tree-row.folder')]
          .find((n) => (n.querySelector('.file-tree-name')?.textContent ?? '').trim() === ${JSON.stringify(name)});
        if (!row) return false;
        if (!row.classList.contains('expanded')) row.click();
        return true;
      })()`);
      await wait(400);
    };
    for (const name of ["dist", "win-unpacked", "resources", "build", ".github"]) await expand(name);
    await wait(400);

    const metrics = await ev(`(() => {
      const rows = [...document.querySelectorAll(".file-tree-row")];
      return JSON.stringify(rows.map((row) => {
        const icon = row.querySelector(".file-icon");
        const svg = icon?.querySelector("path");
        return {
          name: (row.querySelector(".file-tree-name")?.textContent ?? "").trim(),
          folder: row.classList.contains("folder"),
          icon: icon?.getAttribute("data-icon") ?? "",
          fill: svg?.getAttribute("fill") ?? "",
          d: (svg?.getAttribute("d") ?? "").slice(0, 24),
        };
      }));
    })()`);
    console.log("[tree] rows", metrics);

    const box = await ev(`(() => {
      const node = document.querySelector(".files-view") ?? document.querySelector(".file-tree");
      const r = node.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left) - 8, y: Math.round(r.top) - 8, width: Math.round(r.width) + 16, height: Math.round(r.height) + 16 });
    })()`);
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) await dbg.attach("1.3");
    const png = await dbg.sendCommand("Page.captureScreenshot", { format: "png", clip: { ...JSON.parse(box), scale: 2 } });
    const target = path.join(tmpdir(), "treeshot.png");
    await writeFile(target, Buffer.from(png.data, "base64"));
    console.log("[tree] shot", target);
    if (dbg.isAttached()) dbg.detach();
    app.exit(0);
  } catch (error) {
    console.error("[tree] FAIL", error?.stack ?? error);
    app.exit(1);
  }
});
