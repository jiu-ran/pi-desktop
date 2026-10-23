import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

/** 使用本地 HTTP 服务验证超时、取消、流式下载和严格校验；不访问外部网络。 */
export async function checkNetworkInElectron() {
  const { requestJson, downloadFileStream } = await import("../../dist-electron/network/http.js");
  const { findReleaseAsset, compareVersions } = await import("../../dist-electron/network/github.js");
  const content = Buffer.from("网络下载回归\n");
  const hash = createHash("sha256").update(content).digest("hex");
  const sockets = new Set();
  const server = createServer((req, res) => {
    if (req.url === "/slow") { res.writeHead(200, { "Content-Type": "application/json" }); res.write("{"); return; }
    if (req.url === "/json") { res.setHeader("Content-Type", "application/json"); res.end('{"ok":true}'); return; }
    res.setHeader("Content-Length", content.length); res.end(content);
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const dir = await mkdtemp(path.join(tmpdir(), "pi-network-"));
  const file = path.join(dir, "download.bin");
  try {
    assert.equal((await requestJson(`${url}/json`)).ok, true);
    await assert.rejects(requestJson(`${url}/slow`, { timeout: 100, maxRetries: 0, signal: new AbortController().signal }), "有外部信号时超时仍应生效");
    await downloadFileStream(`${url}/file`, file, { verifySha256: hash, maxRetries: 0 });
    assert.deepEqual(await readFile(file), content);
    await assert.rejects(downloadFileStream(`${url}/file`, file, { verifySha256: "bad", maxRetries: 0 }));
    await assert.rejects(downloadFileStream(`${url}/file`, file, { verifySha256: "a".repeat(64), maxRetries: 0 }));
    assert.deepEqual(await readFile(file), content, "失败的下载不应破坏以前完整文件");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 80);
    await assert.rejects(downloadFileStream(`${url}/slow`, file, { signal: controller.signal, maxRetries: 3 }));
    assert.equal((await readdir(dir)).filter(name => name.endsWith(".part")).length, 0);
    const assets = [{ name: "Pi-arm64.dmg", browser_download_url: "arm" }, { name: "Pi-x64.dmg", browser_download_url: "x64" }];
    assert.equal(findReleaseAsset(assets, "darwin", "x64").browser_download_url, "x64");
    assert.ok(compareVersions("v0.2.0", "0.1.9") > 0);
    console.log("[network] PASS 超时 / 取消 / 校验 / 原子下载 / 架构选择");
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}
