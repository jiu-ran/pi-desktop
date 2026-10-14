export interface SlashCommandItem {
  key: string;
  name: string;
  title: string;
  description: string;
  args: string;
  group: string;
  scope?: string;
  order: number;
  local: any | null;
}

export const GROUPS = [
  { id: "desktop", label: "内置命令" },
  { id: "extension", label: "扩展命令" },
  { id: "prompt", label: "提示模板" },
  { id: "skill", label: "技能" },
];

const SCOPES: Record<string, string> = { user: "全局", project: "项目", temporary: "临时" };

export function scopeLabel(scope?: string): string {
  return (scope && SCOPES[scope]) ?? "";
}

export function mergeCommands(local: any[], remote: any[]): SlashCommandItem[] {
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
