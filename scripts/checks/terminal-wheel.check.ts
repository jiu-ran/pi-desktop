import { createTerminalWheelHandler } from "../../packages/ui/src/shared/terminal-wheel.ts";

function assert(value: unknown, message: string): void {
  if (!value) throw new Error(message);
}

let time = 0;
let alternate = true;
let mouseTracking = false;
let prevented = 0;
const sent: string[] = [];
const handle = createTerminalWheelHandler({
  getState: () => ({ alternate, mouseTracking }),
  send: (data) => sent.push(data),
  now: () => time,
});
const wheel = (deltaY: number, props: Partial<WheelEvent> = {}) => ({
  deltaY, deltaX: 0, deltaMode: 0, ctrlKey: false, shiftKey: false,
  preventDefault: () => { prevented += 1; }, stopPropagation: () => {}, ...props,
});
assert(handle(wheel(-120)) === false, "备用屏幕滚轮不能退回 xterm 的方向键模拟");
assert(sent[0] === "\u001b[5~", "上滑应转为内容 PageUp，而不是输入历史 ↑");
time += 80;
handle(wheel(120));
assert(sent[1] === "\u001b[6~", "下滑应转为内容 PageDown，而不是输入历史 ↓");
assert(prevented === 2, "备用屏幕滚轮应阻止浏览器默认行为");

const previous = sent.length;
time += 200;
for (let i = 0; i < 3; i += 1) { handle(wheel(-12)); time += 20; }
assert(sent.length === previous, "触控板微小滑动不应敏感翻页");
handle(wheel(-12));
assert(sent.length === previous + 1, "触控板增量应累积成翻页");
handle(wheel(-800));
assert(sent.length === previous + 1, "同一瞬间的大事件不应连续跨越多页");
time += 80;
handle(wheel(-3, { deltaMode: 1 }));
assert(sent.at(-1) === "\u001b[5~", "按行滚轮单位应正确转换");
time += 80;
handle(wheel(1, { deltaMode: 2 }));
assert(sent.at(-1) === "\u001b[6~", "按页滚轮单位应正确转换");

const count = sent.length;
assert(handle(wheel(0, { deltaX: 120 })) === false && sent.length === count, "横向滚动不能改写历史输入");
assert(handle(wheel(-120, { ctrlKey: true })) === false && sent.length === count, "Ctrl 滚轮不应输入按键");
mouseTracking = true;
assert(handle(wheel(-120)) === true && sent.length === count, "已启用鼠标协议时应由 xterm 原生上报");
mouseTracking = false;
alternate = false;
assert(handle(wheel(-120)) === true && sent.length === count, "普通 shell 应保留正常 scrollback，不发送翻页按键");
assert(!sent.some((data) => data === "\u001b[A" || data === "\u001b[B" || data === "\u001bOA" || data === "\u001bOB"), "滚轮永远不应模拟输入历史方向键");

console.log("terminal-wheel OK");
