import assert from "node:assert/strict";

/**
 * 执行记录分组（一次用户请求 = 一行）的渲染回归。
 *
 * 用户抱怨的是「随便跑个任务就冒出一大堆执行行」：原来 108 个块渲染 47 行。
 * 这里注入 22 个工具的一轮对话，断言：
 * - 顶层只有「用户消息 + 一条执行记录」两行，组头写清步数/命令数/读取数/改动数；
 * - 默认收起，组内 思考/读取/运行/改动 都不挂载；
 * - 展开组 → 出现二级分类；展开「运行」→ 才挂载 18 张命令卡片；
 * - Ctrl+Shift+E 一键展开/收起；
 * - 切到「全部展开」模式后不再有组，逐块显示。
 */
export async function checkActivityInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, label, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await wait(80);
    }
    throw new Error(`执行记录检查超时：${label}`);
  };

  /** 只认画着我们注入内容的那个对话视图 */
  const scope = `([...document.querySelectorAll(".timeline-inner")]
    .filter((el) => el.clientHeight > 100 && el.textContent.includes("跑一下检查"))
    .pop() ?? document.querySelector(".timeline-inner"))`;

  try {
    await evaluate(`(() => {
      window.__piDesktop.settings.close();
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      thread.transcript.blocks.splice(0);
      const t = thread.transcript;
      t.pushUser("跑一下检查", 0);
      const run = (id, name, args) => {
        t.applyEvent({ type: "tool_execution_start", toolCallId: id, toolName: name, args });
        t.applyEvent({ type: "tool_execution_end", toolCallId: id, toolName: name, args, result: { content: [{ type: "text", text: "ok" }] } });
      };
      for (let i = 0; i < 18; i += 1) run("act-bash-" + i, "bash", { command: "npm run check -- " + i });
      for (let i = 0; i < 3; i += 1) run("act-read-" + i, "read", { path: "src/file-" + i + ".ts" });
      run("act-edit-0", "edit", { path: "src/file-0.ts" });
      return true;
    })()`);
    await poll(`Boolean(${scope}?.querySelector(".activity-group"))`, "执行记录组渲染");
    await wait(400);

    // 1) 顶层两行：用户消息 + 一条执行记录
    const top = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      const head = el.querySelector(".activity-group .activity-head");
      return JSON.stringify({
        rows: el.children.length,
        groups: el.querySelectorAll(".activity-group").length,
        title: el.querySelector(".activity-title")?.textContent ?? "",
        summary: head?.querySelector(".activity-summary")?.textContent ?? "",
        count: head?.querySelector(".activity-count")?.textContent ?? "",
        sections: el.querySelectorAll(".turn-section").length,
        toolCards: el.querySelectorAll(".tool-card").length,
        caret: head?.getAttribute("aria-expanded") ?? "",
      });
    })()`));
    assert.equal(top.rows, 2, `一轮对话应只有两行（用户 + 执行记录），实际 ${top.rows}`);
    assert.equal(top.groups, 1, `只应有一执行记录组，实际 ${top.groups}`);
    assert.equal(top.title, "执行", `折叠头前缀应为「执行」，实际「${top.title}」`);
    assert.match(top.summary, /执行了 22 步/, `组头要写清步数：${top.summary}`);
    assert.match(top.summary, /18 条命令/, `组头要写命令数：${top.summary}`);
    assert.match(top.summary, /读 3 个文件/, `组头要写读取数：${top.summary}`);
    assert.match(top.summary, /改 1 个文件/, `组头要写改动数：${top.summary}`);
    assert.equal(top.caret, "false", "默认收起");
    assert.equal(top.sections, 0, "收起时二级分组不挂载");
    assert.equal(top.toolCards, 0, "收起时工具卡片不挂载");

    // 2) 展开组：出现 运行 / 读取 / 改动 三类，卡片仍不挂载
    await evaluate(`(() => { ${scope}.querySelector(".activity-group .activity-head").click(); return true; })()`);
    await poll(`Boolean(${scope}.querySelector(".turn-section"))`, "二级分组出现");
    const sections = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      return JSON.stringify({
        labels: [...el.querySelectorAll(".turn-section-label")].map((n) => n.textContent),
        previews: [...el.querySelectorAll(".turn-section-preview")].map((n) => n.textContent),
        counts: [...el.querySelectorAll(".turn-section-count")].map((n) => n.textContent),
        toolCards: el.querySelectorAll(".tool-card").length,
      });
    })()`));
    assert.deepEqual(sections.labels, ["运行", "读取", "改动"], `二级分类顺序不对：${JSON.stringify(sections.labels)}`);
    assert.deepEqual(sections.counts, ["· 18", "· 3", "· 1"], `分类计数不对：${JSON.stringify(sections.counts)}`);
    assert.match(sections.previews[0], /npm run check/, `命令预览应显示命令：${sections.previews[0]}`);
    assert.match(sections.previews[1], /file-0\.ts/, `读取预览应显示文件名：${sections.previews[1]}`);
    assert.equal(sections.toolCards, 0, "二级分组默认也收起，不挂载卡片");

    // 3) 展开「运行」→ 才挂载 18 张卡片
    await evaluate(`(() => { ${scope}.querySelectorAll(".turn-section-head")[0].click(); return true; })()`);
    await poll(`Boolean(${scope}.querySelector(".turn-section-body .tool-card"))`, "命令卡片出现");
    const opened = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      return JSON.stringify({
        cards: el.querySelectorAll(".turn-section-body .tool-card").length,
        rows: el.children.length,
      });
    })()`));
    assert.equal(opened.cards, 18, `展开运行分组应挂载 18 张卡片，实际 ${opened.cards}`);
    assert.equal(opened.rows, 2, "展开内部不影响顶层行数");

    // 4) Ctrl+Shift+E 一键展开 / 收起
    const press = () =>
      evaluate(`(() => {
        for (const type of ["keydown", "keyup"]) {
          window.dispatchEvent(new KeyboardEvent(type, { key: "e", code: "KeyE", ctrlKey: true, shiftKey: true, bubbles: true }));
        }
        return true;
      })()`);
    // 组当前是展开的，第一次按 = 全部收起
    await press();
    await wait(400);
    const collapsedAll = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      return JSON.stringify({
        open: el.querySelector(".activity-head")?.getAttribute("aria-expanded"),
        cards: el.querySelectorAll(".tool-card").length,
      });
    })()`));
    assert.equal(collapsedAll.open, "false", "Ctrl+Shift+E 应把执行记录全部收起");
    assert.equal(collapsedAll.cards, 0, "收起后卡片不挂载");

    // 再按一次 = 全部展开
    await press();
    await wait(400);
    const expandedAll = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      return JSON.stringify({
        open: el.querySelector(".activity-head")?.getAttribute("aria-expanded"),
        cards: el.querySelectorAll(".tool-card").length,
      });
    })()`));
    assert.equal(expandedAll.open, "true", "再按一次应全部展开");
    assert.ok(expandedAll.cards >= 18, `展开后应能看到命令卡片，实际 ${expandedAll.cards}`);

    // 5) 切到「全部展开」模式：不再有组，逐块显示
    await evaluate(`window.__piDesktop.settings.settings.activityDetail = "expanded"; true`);
    await wait(500);
    const flat = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      return JSON.stringify({ groups: el.querySelectorAll(".activity-group").length, rows: el.children.length });
    })()`));
    assert.equal(flat.groups, 0, "全部展开模式下不该有分组");
    assert.equal(flat.rows, 23, `应逐块显示（用户 + 22 个工具），实际 ${flat.rows}`);

    // 6) 回到分组模式（默认），并补一条耗时断言
    await evaluate(`window.__piDesktop.settings.settings.activityDetail = "grouped"; true`);
    await wait(500);
    await evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      const blocks = thread.transcript.blocks;
      const firstTool = blocks.find((block) => block.kind === "tool");
      if (firstTool) firstTool.ts = Date.now() - 92_000;
      return true;
    })()`);
    await wait(400);
    const duration = await evaluate(`${scope}.querySelector(".activity-duration")?.textContent ?? ""`);
    assert.match(duration, /分|秒/, `有耗时数据时应显示时长，实际「${duration}」`);

    console.log("[activity]", JSON.stringify({ rows: top.rows, summary: top.summary, sections: sections.labels, cards: opened.cards, duration }));
  } finally {
    await evaluate(`(() => {
      window.__piDesktop.settings.settings.activityDetail = "grouped";
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      thread.transcript.blocks.splice(0);
      return true;
    })()`).catch(() => {});
    await wait(300);
  }
}
