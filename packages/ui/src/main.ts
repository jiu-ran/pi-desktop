import { createApp } from "vue";
import App from "./App.vue";
import { createKernel, KERNEL_KEY } from "./kernel/index.ts";
import { builtinPlugins } from "./plugins/index.ts";
import { localizeNotification } from "./shared/notify-text.ts";
import { installLongTaskReporter } from "./shared/long-task.ts";
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
