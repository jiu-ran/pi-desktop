package host

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/aymanbagabas/go-pty"
)

const (
	terminalMaxTasks  = 8
	terminalMaxOutput = 1024 * 1024
	terminalBatchMs   = 24
)

type shellProfile struct {
	ID     string   `json:"id"`
	Label  string   `json:"label"`
	File   string   `json:"file"`
	Args   []string `json:"args"`
	Source string   `json:"source"`
}

type terminalTask struct {
	mu          sync.Mutex
	id          string
	command     string
	cwd         string
	pid         int
	shell       string
	profile     string
	shellPath   string
	startedAt   int64
	endedAt     int64
	status      string
	exitCode    *int
	signal      string
	interactive bool
	isPTY       bool
	cols        int
	rows        int

	output        strings.Builder
	truncated     bool
	stopRequested bool
	finished      bool

	ptyProc   pty.Pty
	ptyCmd    *pty.Cmd
	ptyClosed bool
	cmd       *exec.Cmd
	stdin     io.WriteCloser

	dataCh    chan terminalChunk
	done      chan struct{}
	closeOnce sync.Once
}

type terminalChunk struct {
	stream string
	text   string
}

type terminalManager struct {
	mu    sync.Mutex
	tasks map[string]*terminalTask
	host  *Host
}

func newTerminalManager(h *Host) *terminalManager {
	return &terminalManager{tasks: map[string]*terminalTask{}, host: h}
}

func (m *terminalManager) emit(event map[string]any) {
	m.host.emit(TerminalEvent, event)
}

func (m *terminalManager) runningCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := 0
	for _, task := range m.tasks {
		if task.status == "running" || task.status == "stopping" {
			count++
		}
	}
	return count
}

func (m *terminalManager) assertCanStart() error {
	if m.runningCount() >= terminalMaxTasks {
		return fmt.Errorf("同时运行的后台任务不能超过 %d 个，请先停止一个任务", terminalMaxTasks)
	}
	return nil
}

func (t *terminalTask) info() map[string]any {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := map[string]any{
		"id": t.id, "command": t.command, "cwd": t.cwd, "pid": t.pid, "shell": t.shell,
		"startedAt": t.startedAt, "status": t.status, "interactive": t.interactive, "pty": t.isPTY,
	}
	if t.endedAt > 0 {
		out["endedAt"] = t.endedAt
	}
	if t.exitCode != nil {
		out["exitCode"] = *t.exitCode
	}
	if t.signal != "" {
		out["signal"] = t.signal
	}
	if t.isPTY {
		out["cols"] = t.cols
		out["rows"] = t.rows
	}
	if t.profile != "" {
		out["profileId"] = t.profile
	}
	if t.shellPath != "" {
		out["shellPath"] = t.shellPath
	}
	return out
}

func (t *terminalTask) appendOutput(text string) {
	t.mu.Lock()
	t.output.WriteString(text)
	if t.output.Len() > terminalMaxOutput {
		t.truncated = true
		all := t.output.String()
		all = all[len(all)-terminalMaxOutput:]
		if idx := strings.Index(all, "\n"); idx >= 0 && idx < 8192 {
			all = all[idx+1:]
		}
		t.output.Reset()
		t.output.WriteString(all)
	}
	t.mu.Unlock()
}

func (t *terminalTask) startWriter(m *terminalManager) {
	go func() {
		var pending strings.Builder
		stream := "stdout"
		timer := time.NewTimer(time.Hour)
		if !timer.Stop() {
			<-timer.C
		}
		armed := false
		for {
			select {
			case chunk, ok := <-t.dataCh:
				if !ok {
					if pending.Len() > 0 {
						m.emit(map[string]any{"type": "data", "id": t.id, "stream": stream, "text": pending.String()})
					}
					return
				}
				if pending.Len() > 0 && chunk.stream != stream {
					m.emit(map[string]any{"type": "data", "id": t.id, "stream": stream, "text": pending.String()})
					pending.Reset()
				}
				stream = chunk.stream
				pending.WriteString(chunk.text)
				if !armed {
					timer.Reset(time.Duration(terminalBatchMs) * time.Millisecond)
					armed = true
				}
			case <-timer.C:
				if pending.Len() > 0 {
					m.emit(map[string]any{"type": "data", "id": t.id, "stream": stream, "text": pending.String()})
					pending.Reset()
				}
				armed = false
			case <-t.done:
				if pending.Len() > 0 {
					m.emit(map[string]any{"type": "data", "id": t.id, "stream": stream, "text": pending.String()})
				}
				return
			}
		}
	}()
}

func (t *terminalTask) finish(m *terminalManager, code *int, signal string) {
	t.mu.Lock()
	if t.finished {
		t.mu.Unlock()
		return
	}
	t.finished = true
	t.endedAt = time.Now().UnixMilli()
	t.exitCode = code
	t.signal = signal
	status := "failed"
	if t.stopRequested {
		status = "stopped"
	} else if code != nil && *code == 0 {
		status = "exited"
	}
	t.status = status
	term := t.ptyProc
	t.ptyProc = nil
	t.mu.Unlock()
	if term != nil {
		_ = term.Close()
	}
	t.closeOnce.Do(func() { close(t.done) })
	m.emit(map[string]any{
		"type": "exit", "id": t.id, "status": status, "exitCode": code, "signal": signal, "endedAt": t.endedAt,
	})
}

func (m *terminalManager) add(task *terminalTask) {
	m.mu.Lock()
	m.tasks[task.id] = task
	// 只保留最近 20 条已完成记录。
	if len(m.tasks) > 20 {
		var finished []*terminalTask
		for _, item := range m.tasks {
			if item.finishedState() {
				finished = append(finished, item)
			}
		}
		for _, item := range finished {
			if len(m.tasks) <= 20 {
				break
			}
			delete(m.tasks, item.id)
		}
	}
	m.mu.Unlock()
	m.emit(map[string]any{"type": "start", "task": task.info()})
}

func (t *terminalTask) finishedState() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.finished
}

func newTaskID() string {
	return fmt.Sprintf("term-%s-%s", time.Now().Format("1"), randomSuffix())
}

func (m *terminalManager) startLegacy(cwd, command string, options map[string]any) (map[string]any, error) {
	if err := m.assertCanStart(); err != nil {
		return nil, err
	}
	text := strings.TrimSpace(strings.ReplaceAll(command, "\r\n", "\n"))
	if text == "" {
		return nil, errors.New("请输入要运行的命令")
	}
	if len(text) > 32000 {
		return nil, errors.New("命令过长（最多 32000 个字符）")
	}
	profile, err := resolveTerminalProfile(options)
	if err != nil {
		return nil, err
	}
	file, args := commandForProfile(profile, text)
	task := &terminalTask{
		id: newTaskID(), command: text, cwd: cwd, shell: profile.Label, profile: profile.ID,
		shellPath: profile.File, startedAt: time.Now().UnixMilli(), status: "running",
		dataCh: make(chan terminalChunk, 64), done: make(chan struct{}),
	}
	var cmd *exec.Cmd
	if isWindows() && strings.EqualFold(filepath.Base(file), "cmd.exe") {
		cmd = exec.Command(file)
		setRawCommandLine(cmd, quoteShellPath(file)+" /D /S /C \"chcp 65001 >nul & "+text+"\"")
	} else {
		cmd = exec.Command(file, args...)
	}
	cmd.Dir = cwd
	cmd.Env = terminalEnv(false)
	hideWindow(cmd)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("无法启动命令：%w", err)
	}
	task.cmd = cmd
	task.pid = cmd.Process.Pid
	task.interactive = false
	m.add(task)
	task.startWriter(m)
	read := func(reader io.Reader, stream string) {
		buf := make([]byte, 32*1024)
		for {
			n, err := reader.Read(buf)
			if n > 0 {
				text := strings.ToValidUTF8(string(buf[:n]), "�")
				task.appendOutput(text)
				select {
				case task.dataCh <- terminalChunk{stream, text}:
				case <-task.done:
					return
				}
			}
			if err != nil {
				return
			}
		}
	}
	go read(stdout, "stdout")
	go read(stderr, "stderr")
	go func() {
		err := cmd.Wait()
		code := 0
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				code = exitErr.ExitCode()
			} else {
				code = 1
			}
		}
		task.finish(m, &code, "")
	}()
	return task.info(), nil
}

func (m *terminalManager) startShell(cwd string) (map[string]any, error) {
	if err := m.assertCanStart(); err != nil {
		return nil, err
	}
	file, args, label := interactiveShell()
	task := &terminalTask{
		id: newTaskID(), command: "交互式 " + label, cwd: cwd, shell: label,
		startedAt: time.Now().UnixMilli(), status: "running", interactive: true,
		dataCh: make(chan terminalChunk, 64), done: make(chan struct{}),
	}
	var cmd *exec.Cmd
	if isWindows() && strings.EqualFold(filepath.Base(file), "cmd.exe") {
		inner := args[len(args)-1]
		cmd = exec.Command(file)
		setRawCommandLine(cmd, quoteShellPath(file)+" /D /Q /C \""+inner+"\"")
	} else {
		cmd = exec.Command(file, args...)
	}
	cmd.Dir = cwd
	cmd.Env = terminalEnv(false)
	hideWindow(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("无法启动交互式会话：%w", err)
	}
	task.cmd = cmd
	task.stdin = stdin
	task.pid = cmd.Process.Pid
	m.add(task)
	task.startWriter(m)
	read := func(reader io.Reader, stream string) {
		buf := make([]byte, 32*1024)
		for {
			n, err := reader.Read(buf)
			if n > 0 {
				text := strings.ToValidUTF8(string(buf[:n]), "�")
				task.appendOutput(text)
				select {
				case task.dataCh <- terminalChunk{stream, text}:
				case <-task.done:
					return
				}
			}
			if err != nil {
				return
			}
		}
	}
	go read(stdout, "stdout")
	go read(stderr, "stderr")
	go func() {
		err := cmd.Wait()
		code := 0
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				code = exitErr.ExitCode()
			} else {
				code = 1
			}
		}
		task.finish(m, &code, "")
	}()
	return task.info(), nil
}

type terminalSize struct{ cols, rows int }

func normalizePTYSize(cols, rows int) terminalSize {
	if cols < 2 || cols > 500 {
		cols = 100
	}
	if rows < 1 || rows > 200 {
		rows = 30
	}
	return terminalSize{cols, rows}
}

func (m *terminalManager) startPTY(cwd string, cols, rows int, options map[string]any) (map[string]any, error) {
	if err := m.assertCanStart(); err != nil {
		return nil, err
	}
	profile, err := resolveTerminalProfile(options)
	if err != nil {
		return nil, err
	}
	size := normalizePTYSize(cols, rows)
	term, err := pty.New()
	if err != nil {
		return nil, fmt.Errorf("无法创建终端：%w", err)
	}
	cmd := term.Command(profile.File, profile.Args...)
	cmd.Dir = cwd
	cmd.Env = terminalEnv(true)
	if err := cmd.Start(); err != nil {
		_ = term.Close()
		return nil, fmt.Errorf("无法启动终端：%w", err)
	}
	_ = term.Resize(size.cols, size.rows)
	task := &terminalTask{
		id: newTaskID(), command: profile.Label, cwd: cwd, shell: profile.Label,
		profile: profile.ID, shellPath: profile.File, startedAt: time.Now().UnixMilli(),
		status: "running", interactive: true, isPTY: true, cols: size.cols, rows: size.rows,
		dataCh: make(chan terminalChunk, 64), done: make(chan struct{}),
	}
	if cmd.Process != nil {
		task.pid = cmd.Process.Pid
	}
	task.ptyProc = term
	task.ptyCmd = cmd
	m.add(task)
	task.startWriter(m)
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, err := term.Read(buf)
			if n > 0 {
				text := strings.ToValidUTF8(string(buf[:n]), "�")
				task.appendOutput(text)
				select {
				case task.dataCh <- terminalChunk{"stdout", text}:
				case <-task.done:
					return
				}
			}
			if err != nil {
				if !errors.Is(err, io.EOF) && !strings.Contains(err.Error(), "closed") {
					logWarn("terminal", "读取终端失败："+err.Error())
				}
				return
			}
		}
	}()
	go func() {
		err := cmd.Wait()
		code := 0
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				code = exitErr.ExitCode()
			} else {
				code = 1
			}
		}
		task.finish(m, &code, "")
	}()
	return task.info(), nil
}

func (m *terminalManager) write(id, data string) (bool, error) {
	task := m.task(id)
	if task == nil {
		return false, errors.New("终端任务不存在")
	}
	task.mu.Lock()
	finished := task.finished
	stdin := task.stdin
	task.mu.Unlock()
	if finished {
		return false, errors.New("交互式会话已经结束")
	}
	if stdin == nil {
		return false, errors.New("当前任务不是交互式会话")
	}
	text := strings.ReplaceAll(strings.ReplaceAll(data, "\r\n", "\n"), "\r", "\n")
	if text == "" {
		return false, nil
	}
	if len(text) > 32000 {
		return false, errors.New("输入过长（最多 32000 个字符）")
	}
	if !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	if _, err := io.WriteString(stdin, text); err != nil {
		return false, fmt.Errorf("写入交互式会话失败：%w", err)
	}
	return true, nil
}

func (m *terminalManager) writePTY(id, data string, binary bool) (bool, error) {
	task := m.task(id)
	if task == nil {
		return false, errors.New("终端任务不存在")
	}
	task.mu.Lock()
	term := task.ptyProc
	finished := task.finished
	task.mu.Unlock()
	if term == nil {
		return false, errors.New("当前任务不是 PTY 终端")
	}
	if finished {
		return false, errors.New("终端已经结束")
	}
	if data == "" {
		return false, nil
	}
	if len(data) > 256000 {
		return false, errors.New("终端输入过长（最多 256000 个字符）")
	}
	var payload []byte
	if binary {
		payload = []byte(data)
	} else {
		payload = []byte(data)
	}
	if _, err := term.Write(payload); err != nil {
		return false, fmt.Errorf("写入终端失败：%w", err)
	}
	return true, nil
}

func (m *terminalManager) resizePTY(id string, cols, rows int) bool {
	task := m.task(id)
	if task == nil {
		return false
	}
	task.mu.Lock()
	term := task.ptyProc
	finished := task.finished
	task.mu.Unlock()
	if term == nil || finished {
		return false
	}
	size := normalizePTYSize(cols, rows)
	if err := term.Resize(size.cols, size.rows); err != nil {
		return false
	}
	task.mu.Lock()
	task.cols = size.cols
	task.rows = size.rows
	task.mu.Unlock()
	return true
}

func (m *terminalManager) task(id string) *terminalTask {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.tasks[id]
}

func (m *terminalManager) stop(id string) bool {
	task := m.task(id)
	if task == nil {
		return false
	}
	task.mu.Lock()
	if task.finished || task.status == "stopping" {
		task.mu.Unlock()
		return false
	}
	task.stopRequested = true
	task.status = "stopping"
	pid := task.pid
	cmd := task.cmd
	ptyCmd := task.ptyCmd
	task.mu.Unlock()
	m.emit(map[string]any{"type": "status", "task": task.info()})
	go func() {
		killProcessTree(pid, cmd, ptyCmd, nil)
	}()
	return true
}

func killProcessTree(pid int, cmd *exec.Cmd, ptyCmd *pty.Cmd, term pty.Pty) {
	if runtime.GOOS == "windows" {
		if pid > 0 {
			killer := exec.Command("taskkill", "/pid", fmt.Sprint(pid), "/T", "/F")
			hideWindow(killer)
			_ = killer.Run()
		}
	} else {
		_ = syscallKillTree(pid)
	}
	if term != nil {
		_ = term.Close()
	}
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	if ptyCmd != nil && ptyCmd.Process != nil {
		_ = ptyCmd.Process.Kill()
	}
}

func (m *terminalManager) list() []map[string]any {
	m.mu.Lock()
	tasks := make([]*terminalTask, 0, len(m.tasks))
	for _, task := range m.tasks {
		tasks = append(tasks, task)
	}
	m.mu.Unlock()
	out := []map[string]any{}
	for _, task := range tasks {
		info := task.info()
		task.mu.Lock()
		info["output"] = task.output.String()
		info["truncated"] = task.truncated
		task.mu.Unlock()
		out = append(out, info)
	}
	return out
}

func (m *terminalManager) stopAll() {
	m.mu.Lock()
	tasks := make([]*terminalTask, 0, len(m.tasks))
	for _, task := range m.tasks {
		tasks = append(tasks, task)
	}
	m.mu.Unlock()
	for _, task := range tasks {
		task.mu.Lock()
		finished := task.finished
		pid := task.pid
		cmd := task.cmd
		ptyCmd := task.ptyCmd
		task.mu.Unlock()
		if !finished {
			killProcessTree(pid, cmd, ptyCmd, nil)
		}
	}
}

// ---------- shell 配置 ----------

func executablePath(candidate string) string {
	if candidate == "" || strings.ContainsAny(candidate, "\x00\r\n") {
		return ""
	}
	abs := candidate
	if !filepath.IsAbs(abs) {
		found, err := exec.LookPath(candidate)
		if err != nil {
			return ""
		}
		abs = found
	}
	real, err := realPath(abs)
	if err != nil {
		return ""
	}
	info, err := os.Stat(real)
	if err != nil || !info.Mode().IsRegular() {
		return ""
	}
	if runtime.GOOS == "windows" && !strings.HasSuffix(strings.ToLower(real), ".exe") {
		return ""
	}
	return real
}

func findExecutable(command string) string {
	if filepath.IsAbs(command) {
		return executablePath(command)
	}
	pathEnv := os.Getenv("PATH")
	if pathEnv == "" {
		pathEnv = os.Getenv("Path")
	}
	for _, dir := range filepath.SplitList(pathEnv) {
		dir = strings.Trim(strings.TrimSpace(dir), `"`)
		if dir == "" || !filepath.IsAbs(dir) {
			continue
		}
		if found := executablePath(filepath.Join(dir, command)); found != "" {
			return found
		}
	}
	return ""
}

func systemShellCandidate() shellProfile {
	if runtime.GOOS == "windows" {
		file := os.Getenv("ComSpec")
		if file == "" {
			file = filepath.Join(os.Getenv("SystemRoot"), "System32", "cmd.exe")
		}
		return shellProfile{ID: "system", Label: "系统默认 · CMD", File: file, Source: "system"}
	}
	file := os.Getenv("SHELL")
	if file == "" {
		if runtime.GOOS == "darwin" {
			file = "/bin/zsh"
		} else {
			file = "/bin/bash"
		}
	}
	return shellProfile{ID: "system", Label: "系统默认 · " + filepath.Base(file), File: file, Args: []string{"-l"}, Source: "system"}
}

func listTerminalProfiles() []shellProfile {
	out := []shellProfile{}
	add := func(id, label string, candidates []string, args []string) {
		for _, candidate := range candidates {
			if file := findExecutable(candidate); file != "" {
				out = append(out, shellProfile{ID: id, Label: label, File: file, Args: args, Source: "detected"})
				return
			}
		}
	}
	system := systemShellCandidate()
	if file := executablePath(system.File); file != "" {
		system.File = file
		out = append(out, system)
	}
	if runtime.GOOS == "windows" {
		add("pwsh", "PowerShell 7 (pwsh)", []string{"pwsh.exe", filepath.Join(os.Getenv("ProgramFiles"), "PowerShell", "7", "pwsh.exe")}, []string{"-NoLogo"})
		add("powershell", "Windows PowerShell", []string{os.Getenv("PI_DESKTOP_POWERSHELL"), "powershell.exe", filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")}, []string{"-NoLogo"})
		git := findExecutable("git.exe")
		roots := []string{}
		if git != "" {
			roots = append(roots, filepath.Clean(filepath.Join(filepath.Dir(git), "..", "..")), filepath.Clean(filepath.Join(filepath.Dir(git), "..")))
		}
		roots = append(roots, filepath.Join(os.Getenv("ProgramFiles"), "Git"))
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			roots = append(roots, filepath.Join(local, "Programs", "Git"))
		}
		if x86 := os.Getenv("ProgramFiles(x86)"); x86 != "" {
			roots = append(roots, filepath.Join(x86, "Git"))
		}
		candidates := []string{}
		for _, root := range dedupeStrings(roots) {
			candidates = append(candidates, filepath.Join(root, "bin", "bash.exe"))
		}
		add("git-bash", "Git Bash", candidates, []string{"--login", "-i"})
		add("cmd", "CMD", []string{"cmd.exe"}, nil)
	} else {
		add("zsh", "Zsh", []string{"zsh", "/bin/zsh", "/usr/bin/zsh"}, []string{"-l"})
		add("bash", "Bash", []string{"bash", "/bin/bash", "/usr/bin/bash"}, []string{"-l"})
		add("fish", "Fish", []string{"fish", "/usr/local/bin/fish", "/usr/bin/fish", "/opt/homebrew/bin/fish"}, []string{"-l"})
		add("pwsh", "PowerShell (pwsh)", []string{"pwsh", "/usr/local/bin/pwsh", "/opt/homebrew/bin/pwsh"}, []string{"-NoLogo"})
		add("sh", "POSIX sh", []string{"sh", "/bin/sh"}, []string{"-l"})
	}
	if len(out) == 0 || out[0].ID != "system" {
		fallback := "sh"
		if runtime.GOOS == "windows" {
			fallback = "cmd"
		}
		for _, profile := range out {
			if profile.ID == fallback {
				profile.ID = "system"
				profile.Label = "系统默认 · " + profile.Label + "（回退）"
				profile.Source = "system"
				out = append([]shellProfile{profile}, out...)
				break
			}
		}
	}
	return out
}

func resolveTerminalProfile(options map[string]any) (shellProfile, error) {
	id := "system"
	if options != nil {
		if value := asString(options["profileId"]); value != "" {
			id = value
		}
	}
	if len(id) > 80 {
		return shellProfile{}, errors.New("无效的终端配置")
	}
	if id == "custom" {
		file := strings.TrimSpace(asString(options["customPath"]))
		if file == "" || len(file) > 4000 || !filepath.IsAbs(file) || strings.ContainsAny(file, "\x00\r\n") {
			return shellProfile{}, errors.New("自定义终端需要填写可执行文件的绝对路径")
		}
		args := strSlice(options["customArgs"])
		if len(args) > 64 {
			return shellProfile{}, errors.New("终端启动参数必须是字符串数组（最多 64 项 / 32000 个字符）")
		}
		for _, arg := range args {
			if strings.ContainsRune(arg, 0) {
				return shellProfile{}, errors.New("终端启动参数必须是字符串数组（最多 64 项 / 32000 个字符）")
			}
		}
		resolved := executablePath(file)
		if resolved == "" {
			return shellProfile{}, errors.New("自定义终端文件不存在或不可执行（Windows 请选择 .exe，而不是 .cmd / .bat）")
		}
		if runtime.GOOS == "windows" && strings.EqualFold(filepath.Base(resolved), "git-bash.exe") {
			return shellProfile{}, errors.New("Git Bash 请选择安装目录下的 bin/bash.exe，而不是会打开外部窗口的 git-bash.exe 启动器")
		}
		return shellProfile{ID: id, Label: filepath.Base(resolved), File: resolved, Args: args, Source: "custom"}, nil
	}
	for _, profile := range listTerminalProfiles() {
		if profile.ID == id {
			return profile, nil
		}
	}
	return shellProfile{}, fmt.Errorf("终端「%s」未安装或路径已失效，请在设置中重新选择", id)
}

func commandForProfile(profile shellProfile, command string) (string, []string) {
	base := strings.ToLower(filepath.Base(profile.File))
	args := append([]string{}, profile.Args...)
	if strings.HasPrefix(base, "powershell") || base == "pwsh.exe" || base == "pwsh" {
		body := command
		if strings.HasPrefix(strings.TrimLeft(command, " "), `"`) || strings.HasPrefix(strings.TrimLeft(command, " "), `'`) {
			body = "& " + command
		}
		wrapped := `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [Console]::OutputEncoding; ` + body + `; exit $LASTEXITCODE`
		return profile.File, append(args, "-NonInteractive", "-Command", wrapped)
	}
	if runtime.GOOS == "windows" && strings.EqualFold(base, "cmd.exe") {
		return profile.File, append(args, "/D", "/S", "/C", `"chcp 65001 >nul & `+command+`"`)
	}
	filtered := []string{}
	for _, arg := range args {
		if arg != "-i" && arg != "--interactive" {
			filtered = append(filtered, arg)
		}
	}
	return profile.File, append(filtered, "-c", command)
}

func interactiveShell() (string, []string, string) {
	if runtime.GOOS == "windows" {
		powershell := os.Getenv("PI_DESKTOP_POWERSHELL")
		if powershell == "" {
			powershell = "powershell.exe"
		}
		comspec := os.Getenv("ComSpec")
		if comspec == "" {
			comspec = "cmd.exe"
		}
		command := `chcp 65001 >nul & "` + powershell + `" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command -`
		return comspec, []string{"/D", "/Q", "/C", command}, "PowerShell"
	}
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	return shell, []string{"-l"}, filepath.Base(shell)
}

func terminalEnv(ptty bool) []string {
	env := os.Environ()
	extra := map[string]string{
		"TERM": "xterm-256color", "COLORTERM": firstNonEmpty(os.Getenv("COLORTERM"), "truecolor"),
		"TERM_PROGRAM": "Pi Desktop", "PYTHONIOENCODING": firstNonEmpty(os.Getenv("PYTHONIOENCODING"), "utf-8"),
	}
	if !ptty && os.Getenv("NO_COLOR") == "" {
		extra["FORCE_COLOR"] = firstNonEmpty(os.Getenv("FORCE_COLOR"), "1")
		extra["CLICOLOR_FORCE"] = firstNonEmpty(os.Getenv("CLICOLOR_FORCE"), "1")
	}
	for key, value := range extra {
		env = append(env, key+"="+value)
	}
	return env
}

var _ = utf8.RuneLen
