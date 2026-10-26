/**
 * 把「观察者回调里的布局写入」推迟到下一帧。
 *
 * 在 ResizeObserver 回调里直接改布局（滚动位置、类名、CSS 变量…）会触发第二轮观察，
 * Chromium 兜底后报 `ResizeObserver loop completed with undelivered notifications`。
 * 这条只是浏览器警告，但冒烟把 window.onerror 都当失败，一条警告就能让整次发布挂掉；
 * 而且推迟一帧本来就更好：等布局稳定再量/再滚，不会抖动。
 */
export interface FrameScheduler {
  schedule(): void;
  cancel(): void;
}

export function createFrameScheduler(run: () => void): FrameScheduler {
  let frame = 0;
  return {
    schedule(): void {
      if (typeof requestAnimationFrame !== "function") {
        run();
        return;
      }
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        run();
      });
    },
    cancel(): void {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
