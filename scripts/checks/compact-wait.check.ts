import assert from "node:assert/strict";
import {
  COMPACT_FINISH_TIMEOUT_MS,
  COMPACT_RPC_TIMEOUT_MS,
  isCompactTimeout,
  isTokenCapFailure,
  runCompact,
  runCompactResilient,
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
  // 自己实现的 RpcTimeoutError 靠标记判断，不匹配文案
  assert.equal(
    isCompactTimeout(Object.assign(new Error("等待 compact 响应超时（30000ms）"), { rpcTimeout: true, method: "compact" })),
    true,
    "RpcTimeoutError（带 rpcTimeout 标记）要能识别",
  );
  assert.equal(
    isCompactTimeout(Object.assign(new Error("等待 prompt 响应超时"), { rpcTimeout: true, method: "prompt" })),
    false,
    "别的命令超时不能当成压缩变慢",
  );
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

  // 8. 摘要撞输出上限：临时把思考等级降到 off 重试一次，成功后还原等级
  {
    const levels: string[] = [];
    let calls = 0;
    const client = fakeClient({
      respond: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error(
            "Compaction failed: Summarization failed: generation hit the token cap and the summary is incomplete",
          );
        }
        return { ok: true };
      },
    });
    const outcome = await runCompactResilient(client, undefined, {
      getThinkingLevel: async () => "high",
      setThinkingLevel: (level) => {
        levels.push(level);
      },
    });
    assert.equal(calls, 2, "要重试一次");
    assert.deepEqual(levels, ["off", "high"], "先降级、结束后还原");
    assert.equal(outcome.slow, false);
    assert.equal(outcome.retriedFrom, "high");
  }

  // 9. 思考等级本来就是 off：不重试（重试也救不了），原错误抛出
  {
    let calls = 0;
    const client = fakeClient({
      respond: async () => {
        calls += 1;
        throw new Error("Summarization failed: generation hit the token cap and the summary is incomplete");
      },
    });
    await assert.rejects(
      () =>
        runCompactResilient(client, undefined, {
          getThinkingLevel: () => "off",
          setThinkingLevel: () => {
            throw new Error("不该改等级");
          },
        }),
      /token cap/,
    );
    assert.equal(calls, 1, "off 就不再重试");
  }

  // 10. 重试也失败：错误抛出，但思考等级必须还原
  {
    const levels: string[] = [];
    const client = fakeClient({
      respond: async () => {
        throw new Error("Summarization failed: generation hit the token cap and the summary is incomplete");
      },
    });
    await assert.rejects(
      () =>
        runCompactResilient(client, undefined, {
          getThinkingLevel: () => "medium",
          setThinkingLevel: (level) => {
            levels.push(level);
          },
        }),
      /token cap/,
    );
    assert.deepEqual(levels, ["off", "medium"], "失败也要还原等级");
  }

  // 11. 其它错误不重试（重试救不了，白等一两分钟）
  {
    let calls = 0;
    const client = fakeClient({
      respond: async () => {
        calls += 1;
        throw new Error("Model not found: foo/bar");
      },
    });
    await assert.rejects(
      () =>
        runCompactResilient(client, undefined, {
          getThinkingLevel: () => "high",
          setThinkingLevel: () => {
            throw new Error("不该改等级");
          },
        }),
      /Model not found/,
    );
    assert.equal(calls, 1);
    assert.equal(isTokenCapFailure(new Error("Model not found: foo/bar")), false);
    assert.equal(
      isTokenCapFailure(new Error("Summarization failed: generation hit the token cap and the summary is incomplete")),
      true,
    );
  }

  console.log("[compact-wait] ok");
}

await main();
