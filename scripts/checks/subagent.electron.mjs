import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * 子代理插件回归（隔离临时工作区，避免与真实会话的流式回填竞争）：
 * - 插件注册在「对话区域」，可停用
 * - 结构化 details 渲染为子任务清单（状态 / 耗时 / 用量 / 失败原因）
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

  const expandCard = (id) =>
    evaluate(`(() => {
      const card = document.querySelector('.tool-card[data-block-id="${id}"]');
      if (!card) return false;
      if (!card.classList.contains('open')) card.querySelector('.step-head')?.click();
      return true;
    })()`);

  /** 子任务清单默认折叠（只有失败时自动展开），检查里显式展开。 */
  const expandList = (id) =>
    evaluate(`(() => {
      const card = document.querySelector('.tool-card[data-block-id="${id}"]');
      if (!card) return false;
      if (card.querySelector('.subagent-rows')) return true;
      card.querySelector('.subagent-head')?.click();
      return true;
    })()`);

  const inject = (id, details) =>
    evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      thread.transcript.removeBlock("${id}");
      thread.transcript.applyEvent({
        type: "tool_execution_end",
        toolCallId: "${id}",
        toolName: "subagent",
        result: {
          content: [{ type: "text", text: "3 个子代理已完成，其中 1 个失败" }],
          details: ${JSON.stringify(details)},
        },
        isError: false,
        durationMs: 72000,
      });
      return true;
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
    await poll(`Boolean(document.querySelector('.tool-card[data-block-id="probe-subagent"]'))`, "子代理卡片渲染");
    await expandCard("probe-subagent");
    await expandList("probe-subagent");
    await poll(
      `document.querySelectorAll('.tool-card[data-block-id="probe-subagent"] .subagent-row').length === 3`,
      "子任务清单渲染",
    );

    const view = await evaluate(`(() => {
      const card = document.querySelector('.tool-card[data-block-id="probe-subagent"]');
      const rows = [...card.querySelectorAll('.subagent-row')].map(row => ({
        state: row.dataset.state,
        agent: row.querySelector('.subagent-agent')?.textContent ?? "",
        stateText: row.querySelector('.subagent-state')?.textContent ?? "",
        meta: row.querySelector('.subagent-meta')?.textContent ?? "",
        error: row.querySelector('.subagent-error')?.textContent ?? "",
      }));
      return {
        rows,
        head: card.querySelector('.subagent-head')?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
        badge: card.querySelector('.step-badge')?.textContent?.trim() ?? "",
        verb: card.querySelector('.step-verb')?.textContent?.trim() ?? "",
      };
    })()`);

    assert.deepEqual(view.rows.map((row) => row.agent), ["reviewer", "builder", "tester"]);
    assert.deepEqual(view.rows.map((row) => row.state), ["ok", "failed", "timeout"]);
    assert.equal(view.rows[0].stateText, "完成");
    assert.equal(view.rows[1].stateText, "失败");
    assert.equal(view.rows[2].stateText, "超时");
    assert.match(view.rows[0].meta, /12\.4s/, "成功项应显示耗时");
    assert.match(view.rows[0].meta, /7 工具/, "成功项应显示工具调用数");
    assert.match(view.rows[0].meta, /4200 tok/, "成功项应显示 token 数");
    assert.equal(view.rows[1].error, "构建失败：缺少依赖", "失败原因应可见");
    assert.match(view.head, /3 个子任务/, "汇总行应显示子任务数量");
    assert.match(view.head, /1 完成/, "汇总行应显示完成数");
    assert.match(view.head, /2 失败/, "汇总行应显示失败数（含超时）");
    assert.equal(view.badge, "并行", "徽标应显示模式");
    assert.equal(view.verb, "子代理");

    // 点击子任务行 → 弹窗查看该子代理的对话（不新建会话，只覆盖当前界面）。
    const openRow = (agent) =>
      evaluate(`(() => {
        const card = document.querySelector('.tool-card[data-block-id="probe-subagent"]');
        const row = [...card.querySelectorAll('.subagent-row')]
          .find((item) => item.querySelector('.subagent-agent')?.textContent.trim() === ${JSON.stringify(agent)});
        if (!row) return false;
        row.click();
        return true;
      })()`);
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

    assert(await openRow("reviewer"), "应能点击子任务行");
    await poll(`Boolean(document.querySelector('[data-subagent-modal]'))`, "子代理对话弹窗打开");
    const firstDialog = await dialogState();
    assert.equal(firstDialog.agent, "reviewer", "弹窗应显示被点击的子代理");
    assert.equal(firstDialog.state, "完成");
    assert.match(firstDialog.meta, /12\.4s/, "弹窗头部应显示耗时");
    assert.deepEqual(firstDialog.rail.map((item) => item.agent), ["reviewer", "builder", "tester"], "并行时左侧应列出全部子任务");
    assert.equal(firstDialog.rail[0].active, true);
    // 这条结果没有会话文件：退回展示最终输出，并说明原因。
    assert.match(firstDialog.thread, /没有留下子代理会话文件/, "缺少会话文件时应说明回退原因");
    assert.match(firstDialog.thread, /看起来没问题/, "回退时应展示最终输出");

    // 左侧切换子任务
    await evaluate(`(() => {
      const rows = [...document.querySelectorAll('.subagent-rail-row')];
      rows.find((row) => row.querySelector('.subagent-rail-agent')?.textContent.trim() === 'builder')?.click();
      return true;
    })()`);
    await poll(`document.querySelector('.subagent-dialog-agent')?.textContent.trim() === 'builder'`, "切换子任务");
    const secondDialog = await dialogState();
    assert.equal(secondDialog.state, "失败");
    assert.match(secondDialog.thread, /构建失败：缺少依赖/, "失败原因应出现在弹窗里");

    // Esc 关闭
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await poll(`!document.querySelector('[data-subagent-modal]')`, "Esc 关闭弹窗");

    // 点遮罩关闭
    assert(await openRow("tester"), "应能再次打开弹窗");
    await poll(`Boolean(document.querySelector('[data-subagent-modal]'))`, "弹窗重新打开");
    await evaluate(`document.querySelector('.subagent-modal-scrim').click(); true`);
    await poll(`!document.querySelector('[data-subagent-modal]')`, "点击遮罩关闭弹窗");

    // 实时进度：partialResult.details 立即驱动清单
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
          details: { mode: "single", results: [{ agent: "worker", progress: { activityState: "running", currentTool: "bash", toolCount: 2, tokens: 800 } }] },
        },
      });
      return true;
    })()`);
    await poll(`Boolean(document.querySelector('.tool-card[data-block-id="probe-subagent-live"]'))`, "运行中卡片渲染");
    await expandCard("probe-subagent-live");
    await expandList("probe-subagent-live");
    await poll(
      `document.querySelectorAll('.tool-card[data-block-id="probe-subagent-live"] .subagent-row[data-state="running"]').length === 1`,
      "运行中的子任务状态",
    );
    const live = await evaluate(`(() => {
      const card = document.querySelector('.tool-card[data-block-id="probe-subagent-live"]');
      return {
        agent: card.querySelector('.subagent-agent')?.textContent ?? "",
        current: card.querySelector('.subagent-current')?.textContent ?? "",
        stat: card.querySelector('.subagent-stat.run')?.textContent ?? "",
      };
    })()`);
    assert.equal(live.agent, "worker");
    assert.equal(live.current, "bash", "运行中应显示当前工具");
    assert.match(live.stat, /1 运行中/);

    // 停用插件 → 同样的工具退化为通用卡片
    await evaluate("window.__piDesktop.plugins.setEnabled('subagent', false).then(() => true)");
    await wait(200);
    await inject("probe-subagent-off", details);
    await poll(`Boolean(document.querySelector('.tool-card[data-block-id="probe-subagent-off"]'))`, "停用后卡片渲染");
    await expandCard("probe-subagent-off");
    await poll(
      `(() => {
        const card = document.querySelector('.tool-card[data-block-id="probe-subagent-off"]');
        return Boolean(card) && card.querySelectorAll('.subagent-row').length === 0 && Boolean(card.querySelector('.term-out'));
      })()`,
      "停用插件后回退通用卡片",
    );

    console.log("[subagent] PASS 插件注册 / 子任务清单 / 状态与用量 / 对话弹窗 / 实时进度 / 停用后回退通用卡片");
  } finally {
    await evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value?.activeThread;
      if (thread) for (const id of ["probe-subagent", "probe-subagent-live", "probe-subagent-off"]) thread.transcript.removeBlock(id);
      return true;
    })()`);
    await evaluate("window.__piDesktop.plugins.setEnabled('subagent', true).then(() => true)").catch(() => {});
    await evaluate(`window.__piDesktop.workbench.open(${JSON.stringify(previous.cwd)}).then(() => true)`).catch(() => {});
    await evaluate(`window.__piDesktop.workbench.state.activePanelId=${JSON.stringify(previous.panel)}; true`).catch(() => {});
    await evaluate(`window.__piDesktop.workbench.removeProject(${literal}).then(() => true)`).catch(() => {});
    // Windows 上 Pi 子进程可能短暂占用目录：重试几次，清理失败不影响结论。
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
