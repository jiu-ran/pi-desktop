# 发布前检查清单

本清单用于主分支发布前的自检。命令都在仓库根目录执行，Windows Git Bash、macOS、Linux 通用（路径分隔符按本机调整）。项目现在由 **MyGo + Go 宿主 + Vue 3 前端** 组成，不再有 Electron 主进程、`node-pty` 或 `app.asar`。

## 0. 验证分级：日常小验证，发布前完整跑

**完整链路（冒烟 + 打包产物）只在发布新版本前执行**，日常改动不做这件事。

| 场景 | 跑什么 | 大概耗时 |
| --- | --- | --- |
| 改文档 / 文案 / 注释 | 不跑 | — |
| 改前端纯逻辑（`packages/ui/src/shared/`、`kernel/` 里的纯函数） | `npm run check:changed`（按改动文件自动挑相关检查）；对不准时用 `node scripts/checks/run-checks.mjs --only=<名字>` | 秒级 |
| 改 Go 纯逻辑（`internal/host/`） | `go test ./internal/host`；必要时加 `go vet ./...` | 秒级～十几秒 |
| 改样式 / 布局 / 交互 | `npm run check:changed`（会带上 `css-tokens`、`palette-css` 等全局守门）；要看真实渲染时写一次性探针（`temp/` 下，用完删） | 秒级 |
| 改窗口 / 绑定签名 / PTY / 打包配置 | 一次探针量准关键值，然后跑**一次** `PI_DESKTOP_SMOKE=1 npx mygo dev` | 数分钟 |
| 发布新版本 | `npm run check`（57 个前端检查 + `go test ./...`）+ 本文件第 1–8 节 | 约 10 秒 + 冒烟 |

两条配套规则：

- **不要为了让断言一条条变绿反复跑冒烟**。先在一次性探针里把真实数值（尺寸、计算样式、DOM 结构）量出来，改完只跑最后一次。
- 需要更大范围的验证但还没到发布，**先问**，不要默认开跑。

## 1. 版本与依赖

- [ ] `package.json` 的 `version` 与 `CHANGELOG.md` 的版本段落一致，日期已填。
- [ ] `package-lock.json` 与 `packages/ui/package-lock.json` 都已提交（CI 使用 `npm ci`）。
- [ ] `go.mod` / `go.sum` 已提交；Go 版本不低于 `go.mod` 里的 `go` 指令（当前 1.27.3）。
- [ ] `npm audit` 与 `npm audit --prefix packages/ui` 均无 high / critical；构建期 `mygo-cli` 的 moderate 视情况在 Release 说明中注明。
- [ ] `mygo` 与 `mygo-runtime` 版本一致（当前 `0.9.1`）；升级 MyGo 后重跑窗口、PTY、打包三节。
- [ ] 没有残留 Electron / `node-pty` 依赖：`rg '"electron"|node-pty' package.json packages/ui/package.json` 应为空。

## 2. 静态与单元回归

```bash
npm run check              # tsc + vue-tsc + check:syntax + 全部 *.check.ts + go test ./...
npm run check:go           # 只跑 Go 测试
go vet ./...               # 可选，发布前建议
git diff --check           # 行尾空白 / 冲突标记
```

前端检查由 `scripts/checks/run-checks.mjs` 统一调度：自动发现全部 `*.check.ts`，按 CPU 并行，
失败时只把出错那个检查的最后 30 行打出来，最后给总耗时与最慢的 5 项。常用参数：

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 全量（发布前 / CI） |
| `npm run check:changed` | 只跑被改动文件影响的检查 + 全局守门 |
| `npm run check:full` | 单并发 + 逐项打印（排查时序问题或想看每一项耗时） |
| `node scripts/checks/run-checks.mjs --list` | 列出所有检查（`[全局]` 表示永远跟着跑） |
| `node scripts/checks/run-checks.mjs --only=git,term` | 按名字子串只跑几个 |

- [ ] `npm run check` 全部通过；Go 侧重点看会话分页、模型默认值、工具开关、工作区文件、Git / worktree 五组测试。
- [ ] **新增前端检查只要放进 `scripts/checks/*.check.ts` 就行**，不用再改 `package.json`；文件名即 `--only` 的匹配名。
- [ ] 新增 Go 行为时在 `internal/host/*_test.go` 里补测试，尽量用 `t.TempDir()`，不要在仓库里留产物。
- [ ] **一次性探针、截图脚本、反向验证脚本一律写进 `temp/`，用完删**。

## 3. 宿主冒烟

在开发模式下跑完整探针（会打开真实窗口、启动本机 `pi`、创建临时 git 仓库）：

```bash
PI_DESKTOP_SMOKE=1 \
PI_DESKTOP_SMOKE_PTY=1 \
PI_DESKTOP_SMOKE_BASH=1 \
PI_DESKTOP_SMOKE_PROMPT=1 \
PI_DESKTOP_SMOKE_UI=1 \
PI_DESKTOP_SMOKE_SETTINGS=1 \
PI_DESKTOP_SMOKE_REPO=1 \
npx mygo dev
```

| 探针 | 断言 |
|---|---|
| `host` | 窗口标题、MyGo 运行时、Pi 定位（版本 / 路径）、最近项目、会话目录、模型数量、shell profile |
| `PTY` | ConPTY / Unix PTY 能起 shell、回显 `hello-mygo`、退出码正常 |
| `bash` | 一次性后台命令能收完整输出与退出码 |
| `prompt` | 真实 `pi --mode rpc` 能收到一条 prompt 并返回文本 |
| `UI` | 前端已加载、`openWorkspace` 返回文件列表、`gitBranch` 可用、截图落盘 |
| `settings` | 工具 / 模型 / 技能 / 包 / MCP / 信任 / 智能体 / 日志 / 网络 / 更新缓存各接口不报错 |
| `repo` | 临时 git 仓库的读写、暂存、提交、worktree 创建与移除 |

- [ ] 日志里出现 `smoke: ... PASS` / 统计行，退出码为 0；截图在临时目录（`%TEMP%/pi-desktop-mygo-smoke.png`）。
- [ ] 日志落在仓库 `logs/`（开发模式）或 userData `logs/`；没有 panic、`found pointer to free object`、非法 UTF-8 报错。
- [ ] 生产可执行文件也能跑最小探针：`PI_DESKTOP_SMOKE=1 "dist-mygo/windows-amd64/Pi Desktop.exe"`。

## 4. 打包产物

```bash
npx mygo build                    # 当前平台：exe/app + 安装包
npx mygo build -skip-installer    # 只出可执行文件，打包检查用
npx mygo build -platform windows/amd64,darwin/universal,linux/amd64
```

- [ ] `dist-mygo/<os>-<arch>/` 下的可执行文件能启动，界面正常渲染，标题栏、侧边栏、欢迎页没有缺失。
- [ ] Windows exe 约 35–40 MB；安装包能安装 / 卸载，开始菜单与桌面快捷方式行为正确。
- [ ] macOS `.app` / `.dmg` 能打开；未签名时按第 7 节说明放行。
- [ ] Linux `tar.gz` / `deb` / `rpm` 至少各验一个；`tar.gz` 内含 `install.sh`，可在无包管理器环境安装到 `~/.local`。
- [ ] 打包产物里没有 `@earendil-works`（`rg -a "earendil" dist-mygo` 应为空）。
- [ ] `CSP` 生效但未拦截自身资源：WebView 控制台没有 `Refused to ...` 或 `Content Security Policy` 报错。
- [ ] 开发模式与安装版可以同时运行（单实例锁只作用于同一个可执行文件 / userData）。

## 5. 手工验收（每轮发布至少一遍）

### 窗口与文件保存

- [ ] Windows / Linux 无边框窗口可拖动、双击标题栏最大化、右上角最小化 / 最大化 / 关闭正常；macOS 红绿灯位置正确。
- [ ] 打开项目 A 的文件，改内容但不保存；切换到项目 B，再切回 A，草稿仍在。
- [ ] 关闭自动保存时关闭脏标签 / 停用文件插件 / 移除项目，都会出现确认；确认放弃后不会写盘。
- [ ] 有未保存草稿时关闭窗口，弹出原生确认；取消后窗口仍在。
- [ ] 在外部编辑器或 Agent 修改同一文件后再保存，界面提示冲突并保留草稿，磁盘内容没有被覆盖。
- [ ] 图片 / 二进制文件在文本编辑器中只读，不会被保存覆盖。

### 更新与退出

- [ ] 下载更新时取消，`.part` 临时文件被清理，界面回到可重试状态。
- [ ] 断网、直连、系统代理、自定义代理四种模式下，更新检查与 Pi 请求都按预期走；代理不可用时给出可读错误。
- [ ] 安装新版本后自动重启，已有桌面快捷方式保留。
- [ ] 退出后没有残留 `pi` / shell / 终端进程（Windows 任务管理器确认）。

### 终端与全屏 CLI

- [ ] 首次启动终端插件默认关闭；在插件管理启用后出现标题栏入口，重启后保持启用状态。
- [ ] 新建终端能运行 `pi`、`claude`、`codex`、`vim` 等全屏程序，Tab / 方向键 / 鼠标滚轮正常。
- [ ] 全屏 CLI 中滚轮是内容翻页，不会回溯输入历史；普通 shell 中滚轮仍是 scrollback。
- [ ] 终端聚焦时 Ctrl+W / Ctrl+L 交给终端程序，不关闭窗口或刷新界面。
- [ ] 修改「设置 → 终端」的默认 shell 后，只影响新建会话；一次性后台命令也使用新 shell。
- [ ] 停止 / 结束会话后没有残留进程或 ConPTY 句柄。

### 会话与流式

- [ ] 打开长会话能上翻分页，滚动位置不跳；流式过程中打开会话不会丢历史。
- [ ] 分叉会话（v3 JSONL 多分支）只显示当前分支的消息。
- [ ] 回复结束后才出现复制按钮；Token 用量与实际调用一致，不是全 0。
- [ ] 切换项目 / 会话时没有「未知的会话文件」类错误。
- [ ] 拖拽文件到输入框、粘贴图片、`@` 文件补全都正常（拖放路径由 MyGo 的 `onFileDrop` 异步解析）。

### 离线与网络

- [ ] 断网启动不崩溃，欢迎页 / 侧边栏可用，错误提示可读。
- [ ] 命令面板、快速打开、设置、插件管理在断网时正常工作。

## 6. CI 与发布

- [ ] `.github/workflows/build.yml` 的 `build` job 只有 `contents: read`，`release` job 才提升为 `write`。
- [ ] CI 使用 `actions/setup-go` 读取 `go.mod`，Linux 安装 `fakeroot dpkg rpm zstd`。
- [ ] 打 tag（`v*`）后三个平台都产出产物，`SHA256SUMS.txt` 覆盖 exe / zip / dmg / tar.gz / deb / rpm。
- [ ] **更新签名可用**：仓库已配置签名私钥 secret（`gh api repos/<owner>/<repo>/actions/secrets --jq .total_count` ≥ 1），Release 上带 `SHA256SUMS.txt.sig`，且该版本的 `Pi.Desktop.exe` 里内置了公钥。缺任一环，客户端只能「到发布页手动下载」，自动更新会静默失效。
  - 首次启用：`node scripts/gen-update-key.mjs` → 把输出里的私钥（base64 种子）存进 secret → 发一版**手动升级**的客户端；此后才能验签。
  - 换密钥：新旧公钥不互相兼容，老客户端会拒装，需要再手动升级一次。
- [ ] Release 说明用中文，列出新增功能、修复、已知限制与校验方式；优先维护 `docs/releases/v<版本>.md`，CI 使用 `scripts/release-notes.mjs` 生成说明。

## 7. 已知限制（随 Release 说明）

- Windows 依赖系统 WebView2（Windows 11 自带；Windows 10 若缺失需安装 Evergreen Runtime）。MyGo 不会把 Chromium 打进安装包。
- macOS 安装包未签名 / 未公证，首次打开需要在「系统设置 → 隐私与安全性」允许；Windows 未做代码签名，SmartScreen 可能提示未知发布者。
- Linux 使用 `tar.gz` 内的 `install.sh` 安装到 `~/.local`，或使用 `deb` / `rpm` / Arch 包；桌面环境需要 WebKitGTK 4.1。
- 终端依赖本机已安装的 CLI 与 shell；应用不会代为安装、登录或配置这些工具。
- 单个终端会话保留 1 MB 原始输出（界面 500 KB），更早的内容只能在该程序的界面内查看。
- 文本文件读取 / 保存上限 20 MB，超过 2 MB 以只读大文件模式打开；超限文件请用系统程序打开。

## 8. 回滚

- [ ] 发布前记录上一次可用的 tag 与安装包校验值。
- [ ] 若新版本出现阻断问题：先把 GitHub Release 标为 pre-release 或撤下产物，再在 `CHANGELOG.md` 记录问题与回滚版本；不要强推 tag。
