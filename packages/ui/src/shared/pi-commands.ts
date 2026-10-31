/**
 * Pi CLI 的 `/` 命令清单，以及桌面端对每一条的适配方式。
 *
 * 这张表存在的理由：Pi 的内置命令是 CLI 交互模式的功能，RPC 只提供扩展 / 提示模板 /
 * 技能三类命令（`get_commands`）。桌面端必须自己实现一遍，才不会出现「CLI 有、这里
 * 没有」或者「这里有、行为不一样」的落差。所以：
 *
 * - 表里按 Pi 的版本逐条列全（`PI_COMMANDS_VERSION`），`pi-commands.check.ts` 会盯着
 *   数量与名字，Pi 升级加命令时这里必须跟着动；
 * - 每条要么 `desktop`（桌面端有等价实现，见 `services/slash-commands.ts`），
 *   要么 `terminal` 并给出 `hint`——说清楚为什么没做以及现在怎么做到。
 *
 * 这里只放数据和纯函数，不引用任何运行时对象，检查脚本可以直接跑。
 */

/** 这张表对应的 Pi 内置命令版本（升级 Pi 后要核对一遍）。 */
export const PI_COMMANDS_VERSION = "1.4.0";

export type PiCommandSupport = "desktop" | "terminal";

export interface PiCommandInfo {
  name: string;
  /** 参数提示，与 Pi 的 argumentHint 对齐（没有参数就是空串） */
  argumentHint: string;
  title: string;
  description: string;
  support: PiCommandSupport;
  /** `support === "terminal"` 时必填：没适配的原因 + 现在怎么做 */
  hint?: string;
}

export const PI_BUILTIN_COMMANDS: readonly PiCommandInfo[] = [
  {
    name: "settings",
    argumentHint: "",
    title: "偏好设置",
    description: "打开设置（桌面端打开自己的设置弹窗）",
    support: "desktop",
  },
  {
    name: "model",
    argumentHint: "<provider/model>",
    title: "选择模型",
    description: "选择当前会话使用的模型",
    support: "desktop",
  },
  {
    name: "tree",
    argumentHint: "",
    title: "会话树",
    description: "浏览会话树，切换到别的分支",
    support: "terminal",
    hint:
      "Pi 的 RPC 没有「切换分支」能力，桌面端做不了 /tree。现在可以：终端里 `pi --resume` 打开会话后按 /tree；或者用桌面端的 /fork，从某条消息分叉出新会话。",
  },
  {
    name: "thinking",
    argumentHint: "<level>",
    title: "思考等级",
    description: "设置思考深度",
    support: "desktop",
  },
  {
    name: "scoped-models",
    argumentHint: "",
    title: "轮换用的模型",
    description: "设置 Ctrl+P 轮换时包含哪些模型",
    support: "terminal",
    hint: "桌面端没有 Ctrl+P 轮换模型的开关，也就没有「轮换范围」可设。现在可以：用 /model 直接切换；或在 Pi 设置里写 `--models` 那类模型清单。",
  },
  {
    name: "export",
    argumentHint: "[路径.html|.jsonl]",
    title: "导出会话",
    description: "导出当前会话：`.html`（可分享的网页）或 `.jsonl`（原始记录）",
    support: "desktop",
  },
  {
    name: "import",
    argumentHint: "<文件.jsonl>",
    title: "导入会话",
    description: "把一个 .jsonl 会话文件导入当前项目并接着聊",
    support: "desktop",
  },
  {
    name: "share",
    argumentHint: "",
    title: "分享会话",
    description: "把会话发到 Radius / GitHub Gist",
    support: "terminal",
    hint: "分享走的是 Pi 的云端服务（Radius 网关或 GitHub Gist），需要 Pi 自己的授权，桌面端没有接入。现在可以：终端里 `pi` 打开这个会话后执行 /share；或者用 /export 导出 HTML 自己发。",
  },
  {
    name: "bug",
    argumentHint: "<描述>",
    title: "报告 Pi 的问题",
    description: "收集诊断信息，向 Pi 提交 bug",
    support: "terminal",
    hint: "这是给 Pi 本体提 bug 的入口，收集的是终端现场信息。现在可以：终端里 `pi` 执行 /bug，或直接到 https://github.com/earendil-works/pi/issues 提 issue。",
  },
  {
    name: "copy",
    argumentHint: "",
    title: "复制回复",
    description: "复制最后一条助手回复",
    support: "desktop",
  },
  {
    name: "name",
    argumentHint: "<名称>",
    title: "重命名会话",
    description: "设置会话显示名称",
    support: "desktop",
  },
  {
    name: "session",
    argumentHint: "",
    title: "会话信息",
    description: "查看会话文件、消息数与 Token 用量",
    support: "desktop",
  },
  {
    name: "changelog",
    argumentHint: "",
    title: "更新日志",
    description: "查看本版本更新了什么",
    support: "desktop",
  },
  {
    name: "hotkeys",
    argumentHint: "",
    title: "快捷键",
    description: "查看桌面端的快捷键",
    support: "desktop",
  },
  {
    name: "fork",
    argumentHint: "<消息>",
    title: "分叉会话",
    description: "从之前的某条消息分叉出新会话",
    support: "desktop",
  },
  {
    name: "clone",
    argumentHint: "",
    title: "复制会话",
    description: "在当前位置复制出一个新会话",
    support: "desktop",
  },
  {
    name: "trust",
    argumentHint: "",
    title: "项目信任",
    description: "允许或拒绝 Pi 加载这个项目的 .pi 配置、扩展、技能与 MCP",
    support: "desktop",
  },
  {
    name: "login",
    argumentHint: "<提供方>",
    title: "登录提供方",
    description: "配置模型提供方的凭据",
    support: "terminal",
    hint: "登录要被 Pi 的交互流程接管（浏览器 OAuth 或输入 API Key），桌面端没有复刻。现在可以：终端运行 `pi` 后执行 /login，凭据存在本机，桌面端下次启动就能用；也可以直接设 ANTHROPIC_API_KEY 之类的环境变量。",
  },
  {
    name: "logout",
    argumentHint: "",
    title: "退出登录",
    description: "移除模型提供方的凭据",
    support: "terminal",
    hint: "凭据由 Pi 自己管理，桌面端不碰。现在可以：终端运行 `pi` 后执行 /logout。",
  },
  {
    name: "new",
    argumentHint: "",
    title: "新会话",
    description: "开始一个新会话",
    support: "desktop",
  },
  {
    name: "compact",
    argumentHint: "[压缩要求]",
    title: "压缩上下文",
    description: "手动压缩会话上下文",
    support: "desktop",
  },
  {
    name: "resume",
    argumentHint: "",
    title: "切换会话",
    description: "切换到本项目的另一个会话",
    support: "desktop",
  },
  {
    name: "reload",
    argumentHint: "",
    title: "重新加载",
    description: "重新加载快捷键、扩展、技能、提示模板、主题与上下文文件",
    support: "desktop",
  },
  {
    name: "quit",
    argumentHint: "",
    title: "退出",
    description: "退出 Pi（桌面端关闭窗口）",
    support: "desktop",
  },
];

/** 桌面端自己有、Pi CLI 没有的命令：mcp / packages / skills。 */
export const DESKTOP_ONLY_COMMANDS: readonly string[] = ["mcp", "packages", "skills"];

export function findPiCommand(name: string): PiCommandInfo | undefined {
  return PI_BUILTIN_COMMANDS.find((command) => command.name === name);
}

/** 只能在终端里做的命令：菜单里要打上「需终端」并给出替代做法。 */
export function terminalOnlyCommands(): PiCommandInfo[] {
  return PI_BUILTIN_COMMANDS.filter((command) => command.support === "terminal");
}

/** 挑到这些命令时的提示正文（第一句说清「这里做不了」，后面给替代做法）。 */
export function terminalCommandNotice(info: PiCommandInfo): string {
  return [`/${info.name} 只能在终端里用`, info.hint ?? "", `在终端运行：pi → /${info.name}`]
    .filter(Boolean)
    .join("\n");
}
