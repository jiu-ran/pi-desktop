import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { shouldAutoDownloadUpdate } from "../../packages/ui/src/shared/update-auto.ts";

// 默认开启：装上就该自己保持最新
assert.equal(
  shouldAutoDownloadUpdate({ appUpdateAuto: true }, { updateAvailable: true }),
  true,
  "自动下载开启 + 有更新时必须下载",
);
assert.equal(
  shouldAutoDownloadUpdate({ appUpdateAuto: true }, { updateAvailable: false }),
  false,
  "没有新版本不要下载",
);
assert.equal(
  shouldAutoDownloadUpdate({ appUpdateAuto: false }, { updateAvailable: true }),
  false,
  "关掉自动下载后只能手动点",
);
// 检查失败（限流 / 断网）时不能去下载：会再踩一次同样的错
assert.equal(
  shouldAutoDownloadUpdate({ appUpdateAuto: true }, { updateAvailable: false, error: "超过访问频率限制" }),
  false,
  "检查失败不能触发下载",
);
assert.equal(
  shouldAutoDownloadUpdate({ appUpdateAuto: true }, { updateAvailable: true, error: "网络不可用" }),
  false,
  "带错误的检查结果一律不下载",
);

const settingsSource = await readFile("packages/ui/src/services/settings.ts", "utf8");
// 环境页（检查更新 / 自动下载开关）已拆成独立组件
const modalSource = await readFile("packages/ui/src/components/overlays/settings/PiDesktopSettings.vue", "utf8");
const workbenchSource = await readFile("packages/ui/src/kernel/workbench.ts", "utf8");

// 设置项本身：默认必须开启，并落进 localStorage（老用户缺字段时补成 true）
assert.ok(
  /appUpdateCheck: true,\s*\n\s*appUpdateAuto: true,/.test(settingsSource),
  "appUpdateAuto 默认值必须是 true",
);
assert.ok(
  /appUpdateAuto: typeof parsed\.appUpdateAuto === "boolean"\s*\?\s*parsed\.appUpdateAuto\s*:\s*DEFAULT_SETTINGS\.appUpdateAuto/.test(settingsSource),
  "老配置缺 appUpdateAuto 时要补默认值（默认开启）",
);

// 启动检查必须走「检查 + 自动下载」的统一入口，不能只查不下
assert.ok(
  /if \(appSettings\.appUpdateCheck\) void checkAppUpdateWithAutoDownload\(\)/.test(settingsSource),
  "启动时检查更新要接上自动下载",
);
assert.ok(
  /phase === "available"\) void workbench\.downloadAppUpdate\(\{ background: true \}\)/.test(settingsSource),
  "用户后来打开自动下载时，已发现的更新要补下载",
);
assert.ok(
  /checkAppUpdateWithAutoDownload[\s\S]*?downloadAppUpdate\(\{ background: true \}\)/.test(settingsSource),
  "自动下载要标记成后台任务（失败只提示警告）",
);

// 设置页的「检查更新」也要走同一个入口（否则手动查完还得再点下载）
assert.ok(
  /checkAppUpdateWithAutoDownload\(\{ manual: true \}\)/.test(modalSource),
  "设置页手动检查更新也要触发自动下载",
);
assert.ok(
  /v-model="appSettings\.appUpdateAuto"/.test(modalSource),
  "设置页要有「自动下载更新」开关",
);

// 自动下载是后台行为：失败只能提示警告，不能用红色错误打断用户
assert.ok(
  /options\.background \? "warning" : "error"/.test(workbenchSource),
  "后台自动下载失败要降级成 warning",
);

console.log("update-auto OK");
