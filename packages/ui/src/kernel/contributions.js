import { markRaw, reactive } from "vue";

/**
 * 贡献点（Contribution Points）。
 * 每个贡献点是一个响应式列表；每条贡献都带 pluginId，插件停用时整体移除。
 *
 *   views.sidebar     左侧活动栏视图          { id, title, icon, order, component }
 *   views.main        主舞台（取 order 最小且 when() 为真的一个） { id, when?, order, component }
 *   views.editor      中央编辑器区域                         { id, when?, order, component }
 *   views.panel       右侧面板                  { id, title, icon, order, component, badge? }
 *   titlebar          标题栏左侧（品牌之后）      { id, order, component }
 *   toolstrip         右侧工具条底部按钮        { id, title, icon, order, run(), active?() }
 *   timeline.footer   对话末尾的摘要卡片        { id, order, component }
 *   statusbar         标题栏右侧状态项            { id, align, order, component }
 *   messageRenderers  消息块渲染器              { id, match(block), priority, component }
 *   toolRenderers     工具调用渲染器            { id, match(name), priority, component }
 *   composer.addons   输入框上方附加组件        { id, order, component }
 *   overlays          全局浮层（弹窗/提示）     { id, component }
 *   commands          命令（命令面板与快捷键）  { id, title, keybinding?, run(ctx) }
 *   slash             输入框 / 命令              { name, title, description, group?, args?, options?(), run(arg) }
 *   themes            主题                      { id, label, scheme, vars, codeTheme }
 */
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
];

export function createContributions() {
  const points = reactive(Object.fromEntries(CONTRIBUTION_POINTS.map((point) => [point, []])));

  function add(point, pluginId, item) {
    if (!points[point]) throw new Error(`未知贡献点：${point}`);
    const entry = { order: 50, priority: 0, ...item, pluginId };
    if (entry.component) entry.component = markRaw(entry.component);
    points[point].push(entry);
    points[point].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
    return () => {
      const list = points[point];
      const index = list.indexOf(entry);
      if (index >= 0) list.splice(index, 1);
    };
  }

  function removePlugin(pluginId) {
    for (const point of CONTRIBUTION_POINTS) {
      points[point] = points[point].filter((item) => item.pluginId !== pluginId);
    }
  }

  /** 按优先级返回第一个匹配的渲染器。 */
  function resolve(point, value) {
    let best = null;
    for (const item of points[point]) {
      const matched = typeof item.match === "function" ? item.match(value) : item.match === value;
      if (matched && (!best || item.priority > best.priority)) best = item;
    }
    return best;
  }

  return { points, add, removePlugin, resolve };
}
