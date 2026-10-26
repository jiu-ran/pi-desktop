/**
 * ci 上游 `RpcClient.send()` 给**每条命令**都只留了 30 秒：
 *
 * ```js
 * const timeout = setTimeout(() => reject(new Error(`Timeout waiting for response to ${command.type}. …`)), 30000);
 * ```
 *
 * 大部分命令都是毫秒级，但 `compact`（压缩上下文）要调一次模型把整段对话总结掉，
 * 大会话动辄一两分钟——30 秒必然超时。超时只是「客户端不等了」，Pi 进程那边
 * 其实还在正常压缩，随后照样会发 `compaction_end` 事件。
 *
 * 所以这里把 `compact` 拆成两步：
 *   1. 正常发命令；如果回的是「超时」，不当成失败；
 *   2. 改为等 `compaction_end` 事件（上限 10 分钟）。
 * 其它错误（模型没配、进程挂了…）照原样抛出，不能被吞掉。
 */

/** 上游 RpcClient 的单命令超时 */
export const COMPACT_RPC_TIMEOUT_MS = 30_000;
/** 压缩本身的上限：有的大会话确实很慢，给足 10 分钟 */
export const COMPACT_FINISH_TIMEOUT_MS = 10 * 60 * 1_000;

export interface CompactEvent {
  type?: string;
}

export interface CompactClient {
  compact(instructions?: string): Promise<unknown>;
  onEvent(listener: (event: CompactEvent) => void): () => void;
}

export interface CompactOptions {
  /** 等 `compaction_end` 的上限（测试可以传很小的值） */
  finishTimeoutMs?: number;
}

export type CompactOutcome =
  /** 命令在 30 秒内就返回了（小会话的常见情况） */
  | { slow: false; value: unknown }
  /** 客户端先超时了，结果是等 `compaction_end` 事件拿到的 */
  | { slow: true; value: undefined };

/** 只有「等 compact 响应超时」算慢，别的错误要原样抛出 */
export function isCompactTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Timeout waiting for response to compact");
}

function waitForEvent(finished: Promise<void>, alreadyEnded: boolean, ms: number): Promise<void> {
  if (alreadyEnded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`压缩上下文超时（${Math.round(ms / 60_000)} 分钟没结束）：压缩可能仍在后台进行，稍后刷新会话即可看到结果`));
    }, ms);
    void finished.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function runCompact(
  client: CompactClient,
  instructions: string | undefined,
  options: CompactOptions = {},
): Promise<CompactOutcome> {
  let ended = false;
  let settle = (): void => {};
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const off = client.onEvent((event) => {
    if (event?.type !== "compaction_end") return;
    ended = true;
    off();
    settle();
  });

  try {
    const value = await client.compact(instructions);
    off();
    return { slow: false, value };
  } catch (error) {
    if (!isCompactTimeout(error)) {
      off();
      throw error;
    }
  }

  try {
    await waitForEvent(finished, ended, options.finishTimeoutMs ?? COMPACT_FINISH_TIMEOUT_MS);
  } finally {
    off();
  }
  return { slow: true, value: undefined };
}
