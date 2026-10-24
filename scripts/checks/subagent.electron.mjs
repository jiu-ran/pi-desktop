import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * 子代理插件回归（隔离临时工作区，避免与真实会话的流式回填竞争）：
 * - 插件注册在「对话区域」，可停用
 * - 子代理单独占一行（不进活动组），一行里给出状态 / 任务 / 用量 / 已用时长
 * - 点击打开它自己的对话弹窗：并行时左侧可切换、失败原因可见、无会话文件时回退最终输出
 * - partialResult.details 实时驱动运行中状态
 * - 停用插件后同样的工具退回通用卡片
 * 只注入合成工具块，不发任何模型请求。
 */
export async function checkSubagentInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, label, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await wait(120);
    }
    throw new Error(`子代理插件检查超时：${label}`);
  };

  // 注意：响应式代理对象不能直接返回给主进程，structured clone 会失败。
  const plugin = await evaluate(`(() => {
    const record = window.__piDesktop.plugins.records.find(r => r.id === "subagent");
    return record ? { area: record.area, core: record.core, enabled: record.enabled, name: record.name } : null;
  })()`);
  assert.ok(plugin, "子代理应作为插件注册，而不是写死在核心里");
  assert.equal(plugin.area, "conversation", "子代理插件属于对话区域");
  assert.equal(plugin.core, false, "子代理插件应允许停用");

  const dir = await mkdtemp(path.join(tmpdir(), "pi-subagent-"));
  await writeFile(path.join(dir, "readme.txt"), "subagent check\n");
  const literal = JSON.stringify(dir);
  const previous = await evaluate(
    "({ cwd: window.__piDesktop.workbench.state.activeCwd, panel: window.__piDesktop.workbench.state.activePanelId })",
  );

  const inject = (id, details, extra = {}) =>
    evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      thread.transcript.removeBlock("${id}");
      thread.transcript.applyEvent({
        type: "tool_execution_end",
        toolCallId: "${id}",
        toolName: "subagent",
        args: ${JSON.stringify(extra.args ?? { agent: "scout", task: "检查目录内容" })},
        result: {
          content: [{ type: "text", text: ${JSON.stringify(extra.text ?? "3 个子代理已完成，其中 1 个失败")} }],
          details: ${JSON.stringify(details)},
        },
        isError: false,
        durationMs: ${extra.durationMs ?? 18200},
      });
      return true;
    })()`);

  /** 卡片一行里的信息：标题 / 状态 / 任务 / 用量 / 失败原因。 */
  const cardState = (id) =>
    evaluate(`(() => {
      const card = document.querySelector('.subagent-card[data-block-id="${id}"]');
      if (!card) return null;
      return {
        state: card.dataset.state,
        title: card.querySelector('.subagent-card-title')?.textContent.trim() ?? "",
        stateText: card.querySelector('.subagent-card-state')?.textContent.replace(/\\s+/g, " ").trim() ?? "",
        task: card.querySelector('.subagent-card-task')?.textContent.trim() ?? "",
        meta: card.querySelector('.subagent-card-meta')?.textContent.trim() ?? "",
        open: card.querySelector('.subagent-card-open')?.textContent.trim() ?? "",
        errors: [...card.querySelectorAll('.subagent-card-error')].map((item) => item.textContent.replace(/\\s+/g, " ").trim()),
      };
    })()`);

  const openDialog = async (id) => {
    const clicked = await evaluate(`(() => {
      const card = document.querySelector('.subagent-card[data-block-id="${id}"]');
      card?.querySelector('.subagent-card-main')?.click();
      return Boolean(card);
    })()`);
    assert(clicked, "应能找到子代理卡片");
    await poll(`Boolean(document.querySelector('[data-subagent-modal]'))`, "子代理对话弹窗打开");
  };

  const dialogState = () =>
    evaluate(`(() => {
      const modal = document.querySelector('[data-subagent-modal]');
      if (!modal) return null;
      return {
        agent: modal.querySelector('.subagent-dialog-agent')?.textContent.trim() ?? "",
        state: modal.querySelector('.subagent-dialog-state')?.textContent.trim() ?? "",
        meta: modal.querySelector('.subagent-dialog-meta')?.textContent.trim() ?? "",
        rail: [...modal.querySelectorAll('.subagent-rail-row')].map((row) => ({
          agent: row.querySelector('.subagent-rail-agent')?.textContent.trim() ?? "",
          active: row.classList.contains('active'),
        })),
        thread: modal.querySelector('[data-subagent-thread]')?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
      };
    })()`);

  const details = {
    mode: "parallel",
    results: [
      { agent: "reviewer", success: true, durationMs: 12400, task: "审查 diff", finalOutput: "看起来没问题", progress: { toolCount: 7, turnCount: 3, tokens: 4200 } },
      { agent: "builder", success: false, error: "构建失败：缺少依赖", finalOutput: "npm ERR! missing", progress: { toolCount: 4, tokens: 1800 } },
      { agent: "tester", timedOut: true, success: false, durationMs: 60000 },
    ],
  };

  try {
    await evaluate(`window.__piDesktop.workbench.open(${literal}).then(() => true)`);
    await poll("window.__piDesktop.workbench.active.value?.status === 'ready'", "临时工作区就绪");

    await inject("probe-subagent", details);
    await poll(`Boolean(document.querySelector('.subagent-card[data-block-id="probe-subagent"]'))`, "子代理卡片渲染");

    const card = await cardState("probe-subagent");
    assert.ok(card, "子代理应渲染成独立卡片");
    // 不再折进活动组：同一个 activity 组里不应包含这个工具。
    const insideActivity = await evaluate(`(() => {
      const node = document.querySelector('.subagent-card[data-block-id="probe-subagent"]');
      return Boolean(node?.closest('.activity-body'));
    })()`);
    assert.equal(insideActivity, false, "子代理必须单独成行，不能折进活动组");

    assert.equal(card.title, "子代理 · 并行 3 个子任务", "标题应说明是并行子代理");
    assert.equal(card.state, "failed", "有失败项时卡片状态为失败");
    assert.match(card.stateText, /失败/);
    assert.match(card.meta, /18\.2s/, "应显示这次调用的总耗时");
    assert.match(card.meta, /11 工具/, "应汇总工具调用数（7 + 4）");
    assert.match(card.meta, /1 完成/, "并行时应给出完成数");
    assert.match(card.open, /查看对话/, "应提示可以打开对话");
    assert.equal(card.errors.length, 1, "失败原因直接显示在卡片下方");
    assert.match(card.errors[0], /构建失败：缺少依赖/);

    // 点开对话：并行时左侧列出全部子任务，默认停在第一个。
    await openDialog("probe-subagent");
    const first = await dialogState();
    assert.equal(first.agent, "reviewer");
    assert.equal(first.state, "完成");
    assert.deepEqual(first.rail.map((item) => item.agent), ["reviewer", "builder", "tester"], "并行时左侧应列出全部子任务");
    assert.equal(first.rail[0].active, true);
    assert.match(first.thread, /没有留下子代理会话文件/, "缺少会话文件时应说明回退原因");
    assert.match(first.thread, /看起来没问题/, "回退时应展示最终输出");

    await evaluate(`(() => {
      [...document.querySelectorAll('.subagent-rail-row')]
        .find((row) => row.querySelector('.subagent-rail-agent')?.textContent.trim() === 'builder')?.click();
      return true;
    })()`);
    await poll(`document.querySelector('.subagent-dialog-agent')?.textContent.trim() === 'builder'`, "切换子任务");
    const second = await dialogState();
    assert.equal(second.state, "失败");
    assert.match(second.thread, /构建失败：缺少依赖/, "失败原因应出现在弹窗里");

    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await poll(`!document.querySelector('[data-subagent-modal]')`, "Esc 关闭弹窗");

    await openDialog("probe-subagent");
    await evaluate(`document.querySelector('.subagent-modal-scrim').click(); true`);
    await poll(`!document.querySelector('[data-subagent-modal]')`, "点击遮罩关闭弹窗");

    // 单个子代理：任务直接显示在这一行里。
    await inject("probe-subagent-single", {
      mode: "single",
      results: [{ agent: "scout", task: "侦察一下目录", success: true, durationMs: 2400, progress: { toolCount: 3, tokens: 900 } }],
    }, { args: { agent: "scout", task: "侦察一下目录" }, durationMs: 2400 });
    await poll(`Boolean(document.querySelector('.subagent-card[data-block-id="probe-subagent-single"]'))`, "单个子代理卡片");
    const single = await cardState("probe-subagent-single");
    assert.equal(single.title, "子代理 · scout");
    assert.equal(single.state, "ok");
    assert.match(single.task, /侦察一下目录/);
    assert.equal(single.errors.length, 0);

    // 实时进度：partialResult.details 立即驱动「运行中」，并且显示已用时长（不是一直转圈没反应）。
    await evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      thread.transcript.removeBlock("probe-subagent-live");
      thread.transcript.applyEvent({ type: "tool_execution_start", toolCallId: "probe-subagent-live", toolName: "subagent", args: { agent: "worker", task: "跑测试" } });
      thread.transcript.applyEvent({
        type: "tool_execution_update",
        toolCallId: "probe-subagent-live",
        toolName: "subagent",
        args: { agent: "worker", task: "跑测试" },
        partialResult: {
          content: [{ type: "text", text: "(running...)" }],
          details: { mode: "single", results: [{ agent: "worker", task: "跑测试", progress: { activityState: "running", currentTool: "bash", toolCount: 2, tokens: 800 } }] },
        },
      });
      return true;
    })()`);
    await poll(`Boolean(document.querySelector('.subagent-card[data-block-id="probe-subagent-live"]'))`, "运行中卡片渲染");
    await poll(
      `document.querySelector('.subagent-card[data-block-id="probe-subagent-live"]')?.dataset.state === "running"`,
      "运行中状态",
    );
    const live = await cardState("probe-subagent-live");
    assert.match(live.stateText, /运行中/);
    assert.match(live.task, /跑测试/, "运行中也应显示任务");
    // 已用时长每秒刷新：等两拍确认它在走，而不是一直空白/卡住。
    const firstMeta = live.meta;
    await wait(1600);
    const liveLater = await cardState("probe-subagent-live");
    assert.match(liveLater.meta, /\d+(\.\d+)?s/, `运行中应显示已用时长：${liveLater.meta}`);
    assert.notEqual(liveLater.meta, firstMeta, "已用时长应随时间刷新");

    // 没有结构化结果（老版本扩展）：仍然独立一行，显示任务、状态与已用时长，
    // 并且不能点开对话（没有可读的子任务）。这就是「卡在某一步没反应」的场景。
    await evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      thread.transcript.removeBlock("probe-subagent-nodetails");
      thread.transcript.applyEvent({ type: "tool_execution_start", toolCallId: "probe-subagent-nodetails", toolName: "subagent", args: { agent: "scout", task: "旧版扩展的子任务" } });
      return true;
    })()`);
    await poll(`Boolean(document.querySelector('.subagent-card[data-block-id="probe-subagent-nodetails"]'))`, "无 details 时也渲染卡片");
    const nodetails = await evaluate(`(() => {
      const card = document.querySelector('.subagent-card[data-block-id="probe-subagent-nodetails"]');
      const main = card?.querySelector('.subagent-card-main');
      return {
        state: card?.dataset.state,
        stateText: card?.querySelector('.subagent-card-state')?.textContent.trim() ?? "",
        task: card?.querySelector('.subagent-card-task')?.textContent.trim() ?? "",
        meta: card?.querySelector('.subagent-card-meta')?.textContent.trim() ?? "",
        disabled: main?.disabled ?? null,
        openHint: Boolean(card?.querySelector('.subagent-card-open')),
      };
    })()`);
    assert.equal(nodetails.state, "running", "无 details 的运行中也要标成运行中");
    assert.match(nodetails.task, /旧版扩展的子任务/, "无 details 时也要显示任务");
    assert.match(nodetails.meta, /\d+(\.\d+)?(ms|s)/, "无 details 时也要显示已用时长");
    assert.equal(nodetails.disabled, true, "没有子任务信息时不可点开对话");
    assert.equal(nodetails.openHint, false, "没有子任务信息时不显示「查看对话」");
    await evaluate('window.__piDesktop.workbench.active.value.activeThread.transcript.removeBlock("probe-subagent-nodetails"); true');

    // 停用插件 → 同样的工具退化为通用卡片
    await evaluate("window.__piDesktop.plugins.setEnabled('subagent', false).then(() => true)");
    await wait(200);
    await inject("probe-subagent-off", details);
    await poll(`Boolean(document.querySelector('.tool-card[data-block-id="probe-subagent-off"]'))`, "停用后卡片渲染");
    // 通用卡片默认折叠，先展开再看内容。
    await evaluate(`(() => {
      const card = document.querySelector('.tool-card[data-block-id="probe-subagent-off"]');
      if (card && !card.classList.contains('open')) card.querySelector('.step-head')?.click();
      return true;
    })()`);
    await poll(`Boolean(document.querySelector('.tool-card[data-block-id="probe-subagent-off"] .term-out'))`, "通用卡片展开");
    const fallback = await evaluate(`(() => {
      const card = document.querySelector('.tool-card[data-block-id="probe-subagent-off"]');
      return {
        card: Boolean(card),
        subagentCard: document.querySelectorAll('.subagent-card').length,
        hasOutput: Boolean(card?.querySelector('.term-out')),
      };
    })()`);
    assert.equal(fallback.card, true, "停用插件后应回退通用工具卡片");
    assert.equal(fallback.subagentCard, 0, "停用插件后不应再渲染子代理卡片");
    assert.equal(fallback.hasOutput, true, "通用卡片应显示原始结果");

    console.log("[subagent] PASS 插件注册 / 独立成行 / 一行信息 / 对话弹窗 / 实时时长 / 停用后回退通用卡片");
  } finally {
    await evaluate(`window.__piDesktop.plugins.setEnabled('subagent', true).then(() => true)`).catch(() => {});
    for (const id of ["probe-subagent", "probe-subagent-single", "probe-subagent-live", "probe-subagent-off", "probe-subagent-nodetails"]) {
      await evaluate(`window.__piDesktop.workbench.active.value.activeThread.transcript.removeBlock("${id}"); true`).catch(() => {});
    }
    await evaluate(`window.__piDesktop.workbench.open(${JSON.stringify(previous.cwd)}).then(() => true)`).catch(() => {});
    await evaluate(`window.__piDesktop.workbench.removeProject(${literal}).then(() => true)`).catch(() => {});
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true });
        break;
      } catch {
        await wait(400);
      }
    }
  }
}
