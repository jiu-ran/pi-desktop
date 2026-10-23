import { app } from "electron";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function checkSessionRenameInElectron(win) {
  const k = await win.webContents.executeJavaScript("window.__piDesktop");
  const wb = k.workbench;
  const ws = wb.active.value;
  if (!ws || ws.status !== "ready") throw new Error("workspace not ready");

  // 获取当前会话初始名称和文件
  const sessionsBefore = ws.sessions.filter((s) => !s.empty);
  if (!sessionsBefore.length) {
    console.log("[session-rename] skipping: no non-empty sessions");
    return;
  }

  // 如果当前会话为空，新建一个
  let targetSession = sessionsBefore.find((s) => s.path === ws.sessionFile);
  if (!targetSession || targetSession.empty) {
    await wb.newSession();
    await sleep(200);
    targetSession = ws.sessions.find((s) => s.path === ws.sessionFile);
  }

  const originalFile = targetSession.path;
  const originalTitle = targetSession.title;
  console.log(`[session-rename] testing session: ${originalTitle} (${originalFile})`);

  // 重命名
  const newTitle = `重命名测试 ${Date.now()}`;
  await wb.renameSession(newTitle);
  await sleep(100);

  // 验证 1：侧栏标题立即更新
  const sessionAfterRename = ws.sessions.find((s) => s.path === originalFile);
  if (!sessionAfterRename || sessionAfterRename.title !== newTitle) {
    throw new Error(
      `[session-rename] sidebar not updated: expected "${newTitle}", got "${sessionAfterRename?.title}"`,
    );
  }
  console.log("[session-rename] sidebar title updated ✓");

  // 验证 2：顶部标题栏更新
  const titlebar = await win.webContents.executeJavaScript(
    "document.querySelector('.titlebar')?.innerText",
  );
  if (!titlebar.includes(newTitle)) {
    throw new Error(
      `[session-rename] titlebar not updated: expected to include "${newTitle}", got "${titlebar}"`,
    );
  }
  console.log("[session-rename] titlebar updated ✓");

  // 验证 3：切换到另一个会话再切回，保留新名称（不是刷新回旧标题）
  const otherSession = ws.sessions.find(
    (s) => !s.empty && s.path !== originalFile,
  );
  if (otherSession) {
    await wb.switchSession(otherSession.path);
    await sleep(100);
    const switched = ws.sessions.find((s) => s.path === originalFile);
    if (switched?.title !== newTitle) {
      throw new Error(
        `[session-rename] lost title after switch: expected "${newTitle}", got "${switched?.title}"`,
      );
    }
    console.log("[session-rename] title preserved after switch ✓");

    await wb.switchSession(originalFile);
    await sleep(100);
    const switchedBack = ws.sessions.find((s) => s.path === originalFile);
    if (switchedBack?.title !== newTitle) {
      throw new Error(
        `[session-rename] lost title after switch back: expected "${newTitle}", got "${switchedBack?.title}"`,
      );
    }
    console.log("[session-rename] title preserved after switch back ✓");
  }

  // 验证 4：重命名多次，每次都更新
  const newTitle2 = `再次重命名 ${Date.now()}`;
  await wb.renameSession(newTitle2);
  await sleep(100);
  const sessionAfterRename2 = ws.sessions.find((s) => s.path === originalFile);
  if (sessionAfterRename2?.title !== newTitle2) {
    throw new Error(
      `[session-rename] second rename failed: expected "${newTitle2}", got "${sessionAfterRename2?.title}"`,
    );
  }
  console.log("[session-rename] multiple renames work ✓");

  // 验证 5：清除名称（设为空）后回退到首条消息标题
  await wb.renameSession("");
  await sleep(100);
  const sessionAfterClear = ws.sessions.find((s) => s.path === originalFile);
  if (sessionAfterClear?.title === "" || sessionAfterClear?.title === newTitle2) {
    throw new Error(
      `[session-rename] clear name failed: expected to fall back to message title, got "${sessionAfterClear?.title}"`,
    );
  }
  console.log("[session-rename] clear name falls back to message title ✓");

  console.log("[session-rename] all checks passed");
}
