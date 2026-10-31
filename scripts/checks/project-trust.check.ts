import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  canonicalTrustPath,
  nearestTrustEntry,
  projectNeedsTrust,
  projectTrustStatus,
  readTrustStore,
  setProjectTrust,
  trustFilePath,
  writeTrustStore,
} from "../../electron/project-trust.ts";

/**
 * 项目信任的读写。
 *
 * 这块必须和 Pi 的 `trust.json` 一字不差地对上：桌面端写的内容如果 Pi 读不懂，
 * 项目级扩展 / 技能 / MCP 就还是静默不加载，而这在界面上看起来完全正常。
 */

const root = await mkdtemp(path.join(tmpdir(), "pi-trust-check-"));
const agentDir = path.join(root, "agent");
const project = path.join(root, "repo", "app");
await mkdir(path.join(project, ".pi", "skills", "demo"), { recursive: true });
await mkdir(agentDir, { recursive: true });

try {
  // 1. 目录里有需要信任的资源 → needsTrust 为真；没有记录时按不信任处理（RPC 拿不到回答）
  assert.equal(projectNeedsTrust(project), true, ".pi/skills 应该触发信任校验");
  assert.equal(projectNeedsTrust(path.join(root, "empty")), false, "没有项目级资源就不需要信任");
  await mkdir(path.join(root, "empty"), { recursive: true });

  const initial = await projectTrustStatus({ cwd: project, agentDir });
  assert.equal(initial.decision, null);
  assert.equal(initial.needsTrust, true);
  assert.equal(initial.effective, false, "没有记录 + 默认 ask：RPC 模式下就是不信任");

  // 2. 写信任 → 生效；文件格式与 Pi 一致（键排序、两空格、结尾换行）
  const trusted = await setProjectTrust({ cwd: project, agentDir, action: "trust" });
  assert.equal(trusted.effective, true);
  assert.equal(trusted.decision, true);
  assert.equal(trusted.recordedAt, canonicalTrustPath(project));
  const text = await readFile(trustFilePath(agentDir), "utf8");
  assert.ok(text.endsWith("\n"), "trust.json 要以换行结尾");
  assert.equal(text, `${JSON.stringify({ [canonicalTrustPath(project)]: true }, null, 2)}\n`);

  // 3. 读取时忽略非法值（坏文件不至于让整个命令崩掉）
  await writeFile(path.join(agentDir, "broken.json"), "{ 不是 JSON", "utf8");
  const broken = await readTrustStore(path.join(agentDir, "broken.json"));
  assert.deepEqual(broken.store, {});
  assert.ok(broken.error?.includes("broken.json"), "坏文件要带上原因");

  // 4. 祖先目录的信任会被子目录继承（Pi 的 findNearestTrustEntry 同规则）
  const parentTrust = nearestTrustEntry({ [canonicalTrustPath(path.dirname(project))]: true }, project);
  assert.equal(parentTrust?.decision, true);

  // 5. 「信任上一级目录」：祖先记 true，本目录的记录删掉
  await setProjectTrust({ cwd: project, agentDir, action: "trust-parent" });
  const parentKey = canonicalTrustPath(path.dirname(project));
  const entries = JSON.parse(await readFile(trustFilePath(agentDir), "utf8"));
  assert.equal(entries[parentKey], true, "上一级目录应该被记为信任");
  assert.equal(entries[canonicalTrustPath(project)], undefined, "本目录的记录要删掉，交给祖先继承");
  const inherited = await projectTrustStatus({ cwd: project, agentDir });
  assert.equal(inherited.decision, true);
  assert.equal(inherited.recordedAt, parentKey);

  // 6. 不信任：显式 false 覆盖祖先的 true
  const distrusted = await setProjectTrust({ cwd: project, agentDir, action: "distrust" });
  assert.equal(distrusted.effective, false);
  assert.equal(distrusted.decision, false);
  assert.equal(distrusted.recordedAt, canonicalTrustPath(project));

  // 7. 设置里写了 defaultProjectTrust = always 时，没有记录也算信任
  const always = await projectTrustStatus({ cwd: path.join(root, "empty2"), agentDir, defaultProjectTrust: "always" });
  assert.equal(always.needsTrust, false);

  // 8. 排序：键按字典序落盘，和 Pi 自己写的内容不会来回抖动
  await writeTrustStore(trustFilePath(agentDir), { "C:\\b": true, "C:\\a": false, "C:\\c": null } as any);
  const sorted = await readFile(trustFilePath(agentDir), "utf8");
  assert.equal(sorted, `${JSON.stringify({ "C:\\a": false, "C:\\b": true }, null, 2)}\n`, "null 要丢掉、键要排序");

  console.log("project-trust OK 默认不信任 / 写入格式 / 祖先继承 / 覆盖 / 坏文件 / 排序");
} finally {
  await rm(root, { recursive: true, force: true });
}
