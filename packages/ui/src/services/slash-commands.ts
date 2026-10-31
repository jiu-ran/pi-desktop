import { formatTokens, thinkingLabel } from "../shared/util.ts";
import { openSettingsModal } from "./settings.ts";

/** 桌面端拿不到的桥接对象（preload 暴露在 globalThis.piDesktop）。 */
function bridge(): any {
  return (globalThis as any).piDesktop;
}

export interface LocalSlashCommand {
  name: string;
  title: string;
  description: string;
  args?: string;
  group?: string;
  order: number;
  options?: () => Array<{ value: string; label: string; hint?: string }> | Promise<Array<{ value: string; label: string; hint?: string }>>;
  run: (arg: string) => Promise<void>;
}

export interface SlashCommandItem {
  key: string;
  name: string;
  title: string;
  description: string;
  args: string;
  group: string;
  scope?: string;
  order: number;
  local: LocalSlashCommand | null;
}

export const GROUPS = [
  { id: "desktop", label: "内置命令" },
  { id: "extension", label: "扩展命令" },
  { id: "prompt", label: "提示模板" },
  { id: "skill", label: "技能" },
];

const SCOPES: Record<string, string> = { user: "全局", project: "项目" };

export function scopeLabel(scope?: string): string {
  return (scope && SCOPES[scope]) ?? "";
}

/**
 * 合并桌面端命令与 Pi 报上来的命令。
 *
 * **撞名时桌面端赢**：Pi 自带的扩展里就有 `mcp`（管 MCP 的 OAuth 登录），还有
 * `llama` 之类的。如果让扩展赢，`/mcp` 会跑进扩展自己的流程（还会在对话里
 * 留一条 `/mcp` 消息），而不是打开桌面端的 MCP 设置页。同名时保留桌面端实现，
 * 扩展那条不再展示（想用扩展版可以在终端里敲）。
 */
export function mergeCommands(local: LocalSlashCommand[], remote: any[]): SlashCommandItem[] {
  const localNames = new Set(local.map((cmd) => cmd.name));
  return [
    ...local.map((cmd) => ({
      key: `d:${cmd.name}`,
      name: cmd.name,
      title: cmd.title ?? "",
      description: cmd.description ?? "",
      args: cmd.args ?? "",
      group: cmd.group ?? "desktop",
      order: cmd.order ?? 50,
      local: cmd,
    })),
    ...remote
      .filter((cmd) => !localNames.has(cmd.name))
      .map((cmd, i) => ({
        key: `p:${cmd.name}`,
        name: cmd.name,
        title: cmd.source === "skill" ? cmd.name.replace(/^skill:/, "") : "",
        description: cmd.description ?? "",
        args: "",
        group: GROUPS.some((g) => g.id === cmd.source) ? cmd.source : "extension",
        scope: scopeLabel(cmd.sourceInfo?.scope),
        order: 1000 + i,
        local: null,
      })),
  ];
}

export function filterCommands(commands: SlashCommandItem[], query: string): SlashCommandItem[] {
  const q = query.toLowerCase();
  const score = (cmd: SlashCommandItem): number => {
    if (!q) return 0;
    const name = cmd.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (`${cmd.title} ${cmd.description}`.toLowerCase().includes(q)) return 2;
    return -1;
  };
  const groupIndex = (cmd: SlashCommandItem) => GROUPS.findIndex((g) => g.id === cmd.group);
  return commands
    .map((cmd) => ({ cmd, s: score(cmd) }))
    .filter((item) => item.s >= 0)
    .sort((a, b) => groupIndex(a.cmd) - groupIndex(b.cmd) || a.s - b.s || a.cmd.order - b.cmd.order)
    .map((item) => item.cmd);
}

export function parseSlash(text: string): { name: string; hasArg: boolean; arg: string } | null {
  const match = text.match(/^\/(\S*)(?:(\s)([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1], hasArg: Boolean(match[2]), arg: (match[3] ?? "").trim() };
}

function percent(value?: number | null): string {
  return value == null ? "-" : `${Math.round(value)}%`;
}

export function createBuiltinSlashCommands({
  workbench,
  bus,
  getKeybindings,
}: {
  workbench: any;
  bus: any;
  getKeybindings: () => Array<{ title: string; keybinding?: string }>;
}): LocalSlashCommand[] {
  const needIdle = () => {
    if (workbench.active.value?.streaming) throw new Error("任务运行中，请先停止再执行这个命令");
  };

  return [
    {
      name: "new",
      title: "新建任务",
      description: "在当前项目开始一个新会话（支持与运行中任务并行）",
      order: 10,
      run: async () => {
        await workbench.newSession();
      },
    },
    {
      name: "resume",
      title: "切换任务",
      description: "切换到本项目的另一个会话（支持与运行中任务并行）",
      args: "<会话>",
      order: 11,
      options: () =>
        (workbench.active.value?.sessions ?? [])
          .filter((s: any) => s.path !== workbench.active.value?.sessionFile)
          .map((s: any) => ({ value: s.path, label: s.title, hint: new Date(s.timestamp).toLocaleString() })),
      run: async (arg: string) => {
        if (!arg) throw new Error("请从列表里选择要切换的会话");
        await workbench.switchSession(arg);
      },
    },
    {
      name: "model",
      title: "切换模型",
      description: "选择当前任务使用的模型",
      args: "<提供方/模型>",
      order: 20,
      options: () =>
        (workbench.active.value?.models ?? []).map((m: any) => ({
          value: `${m.provider}/${m.id}`,
          label: m.name || m.id,
          hint: m.provider,
        })),
      run: async (arg: string) => {
        const models = workbench.active.value?.models ?? [];
        const model =
          models.find((m: any) => `${m.provider}/${m.id}` === arg) ??
          models.find((m: any) => m.id === arg || m.name === arg);
        if (!model) throw new Error(arg ? `没有找到模型：${arg}` : "请从列表里选择模型");
        await workbench.setModel(model);
        workbench.notice("info", `已切换模型：${model.name || model.id}（${model.provider}）`);
      },
    },
    {
      name: "thinking",
      title: "思考等级",
      description: "设置模型的思考深度",
      args: "<等级>",
      order: 21,
      options: () =>
        (workbench.active.value?.levels ?? []).map((level: string) => ({
          value: level,
          label: thinkingLabel(level),
          hint: level,
        })),
      run: async (arg: string) => {
        if (!(workbench.active.value?.levels ?? []).includes(arg)) throw new Error("请从列表里选择思考等级");
        await workbench.setThinking(arg);
        workbench.notice("info", `思考等级：${thinkingLabel(arg)}`);
      },
    },
    {
      name: "compact",
      title: "压缩上下文",
      description: "总结较早的对话以释放上下文，可附加压缩要求",
      args: "[压缩要求]",
      order: 30,
      run: async (arg: string) => {
        needIdle();
        await workbench.call("compact", arg || undefined);
      },
    },
    {
      name: "name",
      title: "重命名任务",
      description: "设置当前会话的显示名称",
      args: "<名称>",
      order: 40,
      run: async (arg: string) => {
        if (!arg) throw new Error("用法：/name 新名称");
        await workbench.renameSession(arg);
      },
    },
    {
      name: "session",
      title: "任务信息",
      description: "查看会话文件、消息数与上下文 Token 用量",
      order: 41,
      run: async () => {
        const s = await workbench.call("getSessionStats");
        const c = s.contextUsage;
        workbench.notice(
          "info",
          [
            "任务信息",
            `会话文件：${s.sessionFile ?? "（未保存）"}`,
            `消息：用户 ${s.userMessages} · 助手 ${s.assistantMessages} · 工具调用 ${s.toolCalls}`,
            `Token：输入 ${formatTokens(s.tokens?.input)} · 输出 ${formatTokens(s.tokens?.output)} · 缓存读 ${formatTokens(s.tokens?.cacheRead)} · 缓存写 ${formatTokens(s.tokens?.cacheWrite)}`,
            c ? `上下文：${percent(c.percent)}（${formatTokens(c.tokens)} / ${formatTokens(c.contextWindow)}）` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      },
    },
    {
      name: "copy",
      title: "复制回复",
      description: "复制最后一条助手回复到剪贴板",
      order: 50,
      run: async () => {
        const text = await workbench.call("getLastAssistantText");
        if (!text) throw new Error("还没有助手回复");
        await navigator.clipboard.writeText(text);
        bus.emit("notify", { level: "info", text: "已复制最后一条回复" });
      },
    },
    {
      name: "export",
      title: "导出 HTML",
      description: "导出当前会话：`.html`（可分享的网页）或 `.jsonl`（原始记录）",
      args: "[路径.html|.jsonl]",
      order: 51,
      run: async (arg: string) => {
        const target = arg.trim();
        if (/\.jsonl$/i.test(target)) {
          const result = await bridge().exportSessionJsonl(workbench.active.value?.cwd, target);
          workbench.notice("info", `已导出会话：${result.path}`);
          workbench.reveal(result.path);
          return;
        }
        const { path } = await workbench.call("exportHtml", target || undefined);
        workbench.notice("info", `已导出：${path}`);
        workbench.reveal(path);
      },
    },
    {
      name: "import",
      title: "导入会话",
      description: "把一个 .jsonl 会话文件导入当前项目，导入后直接接着聊",
      args: "<文件.jsonl>",
      order: 52,
      run: async (arg: string) => {
        const cwd = workbench.active.value?.cwd;
        if (!cwd) throw new Error("请先打开一个项目");
        let file = arg.trim();
        if (!file) {
          const picked: string[] = (await bridge().chooseFiles()) ?? [];
          file = picked.find((item) => item.toLowerCase().endsWith(".jsonl")) ?? "";
          if (!file) throw new Error("没有选中 .jsonl 会话文件");
        }
        const imported = await bridge().importSession(cwd, file);
        await workbench.refreshSessions();
        await workbench.switchSession(imported.path);
        workbench.notice("info", `已导入并切换到：${imported.title}`);
      },
    },
    {
      name: "fork",
      title: "分叉任务",
      description: "从之前的某条消息分出一个新会话",
      args: "<消息>",
      order: 60,
      options: async () =>
        (await workbench.call("getForkMessages"))
          .map((m: any) => ({
            value: m.entryId,
            label: m.text.replace(/\s+/g, " ").slice(0, 80),
          }))
          .reverse(),
      run: async (arg: string) => {
        needIdle();
        if (!arg) throw new Error("请从列表里选择要分叉的消息");
        const result = await workbench.call("fork", arg);
        if (result?.cancelled) return;
        await workbench.reload();
        await workbench.refreshSessions();
        if (workbench.active.value && result?.text) workbench.active.value.draft = result.text;
      },
    },
    {
      name: "clone",
      title: "复制任务",
      description: "在当前位置复制出一个新会话",
      order: 61,
      run: async () => {
        needIdle();
        const result = await workbench.call("clone");
        if (result?.cancelled) return;
        await workbench.reload();
        await workbench.refreshSessions();
        workbench.notice("info", "已复制为新任务");
      },
    },
    {
      name: "reload",
      title: "重新加载",
      description: "重启 Pi 进程，重新加载扩展、技能、提示模板与上下文文件",
      order: 70,
      run: async () => {
        needIdle();
        await workbench.restart();
        bus.emit("notify", { level: "info", text: "已重新加载扩展、技能与提示模板" });
      },
    },
    {
      name: "settings",
      title: "偏好设置",
      description: "打开桌面端偏好设置弹窗（并发、外观、MCP、软件包、插件与快捷键）",
      order: 75,
      run: async () => {
        openSettingsModal();
      },
    },
    {
      name: "mcp",
      title: "MCP 服务配置",
      description: "管理全局与项目级 MCP 服务、暴露策略及已挂载的工具",
      order: 76,
      run: async () => {
        openSettingsModal("mcp");
      },
    },
    {
      name: "packages",
      title: "Pi 软件包管理",
      description: "安装、更新与卸载 Pi 扩展包（npm / Git / 本地路径）",
      order: 77,
      run: async () => {
        openSettingsModal("packages");
      },
    },
    {
      name: "skills",
      title: "Skills 设置",
      description: "查看全局与项目级技能的加载状态与调用方式",
      order: 78,
      run: async () => {
        openSettingsModal("skills");
      },
    },
    {
      name: "hotkeys",
      title: "快捷键",
      description: "查看桌面端的快捷键",
      order: 80,
      run: async () => {
        const lines = [
          "快捷键",
          "Enter：发送 · Shift+Enter：换行 · Esc：停止当前任务",
          "Tab：补全命令 · ↑ ↓：在命令列表中选择",
          ...getKeybindings()
            .filter((k) => k.keybinding)
            .map((k) => `${k.keybinding}：${k.title}`),
        ];
        workbench.notice("info", lines.join("\n"));
      },
    },
    {
      name: "changelog",
      title: "更新日志",
      description: "在浏览器打开当前版本的更新日志",
      order: 82,
      run: async () => {
        const version = workbench.state.appUpdate.current;
        const url = version
          ? `https://github.com/jiu-ran/pi-desktop/releases/tag/v${version}`
          : "https://github.com/jiu-ran/pi-desktop/releases";
        await bridge().openExternalUrl(url);
        workbench.notice("info", `已在浏览器打开 Pi Desktop ${version || "最新版本"} 的更新日志`);
      },
    },
    {
      name: "trust",
      title: "项目信任",
      description: "允许 Pi 加载这个项目的 .pi 配置、扩展、技能与 MCP（不信任时这些都会被忽略）",
      args: "<选择一项>",
      order: 73,
      options: () => [
        { value: "trust", label: "信任此项目", hint: "加载 .pi 下的配置、扩展、技能与 MCP" },
        { value: "trust-parent", label: "信任上一级目录", hint: "上一级所有子项目共用同一套配置时用" },
        { value: "distrust", label: "不再信任", hint: "忽略项目级资源，只用全局的" },
      ],
      run: async (arg: string) => {
        const cwd = workbench.active.value?.cwd;
        if (!cwd) throw new Error("请先打开一个项目");
        if (!arg) {
          workbench.notice("info", trustNotice(await bridge().projectTrust(cwd)));
          return;
        }
        needIdle();
        const action = arg === "trust-parent" ? "trust-parent" : arg === "distrust" ? "distrust" : "trust";
        const status = await bridge().setProjectTrust(cwd, action);
        // 资源在 Pi 启动时就加载好了，改完信任必须重启才能生效
        await workbench.restart();
        workbench.notice(status.effective ? "info" : "warning", `${trustNotice(status)}\n已重启 Pi 进程，资源重新加载`);
      },
    },
    {
      name: "quit",
      title: "退出",
      description: "关闭 Pi Desktop（任务运行中会先确认）",
      order: 90,
      run: async () => {
        bridge().windowControls.close();
      },
    },
    // Pi 里只在交互模式实现、桌面端真做不了的那几条（/tree、/login、/share…）
    // 不进菜单：菜单里只列真能执行的。但直接敲出来时不能当普通文字发给模型，
    // 由 Composer 的 submit 用 `shared/pi-commands.ts` 查表给一句说明。
  ];
}

/** 项目信任的一句话结论（/trust 与状态展示共用）。 */
export function trustNotice(status: {
  needsTrust: boolean;
  effective: boolean;
  decision: boolean | null;
  recordedAt: string;
  cwd: string;
}): string {
  if (!status.needsTrust) return "这个项目没有需要信任的资源（.pi 配置 / 扩展 / 技能 / MCP），怎么选都一样";
  if (status.effective) {
    return `项目已信任：${status.recordedAt || status.cwd}`;
  }
  if (status.decision === false) {
    return `项目被标记为不信任：${status.recordedAt || status.cwd}\n项目级扩展、技能与 MCP 不会加载。要启用请执行 /trust。`;
  }
  return "项目信任还没决定：桌面端走 RPC，Pi 拿不到确认就按不信任处理 —— 项目级扩展、技能与 MCP 现在不会加载。\n执行 /trust 选择「信任此项目」即可（会重启 Pi 生效）。";
}
