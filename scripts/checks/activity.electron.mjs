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
      run("act-edit-0", "edit", { path: "src/file-0.ts", edits: [{ oldText: "a", newText: "b" + String.fromCharCode(10) + "c" }] });
      return true;
    })()`);
    await poll(`Boolean(${scope}?.querySelector(".activity-group"))`, "执行记录组渲染");
    await wait(400);

    /** 截图留档：把执行记录这一块截下来（人工核对合并行 / 淡化的效果） */
    const shotGroup = async (name) => {
      try {
        const dbg = win.webContents.debugger;
        if (!dbg.isAttached()) await dbg.attach("1.3");
        const boxText = await evaluate(`(() => {
          const node = ${scope}.querySelector('.activity-group');
          if (!node) return 'null';
          const r = node.getBoundingClientRect();
          return JSON.stringify({ x: Math.round(r.left) - 8, y: Math.round(r.top) - 8, width: Math.round(r.width) + 16, height: Math.round(r.height) + 16 });
        })()`);
        if (boxText === "null" || boxText === null) return;
        const shot = await dbg.sendCommand("Page.captureScreenshot", { format: "png", clip: { ...JSON.parse(boxText), scale: 2 } });
        const { writeFile } = await import("node:fs/promises");
        const nodePath = await import("node:path");
        const { tmpdir } = await import("node:os");
        await writeFile(nodePath.join(tmpdir(), name), Buffer.from(shot.data, "base64"));
        console.log("[activity] shot", name);
      } catch (error) {
        console.log("[activity] shot（跳过）", name, error?.message ?? error);
      } finally {
        if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
      }
    };

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

    // 2) 展开组：连续同类步骤合并成一行（18 条命令 → 1 行，3 次读取 → 1 行），顺序不变
    //    先把设置归位：上一次跑崩可能把 activityMerge 落成 false
    await evaluate(`window.__piDesktop.settings.settings.activityMerge = true; true`);
    await wait(150);
    await evaluate(`(() => { ${scope}.querySelector(".activity-group .activity-head").click(); return true; })()`);
    await poll(`Boolean(${scope}.querySelector(".turn-step"))`, "时间线出现");
    await wait(200);
    const timeline = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      const rows = [...el.querySelectorAll(".turn-step")];
      return JSON.stringify({
        count: rows.length,
        runs: rows.filter((node) => node.classList.contains("turn-step-run")).map((node) => ({
          label: node.querySelector(".turn-step-label")?.textContent ?? "",
          added: node.querySelector(".stat-add")?.textContent ?? "",
          target: node.querySelector(".turn-step-target")?.textContent ?? "",
          count: node.querySelector(".turn-step-count")?.textContent ?? "",
          index: node.querySelector(".turn-step-index")?.textContent ?? "",
          steps: Number(node.dataset.run ?? "0"),
        })),
        singles: rows.filter((node) => !node.classList.contains("turn-step-run")).map((node) => ({
          label: node.querySelector(".turn-step-label")?.textContent ?? "",
          target: node.querySelector(".turn-step-target")?.textContent ?? "",
          added: node.querySelector(".stat-add")?.textContent ?? "",
          removed: node.querySelector(".stat-del")?.textContent ?? "",
        })),
        rails: el.querySelectorAll(".turn-step-rail").length,
        toolCards: el.querySelectorAll(".tool-card").length,
      });
    })()`));
    assert.equal(timeline.count, 3, `18 条命令 + 3 次读取应压成 3 行（2 个合并行 + 1 个单步），实际 ${timeline.count}`);
    assert.equal(timeline.runs.length, 2, `应有两个合并行，实际 ${timeline.runs.length}`);
    assert.deepEqual(timeline.runs.map((run) => run.count), ["×18", "×3"], `合并行要标出条数：${JSON.stringify(timeline.runs)}`);
    assert.equal(timeline.runs[0].label, "运行", "第一条合并行是命令");
    assert.match(timeline.runs[0].target, /npm run check -- \{0\.\.17\}$/, `合并行要压成 {{0..17}}：${timeline.runs[0].target}`);
    assert.equal(timeline.runs[1].label, "读取", "第二条合并行是读取");
    assert.match(timeline.runs[1].target, /src\/file-\{0\.\.2\}\.ts$/, `读取合并行也要压成区间：${timeline.runs[1].target}`);
    assert.deepEqual(timeline.singles.map((row) => row.label), ["改动"], `单步只剩改动：${JSON.stringify(timeline.singles)}`);
    assert.ok(timeline.singles[0].target.includes("file-0.ts"), `最后一步应是改动文件：${timeline.singles[0].target}`);
    // 改动步骤要把 +N / −N 显示出来（卡片头部不再画，行上得有）
    assert.equal(timeline.singles[0].added, "+2", `改动行要显示新增行数，实际「${timeline.singles[0].added}」`);
    assert.equal(timeline.singles[0].removed, "−1", `改动行要显示删除行数，实际「${timeline.singles[0].removed}」`);
    assert.equal(timeline.runs[0].added, "", "命令合并行没有增删");
    // 只是有序列表：不画圆点、不画竖线（用户要求去掉时间线的额外标识）
    const markers = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      return JSON.stringify({
        dots: el.querySelectorAll(".turn-step-dot").length,
        rails: el.querySelectorAll(".turn-step-rail").length,
        numbers: el.querySelectorAll(".turn-step-index").length,
        overflow: el.scrollWidth - el.clientWidth,
      });
    })()`));
    assert.equal(markers.dots, 0, "不该再有步骤圆点");
    assert.equal(markers.rails, 0, "不该再画时间线竖线");
    assert.equal(markers.numbers, 0, "步骤前面不该再有数字");
    assert.ok(markers.overflow <= 1, `执行记录不能横向溢出，实际多出 ${markers.overflow}px`);
    assert.equal(timeline.toolCards, 0, "合并行默认收起细节，不挂载卡片");
    await shotGroup("activity-merged.png");

    // 2.5) 点开合并行 → 逐条列出 18 步，卡片仍然不挂载
    await evaluate(`(() => { ${scope}.querySelector(".turn-step-run .turn-step-head").click(); return true; })()`);
    await poll(`Boolean(${scope}.querySelector(".turn-run-item"))`, "合并行展开出逐条清单");
    const runOpen = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      const items = [...el.querySelectorAll(".turn-run-item")];
      return JSON.stringify({
        items: items.length,
        targets: items.slice(0, 3).map((node) => node.querySelector(".turn-run-target")?.textContent ?? ""),
        cards: el.querySelectorAll(".tool-card").length,
      });
    })()`));
    assert.equal(runOpen.items, 18, `合并行展开后应有 18 条，实际 ${runOpen.items}`);
    assert.deepEqual(runOpen.targets, ["npm run check -- 0", "npm run check -- 1", "npm run check -- 2"], `逐条清单应是原始命令：${JSON.stringify(runOpen.targets)}`);
    assert.equal(runOpen.cards, 0, "逐条清单本身不挂载卡片");

    // 3) 点清单里的某一条 → 只挂载那一条的卡片
    await evaluate(`(() => { ${scope}.querySelectorAll(".turn-run-head")[5].click(); return true; })()`);
    await poll(`Boolean(${scope}.querySelector(".turn-run-item .tool-card"))`, "单条卡片出现");
    const openedRunItem = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      return JSON.stringify({
        cards: el.querySelectorAll(".turn-run-item .tool-card").length,
        bodies: el.querySelectorAll(".turn-run-item .turn-step-body").length,
        rows: el.children.length,
      });
    })()`));
    assert.equal(openedRunItem.cards, 1, `只挂载点中的那一张卡片，实际 ${openedRunItem.cards}`);
    assert.equal(openedRunItem.bodies, 1, `只展开一条，实际 ${openedRunItem.bodies}`);
    assert.equal(openedRunItem.rows, 2, "展开内部不影响顶层行数");
    {
      const bare = JSON.parse(await evaluate(`(() => {
        const card = ${scope}.querySelector(".turn-run-item .tool-card");
        const body = card?.querySelector(".tool-body");
        return JSON.stringify({
          bare: Boolean(card?.classList.contains("is-bare")),
          headers: ${scope}.querySelectorAll(".turn-step-body .tool-card .step-head").length,
          hasContent: Boolean(body && body.textContent.trim().length > 0),
          bodyOverflow: body ? body.scrollWidth - body.clientWidth : -1,
        });
      })()`));
      assert.equal(bare.bare, true, "时间线里的卡片要标记成 is-bare");
      assert.equal(bare.headers, 0, "上面那行已经写过动作，卡片不能再画一遍头部");
      assert.equal(bare.hasContent, true, "完整内容（参数 / 输出）要照常显示");
      assert.ok(bare.bodyOverflow <= 1, `卡片正文不能横向溢出，实际多出 ${bare.bodyOverflow}px`);
    }
    await evaluate(`(() => { ${scope}.querySelector(".turn-step-run .turn-step-head").click(); return true; })()`);
    await wait(200);

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
    assert.equal(expandedAll.steps, 3, `展开后仍是 3 行（合并行不拆开），实际 ${expandedAll.steps}`);

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

    // 6.5) 关掉「合并连续同类步骤」：恢复逐条时间线，但相同前缀被淡化、只留变化段
    await evaluate(`window.__piDesktop.settings.settings.activityDetail = "grouped"; window.__piDesktop.settings.settings.activityMerge = false; true`);
    await wait(600);
    // 切换展示方式后组会回到默认收起，重新展开再数行
    await evaluate(`(() => {
      const head = ${scope}.querySelector(".activity-group .activity-head");
      if (head && head.getAttribute("aria-expanded") !== "true") head.click();
      return true;
    })()`);
    await poll(`Boolean(${scope}.querySelector(".turn-step"))`, "关掉合并后时间线仍在");
    await wait(200);
    const unmerged = JSON.parse(await evaluate(`(() => {
      const el = ${scope};
      const rows = [...el.querySelectorAll(".turn-step")];
      const second = rows[1];
      return JSON.stringify({
        count: rows.length,
        runs: el.querySelectorAll(".turn-step-run").length,
        sameParts: el.querySelectorAll(".turn-step-same").length,
        diffParts: [...el.querySelectorAll(".turn-step-diff")].map((node) => node.textContent),
        secondText: second?.querySelector(".turn-step-target")?.textContent ?? "",
        firstRowDiffs: rows[0]?.querySelectorAll(".turn-step-diff").length ?? -1,
      });
    })()`));
    assert.equal(unmerged.count, 22, `关掉合并后应逐条显示 22 步，实际 ${unmerged.count}`);
    assert.equal(unmerged.runs, 0, "关掉合并后不该再有合并行");
    assert.ok(unmerged.sameParts >= 20, `相同前缀应被拆成淡化片段，实际 ${unmerged.sameParts}`);
    assert.equal(unmerged.firstRowDiffs, 0, "第一步没有上一步可比，不该拆段");
    assert.match(unmerged.secondText, /^npm run check -- 1$/, `淡化只是视觉，文本仍是完整命令：${unmerged.secondText}`);
    await shotGroup("activity-unmerged.png");
    await evaluate(`window.__piDesktop.settings.settings.activityMerge = true; true`);
    await wait(400);
    assert.equal(await evaluate(`${scope}.querySelectorAll(".turn-step").length`), 3, "重新打开合并后又回到 3 行");

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

    // 7) 视觉核对：思考 / 长输出步骤展开后「直接看到内容」（没有多余头部、没有序号）
    await evaluate(`(() => {
      const t = window.__piDesktop.workbench.active.value.activeThread.transcript;
      const NL = String.fromCharCode(10);
      const think = "先把这一轮的问题拆一下：1) 时间线不要圆点；2) 展开后直接看到内容；3) 长输出不能把页面撑宽。";
      t.applyEvent({ type: "message_start", message: { role: "assistant" } });
      t.applyEvent({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: think } });
      t.applyEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: think }] } });
      const args = { command: "sed -n 1,80p packages/ui/src/components/chat/tools/GenericTool.vue" };
      const lines = ['<script setup lang="ts">', 'const props = defineProps<{', '  block: TranscriptBlock;', '  query?: string;', '}>();', 'const subtitle = computed(() => props.block.args?.command ?? "");', 'const longLine = "这一行很长很长，用来验证长命令与长输出都不会把页面撑宽";'];
      t.applyEvent({ type: "tool_execution_start", toolCallId: "act-long", toolName: "bash", args });
      t.applyEvent({ type: "tool_execution_end", toolCallId: "act-long", toolName: "bash", args, result: { content: [{ type: "text", text: lines.join(NL) }] } });
      return true;
    })()`);
    await wait(600);
    await evaluate(`(() => {
      const rows = [...${scope}.querySelectorAll('.turn-step')];
      for (const row of rows.slice(-2)) row.querySelector('.turn-step-head')?.click();
      return rows.length;
    })()`);
    await wait(600);
    {
      const visual = JSON.parse(await evaluate(`(() => {
        const el = ${scope};
        const thinking = el.querySelector('.thinking');
        return JSON.stringify({
          numbers: el.querySelectorAll('.turn-step-index').length,
          headers: el.querySelectorAll('.turn-step-body .step-head').length,
          thinkingBare: Boolean(thinking?.classList.contains('is-bare')),
          thinkingBody: Boolean(thinking?.querySelector('.thinking-body')),
          cards: el.querySelectorAll('.turn-step-body .tool-card').length,
          overflow: el.scrollWidth - el.clientWidth,
        });
      })()`));
      assert.equal(visual.numbers, 0, "步骤前不该有数字");
      assert.equal(visual.headers, 0, "展开后不该再有可点的头部（思考 / 工具都一样）");
      assert.equal(visual.thinkingBare, true, "时间线里的思考块是裸的");
      assert.equal(visual.thinkingBody, true, "思考正文要直接摊开");
      assert.ok(visual.cards >= 1, "工具卡片照常显示内容");
      assert.ok(visual.overflow <= 1, `展开后不能横向溢出，实际多出 ${visual.overflow}px`);
    }
    await shotGroup("activity-expanded.png");
    await evaluate(`(() => {
      window.__piDesktop.workbench.active.value.activeThread.transcript.removeBlock("act-long");
      return true;
    })()`);

    console.log("[activity]", JSON.stringify({ rows: top.rows, summary: top.summary, rowsShown: timeline.count, runs: timeline.runs.map((run) => run.count), cards: openedRunItem.cards, duration: timing.duration }));
  } finally {
    await evaluate(`(() => {
      window.__piDesktop.settings.settings.activityDetail = "grouped";
      window.__piDesktop.settings.settings.activityMerge = true;
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      thread.transcript.blocks.splice(0);
      return true;
    })()`).catch(() => {});
    await wait(300);
  }
}
