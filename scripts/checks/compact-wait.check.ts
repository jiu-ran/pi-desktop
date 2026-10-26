import assert from "node:assert/strict";
import {
  COMPACT_FINISH_TIMEOUT_MS,
  COMPACT_RPC_TIMEOUT_MS,
  isCompactTimeout,
  runCompact,
} from "../../electron/compact-wait.ts";

/** 假客户端：可以控制「命令什么时候回 / 回什么」以及「事件什么时候来」 */
function fakeClient(options: {
  respond?: () => Promise<unknown>;
  events?: string[];
}) {
  const listeners = new Set<(event: { type?: string }) => void>();
  let unsubscribeCount = 0;
  const emit = (type: string): void => {
    options.events?.push(type);
    for (const listener of [...listeners]) listener({ type });
  };
  return {
    emit,
    get listening(): number {
      return listeners.size;
    },
    get unsubscribed(): number {
      return unsubscribeCount;
    },
    compact: options.respond ?? (async () => ({ ok: true })),
    onEvent(listener: (event: { type?: string }) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribeCount += 1;
      };
    },
  };
}

const timeoutError = (method = "compact"): Error =>
  new Error(`Timeout waiting for response to ${method}. Stderr: `);

async function main(): Promise<void> {
  // 1. 常量本身：上游是 30 秒，等完成事件的上限要宽得多
  assert.equal(COMPACT_RPC_TIMEOUT_MS, 30_000);
  assert.ok(COMPACT_FINISH_TIMEOUT_MS >= 5 * 60_000, "等 compaction_end 的上限至少 5 分钟");

  // 2. 只认 compact 的超时，别的超时/错误要能区分
  assert.equal(isCompactTimeout(timeoutError()), true);
  assert.equal(isCompactTimeout(timeoutError("prompt")), false, "prompt 超时不能被当成 compact 慢");
  assert.equal(isCompactTimeout(new Error("Model not found")), false);
  assert.equal(isCompactTimeout(undefined), false);

  // 3. 小会话：命令 30 秒内就回了，拿到结果，不需要等事件
  {
    const client = fakeClient({ respond: async () => ({ summary: "done" }) });
    const outcome = await runCompact(client, "精简一点");
    assert.equal(outcome.slow, false);
    assert.deepEqual(outcome.value, { summary: "done" });
    assert.equal(client.listening, 0, "返回后必须解绑事件监听");
  }

  // 4. 大会话：客户端 30 秒超时，但压缩还在跑 —— 不能报错，要等 compaction_end
  {
    const events: string[] = [];
    const client = fakeClient({
      respond: async () => {
        throw timeoutError();
      },
      events,
    });
    let settled = false;
    const pending = runCompact(client, undefined).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settled, false, "还没收到 compaction_end 就不能提前返回");
    assert.equal(client.listening, 1, "超时后要继续监听完成事件");

    client.emit("compaction_start");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(settled, false, "compaction_start 只是开始，还不能算完成");

    client.emit("compaction_end");
    const outcome = await pending;
    assert.equal(outcome.slow, true, "超时后完成要走 slow 分支");
    assert.equal(client.listening, 0, "完成后要解绑");
  }

  // 5. 事件先到、超时后到：也不能卡住
  {
    const client = fakeClient({
      respond: async () => {
        client.emit("compaction_end");
        throw timeoutError();
      },
    });
    const outcome = await runCompact(client, undefined);
    assert.equal(outcome.slow, true);
  }

  // 6. 一直没结束：按上限报「压缩上下文超时」，并且解绑监听
  {
    const client = fakeClient({
      respond: async () => {
        throw timeoutError();
      },
    });
    await assert.rejects(
      () => runCompact(client, undefined, { finishTimeoutMs: 30 }),
      /压缩上下文超时/,
    );
    assert.equal(client.listening, 0, "报错也要解绑");
  }

  // 7. 真错误（不是超时）必须原样抛出，不能被「等事件」掩盖
  {
    const client = fakeClient({
      respond: async () => {
        throw new Error("Model not found: foo/bar");
      },
    });
    await assert.rejects(() => runCompact(client, undefined), /Model not found/);
    assert.equal(client.listening, 0);
  }

  console.log("[compact-wait] ok");
}

await main();
