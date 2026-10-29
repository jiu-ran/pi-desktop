import { spawn, type ChildProcess } from "node:child_process";

/**
 * 自己实现的 Pi RPC 客户端（替代 SDK 里的 `RpcClient`）。
 *
 * 协议很简单：一行一个 JSON。我们自己发 `{type, ...args, id}`，Pi 回
 * `{type: "response", id, success, data | error}`，其余行都是事件。
 * 这样做的两个好处：
 * 1. 不再把 `@earendil-works/pi-coding-agent` 拖进依赖（会话跑的是本机安装的 Pi）；
 * 2. 启动方式由我们决定 —— 用 `process.execPath` + `ELECTRON_RUN_AS_NODE`，
 *    不需要机器上 `node` 在 PATH 里（SDK 版写死 `spawn("node", …)`）。
 */

/** 单条命令的默认超时；压缩上下文这类长任务由调用方自己等事件。 */
export const RPC_DEFAULT_TIMEOUT_MS = 30_000;

/**
 * 命令超时。带上 `rpcTimeout` 标记和 `method`：调用方（例如压缩上下文）要区分
 * 「只是客户端不等了，Pi 还在干活」和真正的失败，用标记判断比匹配文案可靠。
 */
export class RpcTimeoutError extends Error {
  readonly rpcTimeout = true;
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number, stderr: string) {
    super(`等待 ${method} 响应超时（${timeoutMs}ms）${stderr ? `：${stderr.slice(-400)}` : ""}`);
    this.name = "RpcTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * 方法名（白名单里的 camelCase）→ 参数顺序。
 * 参数名用来拼 wire 上的字段名，命令类型由方法名转 snake_case 得到。
 */
export const RPC_COMMAND_PARAMS: Record<string, string[]> = {
  prompt: ["message", "images", "streamingBehavior"],
  steer: ["message", "images"],
  followUp: ["message", "images"],
  abort: [],
  clearQueue: [],
  newSession: ["parentSession"],
  switchSession: ["sessionPath"],
  getState: [],
  getMessages: [],
  setModel: ["provider", "modelId"],
  getAvailableModels: [],
  setThinkingLevel: ["level"],
  getAvailableThinkingLevels: [],
  setAutoCompaction: ["enabled"],
  setAutoRetry: ["enabled"],
  setSteeringMode: ["mode"],
  setFollowUpMode: ["mode"],
  compact: ["customInstructions"],
  getSessionStats: [],
  getCommands: [],
  getTree: [],
  fork: ["entryId"],
  setSessionName: ["name"],
  clone: [],
  getForkMessages: [],
  getLastAssistantText: [],
  exportHtml: ["outputPath"],
};

/** 有些命令的 data 里还包了一层，调用方要的是里面那项。 */
const RESULT_KEYS: Record<string, string> = {
  prompt: "disposition",
  getAvailableModels: "models",
  getAvailableThinkingLevels: "levels",
  getCommands: "commands",
  getMessages: "messages",
  getForkMessages: "messages",
  getLastAssistantText: "text",
};

export function rpcCommandType(method: string): string {
  return method.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

export interface PiRpcOptions {
  /** Pi 的 `dist/cli.js` */
  entry: string;
  cwd?: string;
  env?: Record<string, string>;
}

type Listener = (event: any) => void;

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class PiRpcClient {
  process: ChildProcess | null = null;
  private listeners: Listener[] = [];
  private pending = new Map<string, Pending>();
  private requestId = 0;
  private stderr = "";
  private exitError: Error | null = null;
  private buffer = "";
  private stopping = false;

  private readonly options: PiRpcOptions;

  constructor(options: PiRpcOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.process) throw new Error("RPC 客户端已经启动");
    this.exitError = null;
    this.stopping = false;
    this.buffer = "";

    const child = spawn(process.execPath, [this.options.entry, "--mode", "rpc"], {
      cwd: this.options.cwd,
      env: {
        ...process.env,
        // 打包后的 process.execPath 是 Electron 本体：这个开关让它按 Node 跑
        ELECTRON_RUN_AS_NODE: "1",
        ...this.options.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process = child;

    child.stderr?.on("data", (chunk) => {
      this.stderr += String(chunk);
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.consume(chunk));

    child.once("exit", (code, signal) => {
      if (this.process !== child) return;
      const error = this.exitErrorOf(code, signal);
      this.exitError = error;
      this.rejectAll(error);
    });
    child.once("error", (error) => {
      if (this.process !== child) return;
      const wrapped = new Error(`Pi 进程启动失败：${error.message}${this.stderr.slice(-400)}`);
      this.exitError = wrapped;
      this.rejectAll(wrapped);
    });
    child.stdin?.on("error", (error) => {
      if (this.process !== child) return;
      const wrapped = this.exitError ?? new Error(`Pi 进程 stdin 写入失败：${error.message}`);
      this.exitError = wrapped;
      this.rejectAll(wrapped);
    });

    // 和 SD 一样给进程一点启动时间：一开始就退出说明入口不对（例如版本不匹配）
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (this.process.exitCode !== null) {
      throw this.exitError ?? this.exitErrorOf(this.process.exitCode, this.process.signalCode);
    }
  }

  async stop(): Promise<void> {
    const child = this.process;
    if (!child) return;
    this.stopping = true;
    // 进程已经退出时不要再等 exit 事件（它早就发过了），否则这里会白等 1 秒
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin?.end();
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 1000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.process = null;
    this.rejectAll(new Error("RPC 客户端已停止"));
  }

  onEvent(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  getStderr(): string {
    return this.stderr;
  }

  /** 通用发送：方法名按 COMMANDS 表取参数名，未登记的方法直接拒绝（白名单在外面）。 */
  async send(method: string, args: any[] = [], timeoutMs = RPC_DEFAULT_TIMEOUT_MS): Promise<any> {
    const params = RPC_COMMAND_PARAMS[method];
    if (!params) throw new Error(`不支持的 RPC 方法：${method}`);
    const child = this.process;
    const stdin = child?.stdin;
    if (!child || !stdin) throw new Error("RPC 客户端未启动");
    if (this.exitError) throw this.exitError;

    const payload: Record<string, any> = { type: rpcCommandType(method) };
    params.forEach((name, index) => {
      const value = args[index];
      if (value !== undefined) payload[name] = value;
    });
    const id = `req_${++this.requestId}`;
    payload.id = id;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcTimeoutError(method, timeoutMs, this.stderr));
      }, timeoutMs);
      this.pending.set(id, {
        timer,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (error: any) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`写入 Pi 进程失败：${error?.message ?? error}`));
      }
    });
  }

  /** 快照/模型/消息这类调用直接返回结果，不经过通用 send 的 data 解包。 */
  private async call<T>(method: string, args: any[] = []): Promise<T> {
    const data = await this.send(method, args);
    const key = RESULT_KEYS[method];
    if (!key) return data as T;
    if (data && typeof data === "object" && key in data) return (data as Record<string, any>)[key] as T;
    // getLastAssistantText 允许 null
    return (key === "text" ? null : []) as unknown as T;
  }

  prompt(message: string, images?: any, streamingBehavior?: string): Promise<any> {
    return this.call("prompt", [message, images, streamingBehavior]);
  }
  steer(message: string, images?: any): Promise<any> {
    return this.call("steer", [message, images]);
  }
  followUp(message: string, images?: any): Promise<any> {
    return this.call("followUp", [message, images]);
  }
  abort(): Promise<any> {
    return this.call("abort");
  }
  clearQueue(): Promise<any> {
    return this.call("clearQueue");
  }
  newSession(parentSession?: string): Promise<any> {
    return this.call("newSession", [parentSession]);
  }
  switchSession(sessionPath: string): Promise<any> {
    return this.call("switchSession", [sessionPath]);
  }
  getState(): Promise<any> {
    return this.call("getState");
  }
  getMessages(): Promise<any[]> {
    return this.call("getMessages");
  }
  getAvailableModels(): Promise<any[]> {
    return this.call("getAvailableModels");
  }
  getAvailableThinkingLevels(): Promise<any[]> {
    return this.call("getAvailableThinkingLevels");
  }
  getCommands(): Promise<any[]> {
    return this.call("getCommands");
  }
  setThinkingLevel(level: string): Promise<any> {
    return this.call("setThinkingLevel", [level]);
  }
  // 下面四个是界面开关（自动压缩 / 自动重试 / 引导模式 / 追问模式）：
  // `pi-host.ts` 是 `client[method](...)` 泛化调用的，类上少一个方法就是运行时报错
  setAutoCompaction(enabled: boolean): Promise<any> {
    return this.call("setAutoCompaction", [enabled]);
  }
  setAutoRetry(enabled: boolean): Promise<any> {
    return this.call("setAutoRetry", [enabled]);
  }
  setSteeringMode(mode: string): Promise<any> {
    return this.call("setSteeringMode", [mode]);
  }
  setFollowUpMode(mode: string): Promise<any> {
    return this.call("setFollowUpMode", [mode]);
  }
  setModel(provider: string, modelId: string): Promise<any> {
    return this.call("setModel", [provider, modelId]);
  }
  compact(customInstructions?: string): Promise<any> {
    return this.call("compact", [customInstructions]);
  }
  getSessionStats(): Promise<any> {
    return this.call("getSessionStats");
  }
  getTree(): Promise<any> {
    return this.call("getTree");
  }
  fork(entryId: string): Promise<any> {
    return this.call("fork", [entryId]);
  }
  clone(): Promise<any> {
    return this.call("clone");
  }
  getForkMessages(): Promise<any[]> {
    return this.call("getForkMessages");
  }
  getLastAssistantText(): Promise<string | null> {
    return this.call("getLastAssistantText");
  }
  exportHtml(outputPath?: string): Promise<any> {
    return this.call("exportHtml", [outputPath]);
  }
  setSessionName(name: string): Promise<any> {
    return this.call("setSessionName", [name]);
  }

  // ---------- 内部 ----------

  private consume(chunk: string): void {
    this.buffer += chunk;
    // 没换行的超大输出（坏掉的扩展、二进制垃圾）不能无限吃内存
    if (this.buffer.length > 16 * 1024 * 1024) {
      this.stderr += "\n[RPC] 单行超过 16 MB，已丢弃";
      this.buffer = "";
      return;
    }
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.handleLine(line);
      index = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let data: any;
    try {
      data = JSON.parse(line);
    } catch {
      // 非 JSON 行（Pi 里的 console.log、扩展的调试输出）直接忽略，别打断协议
      return;
    }
    if (data?.type === "response" && typeof data.id === "string" && this.pending.has(data.id)) {
      const pending = this.pending.get(data.id)!;
      this.pending.delete(data.id);
      if (data.success === false) pending.reject(new Error(String(data.error ?? "Pi 返回失败")));
      else pending.resolve(data.data);
      return;
    }
    for (const listener of [...this.listeners]) listener(data);
  }

  private rejectAll(error: Error): void {
    for (const pending of [...this.pending.values()]) pending.reject(error);
    this.pending.clear();
  }

  private exitErrorOf(code: number | null, signal: NodeJS.Signals | null): Error {
    if (this.stopping) return new Error("Pi 进程已停止");
    return new Error(`Pi 进程退出（code=${code ?? "null"} signal=${signal ?? "null"}）：${this.stderr.slice(-400) || "没有输出"}`);
  }
}
