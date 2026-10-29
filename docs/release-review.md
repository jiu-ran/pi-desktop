# 发布前检查清单

本清单用于主分支发布前的自检；`thinkrail` 工作台改动已在 v0.2.0 合并。这里的命令都在仓库根目录执行，Windows PowerShell / Git Bash、macOS、Linux 通用（路径分隔符按本机调整）。

## 0. 验证分级：日常小验证，发布前完整跑

**完整链路（冒烟 + 打包产物）只在发布新版本前执行**，日常改动不做这件事——一次冒烟要五分钟，连跑几次比改动本身还贵。

| 场景 | 跑什么 | 大概耗时 |
| --- | --- | --- |
| 改文档 / 文案 / 注释 | 不跑 | — |
| 改纯逻辑（`shared/`、`electron/` 里的纯函数） | 对应的单个 `node scripts/checks/<相关>.check.ts`；跨文件的再补 `npx tsc --noEmit` | 秒级 |
| 改样式 / 布局 / 交互 | `npm run check`（含 `css-tokens`、`palette-css` 等守门）；要看真实渲染时写一次性探针（`temp/` 下，用完删） | 几十秒 |
| 改窗口创建 / 标题栏 / preload 白名单 / PTY 宿主 / 打包配置 | 一次探针量准关键值，然后跑**一次** `npm run check:smoke` | 数分钟 |
| 发布新版本 | 本文件第 1–8 节，全部执行 | — |

两条配套规则：

- **不要为了让断言一条条变绿反复跑冒烟**。先在一次性探针里把真实数值（尺寸、计算样式、DOM 结构）量出来，改完只跑最后一次。
- 需要更大范围的验证但还没到发布，**先问**，不要默认开跑。

## 1. 版本与依赖

- [ ] `package.json` 的 `version` 与 `CHANGELOG.md` 的版本段落一致，日期已填。
- [ ] `package-lock.json` 与 `packages/ui/package-lock.json` 都已提交（CI 使用 `npm ci`）。
- [ ] `npm audit` 与 `npm audit --prefix packages/ui` 均无 high / critical；`moderate` 若来自仅构建期使用的 `electron-builder` 工具链，需要在 Release 说明中注明。
- [ ] Electron 使用当前受支持的稳定大版本（当前 `45.x`）；升级后必须重跑第 3、4 节的终端与打包检查。
- [ ] `node-pty` 固定为 `1.1.0`，`node_modules/node-pty` 的预构建产物与目标平台匹配；改动 `electron/terminal-pty-cleanup.ts` 或升级 `node-pty` 时重跑终端冒烟。

## 2. 静态与单元回归

```bash
npm run build:electron     # tsc
npm run typecheck --prefix packages/ui
npm run check              # 全部 scripts/checks/*.check.ts
git diff --check           # 行尾空白 / 冲突标记
```

- [ ] `npm run check` 全部通过，尤其是 `editor-save`、`files`、`history`、`stage`、`terminal`、`terminal-wheel`、`product-boundary`。
- [ ] 新增的检查已加入 `package.json` 的 `check` 链，而不是只在本机手工跑过。

## 3. Electron 冒烟

```bash
npm run check:smoke
```

覆盖内容：

| 模块 | 断言 |
|---|---|
| 网络层 | 超时、取消、下载校验、原子替换、架构选择 |
| 终端 | 可选插件启停、真实 PTY、全屏备用屏幕、方向键与滚轮区分、Tab、Ctrl+W 放行、多会话、resize、Ctrl+C |
| 编辑器 | 保存、外部修改冲突、切换项目保留草稿、Markdown 高亮、Mermaid 时序图、不可信 HTML 被拦截 |
| 版本控制 | 本地分支切换、新建、草稿 / 运行任务保护、暂存分区与真实 Diff、中文路径、窄面板 |
| 终端界面 | 深浅主题下拉、键盘导航、历史只填入、浮层生命周期、窄对话布局 |

- [ ] 输出包含 `[result] PASS` 和 `[errors] none`。CI 的 Windows job 在打包前执行同一套冒烟。
- [ ] 自动化窗口被其它窗口遮挡时，xterm DOM 渲染会被 Chromium 节流；`scripts/checks/smoke.electron.mjs` 已关闭 native occlusion / 后台节流，若未来删除这些开关，终端冒烟会出现假阴性。

## 4. 打包产物

```bash
npm run build
npx --no-install electron-builder --dir
```

- [ ] `dist/win-unpacked`（或对应平台目录）能启动，界面正常渲染，标题栏、侧边栏、欢迎页没有缺失。
- [ ] 打包版加载 `app.asar` 内的 `dist-electron/terminal-host.js` 后能启动 PTY 并正常退出：`npx --no-install electron scripts/checks/packaged-pty.electron.mjs dist/win-unpacked/resources/app.asar`（Windows CI 同样执行）。
- [ ] `dist/` 中的安装包文件名、图标、版本号正确。
- [ ] 打包产物里没有 `@earendil-works`（桌面端不内置 Pi；`find dist/win-unpacked/resources -name "*earendil*"` 应为空）。
- [ ] `CSP` 生效但未拦截自身资源：渲染进程控制台没有 `Refused to ...` 或 `Content Security Policy` 报错。

## 5. 手工验收（每轮发布至少一遍）

### 文件保存与多项目

- [ ] 打开项目 A 的文件，改内容但不保存；切换到项目 B，再切回 A，草稿仍在。
- [ ] 关闭自动保存时关闭脏标签 / 停用文件插件 / 移除项目，都会出现确认；确认放弃后不会写盘。
- [ ] 在外部编辑器或 Agent 修改同一文件后再保存，界面提示冲突并保留草稿，磁盘内容没有被覆盖。
- [ ] 保存失败（只读目录、磁盘满）后草稿仍在，错误提示为中文且可重试。
- [ ] 图片 / 二进制文件在文本编辑器中只读，不会被保存覆盖。

### 更新与退出

- [ ] 下载更新时取消，`.part` 临时文件被清理，界面回到可重试状态。
- [ ] 断网或代理不可用时，更新检查给出可读错误，不出现无限转圈。
- [ ] 有未保存改动时退出应用，会先保存或确认；取消退出后窗口仍在。
- [ ] 安装新版本后，已有桌面快捷方式保留；首次安装或快捷方式缺失时出现创建选项。

### 终端与全屏 CLI

- [ ] 首次启动终端插件默认关闭；在插件管理启用后出现标题栏入口，重启后保持启用状态。
- [ ] 新建终端能运行 `pi`、`claude`、`codex`、`vim` 等全屏程序，Tab / 方向键 / 鼠标滚轮正常。
- [ ] 全屏 CLI 中滚轮是内容翻页，不会回溯输入历史；普通 shell 中滚轮仍是 scrollback。
- [ ] 终端聚焦时 Ctrl+W / Ctrl+L 交给终端程序，不关闭窗口或刷新界面。
- [ ] 修改「设置 → 终端」的默认 shell 后，只影响新建会话；一次性后台命令也使用新 shell。
- [ ] 停止 / 结束会话后没有残留进程或 ConPTY 句柄（Windows 用任务管理器确认）。

### 会话与流式

- [ ] 打开长会话能上翻分页，滚动位置不跳；流式过程中打开会话不会丢历史。
- [ ] 分叉会话（v3 JSONL 多分支）只显示当前分支的消息。
- [ ] 回复结束后才出现复制按钮；Token 用量与实际调用一致，不是全 0。
- [ ] 切换项目 / 会话时没有「未知的会话文件」类错误。

### 离线与网络

- [ ] 断网启动不崩溃，欢迎页 / 侧边栏可用，错误提示可读。
- [ ] 命令面板、快速打开、设置、插件管理在断网时正常工作。

## 6. CI 与发布

- [ ] `.github/workflows/build.yml` 的 `build` job 只有 `contents: read`，`release` job 才提升为 `write`。
- [ ] CI 在 Linux 安装 `build-essential python3`（`node-pty`），并缓存两份 lockfile。
- [ ] 打 tag（`v*`）后三个平台都产出产物，`SHA256SUMS.txt` 覆盖全部安装包。
- [ ] Release 说明用中文，列出新增功能、修复、已知限制与校验方式；优先维护 `docs/releases/v<版本>.md`，CI 使用 `scripts/release-notes.mjs` 生成说明，不再自动生成英文提交列表。

## 7. 已知限制（随 Release 说明）

- macOS 安装包未签名 / 未公证，首次打开需要在「系统设置 → 隐私与安全性」允许；Windows 未做代码签名，SmartScreen 可能提示未知发布者。
- Linux 的 `AppImage` 需要 `libfuse2`；无 FUSE 环境可用 `tar.gz`。
- 终端依赖本机已安装的 CLI 与 shell；应用不会代为安装、登录或配置这些工具。
- 完整终端使用原生模块 `node-pty`，源码安装需要 C++ 工具链；npm 12 可能要求 `npm install-scripts approve node-pty`。
- 单个终端会话保留 1 MB 原始输出（界面 500 KB），更早的内容只能在该程序的界面内查看。
- 文本文件读取 / 保存上限 20 MB，超过 2 MB 以只读大文件模式打开；超限文件请用系统程序打开。

## 8. 回滚

- [ ] 发布前记录上一次可用的 tag 与安装包校验值。
- [ ] 若新版本出现阻断问题：先把 GitHub Release 标为 pre-release 或撤下产物，再在 `CHANGELOG.md` 记录问题与回滚版本；不要强推 tag。
