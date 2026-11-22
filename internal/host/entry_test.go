package host

import (
	"os"
	"path"
	"path/filepath"
	"testing"
)

// 官方安装器（pi.dev）把 pi 装在 <agent>/bin 下：pi.cmd 只负责把参数转给同目录的
// pi-launcher.js，入口和 agentDir 由 launcher 决定。这类安装必须能解析出 launcher，
// 否则界面里「设置 → Pi CLI」能识别、工作区却一律「进程出错」。
func TestPiCliEntryFromInstallerShim(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "agent", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	launcher := filepath.Join(bin, "pi-launcher.js")
	if err := os.WriteFile(launcher, []byte("console.log('1.6.0')\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	shim := filepath.Join(bin, "pi.cmd")
	shimText := "@ECHO off\r\nSETLOCAL\r\nSET \"node=node\"\r\n\"%node%\" \"%~dp0pi-launcher.js\" %*\r\nEXIT /B %ERRORLEVEL%\r\n"
	if err := os.WriteFile(shim, []byte(shimText), 0o644); err != nil {
		t.Fatal(err)
	}

	if got := piCliEntryFromExecutable(shim); got != launcher {
		t.Fatalf("installer shim 应解析到 launcher，得到 %q，期望 %q", got, launcher)
	}
}

// launcher 优先于 node_modules 里的 dist/cli.js：后者能跑，但缺 launcher 设置的环境。
func TestPiCliEntryPrefersLauncherOverNodeModules(t *testing.T) {
	root := t.TempDir()
	agent := filepath.Join(root, "agent")
	bin := filepath.Join(agent, "bin")
	pkg := filepath.Join(agent, "node_modules", "@earendil-works", "pi-coding-agent", "dist")
	if err := os.MkdirAll(pkg, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	cliJS := filepath.Join(pkg, "cli.js")
	if err := os.WriteFile(cliJS, []byte("// cli\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	launcher := filepath.Join(bin, "pi-launcher.js")
	if err := os.WriteFile(launcher, []byte("// launcher\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	shim := filepath.Join(bin, "pi.cmd")
	if err := os.WriteFile(shim, []byte("\"%node%\" \"%~dp0pi-launcher.js\" %*\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if got := piCliEntryFromExecutable(shim); got != launcher {
		t.Fatalf("应优先 launcher，得到 %q", got)
	}
}

// npm 全局安装：shim 直接指向 node_modules 里的 dist/cli.js，没有 launcher。
func TestPiCliEntryFromNpmLayout(t *testing.T) {
	root := t.TempDir()
	prefix := filepath.Join(root, "npm")
	pkg := filepath.Join(prefix, "node_modules", "@earendil-works", "pi-coding-agent", "dist")
	if err := os.MkdirAll(pkg, 0o755); err != nil {
		t.Fatal(err)
	}
	cliJS := filepath.Join(pkg, "cli.js")
	if err := os.WriteFile(cliJS, []byte("// cli\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	shim := filepath.Join(prefix, "pi.cmd")
	if err := os.WriteFile(shim, []byte("\"%_prog%\" \"%dp0%\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js\" %*\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if got := piCliEntryFromExecutable(shim); got != cliJS {
		t.Fatalf("npm 布局应解析到 dist/cli.js，得到 %q，期望 %q", got, cliJS)
	}
}

// 认不出的 shim 返回空串，交给上层给出可操作的报错。
func TestPiCliEntryUnknownShim(t *testing.T) {
	dir := t.TempDir()
	shim := filepath.Join(dir, "pi.cmd")
	if err := os.WriteFile(shim, []byte("@ECHO off\r\nexit /b 0\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := piCliEntryFromExecutable(shim); got != "" {
		t.Fatalf("无法识别的 shim 应返回空串，得到 %q", got)
	}
}

// 直接指定 .js（dist/cli.js 或 pi-launcher.js）时应原样返回。
func TestPiCliEntryAcceptsJavaScriptPath(t *testing.T) {
	dir := t.TempDir()
	js := filepath.Join(dir, "pi-launcher.js")
	if err := os.WriteFile(js, []byte("// launcher\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := piCliEntryFromExecutable(js); got != js {
		t.Fatalf("应原样返回 .js 路径，得到 %q", got)
	}
}

// 新版 npm 包的 bin 指向 dist/bundle/cli.js；相对路径（../install/...）也要能解析。
func TestPiCliEntryFromBundleRelativePath(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "agent", "bin")
	pkg := filepath.Join(root, "agent", "install", "releases", "1.6.0", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(pkg, 0o755); err != nil {
		t.Fatal(err)
	}
	cliJS := filepath.Join(pkg, "cli.js")
	if err := os.WriteFile(cliJS, []byte("// bundled\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	shim := filepath.Join(bin, "pi.cmd")
	shimText := "\"%node%\" \"%~dp0..\\install\\releases\\1.6.0\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js\" %*\\r\\n"
	if err := os.WriteFile(shim, []byte(shimText), 0o644); err != nil {
		t.Fatal(err)
	}

	if got := piCliEntryFromExecutable(shim); got != cliJS {
		t.Fatalf("应解析到 bundle/cli.js，得到 %q，期望 %q", got, cliJS)
	}
}

// 官方安装器的 bin 目录必须排在候选列表最前，且跟随 PI_CODING_AGENT_DIR。
func TestPiKnownCandidatesStartsWithInstallerBin(t *testing.T) {
	agent := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", agent)
	bin := filepath.Join(agent, "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	name := "pi"
	if isWindows() {
		name = "pi.cmd"
	}
	exe := filepath.Join(bin, name)
	if err := os.WriteFile(exe, []byte("@echo off\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	candidates := piKnownCandidates("")
	if len(candidates) == 0 {
		t.Fatal("应至少列出官方安装器的 bin 目录")
	}
	if candidates[0].Path != exe || candidates[0].Source != "官方安装器" {
		t.Fatalf("第一个候选应是官方安装器 %q，得到 %+v", exe, candidates[0])
	}
	for _, candidate := range candidates[1:] {
		if normPathKey(candidate.Path) == normPathKey(exe) {
			t.Fatalf("候选列表出现重复项：%s", candidate.Path)
		}
	}
}

// PATH 里没有 pi 时，应能退回官方安装器的 <agentDir>/bin。
func TestLocatePiFallsBackToInstallerBin(t *testing.T) {
	if !isWindows() {
		t.Skip("用 .cmd 造桩，只在 Windows 上验证")
	}
	agent := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", agent)
	bin := filepath.Join(agent, "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "pi.cmd"), []byte("@echo 1.6.0\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", "")
	t.Setenv("PATHEXT", ".CMD")

	located := locatePi("")
	if !located.Found {
		t.Fatalf("应回退找到官方安装器里的 pi，得到 %+v", located)
	}
	if located.Version != "1.6.0" || located.Source != "官方安装器" {
		t.Fatalf("版本/来源不对：%+v", located)
	}
}

// shim 里的分隔符是反斜杠，必须归一化后才能在各平台 filepath.Join。
// 这条专门盯「把 `\` 写成两个反斜杠」那类手误（在 Windows 上会被掩盖）。
func TestNormalizeShimPath(t *testing.T) {
	bs := string(rune(92))
	if got := normalizeShimPath("..\\install\\releases\\1.6.0"); got != "../install/releases/1.6.0" {
		t.Fatalf("分隔符没归一化：%q", got)
	}
	if got := normalizeShimPath("a" + bs + bs + "b"); got != "a//b" {
		t.Fatalf("不应折叠连续分隔符：%q", got)
	}
	if got := normalizeShimPath("/already/unix/path"); got != "/already/unix/path" {
		t.Fatalf("unix 路径不应被改动：%q", got)
	}
}

// 归一化后的结果必须在 POSIX 上也能 join 成真实路径（CI 的 linux / macos 就在跑这条语义）。
func TestNormalizedShimPathJoinsOnPosix(t *testing.T) {
	token := normalizeShimPath("..\\install\\cli.js")
	if got := path.Join("/tmp/agent/bin", token); got != "/tmp/agent/install/cli.js" {
		t.Fatalf("POSIX join 失败：%q", got)
	}
}
