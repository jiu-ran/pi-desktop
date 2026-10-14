import { formatTokens, thinkingLabel } from "../../shared/util.ts";

function percent(value?: number | null): string {
  return value == null ? "-" : `${Math.round(value)}%`;
}

export default {
  id: "pi.builtin.slash",
  name: "斜杠命令",
  description: "在输入框里用 / 执行 Pi 的内置命令（新建、压缩、切换模型、分叉、导出等），通过 RPC 实现。",
  version: "1.0.0",
  activate(ctx: any) {
    const wb = ctx.workbench;
    const add = (item: Record<string, any>) => ctx.contribute("slash", { group: "desktop", ...item });
    const needIdle = () => {
      if (wb.active?.streaming) throw new Error("任务运行中，请先停止再执行这个命令");
    };

    add({
      name: "new", title: "新建任务", description: "在当前项目开始一个新会话", order: 10,
      run: async () => { needIdle(); await wb.newSession(); },
    });
    add({
      name: "resume", title: "切换任务", description: "切换到本项目的另一个会话", args: "<会话>", order: 11,
      options: () => (wb.active?.sessions ?? [])
        .filter((s: any) => s.path !== wb.active?.sessionFile)
        .map((s: any) => ({ value: s.path, label: s.title, hint: new Date(s.timestamp).toLocaleString() })),
      run: async (arg: string) => {
        needIdle();
        if (!arg) throw new Error("请从列表里选择要切换的会话");
        await wb.switchSession(arg);
      },
    });
    add({
      name: "model", title: "切换模型", description: "选择当前任务使用的模型", args: "<提供方/模型>", order: 20,
      options: () => (wb.active?.models ?? []).map((m: any) => ({ value: `${m.provider}/${m.id}`, label: m.name || m.id, hint: m.provider })),
      run: async (arg: string) => {
        const models = wb.active?.models ?? [];
        const model = models.find((m: any) => `${m.provider}/${m.id}` === arg)
          ?? models.find((m: any) => m.id === arg || m.name === arg);
        if (!model) throw new Error(arg ? `没有找到模型：${arg}` : "请从列表里选择模型");
        await wb.setModel(model);
        wb.notice("info", `已切换模型：${model.name || model.id}（${model.provider}）`);
      },
    });
    add({
      name: "thinking", title: "思考等级", description: "设置模型的思考深度", args: "<等级>", order: 21,
      options: () => (wb.active?.levels ?? []).map((level: string) => ({ value: level, label: thinkingLabel(level), hint: level })),
      run: async (arg: string) => {
        if (!(wb.active?.levels ?? []).includes(arg)) throw new Error("请从列表里选择思考等级");
        await wb.setThinking(arg);
        wb.notice("info", `思考等级：${thinkingLabel(arg)}`);
      },
    });
    add({
      name: "compact", title: "压缩上下文", description: "总结较早的对话以释放上下文，可附加压缩要求", args: "[压缩要求]", order: 30,
      run: async (arg: string) => {
        needIdle();
        await ctx.rpc("compact", arg || undefined);
      },
    });
    add({
      name: "name", title: "重命名任务", description: "设置当前会话的显示名称", args: "<名称>", order: 40,
      run: async (arg: string) => {
        if (!arg) throw new Error("用法：/name 新名称");
        await wb.renameSession(arg);
      },
    });
    add({
      name: "session", title: "任务信息", description: "查看会话文件、消息数、Token 与费用", order: 41,
      run: async () => {
        const s = await ctx.rpc("getSessionStats");
        const c = s.contextUsage;
        wb.notice("info", [
          "任务信息",
          `会话文件：${s.sessionFile ?? "（未保存）"}`,
          `消息：用户 ${s.userMessages} · 助手 ${s.assistantMessages} · 工具调用 ${s.toolCalls}`,
          `Token：输入 ${formatTokens(s.tokens?.input)} · 输出 ${formatTokens(s.tokens?.output)} · 缓存读 ${formatTokens(s.tokens?.cacheRead)} · 缓存写 ${formatTokens(s.tokens?.cacheWrite)}`,
          `费用：$${(s.cost ?? 0).toFixed(4)}`,
          c ? `上下文：${percent(c.percent)}（${formatTokens(c.tokens)} / ${formatTokens(c.contextWindow)}）` : "",
        ].filter(Boolean).join("\n"));
      },
    });
    add({
      name: "copy", title: "复制回复", description: "复制最后一条助手回复到剪贴板", order: 50,
      run: async () => {
        const text = await ctx.rpc("getLastAssistantText");
        if (!text) throw new Error("还没有助手回复");
        await navigator.clipboard.writeText(text);
        ctx.emit("notify", { level: "info", text: "已复制最后一条回复" });
      },
    });
    add({
      name: "export", title: "导出 HTML", description: "把当前会话导出为 HTML 文件，可指定路径", args: "[路径.html]", order: 51,
      run: async (arg: string) => {
        const { path } = await ctx.rpc("exportHtml", arg || undefined);
        wb.notice("info", `已导出：${path}`);
        ctx.reveal(path);
      },
    });
    add({
      name: "fork", title: "分叉任务", description: "从之前的某条消息分出一个新会话", args: "<消息>", order: 60,
      options: async () => (await ctx.rpc("getForkMessages")).map((m: any) => ({
        value: m.entryId, label: m.text.replace(/\s+/g, " ").slice(0, 80),
      })).reverse(),
      run: async (arg: string) => {
        needIdle();
        if (!arg) throw new Error("请从列表里选择要分叉的消息");
        const result = await ctx.rpc("fork", arg);
        if (result?.cancelled) return;
        await wb.reload();
        await wb.refreshSessions();
        if (wb.active && result?.text) wb.active.draft = result.text;
      },
    });
    add({
      name: "clone", title: "复制任务", description: "在当前位置复制出一个新会话", order: 61,
      run: async () => {
        needIdle();
        const result = await ctx.rpc("clone");
        if (result?.cancelled) return;
        await wb.reload();
        await wb.refreshSessions();
        wb.notice("info", "已复制为新任务");
      },
    });
    add({
      name: "reload", title: "重新加载", description: "重启 Pi 进程，重新加载扩展、技能、提示模板与上下文文件", order: 70,
      run: async () => {
        needIdle();
        await wb.restart();
        ctx.emit("notify", { level: "info", text: "已重新加载扩展、技能与提示模板" });
      },
    });
    add({
      name: "hotkeys", title: "快捷键", description: "查看桌面端的快捷键", order: 80,
      run: async () => {
        const lines = [
          "快捷键",
          "Enter：发送 · Shift+Enter：换行 · Esc：停止当前任务",
          "Tab：补全命令 · ↑ ↓：在命令列表中选择",
          ...ctx.keybindings.map((k: any) => `${k.keybinding}：${k.title}`),
        ];
        wb.notice("info", lines.join("\n"));
      },
    });
  },
};
