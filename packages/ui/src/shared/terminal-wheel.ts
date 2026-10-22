/**
 * xterm 6 在没有鼠标协议的备用屏幕中默认把滚轮模拟为 ↑/↓。
 * 这会使 Agent CLI 回溯输入历史，而不是滚动对话；改用通用 PageUp/PageDown。
 * 正常屏幕的 scrollback 和应用已启用的鼠标报告仍由 xterm 原样处理。
 */
interface TerminalWheelState {
  alternate: boolean;
  mouseTracking: boolean;
}

type TerminalWheelEvent = Pick<WheelEvent,
  "deltaX" | "deltaY" | "deltaMode" | "ctrlKey" | "shiftKey" | "preventDefault" | "stopPropagation"
>;

const PAGE_UP = "\u001b[5~";
const PAGE_DOWN = "\u001b[6~";
const PIXEL_THRESHOLD = 48;
const PAGE_INTERVAL_MS = 60;
const GESTURE_IDLE_MS = 180;

export function createTerminalWheelHandler({
  getState,
  send,
  now = () => performance.now(),
}: {
  getState: () => TerminalWheelState;
  send: (data: string) => void;
  now?: () => number;
}): (event: TerminalWheelEvent) => boolean {
  let pendingPixels = 0;
  let direction = 0;
  let lastEventAt = Number.NEGATIVE_INFINITY;
  let lastPageAt = Number.NEGATIVE_INFINITY;

  return (event) => {
    const state = getState();
    if (!state.alternate || state.mouseTracking) {
      pendingPixels = 0;
      direction = 0;
      return true;
    }
    // 必须阻止 xterm 的备用屏幕默认处理，连细微触控板 / 横向滚动也不能
    // 退回到 ↑/↓，否则会在用户没有翻页意图时改写输入草稿。
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey || event.shiftKey || !Number.isFinite(event.deltaY)
      || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return false;
    const time = now();
    const nextDirection = Math.sign(event.deltaY);
    if (direction !== nextDirection || time - lastEventAt > GESTURE_IDLE_MS) pendingPixels = 0;
    direction = nextDirection;
    lastEventAt = time;
    const amount = event.deltaMode === 1 ? event.deltaY * 16
      : event.deltaMode === 2 ? event.deltaY * PIXEL_THRESHOLD
        : event.deltaY;
    pendingPixels += amount;
    if (Math.abs(pendingPixels) < PIXEL_THRESHOLD || time - lastPageAt < PAGE_INTERVAL_MS) return false;
    // 大滚轮事件只翻一页，细碎的触控板事件累积后翻页，避免一次跨越多屏。
    pendingPixels %= PIXEL_THRESHOLD;
    lastPageAt = time;
    send(direction < 0 ? PAGE_UP : PAGE_DOWN);
    return false;
  };
}
