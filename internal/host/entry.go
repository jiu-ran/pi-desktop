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

// 官方安装器（pi.dev）装的 pi 不是 npm 布局：shim 里写的是同目录的 pi-launcher.js，
// 真正的入口、agentDir 等环境都由这个 launcher 决定。绕过它直接跑 dist/cli.js
// 会遇到「设置里能识别、工作区起不来」，所以 shim 指向 launcher 时优先用 launcher。
var shimLauncherRe = regexp.MustCompile(`[^\s"'\x60=<>]*pi-launcher\.js`)

// shimTargetPath 把 shim 文本里的一小段路径解析成真实文件：
// cmd 里的 %~dp0 就是 shim 所在目录，其余相对路径同样按 shim 目录 / 上两级来试。
func shimTargetPath(token, shimDir string) string {
	cleaned := strings.TrimSpace(strings.TrimLeft(token, ")+"))
	cleaned = strings.TrimSpace(strings.TrimRight(cleaned, "),;"))
	if cleaned == "" {
		return ""
	}
	if len(cleaned) >= 5 && strings.EqualFold(cleaned[:5], `%~dp0`) {
		cleaned = strings.TrimLeft(cleaned[5:], `\/`)
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
	return ""
}

func entryFromShimText(shim string) string {
	text := readSmallFile(shim, 256*1024)
	if text == "" {
		return ""
	}
	shimDir := filepath.Dir(shim)
	for _, match := range shimEntryRe.FindAllString(text, -1) {
		if target := shimTargetPath(match, shimDir); target != "" {
			return target
		}
	}
	return ""
}

// launcherFromShimText 找官方安装器写在 shim 里的 pi-launcher.js。
func launcherFromShimText(shim string) string {
	text := readSmallFile(shim, 256*1024)
	if text == "" {
		return ""
	}
	shimDir := filepath.Dir(shim)
	for _, match := range shimLauncherRe.FindAllString(text, -1) {
		if target := shimTargetPath(match, shimDir); target != "" {
			return target
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
	// 官方安装器的 launcher 最可信：入口和环境都由它决定，先看它。
	if launcher := launcherFromShimText(target); launcher != "" {
		return launcher
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
func runShell(commandLine string, env map[string]string, timeout time.Duration) (int, string) {
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
	prepareProcessGroup(cmd)
	cmd.Cancel = func() error {
		killProcess(cmd)
		if cmd.Process != nil {
			return cmd.Process.Kill()
		}
		return nil
	}
	cmd.Env = envSlice(env)
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
	commandLine := quoteShellPath(bin) + " --version"
	// 允许直接指定 JS 入口（dist/cli.js 或官方安装器的 pi-launcher.js）：
	// 这类路径自己不能执行，得用 node 拉起来。
	if strings.HasSuffix(strings.ToLower(bin), ".js") {
		node := findExecutableOnPath("node")
		if node == "" {
			return ""
		}
		commandLine = quoteShellPath(node) + " " + quoteShellPath(bin) + " --version"
	}
	code, output := runShell(commandLine, nil, 10*time.Second)
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
		return PiCommand{}, located, errString("已找到 pi（" + located.Path + "），但没能定位到它的启动脚本（同目录的 pi-launcher.js 或 node_modules 里的 dist/cli.js）。请在「设置 → Pi CLI」把路径改成那个 .js 文件的完整路径")
	}
	// 官方安装器的独立二进制可以直接执行。
	return PiCommand{Exe: located.Path}, located, nil
}

type errString string

func (e errString) Error() string { return string(e) }

func (h *Host) checkPiUpdate(customPath string) map[string]any {
	targetPath := strings.TrimSpace(customPath)
	if targetPath == "" && h != nil {
		h.mu.Lock()
		targetPath = h.piCustomPath
		h.mu.Unlock()
	}
	located := locatePi(targetPath)
	current := located.Version
	if !located.Found {
		return map[string]any{"current": "", "latest": "", "updateAvailable": false, "error": firstNonEmpty(located.Error, "未检测到本机 pi 命令")}
	}
	var env map[string]string
	if h != nil {
		env = h.childEnv()
	}
	code, output := runShell("npm view "+piRuntimePackage+" version", env, 20*time.Second)
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
	return map[string]any{"current": current, "latest": latest, "updateAvailable": compareVersions(latest, current) > 0}
}

func (h *Host) updatePi(customPath, scope string) map[string]any {
	targetPath := strings.TrimSpace(customPath)
	if targetPath == "" && h != nil {
		h.mu.Lock()
		targetPath = h.piCustomPath
		h.mu.Unlock()
	}
	before := locatePi(targetPath)
	from := before.Version
	if !before.Found || before.Path == "" {
		return map[string]any{"ok": false, "from": "", "to": "", "log": firstNonEmpty(before.Error, "未检测到本机 pi 命令")}
	}
	args := " update --no-approve"
	if scope == "all" {
		args = " update --all --no-approve"
	}
	var env map[string]string
	if h != nil {
		env = h.childEnv()
	}
	code, output := runShell(quoteShellPath(before.Path)+args, env, 180*time.Second)
	tail := strings.Join(lastLines(strings.Split(output, "\n"), 30), "\n")
	if code != 0 {
		return map[string]any{"ok": false, "from": from, "to": from, "log": firstNonEmpty(tail, "pi update 异常退出")}
	}
	after := locatePi(targetPath)
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
