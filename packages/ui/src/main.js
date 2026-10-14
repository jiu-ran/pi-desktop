import { createApp } from "vue";
import App from "./App.vue";
import { createKernel, KERNEL_KEY } from "./kernel/index.js";
import { builtinPlugins } from "./plugins/index.js";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/conversation.css";
import "./styles/components.css";

const kernel = createKernel();

async function boot() {
  for (const plugin of builtinPlugins) await kernel.plugins.register(plugin);
  const app = createApp(App);
  app.provide(KERNEL_KEY, kernel);
  app.config.errorHandler = (error, _instance, info) => {
    console.error("[ui]", info, error);
    kernel.bus.emit("notify", { level: "error", text: `界面错误：${error?.message ?? error}` });
  };
  app.mount("#app");
  // 给控制台留一个调试入口，便于手动注册实验插件
  window.__piDesktop = kernel;
  await kernel.workbench.init();
}

boot();
