import assert from "node:assert/strict";
import { PI_RPC_ALLOWLIST } from "../../electron/pi-rpc-allowlist.ts";
import { RPC_COMMAND_PARAMS, rpcCommandType } from "../../electron/pi-rpc.ts";

/**
 * 自己实现的 RPC 客户端要和 Pi 的 wire 协议对得上。
 *
 * `pi-host.ts` 是 `client[method](...args)` 泛化调用的，所以「白名单里的方法名」
 * 必须同时出现在 RPC_COMMAND_PARAMS 里，否则用户一点就报「不支持的 RPC 方法」。
 * 这里把两边的对应关系钉死。
 */

for (const method of PI_RPC_ALLOWLIST) {
  if (method === "setMaxIdleWorkers") continue; // 桌面端自己处理，不走 Pi
  assert.ok(method in RPC_COMMAND_PARAMS, `白名单方法 ${method} 没有对应的 RPC 参数表`);
}

for (const method of Object.keys(RPC_COMMAND_PARAMS)) {
  assert.ok(PI_RPC_ALLOWLIST.includes(method), `RPC 参数表里的 ${method} 不在白名单里`);
}

const wire: Array<[string, string]> = [
  ["prompt", "prompt"],
  ["followUp", "follow_up"],
  ["clearQueue", "clear_queue"],
  ["newSession", "new_session"],
  ["switchSession", "switch_session"],
  ["getState", "get_state"],
  ["getAvailableThinkingLevels", "get_available_thinking_levels"],
  ["setAutoCompaction", "set_auto_compaction"],
  ["getSessionStats", "get_session_stats"],
  ["exportHtml", "export_html"],
  ["getLastAssistantText", "get_last_assistant_text"],
];
for (const [method, type] of wire) {
  assert.equal(rpcCommandType(method), type, `${method} 应该映射到 ${type}`);
}

// 参数顺序直接决定 wire 上的字段值：错了就是「改模型变成改成别的字段」
assert.deepEqual(RPC_COMMAND_PARAMS.setModel, ["provider", "modelId"]);
assert.deepEqual(RPC_COMMAND_PARAMS.prompt, ["message", "images", "streamingBehavior"]);
assert.deepEqual(RPC_COMMAND_PARAMS.switchSession, ["sessionPath"]);
assert.deepEqual(RPC_COMMAND_PARAMS.fork, ["entryId"]);
assert.deepEqual(RPC_COMMAND_PARAMS.compact, ["customInstructions"]);
assert.deepEqual(RPC_COMMAND_PARAMS.setSessionName, ["name"]);
assert.deepEqual(RPC_COMMAND_PARAMS.bash ?? [], [], "bash 不在白名单里，不应该出现参数表");

console.log(`pi-rpc OK 白名单 ${PI_RPC_ALLOWLIST.length} 个方法都有参数表 / 命令类型映射 / 关键字段顺序`);
