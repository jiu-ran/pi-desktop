import { createEventBus } from "../../packages/ui/src/kernel/event-bus.ts";

const bus = createEventBus();
let direct = 0;
let wildcard = 0;
const stopDirect = bus.on("sample", () => {
  direct += 1;
});
const stopWildcard = bus.on("*", ({ type }: { type: string }) => {
  if (type === "sample") wildcard += 1;
});

bus.emit("sample", { value: 1 });
if (direct !== 1 || wildcard !== 1) throw new Error("event bus should notify direct and wildcard listeners");
stopDirect();
stopDirect();
stopWildcard();
bus.emit("sample");
if (direct !== 1 || wildcard !== 1) throw new Error("event bus disposer should be idempotent");

let late = 0;
const stopFirst = bus.on("snapshot", () => {
  late += 1;
  bus.on("snapshot", () => {
    late += 100;
  });
});
bus.emit("snapshot");
if (late !== 1) throw new Error("event bus should snapshot listeners before dispatch");
bus.emit("snapshot");
if (Number(late) !== 102) throw new Error("event bus should dispatch listeners added between emits");
stopFirst();
bus.dispose();
let afterDispose = 0;
bus.on("sample", () => {
  afterDispose += 1;
});
bus.emit("sample");
if (afterDispose !== 0) throw new Error("disposed event bus should ignore listeners and events");

console.log("event-bus OK");
