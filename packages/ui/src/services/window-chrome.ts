import { watch } from "vue";
import { dimmedColor } from "../shared/appearance.ts";

/**
 * 原生窗口按钮（右上角最小化 / 最大化 / 关闭）是**系统画的**，位于网页内容之上：
 * 弹窗遮罩再厚也盖不到它，所以一打开弹窗，右上角就会留下一条没被压暗的亮块，
 * 深浅色主题都一样扎眼。
 *
 * 解决办法：检测到遮罩层出现时，让主进程把原生按钮区的底色和符号色按同样的
 * 0.45 黑色压暗；遮罩消失再恢复。选区/截图都动不了这一层，只能这样对齐。
 */

/**
 * 会把整屏压暗的浮层。新增这类浮层时把它的遮罩类加进来即可
 * （透明的点击捕获层，例如右键菜单的 .ctx-backdrop，不算）。
 */
const SCRIM_SELECTORS = [
  ".modal-backdrop",
  ".subagent-modal-scrim",
  ".image-lightbox",
  // 命令面板 / 快速打开 / 扩展弹窗用的是通用 .overlay（45% 遮罩）
  ".overlay:not(.settings-overlay)",
];

/** 设置是「浮动窗口 + 很淡的遮罩」，原生按钮只需要跟着淡一点点 */
const SETTINGS_SCRIM = ".settings-modal-position";
const SETTINGS_ALPHA = 0.18;
const FULL_ALPHA = 0.45;

export interface WindowChromeTheme {
  id: string;
  titlebar: { color: string; symbolColor: string };
}

export function setupWindowChrome(
  workbench: { state: { theme: string } },
  host: { setTitleBar?: (colors: { color: string; symbolColor: string }) => Promise<boolean> } | undefined,
  themeOf: (id: string) => WindowChromeTheme,
  options: { doc?: Document; delayMs?: number } = {},
): () => void {
  const doc = options.doc ?? (typeof document === "undefined" ? undefined : document);
  if (!doc || !host?.setTitleBar) return () => {};

  const delay = options.delayMs ?? 40;
  let scrimmed: "full" | "light" | "none" = "none";
  let last = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let observer: MutationObserver | null = null;

  const apply = (): void => {
    const theme = themeOf(workbench.state.theme);
    // 压暗强度跟随遮罩：设置页只有 18%，其余全屏浮层 45%。
    // 固定 45% 会让设置页右上角比周围暗一截（截图里就是一块深色补丁）。
    const dim = scrimmed !== "none";
    const alpha = scrimmed === "full" ? FULL_ALPHA : scrimmed === "light" ? SETTINGS_ALPHA : 0;
    const color = dim ? dimmedColor(theme.titlebar.color, alpha) || theme.titlebar.color : theme.titlebar.color;
    const symbolColor = dim
      ? dimmedColor(theme.titlebar.symbolColor, alpha) || theme.titlebar.symbolColor
      : theme.titlebar.symbolColor;
    // 供检查/排查用：原色 / 跟着设置页轻压暗 / 跟着全屏遮罩压暗
    doc.documentElement.dataset.winChrome = !dim ? "plain" : scrimmed === "light" ? "scrim-light" : "scrim";
    const key = `${color}|${symbolColor}`;
    if (key === last) return;
    last = key;
    void host.setTitleBar?.({ color, symbolColor });
  };

  const shown = (selector: string): boolean =>
    [...doc.querySelectorAll(selector)].some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

  /** 全屏遮罩 > 设置浮层 > 没有 */
  const visibleScrim = (): "full" | "light" | "none" => {
    if (SCRIM_SELECTORS.some(shown)) return "full";
    if (shown(SETTINGS_SCRIM)) return "light";
    return "none";
  };

  const schedule = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const next = visibleScrim();
      if (next === scrimmed) return;
      scrimmed = next;
      apply();
    }, delay);
  };

  if (typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(schedule);
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  }

  // 主题切换时也要重算（遮罩可能正开着）
  const stopTheme = watch(() => workbench.state.theme, () => {
    last = "";
    apply();
  });

  scrimmed = visibleScrim();
  apply();

  return () => {
    if (timer) clearTimeout(timer);
    observer?.disconnect();
    stopTheme();
  };
}
