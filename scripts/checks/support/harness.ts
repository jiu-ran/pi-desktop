import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 检查脚本共用的小工具。
 *
 * 以前每个 `.check.ts` 都自己写一份 `assert` / `expectReject`，还要各自搭一个
 * localStorage 替身才能加载 `workbench.ts`；同一段 15 行的假 localStorage 在
 * 5 个文件里抄了 5 遍。放到这里之后，新增检查只需要 import 即可，
 * 失败信息也统一成「消息：实际值」。
 *
 * 只放真正被两个以上检查用到的东西，别把这里做成通用测试框架。
 */

/** 断言为真；`message` 直接说明期望，失败时原样抛出 */
export function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

/** 相等断言：失败信息带上期望与实际，不用每处手拼 */
export function assertEqual<T>(actual: T, expected: T, message = ""): void {
  if (Object.is(actual, expected)) return;
  const prefix = message ? `${message}：` : "";
  throw new Error(`${prefix}期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

/** 深比较断言（数组 / 对象 / 嵌套结构） */
export function assertDeepEqual(actual: unknown, expected: unknown, message = ""): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left === right) return;
  const prefix = message ? `${message}：` : "";
  throw new Error(`${prefix}期望 ${right}，实际 ${left}`);
}

/** 断言这段异步操作抛错（用于拒绝非法参数、保护性错误） */
export async function expectReject(run: () => Promise<unknown>, message: string): Promise<void> {
  let rejected = false;
  try {
    await run();
  } catch {
    rejected = true;
  }
  assert(rejected, message);
}

/** 轮询直到 `read` 返回真值；超时抛出带标签的错误 */
export async function waitFor<T>(read: () => T | undefined | false | "", label: string, timeout = 12_000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = read();
    if (value) return value as T;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`等待超时：${label}`);
}

/** 建一个带前缀的临时目录（Windows 上 %TEMP% 可能不存在，统一走 os.tmpdir） */
export function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export interface FakeLocalStorage {
  /** 底层存储，检查里可以直接读它验证落盘内容 */
  store: Map<string, string>;
  /** 清空，让每个场景从干净状态开始 */
  reset(): void;
}

/**
 * 装一个最小的 localStorage 替身（界面侧只依赖 getItem/setItem/removeItem/key/length）。
 *
 * 必须在使用 `workbench.ts` / `settings.ts` 之前调用：这两个模块在导入时就会读 localStorage。
 */
export function installFakeLocalStorage(): FakeLocalStorage {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  } as Storage;
  return {
    store,
    reset: () => store.clear(),
  };
}
