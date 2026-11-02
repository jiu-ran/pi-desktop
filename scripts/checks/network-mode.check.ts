import assert from "node:assert/strict";
import {
  applyProxyEnv,
  envProxyOf,
  NETWORK_MODE_DEFAULT,
  NETWORK_MODES,
  normalizeNetworkMode,
  normalizeProxyUrl,
  proxyPlanLabel,
  resolveProxyPlan,
} from "../../packages/ui/src/shared/network-mode.ts";

// 模式
assert.equal(NETWORK_MODE_DEFAULT, "auto");
assert.deepEqual(NETWORK_MODES.map((meta) => meta.value), ["auto", "system", "direct", "custom"]);
assert.ok(NETWORK_MODES.every((meta) => meta.label && meta.hint));
assert.equal(normalizeNetworkMode("system"), "system");
assert.equal(normalizeNetworkMode("  direct "), "direct");
assert.equal(normalizeNetworkMode(undefined), "auto", "没设置时跟系统走");
assert.equal(normalizeNetworkMode("nonsense"), "auto");

// 代理地址：允许省略协议，只留协议+主机+端口
assert.equal(normalizeProxyUrl("127.0.0.1:7890"), "http://127.0.0.1:7890");
assert.equal(normalizeProxyUrl(" http://127.0.0.1:7890/ "), "http://127.0.0.1:7890");
assert.equal(normalizeProxyUrl("socks5://127.0.0.1:1080"), "socks5://127.0.0.1:1080");
assert.equal(normalizeProxyUrl("http://user:pw@proxy.local:3128"), "http://user:pw@proxy.local:3128");
assert.equal(normalizeProxyUrl("http://127.0.0.1:7890/path?x=1"), "http://127.0.0.1:7890", "丢掉路径与查询");
assert.equal(normalizeProxyUrl("ftp://127.0.0.1:21"), "", "只支持 http/https/socks");
assert.equal(normalizeProxyUrl(""), "");

// 环境变量里的代理
assert.equal(envProxyOf({ HTTPS_PROXY: "127.0.0.1:7890" }), "http://127.0.0.1:7890");
assert.equal(envProxyOf({ https_proxy: "http://a:1", HTTP_PROXY: "http://b:2" }), "http://a:1", "HTTPS 优先");
assert.equal(envProxyOf({}), "");

// auto：环境变量 → 系统代理 → 直连
assert.deepEqual(resolveProxyPlan("auto", "", { HTTPS_PROXY: "http://e:1" }, "http://s:2"), {
  mode: "auto",
  proxy: "http://e:1",
  source: "env",
});
assert.deepEqual(resolveProxyPlan("auto", "", {}, "http://s:2"), { mode: "auto", proxy: "http://s:2", source: "system" });
assert.deepEqual(resolveProxyPlan("auto", "", {}, ""), { mode: "auto", proxy: "", source: "none" });

// system：只认系统设置，不回落环境变量
assert.deepEqual(resolveProxyPlan("system", "", { HTTPS_PROXY: "http://e:1" }, "http://s:2"), {
  mode: "system",
  proxy: "http://s:2",
  source: "system",
});
assert.deepEqual(resolveProxyPlan("system", "", { HTTPS_PROXY: "http://e:1" }, ""), {
  mode: "system",
  proxy: "",
  source: "none",
});

// direct：谁的都不听
assert.deepEqual(resolveProxyPlan("direct", "http://c:3", { HTTPS_PROXY: "http://e:1" }, "http://s:2"), {
  mode: "direct",
  proxy: "",
  source: "none",
});

// custom：填错就直连，不偷偷换成别的路
assert.deepEqual(resolveProxyPlan("custom", "127.0.0.1:7890", {}, "http://s:2"), {
  mode: "custom",
  proxy: "http://127.0.0.1:7890",
  source: "custom",
});
assert.deepEqual(resolveProxyPlan("custom", "ftp://x", {}, "http://s:2"), {
  mode: "custom",
  proxy: "",
  source: "none",
});

// 落到子进程环境：直连必须删掉继承来的代理变量
const inherited = { PATH: "/bin", HTTPS_PROXY: "http://e:1", http_proxy: "http://e:2", NO_PROXY: "localhost" };
const direct = applyProxyEnv(inherited, resolveProxyPlan("direct", "", inherited));
assert.equal(direct.HTTPS_PROXY, undefined, "直连要删掉 HTTPS_PROXY");
assert.equal(direct.http_proxy, undefined, "直连要删掉小写变量");
assert.equal(direct.NO_PROXY, "*");
assert.equal(direct.PATH, "/bin", "其它环境变量要保留");
assert.equal(inherited.HTTPS_PROXY, "http://e:1", "不能改入参");

const proxied = applyProxyEnv(inherited, resolveProxyPlan("custom", "127.0.0.1:7890", inherited));
assert.equal(proxied.HTTPS_PROXY, "http://127.0.0.1:7890");
assert.equal(proxied.HTTP_PROXY, "http://127.0.0.1:7890");
assert.equal(proxied.no_proxy, undefined, "老 NO_PROXY 要清掉，否则用户可能被自己写的规则挡住");

// 文案
assert.equal(proxyPlanLabel({ mode: "direct", proxy: "", source: "none" }), "当前直连（没有检测到代理）");
assert.equal(proxyPlanLabel({ mode: "custom", proxy: "", source: "none" }), "未填有效的代理地址，当前直连");
assert.equal(
  proxyPlanLabel(resolveProxyPlan("auto", "", {}, "http://s:2")),
  "系统代理：http://s:2",
  "设置页要能看出代理是从哪来的",
);

console.log("network-mode OK 模式 / 地址规整 / 方案 / 子进程环境 / 文案");

// 主进程有一份同样的实现（electron/network/proxy.ts）：两边必须给出一样的结果，
// 否则设置页说「走系统代理」而 Pi 子进程实际上直连 —— 最常见的「配了也没用」。
import * as mainProxy from "../../electron/network/proxy.ts";

const matrixEnv: Array<Record<string, string | undefined>> = [
  {},
  { HTTPS_PROXY: "http://e:1" },
  { http_proxy: "127.0.0.1:7890" },
  { HTTPS_PROXY: "ftp://nope" },
];
const matrixMode = ["auto", "system", "direct", "custom"] as const;
const matrixCustom = ["", "127.0.0.1:7890", "ftp://bad"];
const matrixSystem = ["", "http://s:2"];
for (const env of matrixEnv) {
  for (const mode of matrixMode) {
    for (const custom of matrixCustom) {
      for (const system of matrixSystem) {
        const ui = resolveProxyPlan(mode, custom, env, system);
        const main = mainProxy.resolveProxyPlan(mode, custom, env, system);
        assert.deepEqual(
          main,
          ui,
          `主进程与界面必须算出同一个方案：${JSON.stringify({ mode, custom, system, env, ui, main })}`,
        );
        const base = { PATH: "/bin", HTTPS_PROXY: "http://e:1" };
        assert.deepEqual(
          mainProxy.applyProxyEnv(base, main),
          applyProxyEnv(base, ui),
          "子进程环境补丁两边要一致",
        );
      }
    }
  }
}
for (const value of ["127.0.0.1:7890", "http://a:1/path", "socks5://h:1", "ftp://x", "", "  "]) {
  assert.equal(mainProxy.normalizeProxyUrl(value), normalizeProxyUrl(value), `地址规整要一致：${value}`);
}
for (const value of ["auto", "system", "direct", "custom", "bogus", undefined]) {
  assert.equal(mainProxy.normalizeNetworkMode(value), normalizeNetworkMode(value), `模式规整要一致：${String(value)}`);
}

console.log("network-mode OK 两处实现一致（界面 / 主进程）");
