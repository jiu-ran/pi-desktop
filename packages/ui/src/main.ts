import { createApp } from "vue";
import App from "./App.vue";
import { createKernel, KERNEL_KEY } from "./kernel/index.ts";
import { builtinPlugins } from "./plugins/index.ts";
import { localizeNotification } from "./shared/notify-text.ts";
import { installLagWatchdog, installLongTaskReporter } from "./shared/long-task.ts";
import { installRenderLogReporter } from "./shared/render-log.ts";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/conversation.css";
import "./styles/components.css";

const kernel = createKernel();

async function boot(): Promise<void> {
  for (const plugin of builtinPlugins) await kernel.plugins.register(plugin);
  const app = createApp(App);
  app.provide(KERNEL_KEY, kernel);
  app.config.errorHandler = (error: any, _instance, info) => {
    console.error("[ui]", info, error);
    kernel.bus.emit("notify", { level: "error", text: `界面错误：${localizeNotification(error, "error")}` });
  };
  app.mount("#app");
  window.__piDesktop = kernel;
  // 渲染侧长任务写进主进程的卡顿日志：卡死时能分清是主进程还是渲染进程。
  installLongTaskReporter({
    report: (ms, label) => (window as any).piDesktop?.reportLongTask?.(ms, label),
  });
  // 前端 warn / error 与未捕获异常也落盘（logs/renderer.log），
  // 否则主进程侧看不到前端到底报了什么错。
  installRenderLogReporter({ logEvent: (level, scope, message) => (window as any).piDesktop?.logEvent?.(level, scope, message) });
  // 心跳看门狗：界面卡住几秒又自己恢复时，恢复后补一条带时间的记录，
  // 否则这种情况在日志里完全看不出来（长任务回调本身也不会触发）。
  installLagWatchdog({
    report: (driftMs, at) =>
      (window as any).piDesktop?.logEvent?.(
        "warn",
        "renderer",
        `界面卡顿 ${Math.round(driftMs)}ms（起于 ${at}），可能正在死循环或被主进程阻塞`,
      ),
  });
  // 这行是「渲染进程到底启动过没有」的分界线：卡死时日志里有没有它一目了然。
  (window as any).piDesktop?.logEvent?.("info", "renderer", "界面已就绪");
  window.addEventListener("beforeunload", (event) => {
    if (!kernel.stage.allTabs.value.some(tab => tab.dirty || (tab.data as any)?.saving)) return;
    event.preventDefault();
    event.returnValue = "存在未保存的文件修改";
  });
  await kernel.workbench.init();
}

void boot().catch((error) => {
  console.error("[boot]", error);
  kernel.bus.emit("notify", { level: "error", text: `启动失败：${localizeNotification(error, "error")}` });
});
