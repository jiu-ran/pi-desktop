/** 全局 body 滚动锁：多个弹层/预览同时打开时用引用计数，最后一个关闭才恢复。 */
let holders = 0;
let savedOverflow = "";

export function lockBodyScroll(): void {
  if (typeof document === "undefined") return;
  if (holders++ === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
}

export function unlockBodyScroll(): void {
  if (typeof document === "undefined" || holders === 0) return;
  if (--holders === 0) {
    document.body.style.overflow = savedOverflow;
  }
}
