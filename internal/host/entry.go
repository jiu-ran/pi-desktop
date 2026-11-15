package host

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const piRuntimePackage = "@earendil-works/pi-coding-agent"

// PiLocation 是「本机 pi 在哪里」的探测结果。
type PiLocation struct {
	Found   bool   `json:"found"`
	Version string `json:"version"`
	Path    string `json:"path"`
	Error   string `json:"error,omitempty"`
}

func isFile(target string) bool {
	info, err := os.Stat(target)
	return err == nil && info.Mode().IsRegular()
}

func piEntryFromNodeModulesDir(dir string) string {
	if dir == "" {
		return ""
	}
	entry := filepath.Join(dir, filepath.FromSlash(piRuntimePackage), "dist", "cli.js")
	if isFile(entry) {
		abs, _ := filepath.Abs(entry)
		return abs
	}
	return ""
}

var shimEntryRe = regexp.MustCompile(`[^\s"'\x60=<>]*pi-coding-agent[/\\]dist[/\\]cli\.js`)

func entryFromShimText(shim string) string {
	text := readSmallFile(shim, 256*1024)
	if text == "" {
		return ""
	}
	shimDir := filepath.Dir(shim)
	for _, match := range shimEntryRe.FindAllString(text, -1) {
		cleaned := strings.TrimLeft(match, ")+")
		cleaned = strings.TrimRight(cleaned, "),;")
		cleaned = strings.TrimSpace(cleaned)
		if cleaned == "" {
			continue
		}
		candidates := []string{}
		if filepath.IsAbs(cleaned) {
			candidates = append(candidates, cleaned)
		} else {
			candidates = append(candidates, filepath.Join(shimDir, cleaned), filepath.Join(filepath.Dir(shimDir), cleaned))
		}
		for _, candidate := range candidates {
			if isFile(candidate) {
				abs, _ := filepath.Abs(candidate)
				return abs
			}
		}
	}
	return ""
}

func piCliEntryFromExecutable(executable string) string {
	target := strings.Trim(strings.TrimSpace(executable), `"`)
	if target == "" {
		return ""
	}
	if strings.HasSuffix(strings.ToLower(target), ".js") && isFile(target) {
		abs, _ := filepath.Abs(target)
		return abs
	}
	if !isFile(target) {
		return ""
	}
	dir := filepath.Dir(target)
	layouts := []string{
		filepath.Join(dir, "node_modules"),
		filepath.Join(dir, "..", "node_modules"),
		filepath.Join(dir, "..", "lib", "node_modules"),
	}
	for _, nodeModules := range layouts {
		if entry := piEntryFromNodeModulesDir(nodeModules); entry != "" {
			return entry
		}
	}
	return entryFromShimText(target)
}

func findExecutableOnPath(name string) string {
	pathEnv := os.Getenv("PATH")
	if pathEnv == "" {
		pathEnv = os.Getenv("Path")
	}
	dirs := filepath.SplitList(pathEnv)
	exts := []string{""}
	if isWindows() {
		pathext := os.Getenv("PATHEXT")
		if pathext == "" {
			pathext = ".COM;.EXE;.BAT;.CMD"
		}
		for _, ext := range strings.Split(pathext, ";") {
			if ext = strings.TrimSpace(ext); ext != "" {
				exts = append(exts, strings.ToLower(ext))
			}
		}
	}
	for _, dir := range dirs {
		dir = strings.TrimSpace(dir)
		if dir == "" {
			continue
		}
		for _, ext := range exts {
			candidate := filepath.Join(dir, name+ext)
			if isFile(candidate) {
				return candidate
			}
		}
	}
	return ""
}

// appLocalRoots 是开发时 npm scripts 注入的 node_modules/.bin 所在目录。
func appLocalRoots() []string {
	var roots []string
	if cwd, err := os.Getwd(); err == nil {
		roots = append(roots, cwd)
	}
	if exe, err := os.Executable(); err == nil {
		roots = append(roots, filepath.Dir(exe), filepath.Dir(filepath.Dir(exe)))
	}
	return roots
}

func isAppLocalBin(candidate string) bool {
	file := normPathKey(candidate)
	for _, root := range appLocalRoots() {
		root = normPathKey(root)
		if file == root || strings.HasPrefix(file, root+string(os.PathSeparator)) {
			return true
		}
	}
	return false
}

func findPiOnPath() string {
	pathEnv := os.Getenv("PATH")
	if pathEnv == "" {
		pathEnv = os.Getenv("Path")
	}
	var names []string
	if isWindows() {
		pathext := os.Getenv("PATHEXT")
		if pathext == "" {
			pathext = ".COM;.EXE;.BAT;.CMD"
		}
		for _, ext := range strings.Split(pathext, ";") {
			if ext = strings.TrimSpace(ext); ext != "" {
				names = append(names, "pi"+strings.ToLower(ext))
			}
		}
		names = append(names, "pi")
	} else {
		names = []string{"pi"}
	}
	seen := map[string]bool{}
	for _, dir := range filepath.SplitList(pathEnv) {
		dir = strings.TrimSpace(dir)
		if dir == "" {
			continue
		}
		for _, name := range names {
			full := filepath.Join(dir, name)
			key := normPathKey(full)
			if seen[key] {
				continue
			}
			seen[key] = true
			if isFile(full) && !isAppLocalBin(full) {
				return full
			}
		}
	}
	return ""
}

// runShell 执行一条 shell 命令行（Windows 走 cmd /c，Unix 走 sh -c）。
// 返回退出码与合并后的输出。
func runShell(commandLine string, timeout time.Duration) (int, string) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	var cmd *exec.Cmd
	if isWindows() {
		comspec := os.Getenv("ComSpec")
		if comspec == "" {
			comspec = "cmd.exe"
		}
		cmd = exec.CommandContext(ctx, comspec)
		setRawCommandLine(cmd, quoteShellPath(comspec)+" /d /s /c \""+commandLine+"\"")
	} else {
		cmd = exec.CommandContext(ctx, "/bin/sh", "-c", commandLine)
	}
	hideWindow(cmd)
	cmd.Env = os.Environ()
	output, err := cmd.CombinedOutput()
	code := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			code = exitErr.ExitCode()
		} else {
			code = -1
		}
	}
	if ctx.Err() == context.DeadlineExceeded {
		code = -1
	}
	return code, strings.TrimSpace(string(output))
}

func quoteShellPath(value string) string {
	if isWindows() {
		return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
	}
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

func probePiVersion(bin string) string {
	code, output := runShell(quoteShellPath(bin)+" --version", 10*time.Second)
	if code != 0 {
		return ""
	}
	for _, line := range strings.Split(output, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			return line
		}
	}
	return ""
}

func locatePi(customPath string) PiLocation {
	manual := strings.Trim(strings.TrimSpace(customPath), `"`)
	if manual != "" {
		if !fileExists(manual) {
			return PiLocation{Path: manual, Error: "指定的 Pi 路径不存在，请检查后重新输入"}
		}
		version := probePiVersion(manual)
		if version == "" {
			return PiLocation{Path: manual, Error: "该路径无法运行 pi --version，请确认是 Pi 可执行文件"}
		}
		return PiLocation{Found: true, Version: version, Path: manual}
	}
	auto := findPiOnPath()
	if auto == "" {
		return PiLocation{Error: "未在系统 PATH 中检测到 pi 命令，请先安装 Pi CLI，或在下方手动指定 Pi 可执行文件路径"}
	}
	version := probePiVersion(auto)
	if version == "" {
		return PiLocation{Path: auto, Error: "PATH 中的 pi 无法运行（pi --version 失败），请检查安装或手动指定路径"}
	}
	return PiLocation{Found: true, Version: version, Path: auto}
}

// resolvePiCommand 把「pi 可执行文件」变成真正能启动 RPC 的命令。
// npm 安装返回 `node <dist/cli.js>`；独立二进制直接返回自身。
func resolvePiCommand(customPath string) (PiCommand, PiLocation, error) {
	located := locatePi(customPath)
	if !located.Found {
		return PiCommand{}, located, errString(firstNonEmpty(located.Error, "没有找到本机 Pi CLI，请先安装 pi 或到「设置 → Pi CLI」指定路径"))
	}
	entry := piCliEntryFromExecutable(located.Path)
	if entry != "" {
		node := findExecutableOnPath("node")
		if node == "" {
			return PiCommand{}, located, errString("找到了 Pi 的 JS 入口，但没有找到 Node.js。请安装 Node.js 22.19 或更新版本（Pi 需要用它运行）")
		}
		return PiCommand{Exe: node, Prefix: []string{entry}}, located, nil
	}
	if isWindows() && (strings.HasSuffix(strings.ToLower(located.Path), ".cmd") || strings.HasSuffix(strings.ToLower(located.Path), ".bat")) {
		return PiCommand{}, located, errString("已找到 pi（" + located.Path + "），但没能定位到它的 dist/cli.js。请用 npm 安装 Pi，或在「设置 → Pi CLI」直接指定 node_modules/@earendil-works/pi-coding-agent/dist/cli.js")
	}
	// 官方安装器的独立二进制可以直接执行。
	return PiCommand{Exe: located.Path}, located, nil
}

type errString string

func (e errString) Error() string { return string(e) }

func checkPiUpdate(customPath string) map[string]any {
	located := locatePi(customPath)
	current := located.Version
	if !located.Found {
		return map[string]any{"current": "", "latest": "", "updateAvailable": false, "error": firstNonEmpty(located.Error, "未检测到本机 pi 命令")}
	}
	code, output := runShell("npm view "+piRuntimePackage+" version", 20*time.Second)
	latest := ""
	if code == 0 {
		fields := strings.Fields(output)
		if len(fields) > 0 {
			latest = fields[len(fields)-1]
		}
	}
	if latest == "" {
		return map[string]any{"current": current, "latest": "", "updateAvailable": false, "error": "无法查询最新版本，请检查网络"}
	}
	return map[string]any{"current": current, "latest": latest, "updateAvailable": latest != current}
}

func updatePi(customPath, scope string) map[string]any {
	before := locatePi(customPath)
	from := before.Version
	if !before.Found || before.Path == "" {
		return map[string]any{"ok": false, "from": "", "to": "", "log": firstNonEmpty(before.Error, "未检测到本机 pi 命令")}
	}
	args := " update --no-approve"
	if scope == "all" {
		args = " update --all --no-approve"
	}
	code, output := runShell(quoteShellPath(before.Path)+args, 180*time.Second)
	tail := strings.Join(lastLines(strings.Split(output, "\n"), 30), "\n")
	if code != 0 {
		return map[string]any{"ok": false, "from": from, "to": from, "log": firstNonEmpty(tail, "pi update 异常退出")}
	}
	after := locatePi(customPath)
	to := after.Version
	if to == "" {
		to = from
	}
	return map[string]any{"ok": after.Found, "from": from, "to": to, "log": tail}
}

func lastLines(lines []string, count int) []string {
	if len(lines) <= count {
		return lines
	}
	return lines[len(lines)-count:]
}
