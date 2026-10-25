import assert from "node:assert/strict";
import {
  ASYNC_WIDGET_PREFIX,
  INSPECT_WIDGET_PREFIX,
  parseAsyncSnapshot,
  parsePrefixedJson,
  snapshotNodeDetail,
  snapshotStateLabel,
  snapshotStateTone,
  snapshotSummary,
} from "../../packages/ui/src/shared/subagent-widget.ts";

/** 真实快照（取自用户会话里 pi-subagents 推给宿主的那一条，字段照抄）。 */
const snapshot = {
  kind: "pi-subagents.async-status-snapshot",
  version: 1,
  generatedAt: 1792572989594,
  caps: { maxRuns: 20, maxChildrenPerNode: 8, maxDepth: 3, maxStringLength: 160, maxSerializedBytes: 32768 },
  omitted: { runs: 0, children: 0, byteLimitExceeded: false },
  runs: [
    {
      id: "8fcf1559-3f7b-429a-a5d6-51a762800f60",
      kind: "subagent",
      label: "delegate",
      state: "running",
      startedAt: 1792572954502,
      updatedAt: 1792573046424,
      children: [
        {
          id: "step:0",
          kind: "step",
          label: "delegate",
          state: "running",
          startedAt: 1792572954513,
          updatedAt: 1792572954513,
          agent: "delegate",
          model: "magpie/opendsign/deepseek-v4.1-flash",
          thinking: "low",
        },
      ],
    },
    {
      id: "8b6cc47e-b4b3-4d1a-92f1-3b821daa1523",
      kind: "workflow",
      label: "scout",
      state: "running",
      startedAt: 1792573044262,
      updatedAt: 1792573044394,
      activity: { currentTool: "map", turnCount: 2, toolCount: 3 },
      children: [
        {
          id: "scan",
          kind: "step",
          label: "Map order module",
          state: "running",
          startedAt: 1792573045494,
          updatedAt: 1792573046502,
          agent: "scout",
          model: "magpie/opendsign/deepseek-v4.1-flash",
          thinking: "low",
        },
      ],
    },
  ],
};

const lines = [`${ASYNC_WIDGET_PREFIX}${JSON.stringify(snapshot)}`];
const parsed = parseAsyncSnapshot(lines);
assert.ok(parsed, "应能解析 subagent-async 快照");
assert.equal(parsed!.runs.length, 2);
assert.equal(parsed!.runs[0].label, "delegate");
assert.equal(parsed!.runs[0].state, "running");
assert.equal(parsed!.runs[0].children[0].agent, "delegate");
assert.equal(parsed!.runs[1].kind, "workflow");
assert.equal(parsed!.runs[1].children[0].label, "Map order module");
assert.equal(parsed!.runs[1].activity.currentTool, "map");
assert.equal(parsed!.runs[1].activity.toolCount, 3);
assert.equal(parsed!.generatedAt, 1792572989594);

// 汇总文案：只数到顶层与 workflow 级节点，步骤不重复计数
assert.equal(snapshotSummary(parsed!), "2 个运行中");

// 状态文案与色调
assert.equal(snapshotStateLabel("queued"), "排队中");
assert.equal(snapshotStateLabel("partial"), "部分完成");
assert.equal(snapshotStateTone("complete"), "ok");
assert.equal(snapshotStateTone("running"), "run");
assert.equal(snapshotStateTone("failed"), "err");
assert.equal(snapshotStateTone("rejected"), "err");
assert.equal(snapshotStateTone("paused"), "muted");

// 行细节：当前工具 / 轮数 / 工具数 / agent / 思考深度
const detail = snapshotNodeDetail(parsed!.runs[1]);
assert.match(detail, /map/);
assert.match(detail, /2 轮/);
assert.match(detail, /3 工具/);
assert.match(detail, /思考 low/);
assert.doesNotMatch(detail, /scout scout/, "agent 与 label 相同时不重复显示");

// 不是快照的 widget 不接管（普通 widget 仍按原样显示）
assert.equal(parseAsyncSnapshot(["构建中…", "剩余 3 步"]), null);
assert.equal(parseAsyncSnapshot([]), null);
assert.equal(parseAsyncSnapshot([`${ASYNC_WIDGET_PREFIX}{"kind":"other"}`]), null, "kind 不对就不算快照");
assert.equal(parseAsyncSnapshot([`${ASYNC_WIDGET_PREFIX}不是 JSON`]), null);

// 多行 / 后缀垃圾：逐步退到能解析为止
const wrapped = [`${ASYNC_WIDGET_PREFIX}${JSON.stringify(snapshot)}`, "trailing note"];
assert.ok(parseAsyncSnapshot(wrapped), "后面跟了别的行也要能解析");
const folded = [`${ASYNC_WIDGET_PREFIX}{"kind":"pi-subagents.async-status-snapshot",`, `"runs":[{"id":"a","label":"x","state":"complete"}]}`];
assert.ok(parseAsyncSnapshot(folded), "被折成多行的 payload 也要能解析");

// inspect widget：宿主不能显示，只按 requestId 缓冲 —— 这里只验证前缀识别
const inspectText = `${INSPECT_WIDGET_PREFIX}{"kind":"pi-subagents.inspect-reply","requestId":"r1"}`;
assert.ok(parsePrefixedJson(inspectText, INSPECT_WIDGET_PREFIX), "应该能取出 inspect 的 JSON");
assert.equal(parsePrefixedJson("no prefix here", INSPECT_WIDGET_PREFIX), null);

// 畸形数据不能把界面打崩
const broken = parseAsyncSnapshot([`${ASYNC_WIDGET_PREFIX}{"kind":"pi-subagents.async-status-snapshot","runs":[{"state":"???"},{"id":"b"}]}`]);
assert.ok(broken);
assert.equal(broken!.runs[0].state, "running", "未知状态回落到运行中");
assert.equal(broken!.runs[1].label, "");

console.log("subagent-widget OK");
