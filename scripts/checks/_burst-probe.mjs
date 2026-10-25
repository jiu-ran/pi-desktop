/**
 * 定位「批量写回 title 卡住主线程」的真实成本（手工探针）。
 *
 * 对比三组：
 *   A. 元素挂在 document.body 下（会被 TooltipLayer 的 MutationObserver 看到）
 *   B. 元素挂在游离节点下（观察不到）
 *   C. 只量「是否 observer 回调」：A 但先 disconnect
 *
 * npx electron scripts/checks/_burst-probe.mjs
 */
import { app, BrowserWindow } from "electron";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PI_DESKTOP_PROFILE ||= "Pi Desktop Smoke";
if (!process.env.PI_CODING_AGENT_DIR) process.env.PI_CODING_AGENT_DIR = await mkdtemp(path.join(tmpdir(), "pi-burst-agent-"));
app.disableHardwareAcceleration();

setTimeout(() => {
  console.error("[burst] FAIL 超时");
  app.exit(1);
}, 240_000);

await import("../../dist-electron/main.js");

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 100 && !win; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    win = BrowserWindow.getAllWindows()[0] ?? null;
  }
  if (!win) {
    console.error("[burst] FAIL 没有窗口");
    app.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2500));

  const run = async (label, expression) => {
    const value = await win.webContents
      .executeJavaScript(expression, true)
      .catch((error) => `error: ${error.message}`);
    console.log(`[burst] ${label} →`, typeof value === "string" ? value : JSON.stringify(value));
    return value;
  };

  const bench = (attachToBody, count) => `(() => new Promise((resolve) => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:200px';
    ${attachToBody ? "document.body.appendChild(host);" : "const detached = document.createElement('div'); detached.appendChild(host);"}
    const rows = [];
    const t0 = performance.now();
    for (let i = 0; i < ${count}; i += 1) {
      const row = document.createElement('div');
      row.textContent = 'row ' + i;
      host.appendChild(row);
      rows.push(row);
    }
    const tCreate = performance.now() - t0;
    const t1 = performance.now();
    for (let k = 0; k < rows.length; k += 1) rows[k].setAttribute('title', '批量标题 ' + k);
    const tTitle = performance.now() - t1;
    const t2 = performance.now();
    setTimeout(() => {
      const tSettle = performance.now() - t2;
      host.remove();
      resolve(JSON.stringify({ create: Math.round(tCreate), titles: Math.round(tTitle), settle: Math.round(tSettle) }));
    }, 0);
  }))()`;

  await run("A. 挂在 body 下（observer 能看到）1000 条", bench(true, 1000));
  // 病态场景：hovered 是 body（悬停链判断会退化成「每个元素都在链上」）
  await run("D. 先悬停 body，再写回 1000 条", `(() => { document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 })); return true; })()`);
  await run("D. 悬停 body 后 1000 条", bench(true, 1000));
  await run("D. 悬停 body 后 3000 条", bench(true, 3000));
  // 对照：逐条 getBoundingClientRect 就是以前每条 MutationRecord 的代价
  await run("E. 3000 次 getBoundingClientRect", `(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:200px';
    document.body.appendChild(host);
    const rows = [];
    for (let i = 0; i < 3000; i += 1) { const row = document.createElement('div'); row.textContent = 'r' + i; host.appendChild(row); rows.push(row); }
    const started = performance.now();
    let sum = 0;
    for (const row of rows) sum += row.getBoundingClientRect().width;
    const elapsed = Math.round(performance.now() - started);
    host.remove();
    return elapsed + 'ms (' + sum + ')';
  })()`);
  await run("B. 游离节点（observer 看不到）1000 条", bench(false, 1000));
  await run("A. 挂在 body 下 3000 条", bench(true, 3000));
  console.log("[burst] done");
  app.exit(0);
});
