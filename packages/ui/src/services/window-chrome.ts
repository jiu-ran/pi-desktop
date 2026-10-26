import { watch } from "vue";

/**
 * 原生窗口按钮（右上角最小化 / 最大化 / 关闭）由系统绘制，位于网页内容之上。
 *
 * 历史做法：检测到遮罩层出现时把原生按钮区也压暗，好让右上角不留一块亮斑。
 * 但这条路无法做到「完全一致」——原生按钮区的颜色要靠 IPC 通知主进程重绘，
 * 永远比网页侧的遮罩慢一帧；遮罩如果有淡入动画，两边更是两个速度。
 *
 * 现在的做法：**遮罩一律从标题栏下方开始**（`--titlebar-h`），标题栏本身永不被压暗，
 * 于是原生按钮区和网页标题栏天然同色，没有任何需要同步的状态。
 * 这个文件只负责「主题切换时把标题栏颜色告诉主进程」。
 */

export interface WindowChromeTheme {
  id: string;
  titlebar: { color: string; symbolColor: string };
}

export function setupWindowChrome(
  workbench: { state: { theme: string } },
  host: { setTitleBar?: (colors: { color: string; symbolColor: string }) => Promise<boolean> } | undefined,
  themeOf: (id: string) => WindowChromeTheme,
): () => void {
  if (!host?.setTitleBar) return () => {};

  let last = "";
  const apply = (): void => {
    const theme = themeOf(workbench.state.theme);
    const key = `${theme.titlebar.color}|${theme.titlebar.symbolColor}`;
    if (key === last) return;
    last = key;
    void host.setTitleBar?.({ color: theme.titlebar.color, symbolColor: theme.titlebar.symbolColor });
  };

  // 主题切换时重算（遮罩不再影响原生按钮区，所以没有别的触发点）
  const stop = watch(() => workbench.state.theme, apply);
  apply();

  return () => stop();
}
