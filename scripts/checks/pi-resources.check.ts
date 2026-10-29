import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  autoResources,
  configuredPackages,
  installedPathFor,
  packageResources,
  parseSkillFrontmatter,
  parseSource,
} from "../../electron/pi-resources.ts";

/**
 * 桌面端自己实现的 Pi 配置 / 资源层。
 *
 * 这些规则决定「面板里显示哪些包、哪些资源、技能叫什么名字」，以前来自 Pi 的 SDK，
 * 现在是我们的实现 —— 所以按 Pi 的磁盘约定逐条钉住。
 */

const root = mkdtempSync(path.join(tmpdir(), "pi-resources-check-"));
const agentDir = path.join(root, "agent");
const cwd = path.join(root, "project");

function write(file: string, content = ""): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
  return file;
}

try {
  // ---- 来源解析 ----
  assert.deepEqual(parseSource("npm:pi-subagents"), { kind: "npm", name: "pi-subagents" });
  assert.deepEqual(parseSource("npm:@scope/pkg@^1.2.0"), { kind: "npm", name: "@scope/pkg" });
  assert.equal(parseSource("git:github.com/me/repo").kind, "git");
  assert.equal(parseSource("https://github.com/me/repo.git").kind, "git");
  assert.equal(parseSource("ssh://git@github.com/me/repo.git").kind, "git");
  // git 源的 host / path 决定安装目录，@ref 与 .git 不能混进去
  assert.deepEqual(parseSource("git:github.com/me/repo"), { kind: "git", host: "github.com", path: "me/repo" });
  assert.deepEqual(parseSource("git:github.com/me/repo@v1.2.0"), { kind: "git", host: "github.com", path: "me/repo" }, "固定 ref 不参与目录");
  assert.deepEqual(parseSource("git@github.com:me/repo.git"), { kind: "git", host: "github.com", path: "me/repo" }, "scp 形式");
  assert.deepEqual(parseSource("https://github.com/me/repo.git"), { kind: "git", host: "github.com", path: "me/repo" });
  assert.deepEqual(
    parseSource("ssh://git@gitlab.example.com:2222/group/sub/repo.git"),
    { kind: "git", host: "gitlab.example.com", path: "group/sub/repo" },
    "端口不进 host，多级路径要保留",
  );
  assert.equal(parseSource("./local-dir").kind, "local");
  assert.equal(parseSource("D:\\work\\ext").kind, "local");

  // ---- 安装位置 ----
  const npmUser = path.join(agentDir, "npm", "node_modules", "pi-subagents");
  write(path.join(npmUser, "package.json"), "{}");
  assert.equal(installedPathFor("npm:pi-subagents", "user", cwd, agentDir), npmUser, "用户级 npm 包位置");
  assert.equal(installedPathFor("npm:pi-missing", "user", cwd, agentDir), "", "没装就返回空");

  const npmProject = path.join(cwd, ".pi", "npm", "node_modules", "@scope", "pkg");
  write(path.join(npmProject, "package.json"), "{}");
  assert.equal(installedPathFor("npm:@scope/pkg", "project", cwd, agentDir), npmProject, "项目级 npm 包位置");

  const gitUser = path.join(agentDir, "git", "github.com", "me", "repo");
  write(path.join(gitUser, "package.json"), "{}");
  assert.equal(installedPathFor("git:github.com/me/repo", "user", cwd, agentDir), gitUser, "git 检出位置");

  const localDir = path.join(agentDir, "my-ext");
  write(path.join(localDir, "package.json"), "{}");
  assert.equal(installedPathFor("./my-ext", "user", cwd, agentDir), localDir, "本地路径按用户级基目录解析");

  // ---- 配置项：字符串 vs 对象（带过滤）----
  const configured = configuredPackages(
    { packages: ["npm:pi-subagents", { source: "npm:pi-filtered", autoload: false, skills: ["a"] }] },
    { packages: ["npm:project-pkg"] },
    cwd,
    agentDir,
  );
  assert.equal(configured.length, 3);
  assert.deepEqual(
    configured.map((item) => [item.source, item.scope, item.filtered]),
    [
      ["npm:pi-subagents", "user", false],
      ["npm:pi-filtered", "user", true],
      ["npm:project-pkg", "project", false],
    ],
  );

  // ---- 包内资源：读 package.json 的 pi 字段 ----
  const pkgRoot = path.join(root, "pkg");
  write(
    path.join(pkgRoot, "package.json"),
    JSON.stringify({ name: "demo", pi: { extensions: ["./bundle/index.js"], skills: ["./skills"], prompts: ["./prompts"] } }),
  );
  write(path.join(pkgRoot, "bundle", "index.js"), "export {};");
  write(path.join(pkgRoot, "skills", "one", "SKILL.md"), "---\nname: one\ndescription: test\n---\n");
  write(path.join(pkgRoot, "skills", "two", "SKILL.md"), "---\nname: two\ndescription: test\n---\n");
  write(path.join(pkgRoot, "prompts", "hello.md"), "# hello");
  write(path.join(pkgRoot, "prompts", "notes.txt"), "ignored");
  const resources = packageResources(
    { source: "npm:demo", scope: "user", kind: "npm", filtered: false, installedPath: pkgRoot },
    { global: {}, project: {} },
  );
  assert.deepEqual(
    resources.map((item) => [item.type, path.basename(path.dirname(item.path)) === "skills" ? path.basename(item.path) : path.basename(item.path), item.enabled]),
    [
      ["extensions", "index.js", true],
      ["skills", "SKILL.md", true],
      ["skills", "SKILL.md", true],
      ["prompts", "hello.md", true],
    ],
    "包内资源按 类型顺序 → 声明顺序 → 文件名排序，.txt 不算资源",
  );

  // autoload: false + 过滤数组 = 只保留列出来的
  const filtered = packageResources(
    {
      source: "npm:demo",
      scope: "user",
      kind: "npm",
      filtered: true,
      filteredEntry: { source: "npm:demo", autoload: false, skills: ["one"] },
      installedPath: pkgRoot,
    },
    { global: {}, project: {} },
  );
  const skillItems = filtered.filter((item) => item.type === "skills");
  assert.equal(skillItems.length, 2, "过滤不删除条目，只标记 enabled");
  assert.equal(skillItems.filter((item) => item.enabled).length, 1, "只启用列出来的那一个");

  // ---- 顶层自动发现 + 设置里的白名单 ----
  write(path.join(agentDir, "extensions", "rtk.ts"), "export {};");
  write(path.join(agentDir, "extensions", "other.ts"), "export {};");
  write(path.join(cwd, ".pi", "extensions", "local.ts"), "export {};");
  const auto = autoResources({ global: {}, project: {} }, cwd, agentDir);
  assert.deepEqual(
    auto.filter((item) => item.type === "extensions").map((item) => [path.basename(item.path), item.scope, item.source]),
    [
      ["local.ts", "project", "auto"],
      ["other.ts", "user", "auto"],
      ["rtk.ts", "user", "auto"],
    ],
    "项目级在前，用户级在后，source 标记为 auto",
  );
  const whitelisted = autoResources({ global: { extensions: ["rtk.ts"] }, project: {} }, cwd, agentDir);
  const extensionState = whitelisted
    .filter((item) => item.type === "extensions")
    .map((item) => [path.basename(item.path), item.enabled]);
  // 白名单是按作用域生效的：全局设置只管全局目录，项目目录看项目设置
  assert.deepEqual(extensionState, [["local.ts", true], ["other.ts", false], ["rtk.ts", true]], "全局白名单只管用户级目录");

  const projectWhitelisted = autoResources({ global: {}, project: { extensions: ["local.ts"] } }, cwd, agentDir);
  const projectState = projectWhitelisted
    .filter((item) => item.type === "extensions")
    .map((item) => [path.basename(item.path), item.enabled]);
  assert.deepEqual(projectState, [["local.ts", true], ["other.ts", true], ["rtk.ts", true]], "项目白名单只管项目目录");

  // ---- SKILL.md frontmatter ----
  assert.deepEqual(parseSkillFrontmatter("---\nname: a\ndescription: b\n---\nbody"), { name: "a", description: "b" });
  assert.deepEqual(parseSkillFrontmatter('---\nname: "q"\ndescription: \'w\'\n---\n'), { name: "q", description: "w" });
  assert.deepEqual(
    parseSkillFrontmatter("---\ndescription: |\n  line1\n  line2\n---\n"),
    { description: "line1\nline2\n" },
    "块文本保留换行",
  );
  assert.deepEqual(parseSkillFrontmatter("---\ndescription: >\n  a\n  b\n---\n"), { description: "a b\n" }, "折叠块换成空格");
  assert.equal(parseSkillFrontmatter("---\ndisable-model-invocation: true\n---\n").disableModelInvocation, true);
  assert.deepEqual(parseSkillFrontmatter("没有 frontmatter"), {}, "没有 frontmatter 时返回空");

  console.log("pi-resources OK 来源解析 / 安装位置 / 配置项 / 包内资源 / 自动发现白名单 / SKILL.md frontmatter");
} finally {
  rmSync(root, { recursive: true, force: true });
}
