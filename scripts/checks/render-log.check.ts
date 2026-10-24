import assert from "node:assert/strict";
import { formatLogMessage, installRenderLogReporter } from "../../packages/ui/src/shared/render-log.ts";

// 参数压成一行：字符串原样、Error 带栈、对象走 JSON、其余 String()
assert.equal(formatLogMessage(["第一句", "第二句"]), "第一句 第二句");
assert.equal(formatLogMessage([{ a: 1 }]), '{"a":1}');
{
  const error = new Error("炸了");
  const text = formatLogMessage([error]);
  assert.ok(text.startsWith("Error: 炸了"), text.slice(0, 40));
  assert.ok(text.includes("at "), "Error 要带调用栈");
}
{
  const circular: any = { a: 1 };
  circular.self = circular;
  assert.ok(formatLogMessage([circular]).length > 0, "循环引用不能抛错");
}
// 超长内容截断，避免一条日志写几 MB
assert.ok(formatLogMessage(["x".repeat(10_000)]).length < 4100);
assert.ok(formatLogMessage(["x".repeat(10_000)]).endsWith("…（截断）"));

// console.warn / error 会被上报，其它级别不报；卸载后恢复原函数
{
  const sent: Array<{ level: string; scope: string; message: string }> = [];
  const fakeConsole: any = {
    warn: (...args: any[]) => {
      fakeConsole.lastWarn = args.join(" ");
    },
    error: (...args: any[]) => {
      fakeConsole.lastError = args.join(" ");
    },
    log: () => {},
  };
  const dispose = installRenderLogReporter(
    { logEvent: (level, scope, message) => sent.push({ level, scope, message }) },
    { console: fakeConsole },
  );
  fakeConsole.warn("磁盘快满了");
  fakeConsole.error("渲染出错", { code: 500 });
  fakeConsole.log("这条不该上报");
  assert.deepEqual(
    sent.map((item) => `${item.level}:${item.scope}:${item.message}`),
    ["warn:console:磁盘快满了", 'error:console:渲染出错 {"code":500}'],
  );
  assert.equal(fakeConsole.lastWarn, "磁盘快满了", "原 console 行为要保持不变");
  assert.equal(fakeConsole.lastError, "渲染出错 [object Object]", "原 console 行为要保持不变");

  dispose();
  fakeConsole.warn("卸载后");
  assert.equal(sent.length, 2, "卸载后不应继续上报");

  // 上报通道自己报错也不能影响界面
  const disposeBroken = installRenderLogReporter(
    {
      logEvent: () => {
        throw new Error("上报失败");
      },
    },
    { console: fakeConsole },
  );
  fakeConsole.error("依然要能打印");
  disposeBroken();
}

// 没有 window / PerformanceObserver 等宿主能力时不报错
{
  const fakeConsole: any = { warn: () => {}, error: () => {} };
  const dispose = installRenderLogReporter({ logEvent: () => assert.fail("没有错误不该上报") }, { console: fakeConsole });
  dispose();
}

console.log("render-log.check ok 格式化 / console 接管 / 卸载 / 上报失败兜底");
