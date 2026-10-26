import assert from "node:assert/strict";

/**
 * 执行记录 = 时间线 的渲染回归。
 *
 * 用户抱怨的是「按类别归并后看不出真实执行顺序」。这里注入 22 个工具的一轮对话，断言：
 * - 顶层只有「用户消息 + 一条执行记录」两行，组头写清步数/命令数/读取数/改动数；
 * - 默认收起，组内步骤与卡片都不挂载；
 * - 展开组 → 出现 22 个时间线步骤，**顺序与注入顺序一致**（18 条命令 → 3 次读取 → 1 次改动），
 *   卡片仍不挂载；
 * - 点某一步 → 只挂载那一步的卡片；
 * - Ctrl+Shift+E 一键展开/收起；
 * - 「展开」模式下组与步骤默认全开。
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
        timeline: el.querySelectorAll(".turn-timeline").length,
        steps: el.querySelectorAll(".turn-step").length,
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
    assert.equal(top.timeline, 0, "收起时不挂载时间线");
    assert.equal(top.steps, 0, "收起时不挂载步骤");
    assert.equal(top.toolCards, 0, "收起时工具卡片不挂载");

    // 1.5) 右侧大纲：只显示用户消息本身，不带「第 N 轮」编号
    const outline = JSON.parse(await evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.chat-outline button')];
      return JSON.stringify({
        count: buttons.length,
        texts: buttons.map((node) => node.textContent.trim()),
        titles: buttons.map((node) => node.getAttribute('title') ?? ''),
      });
    })()`));
    assert.ok(outline.count >= 1, "有用户消息时应有大纲");
    assert.equal(outline.texts.at(-1), "跑一下检查", `大纲条目应就是用户消息，实际「${outline.texts.at(-1)}」`);
    assert.equal(/第\s*\d+\s*轮/.test(outline.titles.join(" ")), false, `大纲提示里不该出现「第 N 轮」：${JSON.stringify(outline.titles)}`);
    assert.equal(outline.titles.at(-1), "跑一下检查", `大纲提示应只有内容，实际「${outline.titles.at(-1)}」`);

    // 2) 展开组：22 步按注入顺序排列，卡片仍不挂载
    await evaluate(`(() => { ${scope}.querySelector(".activity-group .activity-head").click(); return true; })()`);
    await poll(`Boolean(${scope}.querySelector(".turn-step"))`, "时间线出现");
    await wait(200);
    const timeline = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      const steps = [...el.querySelectorAll(".turn-step")];
      return JSON.stringify({
        count: steps.length,
        labels: [...new Set(steps.map((node) => node.querySelector(".turn-step-label")?.textContent ?? ""))],
        kinds: steps.map((node) => node.dataset.stepKind),
        texts: steps.slice(0, 3).map((node) => node.querySelector(".turn-step-target")?.textContent ?? ""),
        numbers: steps.slice(0, 3).map((node) => node.querySelector(".turn-step-index")?.textContent ?? ""),
        lastTarget: steps.at(-1)?.querySelector(".turn-step-target")?.textContent ?? "",
        rails: el.querySelectorAll(".turn-step-rail").length,
        timeLabels: steps.filter((node) => (node.querySelector(".turn-step-time")?.textContent ?? "").trim()).length,
        toolCards: el.querySelectorAll(".tool-card").length,
      });
    })()`));
    assert.equal(timeline.count, 22, `时间线应有 22 步，实际 ${timeline.count}`);
    assert.deepEqual(timeline.labels, ["运行", "读取", "改动"], `动作名不对：${JSON.stringify(timeline.labels)}`);
    // 关键：顺序必须是 18 条命令 → 3 次读取 → 1 次改动，而不是按类别归并后的分组
    assert.deepEqual(
      timeline.kinds.slice(0, 18),
      Array.from({ length: 18 }, () => "bash"),
      `前 18 步应连续是命令，实际 ${JSON.stringify(timeline.kinds.slice(0, 18))}`,
    );
    assert.deepEqual(timeline.kinds.slice(18), ["read", "read", "read", "edit"], `末尾应是读取 + 改动，实际 ${JSON.stringify(timeline.kinds.slice(18))}`);
    assert.deepEqual(timeline.texts, ["npm run check -- 0", "npm run check -- 1", "npm run check -- 2"], `步骤摘要应是命令：${JSON.stringify(timeline.texts)}`);
    assert.deepEqual(timeline.numbers, ["1", "2", "3"], `时间线要有序号：${JSON.stringify(timeline.numbers)}`);
    assert.ok(timeline.lastTarget.includes("file-0.ts"), `最后一步应是改动文件：${timeline.lastTarget}`);
    assert.equal(timeline.rails, 22, "每一步都要有竖线");
    assert.equal(timeline.toolCards, 0, "时间线默认收起细节，不挂载卡片");

    // 3) 点某一步 → 只挂载那一步的卡片
    await evaluate(`(() => { ${scope}.querySelectorAll(".turn-step-head")[5].click(); return true; })()`);
    await poll(`Boolean(${scope}.querySelector(".turn-step-body .tool-card"))`, "步骤卡片出现");
    const opened = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      return JSON.stringify({
        bodies: el.querySelectorAll(".turn-step-body").length,
        cards: el.querySelectorAll(".turn-step-body .tool-card").length,
        rows: el.children.length,
        openIndex: [...el.querySelectorAll(".turn-step")].findIndex((node) => node.classList.contains("open")) + 1,
      });
    })()`));
    assert.equal(opened.bodies, 1, `只展开点中的那一步，实际 ${opened.bodies}`);
    assert.equal(opened.cards, 1, `只挂载一张卡片，实际 ${opened.cards}`);
    assert.equal(opened.rows, 2, "展开内部不影响顶层行数");
    assert.equal(opened.openIndex, 6, `展开的应是第 6 步，实际第 ${opened.openIndex} 步`);

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
        steps: el.querySelectorAll(".turn-step").length,
        cards: el.querySelectorAll(".tool-card").length,
      });
    })()`));
    assert.equal(collapsedAll.open, "false", "Ctrl+Shift+E 应把执行记录全部收起");
    assert.equal(collapsedAll.steps, 0, "收起后时间线不挂载");
    assert.equal(collapsedAll.cards, 0, "收起后卡片不挂载");

    // 再按一次 = 全部展开（时间线出现，但细节仍按需展开）
    await press();
    await wait(400);
    const expandedAll = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      return JSON.stringify({
        open: el.querySelector(".activity-head")?.getAttribute("aria-expanded"),
        steps: el.querySelectorAll(".turn-step").length,
      });
    })()`));
    assert.equal(expandedAll.open, "true", "再按一次应全部展开");
    assert.equal(expandedAll.steps, 22, `展开后应看到 22 步时间线，实际 ${expandedAll.steps}`);

    // 5) 切到「展开」模式：组与每一步的细节都默认打开
    await evaluate(`window.__piDesktop.settings.settings.activityDetail = "expanded"; true`);
    await wait(700);
    const flat = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      return JSON.stringify({
        groups: el.querySelectorAll(".activity-group").length,
        rows: el.children.length,
        cards: el.querySelectorAll(".turn-step-body .tool-card").length,
      });
    })()`));
    assert.equal(flat.groups, 1, "「展开」模式仍然按请求分组");
    assert.equal(flat.rows, 2, `顶层仍是两行，实际 ${flat.rows}`);
    assert.ok(flat.cards >= 22, `「展开」模式应直接挂载 22 张卡片，实际 ${flat.cards}`);

    // 6) 回到时间线模式（默认），并补一条耗时断言
    await evaluate(`window.__piDesktop.settings.settings.activityDetail = "grouped"; true`);
    await wait(500);
    await evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      const blocks = thread.transcript.blocks;
      const firstTool = blocks.find((block) => block.kind === "tool");
      if (firstTool) firstTool.ts = Date.now() - 92_000;
      const lastTool = [...blocks].reverse().find((block) => block.kind === "tool");
      if (lastTool) lastTool.ts = Date.now();
      return true;
    })()`);
    await wait(400);
    const timing = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      const head = el.querySelector(".activity-head");
      if (head && head.getAttribute("aria-expanded") !== "true") head.click();
      return JSON.stringify({ duration: el.querySelector(".activity-duration")?.textContent ?? "" });
    })()`));
    await wait(300);
    const stepTimes = await evaluate(`${scope}.querySelectorAll(".turn-step-time").length`);
    assert.match(timing.duration, /分|秒/, `有耗时数据时应显示时长，实际「${timing.duration}」`);
    assert.ok(stepTimes >= 1, `时间线上应出现相对时间，实际 ${stepTimes}`);

    console.log("[activity]", JSON.stringify({ rows: top.rows, summary: top.summary, steps: timeline.count, labels: timeline.labels, cards: opened.cards, duration: timing.duration }));
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
