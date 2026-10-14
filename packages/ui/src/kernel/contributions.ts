import { markRaw, reactive } from "vue";

export const CONTRIBUTION_POINTS = [
  "views.sidebar",
  "views.main",
  "views.editor",
  "views.panel",
  "titlebar",
  "toolstrip",
  "timeline.footer",
  "statusbar",
  "messageRenderers",
  "toolRenderers",
  "composer.addons",
  "overlays",
  "commands",
  "slash",
  "themes",
] as const;

export type ContributionPoint = (typeof CONTRIBUTION_POINTS)[number];

export function createContributions() {
  const points = reactive<Record<string, any[]>>(
    Object.fromEntries(CONTRIBUTION_POINTS.map((point) => [point, []])),
  );

  function add(point: string, pluginId: string, item: Record<string, any>): () => void {
    if (!points[point]) throw new Error(`未知贡献点：${point}`);
    const entry: Record<string, any> = { order: 50, priority: 0, ...item, pluginId };
    if (entry.component) entry.component = markRaw(entry.component);
    points[point].push(entry);
    points[point].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
    return () => {
      const list = points[point];
      const index = list.indexOf(entry);
      if (index >= 0) list.splice(index, 1);
    };
  }

  function removePlugin(pluginId: string): void {
    for (const point of CONTRIBUTION_POINTS) {
      points[point] = points[point].filter((item) => item.pluginId !== pluginId);
    }
  }

  function resolve(point: string, value: any): any {
    let best: any = null;
    for (const item of points[point]) {
      const matched = typeof item.match === "function" ? item.match(value) : item.match === value;
      if (matched && (!best || item.priority > best.priority)) best = item;
    }
    return best;
  }

  return { points, add, removePlugin, resolve };
}
