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

/** 设置是「浮动窗口 + 很淡的遮罩」 */
const SETTINGS_SCRIM = ".settings-modal-position";

/** 从遮罩元素的背景色里读实际 alpha：原生按钮要和网页里的遮罩**完全一致**，
 *  不能各写一份数值（曾经 CSS 用 0.10、这里固定 0.18，浅色下右上角就深一截）。 */
function scrimAlphaOf(element: Element | null): number {
  if (!element) return 0;
  const value = element.ownerDocument.defaultView?.getComputedStyle(element).backgroundColor ?? "";
  const match = /rgba?(([^)]+))/.exec(value);
  if (!match) return 0;
  const parts = match[1]!.split(",").map((item) => Number.parseFloat(item));
  const alpha = parts.length >= 4 ? parts[3]! : 1;
  return Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
}

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
  /** 真正带着遮罩底色的元素（设置页是外层 .overlay，不是里面的定位容器） */
  let scrimElement: Element | null = null;
  let last = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let observer: MutationObserver | null = null;

  const apply = (): void => {
    const theme = themeOf(workbench.state.theme);
    // 压暗强度跟随遮罩：设置页只有 18%，其余全屏浮层 45%。
    // 固定 45% 会让设置页右上角比周围暗一截（截图里就是一块深色补丁）。
    const dim = scrimmed !== "none";
    const alpha = dim ? scrimAlphaOf(scrimElement) : 0;
    const color = dim && alpha > 0 ? dimmedColor(theme.titlebar.color, alpha) || theme.titlebar.color : theme.titlebar.color;
    const symbolColor =
      dim && alpha > 0
        ? dimmedColor(theme.titlebar.symbolColor, alpha) || theme.titlebar.symbolColor
        : theme.titlebar.symbolColor;
    // 供检查/排查用：原色 / 跟着设置页轻压暗 / 跟着全屏遮罩压暗
    doc.documentElement.dataset.winChrome = !dim ? "plain" : scrimmed === "light" ? "scrim-light" : "scrim";
    // 排查用：原生按钮区实际用的底色（应当等于 titlebar 色 × (1 - 遮罩 alpha)）
    doc.documentElement.dataset.winChromeColor = color;
    doc.documentElement.dataset.winChromeAlpha = String(Math.round(alpha * 100) / 100);
    const key = `${color}|${symbolColor}`;
    if (key === last) return;
    last = key;
    void host.setTitleBar?.({ color, symbolColor });
  };

  /** 找出正在显示、且真的在画遮罩底色的元素（全屏遮罩优先） */
  const findScrim = (): { level: "full" | "light"; element: Element } | null => {
    for (const selector of SCRIM_SELECTORS) {
      const element = [...doc.querySelectorAll(selector)].find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (element) return { level: "full", element };
    }
    const position = [...doc.querySelectorAll(SETTINGS_SCRIM)].find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!position) return null;
    // 设置页的遮罩底色画在外层 .overlay 上，定位容器本身是透明的
    return { level: "light", element: position.closest(".overlay") ?? position };
  };

  const schedule = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const found = findScrim();
      const next = found?.level ?? "none";
      if (next === scrimmed) {
        // 同一个遮罩换了元素也要跟上（例如先开设置再开子代理弹窗）
        if (found && found.element !== scrimElement) {
          scrimElement = found.element;
          apply();
        }
        return;
      }
      scrimmed = next;
      scrimElement = found?.element ?? null;
      apply();
      // 遮罩淡入 180ms：动画结束再按最终 alpha 对齐一次
      setTimeout(apply, 260);
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

  const initial = findScrim();
  scrimmed = initial?.level ?? "none";
  scrimElement = initial?.element ?? null;
  apply();

  return () => {
    if (timer) clearTimeout(timer);
    observer?.disconnect();
    stopTheme();
  };
}
