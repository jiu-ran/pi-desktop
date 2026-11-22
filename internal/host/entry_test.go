package host

import (
	"os"
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
