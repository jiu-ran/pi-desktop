package host

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

// requireWorkspace 用在会改动磁盘或拉起进程的接口上：cwd 必须是用户打开（授权）过的项目目录，
// 不能由界面随手传一个路径进来。只读接口不在此列。
func (h *Host) requireWorkspace(cwd string) error {
	_, err := h.requireAuthorizedWorkspace(cwd)
	return err
}

// watchWorkspace 只监听已授权的工作区。ListDirectory / ReadWorkspaceFile 这些接口的 cwd
// 直接来自界面，监听 C:\ 或用户主目录会把整棵树递归加进 fsnotify。
func (h *Host) watchWorkspace(cwd string) {
	root, err := h.requireAuthorizedWorkspace(cwd)
	if err != nil {
		return
	}
	h.watcher.watch(root)
}

// requireProjectScope 用于写项目级配置的 MCP 接口：scope=project 时 cwd 必须已授权。
func (h *Host) requireProjectScope(cwd string, payload map[string]any) error {
	if firstNonEmpty(asString(payload["scope"]), "global") != "project" {
		return nil
	}
	if strings.TrimSpace(cwd) == "" {
		return errors.New("当前未打开项目目录，无法操作项目级配置")
	}
	return h.requireWorkspace(cwd)
}

// requireLocalPackages 用于 local=true 的软件包安装/卸载：它们会写进项目级配置。
func (h *Host) requireLocalPackages(cwd string, payload map[string]any) error {
	if !asBool(payload["local"]) {
		return nil
	}
	if strings.TrimSpace(cwd) == "" {
		return errors.New("当前未打开项目目录，无法修改项目级配置")
	}
	return h.requireWorkspace(cwd)
}

// ---------- 窗口 / 基础 ----------

func (h *Host) WindowState() map[string]any {
	win := h.currentWindow()
	if win == nil {
		return map[string]any{"maximized": false, "fullscreen": false}
	}
	return map[string]any{"maximized": win.IsMaximized(), "fullscreen": win.IsFullScreen()}
}

func (h *Host) MinimizeWindow() bool {
	if win := h.currentWindow(); win != nil {
		win.Minimize()
		return true
	}
	return false
}

func (h *Host) ToggleMaximizeWindow() bool {
	win := h.currentWindow()
	if win == nil {
		return false
	}
	win.ToggleMaximize()
	return win.IsMaximized()
}

func (h *Host) CloseWindow() bool {
	if win := h.currentWindow(); win != nil {
		win.Close()
		return true
	}
	return false
}

func (h *Host) SetWindowBackground(color string) bool {
	win := h.currentWindow()
	if win == nil || strings.TrimSpace(color) == "" {
		return false
	}
	return win.SetBackgroundColor(color) == nil
}

func (h *Host) SetZoomFactor(factor float64) float64 {
	if factor < 0.5 {
		factor = 0.5
	}
	if factor > 3 {
		factor = 3
	}
	if win := h.currentWindow(); win != nil && win.Page() != nil {
		win.Page().SetZoomFactor(factor)
	}
	return factor
}

func (h *Host) Locate(customPath string) PiLocation {
	h.mu.Lock()
	h.piCustomPath = strings.TrimSpace(customPath)
	h.piCmd = nil
	h.mu.Unlock()
	located := locatePi(h.piCustomPath)
	h.mu.Lock()
	h.piVersion = located.Version
	h.mu.Unlock()
	return located
}

func (h *Host) CheckPiUpdate(customPath string) map[string]any {
	return h.checkPiUpdate(customPath)
}

func (h *Host) UpdatePi(customPath, scope string) map[string]any {
	result := h.updatePi(customPath, scope)
	if asBool(result["ok"]) {
		h.invalidatePiEntry()
	}
	return result
}

// ---------- 最近项目 / 目录 ----------

func recentFile() string { return filepath.Join(userDataDir(), "recent-workspaces.json") }

func readRecent(file string) []string {
	data, err := os.ReadFile(file)
	if err != nil {
		return []string{}
	}
	var entries []any
	if json.Unmarshal(data, &entries) != nil {
		return []string{}
	}
	valid := []string{}
	for _, item := range entries {
		path, ok := item.(string)
		if !ok {
			continue
		}
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			abs, _ := filepath.Abs(path)
			valid = append(valid, abs)
		}
	}
	return dedupeStrings(valid)
}

func writeRecent(file, cwd string) []string {
	var next []string
	_ = withFileWrite(file, func() error {
		// 刚打开的这个放最前，其余（可能重复的）依次跟在后面。
		// 以前写成 append(cwd) 再过滤掉与 cwd 相同的项，结果把刚加的那条也删掉了，
		// 于是「最近项目」永远是空的，重启后回到空白页。
		next = []string{cwd}
		for _, item := range readRecent(file) {
			if !samePath(item, cwd) {
				next = append(next, item)
			}
		}
		if len(next) > 20 {
			next = next[:20]
		}
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			return err
		}
		data, _ := json.MarshalIndent(next, "", "  ")
		return atomicWriteText(file, string(data))
	})
	return next
}

func forgetRecent(file, cwd string) []string {
	var next []string
	_ = withFileWrite(file, func() error {
		for _, item := range readRecent(file) {
			if !samePath(item, cwd) {
				next = append(next, item)
			}
		}
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			return err
		}
		data, _ := json.MarshalIndent(next, "", "  ")
		return atomicWriteText(file, string(data))
	})
	return next
}

func (h *Host) Recent() []string {
	recent := readRecent(recentFile())
	authorized := []string{}
	for _, cwd := range recent {
		if canonical, err := h.authorizeWorkspace(cwd); err == nil {
			authorized = append(authorized, canonical)
		}
	}
	return dedupeStrings(authorized)
}

func (h *Host) Forget(cwd string) []string {
	authorized, err := h.requireAuthorizedWorkspace(cwd)
	if err != nil {
		return h.Recent()
	}
	h.revokeWorkspace(authorized)
	h.watcher.unwatch(authorized)
	return forgetRecent(recentFile(), authorized)
}

func (h *Host) ChooseDirectory() (string, error) {
	win := h.currentWindow()
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: win, Directory: true, Title: "打开项目目录"})
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		return "", nil
	}
	return h.authorizeWorkspace(paths[0])
}

func (h *Host) ChooseFiles() ([]string, error) {
	win := h.currentWindow()
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: win, Multiple: true, Title: "添加文件"})
	if err != nil {
		return nil, err
	}
	h.authorizedAttachmentPaths(paths)
	return paths, nil
}

func (h *Host) ChooseFolder() (string, error) {
	win := h.currentWindow()
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: win, Directory: true, Title: "添加文件夹"})
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		return "", nil
	}
	h.authorizedAttachmentPaths(paths)
	return paths[0], nil
}

func (h *Host) ChooseTerminalExecutable() (string, error) {
	win := h.currentWindow()
	filters := []mygo.FileFilter{}
	if isWindows() {
		filters = append(filters, mygo.FileFilter{Name: "可执行程序", Extensions: []string{"exe"}})
	}
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: win, Title: "选择终端 shell 可执行文件", Filters: filters})
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		return "", nil
	}
	return paths[0], nil
}

// ---------- 会话 ----------

func (h *Host) Open(cwd string, options map[string]any) (map[string]any, error) {
	authorized, err := h.authorizeWorkspace(cwd)
	if err != nil {
		return nil, err
	}
	h.watcher.watch(authorized)
	result, err := h.open(authorized, options)
	if err != nil {
		return nil, err
	}
	writeRecent(recentFile(), authorized)
	return result, nil
}

func (h *Host) Snapshot(cwd, sessionFile string) (map[string]any, error) {
	h.watchWorkspace(cwd)
	return h.snapshot(cwd, sessionFile)
}

func (h *Host) Restart(cwd, sessionFile string) (map[string]any, error) {
	return h.restart(cwd, sessionFile)
}

func (h *Host) Sessions(cwd string) []sessionSummary { return h.sessions(cwd) }

// SessionImage 按 ref 取回历史分页里被替换成大图引用的图片（界面渲染时按需调用）。
func (h *Host) SessionImage(cwd, ref string) (map[string]any, error) {
	return h.sessionImage(cwd, ref)
}

func (h *Host) MessagePage(cwd, file string, endIndex, limit, minTurns, minBlocks int) (map[string]any, error) {
	return h.messagePage(cwd, file, endIndex, limit, minTurns, minBlocks)
}

func (h *Host) DeleteSession(cwd, file string) ([]sessionSummary, error) {
	return h.deleteSession(cwd, file)
}

func (h *Host) DeleteAllSessions(cwd string) (map[string]any, error) {
	return h.deleteAllSessions(cwd)
}

func (h *Host) RemoveProject(cwd string, options map[string]any) map[string]any {
	h.closeWorkspace(cwd)
	result := map[string]any{"deleted": 0, "failed": 0}
	if asBool(options["deleteSessions"]) {
		if value, err := h.deleteAllSessions(cwd); err == nil {
			result = value
		}
	}
	h.watcher.unwatch(cwd)
	h.revokeWorkspace(cwd)
	recent := forgetRecent(recentFile(), cwd)
	result["recent"] = recent
	return result
}

func (h *Host) ProjectTrust(cwd string) map[string]any {
	settings := readSettings(cwd)
	defaultTrust := asString(settings.Global["defaultProjectTrust"])
	if defaultTrust == "" {
		defaultTrust = "ask"
	}
	return projectTrustStatus(cwd, defaultTrust)
}

func (h *Host) SetProjectTrust(cwd, action string) (map[string]any, error) {
	if strings.TrimSpace(cwd) == "" {
		return nil, errors.New("项目目录无效")
	}
	if err := h.requireWorkspace(cwd); err != nil {
		return nil, err
	}
	return setProjectTrust(cwd, action)
}

func (h *Host) ImportSession(cwd, file string) (map[string]any, error) {
	cwd = h.resolvePoolKey(cwd)
	source, _ := filepath.Abs(file)
	if !strings.HasSuffix(strings.ToLower(source), ".jsonl") {
		return nil, errors.New("只能导入 .jsonl 会话文件")
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return nil, errors.New("无法读取会话文件")
	}
	firstLine := strings.SplitN(string(data), "\n", 2)[0]
	var head map[string]any
	if json.Unmarshal([]byte(strings.TrimSpace(firstLine)), &head) != nil || asString(head["type"]) != "session" {
		return nil, errors.New("这不是 Pi 的会话文件（首行缺少 session 头）")
	}
	dest, err := cloneSessionToWorkspace(source, cwd)
	if err != nil {
		return nil, err
	}
	summary, _ := summarizeSessionFile(dest)
	return map[string]any{"path": dest, "title": firstNonEmpty(summary.Title, "导入的会话")}, nil
}

func (h *Host) ExportSessionJSONL(cwd, target string) (map[string]any, error) {
	cwd = h.resolvePoolKey(cwd)
	pool := h.requirePool(cwd)
	if pool == nil {
		return nil, errors.New("这个工作区还没有启动 Pi")
	}
	pool.mu.Lock()
	source := pool.activeSessionFile
	pool.mu.Unlock()
	if source == "" {
		return nil, errors.New("当前会话还没有落盘，先发一条消息再导出")
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return nil, err
	}
	file := strings.TrimSpace(target)
	if file != "" {
		_, resolved, pathErr := workspacePath(cwd, file)
		if pathErr != nil {
			return nil, pathErr
		}
		file = resolved
	} else {
		stamp := strings.NewReplacer(":", "-", ".", "-").Replace(time.Now().UTC().Format("2006-01-02T15:04:05"))
		file = filepath.Join(cwd, "pi-session-"+stamp+".jsonl")
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return nil, err
	}
	if err := atomicWriteText(file, string(data)); err != nil {
		return nil, err
	}
	return map[string]any{"path": file}, nil
}

func (h *Host) Call(cwd, method string, args []any, sessionFile string) (any, error) {
	h.watchWorkspace(cwd)
	return h.call(cwd, method, args, sessionFile)
}

func (h *Host) RespondExtensionUI(cwd string, response map[string]any, sessionFile string) error {
	return h.respondExtensionUI(cwd, response, sessionFile)
}

func (h *Host) PrepareAttachments(cwd string, paths, authorize []string) (map[string]any, error) {
	return h.prepareAttachments(cwd, paths, authorize)
}

func (h *Host) PrepareSessionAttachments(cwd string, files []string) (map[string]any, error) {
	return h.prepareSessionAttachments(cwd, files)
}

func (h *Host) CrossProjectSessions(limit int) []sessionSummary {
	if limit <= 0 {
		limit = 40
	}
	return listCrossProjectSessions(limit)
}

// ---------- 工作区文件 ----------

func (h *Host) ListDirectory(cwd, relative string) ([]map[string]any, error) {
	h.watchWorkspace(cwd)
	return h.listDirectory(cwd, relative)
}

func (h *Host) ReadWorkspaceFile(cwd, relative string) (map[string]any, error) {
	h.watchWorkspace(cwd)
	return h.readWorkspaceFile(cwd, relative)
}

// ReadLocalImage 把对话里的本地图片读成 data URL（不登记写盘权限，详见 readLocalImage）。
func (h *Host) ReadLocalImage(cwd, path string) (map[string]any, error) {
	return h.readLocalImage(cwd, path)
}

func (h *Host) WriteWorkspaceFile(cwd, relative, content, revision string) (map[string]any, error) {
	if err := h.requireWorkspace(cwd); err != nil {
		return nil, err
	}
	h.watchWorkspace(cwd)
	return h.writeWorkspaceFile(cwd, relative, content, revision)
}

func (h *Host) OpenWorkspacePath(cwd, relative string) (string, error) {
	target, err := h.openWorkspacePath(cwd, relative)
	if err != nil {
		return "", err
	}
	if err := mygo.Shell.OpenPath(target); err != nil {
		return "", err
	}
	return target, nil
}

func (h *Host) CreateWorkspaceEntry(cwd, parent, name, kind string) (map[string]any, error) {
	if err := h.requireWorkspace(cwd); err != nil {
		return nil, err
	}
	return h.createWorkspaceEntry(cwd, parent, name, kind)
}

func (h *Host) RenameWorkspaceEntry(cwd, relative, name string) (map[string]any, error) {
	if err := h.requireWorkspace(cwd); err != nil {
		return nil, err
	}
	return h.renameWorkspaceEntry(cwd, relative, name)
}

func (h *Host) DeleteWorkspaceEntry(cwd, relative string) error {
	if err := h.requireWorkspace(cwd); err != nil {
		return err
	}
	return h.deleteWorkspaceEntry(cwd, relative)
}

func (h *Host) CompletePaths(cwd, query string) ([]map[string]any, error) {
	return h.completePaths(cwd, query)
}

func (h *Host) SavePastedImage(payload map[string]any) (string, error) {
	return h.savePastedImage(payload)
}

// ---------- Git ----------

func (h *Host) GitOverview(cwd string) (map[string]any, error)   { return h.gitOverview(cwd) }
func (h *Host) GitBranches(cwd string) ([]map[string]any, error) { return h.gitBranches(cwd) }
func (h *Host) GitInspect(cwd, kind, target string) (map[string]any, error) {
	return h.gitInspect(cwd, kind, target)
}
func (h *Host) GitAction(cwd, action string, payload map[string]any) (map[string]any, error) {
	if err := h.requireWorkspace(cwd); err != nil {
		return nil, err
	}
	return h.gitAction(cwd, action, payload)
}
func (h *Host) GitWorktrees(cwd string) ([]map[string]any, error) { return h.gitWorktrees(cwd) }
func (h *Host) GitWorktreeCreate(cwd, name string, options map[string]any) (map[string]any, error) {
	if err := h.requireWorkspace(cwd); err != nil {
		return nil, err
	}
	return h.gitWorktreeCreate(cwd, name, options)
}
func (h *Host) GitWorktreeRemove(cwd, target string, options map[string]any) (map[string]any, error) {
	if err := h.requireWorkspace(cwd); err != nil {
		return nil, err
	}
	return h.gitWorktreeRemove(cwd, target, options)
}
func (h *Host) GitWorktreeMerge(cwd string, options map[string]any) (map[string]any, error) {
	if err := h.requireWorkspace(cwd); err != nil {
		return nil, err
	}
	return h.gitWorktreeMerge(cwd, options)
}
func (h *Host) GitClone(url, target string) (map[string]any, error) { return h.gitClone(url, target) }

// ---------- 设置 / 资源 ----------

func (h *Host) ToolsOverview(cwd string) map[string]any { return toolsOverview(cwd) }
func (h *Host) ToolsSet(cwd string, payload map[string]any) (map[string]any, error) {
	result, err := toolsSet(cwd, payload)
	if err == nil {
		h.invalidatePiEntry()
	}
	return result, err
}
func (h *Host) ToolsReset(cwd string, payload map[string]any) (map[string]any, error) {
	result, err := toolsReset(cwd, payload)
	if err == nil {
		h.invalidatePiEntry()
	}
	return result, err
}

func (h *Host) ModelDefaults(cwd string) map[string]any { return modelDefaultsOverview(cwd) }
func (h *Host) SetModelDefaults(cwd string, payload map[string]any) (map[string]any, error) {
	return setModelDefaults(cwd, payload)
}

func (h *Host) GlobalAgents() (map[string]any, error) {
	path := globalAgentsPath()
	content := ""
	if data, err := os.ReadFile(path); err == nil {
		content = string(data)
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return map[string]any{"path": path, "content": content}, nil
}

func (h *Host) SaveGlobalAgents(content string) (map[string]any, error) {
	if len(content) > 1024*1024 {
		return nil, errors.New("全局提示词不能超过 1 MB")
	}
	path := globalAgentsPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	if err := atomicWriteText(path, content); err != nil {
		return nil, err
	}
	return map[string]any{"path": path, "content": content}, nil
}

// ---------- 日志 ----------

func (h *Host) LogsInfo() LogSummary { return logs.summary() }

func (h *Host) SetLogLimit(bytes int64) LogSummary {
	logs.setLimits(bytes)
	return logs.summary()
}

func (h *Host) LogsClear() LogSummary {
	logs.clear()
	return logs.summary()
}

func (h *Host) LogsOpen() bool {
	summary := logs.summary()
	if summary.Dir == "" {
		return false
	}
	return mygo.Shell.OpenPath(summary.Dir) == nil
}

func (h *Host) LogsReveal() bool {
	summary := logs.summary()
	if summary.Dir == "" {
		return false
	}
	mygo.Shell.ShowItemInFolder(filepath.Join(summary.Dir, "app.log"))
	return true
}

func (h *Host) ReportLongTask(ms int64, label string) {
	if ms < 1000 {
		return
	}
	logPerf(fmt.Sprintf("界面长任务 %dms%s", ms, func() string {
		if label != "" {
			return "（" + label + "）"
		}
		return ""
	}()))
}

func (h *Host) LogEvent(level, scope, message string) {
	if level != "debug" && level != "info" && level != "warn" && level != "error" {
		level = "info"
	}
	if len(scope) > 40 {
		scope = scope[:40]
	}
	if len(message) > 8000 {
		message = message[:8000]
	}
	if message == "" {
		return
	}
	logRenderer(level, scope, message)
}

// ---------- 终端 ----------

func (h *Host) TerminalProfiles() []shellProfile { return listTerminalProfiles() }

func (h *Host) ValidateTerminalProfile(options map[string]any) (shellProfile, error) {
	return resolveTerminalProfile(options)
}

func (h *Host) StartTerminal(cwd, command string, options map[string]any) (map[string]any, error) {
	if err := h.requireWorkspace(cwd); err != nil {
		return nil, err
	}
	return h.terminals.startLegacy(cwd, command, options)
}

func (h *Host) StartTerminalShell(cwd string) (map[string]any, error) {
	if err := h.requireWorkspace(cwd); err != nil {
		return nil, err
	}
	return h.terminals.startShell(cwd)
}

func (h *Host) StartTerminalPty(cwd string, cols, rows int, options map[string]any) (map[string]any, error) {
	if err := h.requireWorkspace(cwd); err != nil {
		return nil, err
	}
	return h.terminals.startPTY(cwd, cols, rows, options)
}

func (h *Host) WriteTerminal(id, input string) (bool, error) { return h.terminals.write(id, input) }
func (h *Host) WriteTerminalPty(id, data string, binary bool) (bool, error) {
	return h.terminals.writePTY(id, data, binary)
}
func (h *Host) ResizeTerminalPty(id string, cols, rows int) bool {
	return h.terminals.resizePTY(id, cols, rows)
}
func (h *Host) StopTerminal(id string) bool        { return h.terminals.stop(id) }
func (h *Host) TerminalTasks() []map[string]any    { return h.terminals.list() }
func (h *Host) SetTerminalFocus(focused bool) bool { return true }

// ---------- 出网 / 应用更新 ----------

func (h *Host) NetworkApply(mode, custom string) map[string]any {
	return h.networkApply(mode, custom)
}

func (h *Host) NetworkStatus() map[string]any { return h.networkStatus() }

func (h *Host) CheckAppUpdate(options map[string]any) map[string]any {
	return h.checkAppUpdate(asBool(options["manual"]))
}

func (h *Host) DownloadAppUpdate() (map[string]any, error) { return h.downloadAppUpdate() }
func (h *Host) CancelAppUpdate() bool                      { return h.cancelAppUpdate() }
func (h *Host) InstallAppUpdate(version string) error      { return h.installAppUpdate(version) }
func (h *Host) OpenAppUpdate(url string) bool              { return h.openAppUpdate(url) }
func (h *Host) OpenExternalURL(url string) bool            { return h.openExternalURL(url) }
func (h *Host) ReadClipboard() string                      { return h.readClipboard() }

func (h *Host) Reveal(target string) bool {
	if !filepath.IsAbs(target) {
		return false
	}
	return h.reveal(target)
}

// ---------- MCP ----------

func (h *Host) McpOverview(cwd string) (map[string]any, error) { return h.mcpOverview(cwd) }
func (h *Host) McpProbe(cwd string) (map[string]any, error)    { return h.mcpProbe(cwd) }
func (h *Host) McpLogin(cwd, name string) (map[string]any, error) {
	return h.mcpLogin(cwd, name)
}
func (h *Host) McpLogout(cwd, name string) (map[string]any, error) {
	return h.mcpLogout(cwd, name)
}
func (h *Host) McpSaveServer(cwd string, payload map[string]any) (map[string]any, error) {
	if err := h.requireProjectScope(cwd, payload); err != nil {
		return nil, err
	}
	return h.mcpSaveServer(cwd, payload)
}
func (h *Host) McpUpdateServer(cwd string, payload map[string]any) (map[string]any, error) {
	if err := h.requireProjectScope(cwd, payload); err != nil {
		return nil, err
	}
	return h.mcpUpdateServer(cwd, payload)
}
func (h *Host) McpRemoveServer(cwd string, payload map[string]any) (map[string]any, error) {
	if err := h.requireProjectScope(cwd, payload); err != nil {
		return nil, err
	}
	return h.mcpRemoveServer(cwd, payload)
}
func (h *Host) McpSetAutoCodemode(cwd string, payload map[string]any) (map[string]any, error) {
	if err := h.requireProjectScope(cwd, payload); err != nil {
		return nil, err
	}
	return h.mcpSetAutoCodemode(cwd, payload)
}
func (h *Host) McpImportJSON(cwd string, payload map[string]any) (map[string]any, error) {
	if err := h.requireProjectScope(cwd, payload); err != nil {
		return nil, err
	}
	return h.mcpImportJSON(cwd, payload)
}

// ---------- 软件包 / 技能 ----------

func (h *Host) PackagesOverview(cwd string) map[string]any { return packagesOverview(cwd) }
func (h *Host) PackagesInstall(cwd string, payload map[string]any) (map[string]any, error) {
	if err := h.requireLocalPackages(cwd, payload); err != nil {
		return nil, err
	}
	return h.packagesInstall(cwd, payload)
}
func (h *Host) PackagesRemove(cwd string, payload map[string]any) (map[string]any, error) {
	if err := h.requireLocalPackages(cwd, payload); err != nil {
		return nil, err
	}
	return h.packagesRemove(cwd, payload)
}
func (h *Host) PackagesUpdate(cwd string, payload map[string]any) (map[string]any, error) {
	return h.packagesUpdate(cwd, payload)
}
func (h *Host) SkillsOverview(cwd string) map[string]any { return skillsOverview(cwd) }
