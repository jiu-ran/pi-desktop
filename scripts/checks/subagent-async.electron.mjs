import assert from "node:assert/strict";

/**
 * 异步子代理的展示回归（docs: pi-subagents/docs/observability.md 的宿主约定）：
 *
 * 1. 工具只把任务丢到后台就返回（`results: []` + `asyncId`）：
 *    卡片应显示「子代理 · delegate / 已派发 / 并发 1/64」，而不是把扩展写给模型看的
 *    英文说明（"Detached. Return control now…"）贴出来。
 * 2. 工作流派发没有 `agent`，标题不能退化成「子代理 · 子代理」。
 * 3. `subagent-async` widget 是 `PI_SUBAGENT_ASYNC_JSON:` 机器快照：
 *    界面要渲染成任务清单，原始 JSON 折进 details。
 * 4. `subagent-inspect` widget 扩展明确要求宿主不渲染。
 */
export async function checkSubagentAsyncInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, label, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await wait(120);
    }
    throw new Error(`异步子代理检查超时：${label}`);
  };

  const cwd = await evaluate("window.__piDesktop.workbench.state.activeCwd");
  const cwdLiteral = JSON.stringify(cwd);

  const inject = (id, details, args, text, durationMs = 419) =>
    evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      thread.transcript.removeBlock(${JSON.stringify(id)});
      // 真实事件序列：先 start（带 args），再 end（结果里没有 args）
      thread.transcript.applyEvent({
        type: "tool_execution_start",
        toolCallId: ${JSON.stringify(id)},
        toolName: "subagent",
        args: ${JSON.stringify(args)},
      });
      thread.transcript.applyEvent({
        type: "tool_execution_end",
        toolCallId: ${JSON.stringify(id)},
        toolName: "subagent",
        args: ${JSON.stringify(args)},
        result: {
          content: [{ type: "text", text: ${JSON.stringify(text)} }],
          details: ${JSON.stringify(details)},
        },
        isError: false,
        durationMs: ${durationMs},
      });
      return true;
    })()`);

  // ---------- 1. 单个子代理的异步派发 ----------
  const dispatchText = [
    "Run fan-out: 1/64 used, 63 remaining",
    "Async: delegate [8fcf1559-3f7b-429a-a5d6-51a762800f60]",
    "",
    "Detached. Return control now: native completion wakes you, so do not sleep, poll, or call bg_wait for it.",
    'One-shot check: subagent({ action: "status", id: "..." }).',
  ].join("\n");
  await inject(
    "probe-async-single",
    {
      mode: "single",
      runId: "8fcf1559-3f7b-429a-a5d6-51a762800f60",
      asyncId: "8fcf1559-3f7b-429a-a5d6-51a762800f60",
      results: [],
      runFanoutBudget: { used: 1, limit: 64, remaining: 63 },
    },
    { agent: "delegate", task: "只读任务：读取 README 并总结" },
    dispatchText,
  );
  await poll(`Boolean(document.querySelector('.subagent-card[data-block-id="probe-async-single"]'))`, "派发卡片渲染");
  const single = await evaluate(`(() => {
    const card = document.querySelector('.subagent-card[data-block-id="probe-async-single"]');
    return {
      title: card.querySelector('.subagent-card-title')?.textContent.trim(),
      state: card.querySelector('.subagent-card-state')?.textContent.trim(),
      meta: card.querySelector('.subagent-card-meta')?.textContent.trim(),
      raw: Boolean(card.querySelector('.subagent-card-raw')),
      hint: card.querySelector('.subagent-card-hint')?.textContent.trim() ?? "",
      text: card.textContent,
    };
  })()`);
  assert.equal(single.title, "子代理 · delegate", `派发卡片标题应带 agent，实际 ${single.title}`);
  assert.equal(single.state, "已派发", `派发卡片状态应为「已派发」，实际 ${single.state}`);
  assert.match(String(single.meta), /并发 1\/64/, `派发卡片应显示并发配额，实际 ${single.meta}`);
  assert.equal(single.raw, false, "派发卡片不该把扩展写给模型的英文说明贴出来");
  assert.ok(!single.text.includes("Detached. Return control"), "界面里不应出现扩展的内部英文说明");
  assert.match(single.hint, /已在后台运行/, `应有一句中文说明，实际 ${single.hint}`);

  // ---------- 2. 工作流派发 ----------
  await inject(
    "probe-async-workflow",
    {
      mode: "workflow",
      asyncId: "8b6cc47e-b4b3-4d1a-92f1-3b821daa1523",
      results: [],
      workflow: { trace: [], emits: [], console: [], args: {} },
      runFanoutBudget: { used: 0, limit: 64, remaining: 64 },
    },
    { workflow: true },
    "Run fan-out: 0/64 used, 64 remaining\nAsync workflow [8b6cc47e-b4b3-4d1a-92f1-3b821daa1523]",
  );
  await poll(`Boolean(document.querySelector('.subagent-card[data-block-id="probe-async-workflow"]'))`, "工作流派发卡片渲染");
  const workflow = await evaluate(`(() => {
    const card = document.querySelector('.subagent-card[data-block-id="probe-async-workflow"]');
    return {
      title: card.querySelector('.subagent-card-title')?.textContent.trim(),
      state: card.querySelector('.subagent-card-state')?.textContent.trim(),
    };
  })()`);
  assert.equal(workflow.title, "子代理 · 工作流", `工作流派发标题不对：${workflow.title}`);
  assert.equal(workflow.state, "已派发");

  // ---------- 3. subagent-async widget ----------
  const snapshot = {
    kind: "pi-subagents.async-status-snapshot",
    version: 1,
    generatedAt: Date.now(),
    caps: { maxRuns: 20, maxChildrenPerNode: 8, maxDepth: 3, maxStringLength: 160, maxSerializedBytes: 32768 },
    omitted: { runs: 0, children: 0, byteLimitExceeded: false },
    runs: [
      {
        id: "8fcf1559-3f7b-429a-a5d6-51a762800f60",
        kind: "subagent",
        label: "delegate",
        state: "running",
        startedAt: Date.now(),
        updatedAt: Date.now(),
        children: [{ id: "step:0", kind: "step", label: "delegate", state: "running", agent: "delegate", thinking: "low" }],
      },
      {
        id: "8b6cc47e-b4b3-4d1a-92f1-3b821daa1523",
        kind: "workflow",
        label: "scout",
        state: "failed",
        startedAt: Date.now(),
        updatedAt: Date.now(),
        activity: { currentTool: "map", turnCount: 2, toolCount: 3 },
        children: [{ id: "scan", kind: "step", label: "Map order module", state: "failed" }],
      },
    ],
  };
  const widgetLine = `PI_SUBAGENT_ASYNC_JSON:${JSON.stringify(snapshot)}`;
  const setWidget = (key, lines) =>
    evaluate(`(() => {
      window.__piDesktop.bus.emit("pi:event", {
        cwd: ${cwdLiteral},
        event: {
          type: "extension_ui_request",
          method: "setWidget",
          widgetKey: ${JSON.stringify(key)},
          widgetLines: ${lines === null ? "undefined" : JSON.stringify(lines)},
          widgetPlacement: "aboveEditor",
        },
      });
      return true;
    })()`);

  await setWidget("subagent-async", [widgetLine]);
  await poll(
    `Boolean([...document.querySelectorAll('.ext-widget-key')].find((n) => n.textContent.includes('子代理进度')))`,
    "widget 紧凑卡片渲染",
  );
  const widget = await evaluate(`(() => {
    const card = [...document.querySelectorAll(".ext-widget")].find((n) => n.textContent.includes("子代理进度"));
    const rows = [...card.querySelectorAll(".ext-subagent-run")].map((n) => n.textContent.replace(/\\s+/g, " ").trim());
    const details = card.querySelector(".ext-widget-raw");
    return {
      head: card.querySelector(".ext-widget-key").textContent.replace(/\\s+/g, " ").trim(),
      rows,
      directPre: Boolean(card.querySelector(":scope > pre")),
      rawInDetails: Boolean(details?.querySelector("pre")),
      detailsOpen: details ? details.open : null,
      text: card.textContent,
    };
  })()`);
  assert.match(widget.head, /子代理进度 · 1 个运行中 · 1 个失败/, `widget 头部应汇总状态，实际 ${widget.head}`);
  assert.equal(widget.rows.length, 2, `widget 应有两条任务，实际 ${widget.rows.length}：${widget.rows.join(" | ")}`);
  assert.match(widget.rows[0] ?? "", /运行中/);
  assert.match(widget.rows[0] ?? "", /delegate/);
  assert.match(widget.rows[1] ?? "", /失败/, "失败的任务要标出来");
  assert.equal(widget.directPre, false, "机器 JSON 不能直接渲染在 widget 正文里");
  assert.equal(widget.rawInDetails, true, "原始 JSON 应折叠在 details 里备查");
  assert.equal(widget.detailsOpen, false, "原始 JSON 默认折叠");

  // ---------- 4. subagent-inspect widget 不渲染 ----------
  await setWidget("subagent-inspect", ['PI_SUBAGENT_INSPECT_JSON:{"kind":"pi-subagents.inspect-reply","requestId":"r1"}']);
  await wait(300);
  const inspectShown = await evaluate(
    `[...document.querySelectorAll(".ext-widget-key")].some((n) => n.textContent.includes("subagent-inspect"))`,
  );
  assert.equal(inspectShown, false, "subagent-inspect widget 不该显示在界面上");

  // 收尾：清掉注入的块与 widget
  await setWidget("subagent-async", null);
  await setWidget("subagent-inspect", null);
  for (const id of ["probe-async-single", "probe-async-workflow"]) {
    await evaluate(`window.__piDesktop.workbench.active.value.activeThread.transcript.removeBlock(${JSON.stringify(id)}); true`);
  }

  console.log(
    "[subagent-async]",
    JSON.stringify({ single: { title: single.title, state: single.state, meta: single.meta }, workflow: workflow.title, widget: widget.head }),
  );
}
