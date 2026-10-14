/**
 * 斜杠命令的数据整理（不含界面）。
 * 两类来源：
 *   - 桌面端 slash 贡献点：Pi 的内置命令，由桌面端用 RPC 实现，在本地执行；
 *   - Pi 的 get_commands：扩展命令 / 提示模板 / 技能，原样通过 prompt 交给 Pi 执行。
 */
export const GROUPS = [
  { id: "desktop", label: "内置命令" },
  { id: "extension", label: "扩展命令" },
  { id: "prompt", label: "提示模板" },
  { id: "skill", label: "技能" },
];

const SCOPES = { user: "全局", project: "项目", temporary: "临时" };

export function scopeLabel(scope) {
  return SCOPES[scope] ?? "";
}

/** 合并两类命令。Pi 返回的同名命令优先（扩展可以覆盖内置行为）。 */
export function mergeCommands(local, remote) {
  const remoteNames = new Set(remote.map((cmd) => cmd.name));
  return [
    ...local.filter((cmd) => !remoteNames.has(cmd.name)).map((cmd) => ({
      key: `d:${cmd.name}`,
      name: cmd.name,
      title: cmd.title ?? "",
      description: cmd.description ?? "",
      args: cmd.args ?? "",
      group: cmd.group ?? "desktop",
      order: cmd.order ?? 50,
      local: cmd,
    })),
    ...remote.map((cmd, i) => ({
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

/** 按查询过滤并排序：名称前缀 > 名称包含 > 中文标题 / 描述包含。 */
export function filterCommands(commands, query) {
  const q = query.toLowerCase();
  const score = (cmd) => {
    if (!q) return 0;
    const name = cmd.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (`${cmd.title} ${cmd.description}`.toLowerCase().includes(q)) return 2;
    return -1;
  };
  const groupIndex = (cmd) => GROUPS.findIndex((g) => g.id === cmd.group);
  return commands
    .map((cmd) => ({ cmd, s: score(cmd) }))
    .filter((item) => item.s >= 0)
    .sort((a, b) => groupIndex(a.cmd) - groupIndex(b.cmd) || a.s - b.s || a.cmd.order - b.cmd.order)
    .map((item) => item.cmd);
}

/** 解析输入框里的 /命令：{ name, hasArg, arg } */
export function parseSlash(text) {
  const match = text.match(/^\/(\S*)(?:(\s)([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1], hasArg: Boolean(match[2]), arg: (match[3] ?? "").trim() };
}
