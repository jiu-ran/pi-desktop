package host

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Antigravity CLI 是第一个通过 ACP 接入的非 Pi Agent。
//
// 桌面端不注入任何提示词、不改它的配置：只启动本机 `agy acp`，按
// Agent Client Protocol v1 收发 JSON-RPC，把 ACP 的 update 翻译成界面认识的
// Pi 风格事件 / 消息，从而复用同一套对话、工具卡片与会话面板。
const (
	agentPi          = "pi"
	agentAntigravity = "antigravity"

	antigravityPrefix  = "antigravity://"
	antigravityDefault = "Antigravity"
	acpTurnTimeout     = 30 * time.Minute
)

func isAntigravityFile(file string) bool {
	return strings.HasPrefix(strings.TrimSpace(file), antigravityPrefix)
}

func antigravityFile(id string) string { return antigravityPrefix + id }

func antigravityID(file string) string {
	if !isAntigravityFile(file) {
		return ""
	}
	return strings.TrimPrefix(strings.TrimSpace(file), antigravityPrefix)
}

// ---------- Agent 设置（按项目记住用哪个 Agent） ----------

type agentSettingsStore struct {
	Projects    map[string]string `json:"projects,omitempty"`
	CustomPaths map[string]string `json:"customPaths,omitempty"`
	// Default 是新项目的默认 Agent。空字符串表示「每次询问」——这也是默认值，
	// 所以启动时没有显式选择的项目不会自动拉起任何一个 Agent。
	Default string `json:"default,omitempty"`
	// Models 记住每个 Agent 上次选中的模型：Antigravity 的 session/new 默认模型
	// 在某些账号上不会产出任何流（agy 1.5.11 实测），重启后不能再退回它。
	Models map[string]string `json:"models,omitempty"`
	// Thinking 记住 Antigravity 新会话的默认思考档位（low / medium / high）。
	Thinking map[string]string `json:"thinking,omitempty"`
}

var agentSettingsMu sync.Mutex

func agentSettingsPath() string { return filepath.Join(userDataDir(), "agents.json") }

func readAgentSettings() agentSettingsStore {
	store := agentSettingsStore{Projects: map[string]string{}, CustomPaths: map[string]string{}, Models: map[string]string{}, Thinking: map[string]string{}}
	data, err := os.ReadFile(agentSettingsPath())
	if err != nil {
		return store
	}
	_ = json.Unmarshal(data, &store)
	if store.Projects == nil {
		store.Projects = map[string]string{}
	}
	if store.CustomPaths == nil {
		store.CustomPaths = map[string]string{}
	}
	if store.Models == nil {
		store.Models = map[string]string{}
	}
	if store.Thinking == nil {
		store.Thinking = map[string]string{}
	}
	return store
}

func writeAgentSettings(store agentSettingsStore) error {
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(agentSettingsPath()), 0o755); err != nil {
		return err
	}
	return atomicWriteText(agentSettingsPath(), string(data)+"\n")
}

func agentKindFor(cwd string) string {
	settings := readAgentSettings()
	if kind := settings.Projects[normPathKey(cwd)]; kind == agentAntigravity || kind == agentPi {
		return kind
	}
	// 项目没有单独选择时，才落到「新项目默认 Agent」；默认值本身默认是空，
	// 所以全新安装启动不会连接任何 Agent。
	if kind := settings.Default; kind == agentAntigravity || kind == agentPi {
		return kind
	}
	return ""
}

func agentDefault() string {
	agentSettingsMu.Lock()
	defer agentSettingsMu.Unlock()
	kind := readAgentSettings().Default
	if kind == agentAntigravity || kind == agentPi {
		return kind
	}
	return ""
}

func setAgentDefault(kind string) error {
	if kind != "" && kind != agentPi && kind != agentAntigravity {
		return errors.New("未知的 Agent：" + kind)
	}
	agentSettingsMu.Lock()
	defer agentSettingsMu.Unlock()
	store := readAgentSettings()
	store.Default = kind
	return writeAgentSettings(store)
}

func setAgentKindFor(cwd, kind string) error {
	if kind != agentPi && kind != agentAntigravity {
		return errors.New("未知的 Agent：" + kind)
	}
	agentSettingsMu.Lock()
	defer agentSettingsMu.Unlock()
	store := readAgentSettings()
	// Pi 也要显式写进去：空值现在表示「还没选过」，不能再拿「没有记录」当 Pi。
	store.Projects[normPathKey(cwd)] = kind
	return writeAgentSettings(store)
}

func agentCustomPath(kind string) string {
	agentSettingsMu.Lock()
	defer agentSettingsMu.Unlock()
	return readAgentSettings().CustomPaths[kind]
}

func setAgentCustomPath(kind, path string) error {
	agentSettingsMu.Lock()
	defer agentSettingsMu.Unlock()
	store := readAgentSettings()
	path = strings.Trim(strings.TrimSpace(path), `"`)
	if path == "" {
		delete(store.CustomPaths, kind)
	} else {
		store.CustomPaths[kind] = path
	}
	return writeAgentSettings(store)
}

func agentModel(kind string) string {
	agentSettingsMu.Lock()
	defer agentSettingsMu.Unlock()
	return readAgentSettings().Models[kind]
}

func agentThinking(kind string) string {
	agentSettingsMu.Lock()
	defer agentSettingsMu.Unlock()
	level := readAgentSettings().Thinking[kind]
	if level == "low" || level == "medium" || level == "high" {
		return level
	}
	return ""
}

func setAgentThinking(kind, level string) error {
	level = strings.TrimSpace(level)
	if level != "" && level != "low" && level != "medium" && level != "high" {
		return errors.New("未知的思考档位：" + level)
	}
	agentSettingsMu.Lock()
	defer agentSettingsMu.Unlock()
	store := readAgentSettings()
	if level == "" {
		delete(store.Thinking, kind)
	} else {
		store.Thinking[kind] = level
	}
	return writeAgentSettings(store)
}

// ---------- 位置探测 ----------

type AgentLocation struct {
	Kind    string `json:"kind"`
	Label   string `json:"label"`
	Found   bool   `json:"found"`
	Version string `json:"version"`
	Path    string `json:"path"`
	Error   string `json:"error,omitempty"`
}

func locateAntigravity(customPath string) AgentLocation {
	location := AgentLocation{Kind: agentAntigravity, Label: antigravityDefault}
	manual := strings.Trim(strings.TrimSpace(customPath), `"`)
	if manual == "" {
		manual = agentCustomPath(agentAntigravity)
	}
	if manual != "" {
		if !fileExists(manual) {
			location.Path = manual
			location.Error = "指定的 Antigravity CLI 路径不存在，请检查后重新输入"
			return location
		}
		version := probeAgentVersion(manual)
		if version == "" {
			location.Path = manual
			location.Error = "这个文件不能运行 `agy --version`，请确认是本机的 Antigravity CLI"
			return location
		}
		location.Found = true
		location.Version = version
		location.Path = manual
		return location
	}
	auto := findExecutableOnPath("agy")
	if auto == "" {
		location.Error = "未在 PATH 中找到 agy 命令。安装 Antigravity CLI 后重新打开设置，或手动指定 agy 可执行文件。"
		return location
	}
	version := probeAgentVersion(auto)
	if version == "" {
		location.Path = auto
		location.Error = "PATH 中的 agy 无法运行（agy --version 失败）"
		return location
	}
	location.Found = true
	location.Version = version
	location.Path = auto
	return location
}

func probeAgentVersion(exe string) string {
	cmd := exec.Command(exe, "--version")
	hideWindow(cmd)
	prepareProcessGroup(cmd)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func antigravityCommand() (string, AgentLocation, error) {
	location := locateAntigravity("")
	if !location.Found {
		return "", location, errors.New(firstNonEmpty(location.Error, "没有找到本机 Antigravity CLI"))
	}
	return location.Path, location, nil
}

// ---------- 工作区与会话 ----------

type agPermission struct {
	id        string
	requestID string
	options   []any
	toolCall  map[string]any
	createdAt time.Time
}

type agQueuedPrompt struct {
	text   string
	images []any
}

type agToolState struct {
	id       string
	acpName  string
	name     string
	kind     string
	title    string
	args     map[string]any
	rawArgs  map[string]any
	started  time.Time
	finished bool
	emitted  bool
	output   string
	images   []any
	details  map[string]any
	isError  bool
}

type agSession struct {
	id        string
	cwd       string
	title     string
	updatedAt time.Time
	// listed 表示这条会话来自 Antigravity 的 session/list（即使用户还没在本进程里打开，也要出现在侧栏）
	listed bool

	messages []any

	models []any
	levels []string
	model  string
	// thinking 是 Antigravity 的 thought_level（low / medium / high）
	thinking string
	mode     string
	modes    []any

	commands []any
	usage    map[string]any
	totals   map[string]float64
	context  map[string]any

	streaming   bool
	activeTurns int
	loading     bool
	loaded      bool

	bufText     strings.Builder
	bufThinking strings.Builder
	liveStarted bool
	userPending strings.Builder

	followUp []agQueuedPrompt
	steer    []agQueuedPrompt

	permissions map[string]*agPermission
	tools       map[string]*agToolState
}

type antigravityWorkspace struct {
	mu       sync.Mutex
	h        *Host
	cwd      string
	client   *acpClient
	activeID string
	sessions map[string]*agSession
	closed   bool

	agentInfo map[string]any
}

func (w *antigravityWorkspace) sessionLocked(file string) *agSession {
	id := antigravityID(file)
	if id == "" {
		id = w.activeID
	}
	if id == "" {
		return nil
	}
	return w.sessions[id]
}

func (w *antigravityWorkspace) ensureSessionLocked(id string) *agSession {
	session := w.sessions[id]
	if session == nil {
		session = &agSession{
			id:          id,
			cwd:         w.cwd,
			permissions: map[string]*agPermission{},
			tools:       map[string]*agToolState{},
			totals:      map[string]float64{},
		}
		w.sessions[id] = session
	}
	return session
}

func (w *antigravityWorkspace) emit(session *agSession, event map[string]any) {
	if w.h == nil || session == nil {
		return
	}
	file := antigravityFile(session.id)
	w.h.emitPi(w.cwd, file, event)
}

// ---------- ACP 通知 / 服务端请求 ----------

func (w *antigravityWorkspace) onNotification(method string, params map[string]any) {
	if method != "session/update" {
		return
	}
	id := asString(params["sessionId"])
	update := asMap(params["update"])
	w.mu.Lock()
	session := w.sessions[id]
	if session != nil {
		w.applyUpdateLocked(session, update)
	}
	w.mu.Unlock()
}

func (w *antigravityWorkspace) onRequest(id, method string, params map[string]any) {
	if method != "session/request_permission" {
		_ = w.client.RespondError(id, -32601, "不支持的请求："+method)
		return
	}
	sessionID := asString(params["sessionId"])
	options := asSlice(params["options"])
	toolCall := asMap(params["toolCall"])
	permissionID := fmt.Sprintf("perm-%d", time.Now().UnixNano())

	w.mu.Lock()
	session := w.sessions[sessionID]
	if session == nil {
		session = w.ensureSessionLocked(sessionID)
	}
	session.permissions[permissionID] = &agPermission{
		id: permissionID, requestID: id, options: options, toolCall: toolCall, createdAt: time.Now(),
	}
	w.mu.Unlock()

	title := firstNonEmpty(asString(toolCall["title"]), asString(toolCall["name"]), "执行工具")
	message := "Antigravity 请求执行：" + title
	w.emit(session, map[string]any{
		"type":      "acp_permission_request",
		"id":        permissionID,
		"sessionId": sessionID,
		"title":     "Antigravity 请求权限",
		"message":   message,
		"toolCall":  toolCall,
		"options":   options,
		"agent":     agentAntigravity,
		"createdAt": time.Now().UnixMilli(),
	})

	// 界面没响应（切走了 / 窗口关了）时不要永远卡住这个工具调用。
	go func() {
		timer := time.NewTimer(10 * time.Minute)
		defer timer.Stop()
		<-timer.C
		w.mu.Lock()
		permission := session.permissions[permissionID]
		delete(session.permissions, permissionID)
		w.mu.Unlock()
		if permission != nil {
			_ = w.client.Respond(permission.requestID, map[string]any{"outcome": map[string]any{"outcome": "cancelled"}})
		}
	}()
}

func (w *antigravityWorkspace) applyUpdateLocked(session *agSession, update map[string]any) {
	kind := asString(update["sessionUpdate"])
	switch kind {
	case "user_message_chunk":
		if !session.loading {
			return
		}
		session.userPending.WriteString(acpContentText(update["content"]))
	case "agent_message_chunk":
		text := acpContentText(update["content"])
		if text == "" {
			return
		}
		w.flushUserLocked(session)
		session.bufText.WriteString(text)
		if !session.loading {
			w.ensureLiveLocked(session)
			w.emit(session, map[string]any{
				"type": "message_update",
				"assistantMessageEvent": map[string]any{
					"type": "text_delta", "contentIndex": 0, "delta": text,
				},
			})
		}
	case "agent_thought_chunk":
		text := acpContentText(update["content"])
		if text == "" {
			return
		}
		w.flushUserLocked(session)
		session.bufThinking.WriteString(text)
		if !session.loading {
			w.ensureLiveLocked(session)
			w.emit(session, map[string]any{
				"type": "message_update",
				"assistantMessageEvent": map[string]any{
					"type": "thinking_delta", "contentIndex": 1, "delta": text,
				},
			})
		}
	case "tool_call", "tool_call_update":
		w.flushUserLocked(session)
		w.applyToolLocked(session, update, kind == "tool_call")
	case "usage_update":
		used := asFloat(update["used"])
		size := asFloat(update["size"])
		if size > 0 {
			session.context = map[string]any{"used": used, "size": size}
		}
	case "available_commands_update":
		session.commands = normalizeAcpCommands(asSlice(update["availableCommands"]))
		if !session.loading {
			w.emit(session, map[string]any{"type": "commands_changed", "commands": append([]any{}, session.commands...)})
		}
	case "session_info_update":
		if title := strings.TrimSpace(asString(update["title"])); title != "" {
			session.title = title
		}
		if !session.loading {
			w.emit(session, map[string]any{"type": "session_info_changed", "name": session.title})
		}
	case "config_option_update":
		w.applyConfigOptionsLocked(session, asSlice(update["configOptions"]))
		if !session.loading {
			w.emit(session, map[string]any{
				"type": "config_option_changed", "thinkingLevel": session.thinking,
				"model": sessionModelID(session),
			})
		}
	case "current_mode_update":
		session.mode = asString(update["currentModeId"])
	case "plan":
		// 计划内容作为思考过程展示，避免左右两套计划 UI 各说各话。
		entries := asSlice(update["entries"])
		lines := make([]string, 0, len(entries))
		for _, entry := range entries {
			item := asMap(entry)
			content := strings.TrimSpace(asString(item["content"]))
			if content == "" {
				continue
			}
			if status := asString(item["status"]); status != "" && status != "pending" {
				content += "（" + status + "）"
			}
			lines = append(lines, "- "+content)
		}
		if len(lines) > 0 {
			session.bufThinking.WriteString(strings.Join(lines, "\n") + "\n")
			if !session.loading {
				w.ensureLiveLocked(session)
				w.emit(session, map[string]any{
					"type": "message_update",
					"assistantMessageEvent": map[string]any{
						"type": "thinking_delta", "contentIndex": 1, "delta": strings.Join(lines, "\n") + "\n",
					},
				})
			}
		}
	}
}

func (w *antigravityWorkspace) ensureLiveLocked(session *agSession) {
	if session.liveStarted {
		return
	}
	session.liveStarted = true
	w.emit(session, map[string]any{
		"type":    "message_start",
		"message": map[string]any{"role": "assistant", "content": []any{}},
	})
}

func (w *antigravityWorkspace) flushUserLocked(session *agSession) {
	if session.userPending.Len() == 0 {
		return
	}
	text := session.userPending.String()
	session.userPending.Reset()
	if strings.TrimSpace(text) == "" {
		return
	}
	session.messages = append(session.messages, map[string]any{
		"role": "user", "content": []any{map[string]any{"type": "text", "text": text}},
	})
}

// flushAssistantLocked 把流式累积的正文 / 思考落成一条 assistant 消息。
// loading 期间只改历史，不向界面发事件（session/load 的回放就是这样）。
func (w *antigravityWorkspace) flushAssistantLocked(session *agSession, stopReason string) {
	text := session.bufText.String()
	thinking := session.bufThinking.String()
	session.bufText.Reset()
	session.bufThinking.Reset()
	if strings.TrimSpace(text) == "" && strings.TrimSpace(thinking) == "" {
		session.liveStarted = false
		return
	}
	content := []any{}
	if strings.TrimSpace(thinking) != "" {
		content = append(content, map[string]any{"type": "thinking", "thinking": thinking})
	}
	if strings.TrimSpace(text) != "" {
		content = append(content, map[string]any{"type": "text", "text": text})
	}
	message := map[string]any{
		"role": "assistant", "content": content,
		"stopReason": firstNonEmpty(stopReason, "end_turn"),
	}
	if session.usage != nil {
		message["usage"] = session.usage
	}
	session.messages = append(session.messages, message)
	started := session.liveStarted
	session.liveStarted = false
	if session.loading || !started {
		return
	}
	w.emit(session, map[string]any{"type": "message_end", "message": message})
}

func (w *antigravityWorkspace) applyToolLocked(session *agSession, update map[string]any, created bool) {
	id := asString(update["toolCallId"])
	if id == "" {
		return
	}
	status := asString(update["status"])
	name := asString(update["name"])
	kind := asString(update["kind"])
	rawArgs := asMap(update["rawInput"])
	if len(rawArgs) == 0 {
		rawArgs = asMap(update["args"])
	}
	args := map[string]any{}
	for key, value := range rawArgs {
		args[key] = value
	}
	mappedName := mapAcpToolName(name, kind)
	mappedArgs := mapAcpToolArgs(mappedName, rawArgs)

	tool := session.tools[id]
	if tool == nil {
		tool = &agToolState{id: id, acpName: name, name: mappedName, kind: kind, started: time.Now()}
		session.tools[id] = tool
	}
	tool.acpName = firstNonEmpty(name, tool.acpName)
	tool.name = mappedName
	tool.kind = firstNonEmpty(kind, tool.kind)
	tool.title = firstNonEmpty(asString(update["title"]), tool.title)
	tool.args = mappedArgs
	tool.rawArgs = args

	output, images, details, isError := acpToolResult(update)
	if output != "" {
		tool.output = output
	}
	if len(images) > 0 {
		tool.images = images
	}
	if len(details) > 0 {
		tool.details = details
		// diff 内容里带了文件路径时补进参数，编辑卡片的标题与「打开文件」才有目标。
		if path := asString(details["path"]); path != "" && asString(tool.args["path"]) == "" {
			tool.args["path"] = path
		}
	}
	if isError {
		tool.isError = true
	}

	completed := status == "completed" || status == "failed" || status == "error"
	if !completed {
		if !session.loading {
			if !tool.emitted {
				tool.emitted = true
				w.flushAssistantLocked(session, "toolUse")
				w.emit(session, map[string]any{
					"type": "tool_execution_start", "toolCallId": id,
					"toolName": tool.name, "args": tool.args,
				})
			} else if output != "" {
				w.emit(session, map[string]any{
					"type": "tool_execution_update", "toolCallId": id,
					"toolName": tool.name, "args": tool.args,
					"partialResult": map[string]any{"content": []any{map[string]any{"type": "text", "text": output}}},
				})
			}
		}
		return
	}
	if tool.finished {
		return
	}
	tool.finished = true
	// 先落正文，再落工具：否则回放时工具卡片会跑到它前面的回答上面去。
	w.flushAssistantLocked(session, "toolUse")

	// 历史里先留一条带工具名的 assistant 消息，普通工具卡片才有标题 / 命令可显示。
	session.messages = append(session.messages, map[string]any{
		"role": "assistant",
		"content": []any{map[string]any{
			"type": "toolCall", "id": id, "name": tool.name, "arguments": tool.args,
		}},
		"stopReason": "toolUse",
	})
	result := w.toolResultPayload(tool)
	// 回放（session/load）没有真实耗时：不要把「刚回放到内存」的 0ms 写成工具耗时。
	var duration any
	if !session.loading {
		duration = time.Since(tool.started).Milliseconds()
	}
	session.messages = append(session.messages, map[string]any{
		"role": "toolResult", "toolCallId": id, "toolName": tool.name,
		"content": result["content"], "details": result["details"],
		"isError": tool.isError, "durationMs": duration,
	})

	if session.loading {
		return
	}
	if !tool.emitted {
		tool.emitted = true
		w.emit(session, map[string]any{
			"type": "tool_execution_start", "toolCallId": id,
			"toolName": tool.name, "args": tool.args,
		})
	}
	w.emit(session, map[string]any{
		"type": "tool_execution_end", "toolCallId": id, "toolName": tool.name,
		"args": tool.args, "result": result, "isError": tool.isError,
		"durationMs": time.Since(tool.started).Milliseconds(),
	})
}

func (w *antigravityWorkspace) toolResultPayload(tool *agToolState) map[string]any {
	content := []any{}
	if strings.TrimSpace(tool.output) != "" {
		content = append(content, map[string]any{"type": "text", "text": tool.output})
	}
	for _, image := range tool.images {
		content = append(content, image)
	}
	details := map[string]any{}
	for key, value := range tool.details {
		details[key] = value
	}
	if tool.title != "" {
		details["title"] = tool.title
	}
	result := map[string]any{"content": content}
	if len(details) > 0 {
		result["details"] = details
	}
	return result
}

func (w *antigravityWorkspace) applyConfigOptionsLocked(session *agSession, options []any) {
	models, levels, mode, modes, modelID, thinking := parseAcpConfigOptions(options, session.models)
	if len(models) > 0 {
		session.models = models
	}
	if len(levels) > 0 {
		session.levels = levels
	}
	if len(modes) > 0 {
		session.modes = modes
	}
	if mode != "" {
		session.mode = mode
	}
	if modelID != "" {
		session.model = modelID
	}
	if thinking != "" {
		session.thinking = thinking
	}
}

// ---------- 工具名 / 参数翻译 ----------

func mapAcpToolName(name, kind string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	switch lower {
	case "read_file", "readfile", "view_file", "read":
		return "read"
	case "run_command", "runcommand", "execute_command", "shell", "bash", "terminal":
		return "bash"
	case "write_file", "writefile", "create_file", "createfile":
		return "write"
	case "edit_file", "editfile", "replace_file_content", "apply_patch", "str_replace", "edit":
		return "edit"
	case "list_directory", "list_dir", "ls":
		return "ls"
	case "grep_search", "search", "grep":
		return "grep"
	case "find_files", "glob":
		return "glob"
	case "":
		switch strings.ToLower(kind) {
		case "read":
			return "read"
		case "execute":
			return "bash"
		case "edit":
			return "edit"
		case "delete":
			return "bash"
		}
	}
	return name
}

func mapAcpToolArgs(name string, raw map[string]any) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	out := map[string]any{}
	for key, value := range raw {
		out[key] = value
	}
	switch name {
	case "read":
		if path := pickArgString(raw, "Path", "path", "file_path", "filePath", "filename"); path != "" {
			out["path"] = path
		}
		if offset := pickArgNumber(raw, "Offset", "offset", "start_line", "startLine"); offset > 0 {
			out["offset"] = offset
		}
		if limit := pickArgNumber(raw, "Limit", "limit", "line_count", "lineCount"); limit > 0 {
			out["limit"] = limit
		}
	case "bash":
		if command := pickArgString(raw, "CommandLine", "command", "cmd", "Command"); command != "" {
			out["command"] = command
		}
	case "write":
		if path := pickArgString(raw, "Path", "path", "file_path", "filePath"); path != "" {
			out["path"] = path
		}
		if content, ok := raw["Content"]; ok {
			out["content"] = content
		} else if content, ok := raw["content"]; ok {
			out["content"] = content
		}
	case "edit":
		if path := pickArgString(raw, "Path", "path", "file_path", "filePath"); path != "" {
			out["path"] = path
		}
		oldText := pickArgString(raw, "OldText", "oldText", "old_string", "oldString", "old_str")
		newText := pickArgString(raw, "NewText", "newText", "new_string", "newString", "new_str")
		if oldText != "" || newText != "" {
			out["edits"] = []any{map[string]any{"oldText": oldText, "newText": newText}}
		}
	}
	return out
}

func pickArgString(raw map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			if text := strings.TrimSpace(asString(value)); text != "" {
				return text
			}
		}
	}
	return ""
}

func pickArgNumber(raw map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			if number := asFloat(value); number > 0 {
				return number
			}
		}
	}
	return 0
}

func acpContentText(content any) string {
	switch value := content.(type) {
	case string:
		return value
	case map[string]any:
		if text := asString(value["text"]); text != "" {
			return text
		}
		if nested, ok := value["content"]; ok {
			return acpContentText(nested)
		}
	}
	return ""
}

// acpToolResult 从 tool_call / tool_call_update 里提取可读输出、图片、diff 与错误标记。
func acpToolResult(update map[string]any) (string, []any, map[string]any, bool) {
	var texts []string
	images := []any{}
	details := map[string]any{}
	isError := asString(update["status"]) == "failed" || asString(update["status"]) == "error"

	for _, item := range asSlice(update["content"]) {
		part := asMap(item)
		switch asString(part["type"]) {
		case "content":
			if text := acpContentText(part["content"]); text != "" {
				texts = append(texts, text)
			}
		case "text":
			if text := asString(part["text"]); text != "" {
				texts = append(texts, text)
			}
		case "image":
			images = append(images, map[string]any{
				"type": "image", "mimeType": asString(part["mimeType"]), "data": asString(part["data"]),
			})
		case "diff":
			diff := acpDiffText(asString(part["oldText"]), asString(part["newText"]))
			if diff != "" {
				details["diff"] = diff
			}
			if path := asString(part["path"]); path != "" {
				details["path"] = path
			}
		}
	}

	rawOutput := asMap(update["rawOutput"])
	if output := asString(rawOutput["output"]); output != "" && len(texts) == 0 {
		texts = append(texts, output)
	}
	if code, ok := rawOutput["exit_code"]; ok && asFloat(code) != 0 {
		isError = true
	}
	if status := asString(update["status"]); status == "failed" {
		isError = true
	}
	output := strings.TrimSpace(strings.Join(texts, "\n"))
	return output, images, details, isError
}

func acpDiffText(oldText, newText string) string {
	if oldText == "" && newText == "" {
		return ""
	}
	lines := []string{}
	for _, line := range strings.Split(strings.ReplaceAll(oldText, "\r\n", "\n"), "\n") {
		if line == "" && oldText == "" {
			continue
		}
		lines = append(lines, "- "+line)
	}
	for _, line := range strings.Split(strings.ReplaceAll(newText, "\r\n", "\n"), "\n") {
		if line == "" && newText == "" {
			continue
		}
		lines = append(lines, "+ "+line)
	}
	return strings.Join(lines, "\n")
}

// ---------- 会话配置 ----------

func normalizeAcpModels(options []any) []any {
	models := make([]any, 0, len(options))
	for _, item := range options {
		option := asMap(item)
		id := asString(option["value"])
		if id == "" {
			continue
		}
		models = append(models, map[string]any{
			"provider": agentAntigravity,
			"id":       id,
			"name":     firstNonEmpty(asString(option["name"]), id),
			// 思考档位由 thought_level 单独提供；这里把不支持的四档标成 null，
			// 合并选择器就只会显示 low / medium / high。
			"reasoning": true,
			"thinkingLevelMap": map[string]any{
				"off": nil, "minimal": nil,
				"low": "low", "medium": "medium", "high": "high",
				"xhigh": nil, "max": nil,
			},
		})
	}
	return models
}

func parseAcpConfigOptions(options []any, previous []any) ([]any, []string, string, []any, string, string) {
	models := previous
	levels := []string{}
	mode := ""
	modes := []any{}
	modelID := ""
	thinking := ""
	for _, item := range options {
		option := asMap(item)
		switch asString(option["id"]) {
		case "model":
			if list := normalizeAcpModels(asSlice(option["options"])); len(list) > 0 {
				models = list
			}
			modelID = asString(option["currentValue"])
		case "thought_level":
			levels = []string{}
			for _, entry := range asSlice(option["options"]) {
				if value := asString(asMap(entry)["value"]); value != "" {
					levels = append(levels, value)
				}
			}
			thinking = asString(option["currentValue"])
		case "mode":
			mode = asString(option["currentValue"])
			for _, entry := range asSlice(option["options"]) {
				modes = append(modes, map[string]any{
					"id":          asString(asMap(entry)["value"]),
					"name":        asString(asMap(entry)["name"]),
					"description": asString(asMap(entry)["description"]),
				})
			}
		}
	}
	return models, levels, mode, modes, modelID, thinking
}

func normalizeAcpCommands(items []any) []any {
	commands := make([]any, 0, len(items))
	for _, item := range items {
		command := asMap(item)
		name := strings.TrimSpace(asString(command["name"]))
		if name == "" {
			continue
		}
		commands = append(commands, map[string]any{
			"name":        name,
			"description": asString(command["description"]),
			"source":      "agent",
		})
	}
	return commands
}

func acpModelBase(id string) (string, string) {
	for _, suffix := range []string{"-xhigh", "-medium", "-high", "-low"} {
		if strings.HasSuffix(id, suffix) {
			return strings.TrimSuffix(id, suffix), strings.TrimPrefix(suffix, "-")
		}
	}
	return id, ""
}

func (w *antigravityWorkspace) configureSession(session *agSession, result map[string]any) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if model, ok := result["models"]; ok {
		models := asMap(model)
		if current := asString(models["currentModelId"]); current != "" {
			session.model = current
			if base, suffix := acpModelBase(current); suffix != "" {
				session.model = base
				session.thinking = suffix
			}
		}
	}
	w.applyConfigOptionsLocked(session, asSlice(result["configOptions"]))
	if len(session.levels) == 0 {
		session.levels = []string{"low", "medium", "high"}
	}
	session.loaded = true
}

// antigravityDefaultModel 选一个「打开就会出字」的默认模型。
//
// agy 1.5.11 的 session/new 在这些账号上默认给 gemini-4-argon：实测 90 秒内
// 一条 session/update 都没有（hydrogen / flash 十几秒就回）。这不是桌面端能修的
// 上游问题，所以新会话先落到可用的型号上；用户仍可在模型菜单里改，选择会被记住。
func antigravityDefaultModel(models []any) string {
	ids := make([]string, 0, len(models))
	for _, item := range models {
		if id := asString(asMap(item)["id"]); id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return ""
	}
	contains := func(want string) bool {
		for _, id := range ids {
			if id == want {
				return true
			}
		}
		return false
	}
	for _, want := range []string{
		"gemini-4-hydrogen", "gemini-3.8-flash",
		"gemini-4-hydrogen-medium", "gemini-3.8-flash-medium",
	} {
		if contains(want) {
			return want
		}
	}
	for _, id := range ids {
		lower := strings.ToLower(id)
		if strings.Contains(lower, "argon") || strings.Contains(lower, "orchestrator") {
			continue
		}
		if strings.HasSuffix(lower, "-xhigh") || strings.HasSuffix(lower, "-max") {
			continue
		}
		return id
	}
	return ids[0]
}

func (w *antigravityWorkspace) ensurePreferredModel(session *agSession) {
	w.mu.Lock()
	current := sessionModelID(session)
	models := append([]any{}, session.models...)
	w.mu.Unlock()
	if len(models) == 0 {
		return
	}
	choice := agentModel(agentAntigravity)
	if base, _ := acpModelBase(choice); base != "" {
		choice = base
	}
	available := false
	if choice != "" {
		for _, item := range models {
			if asString(asMap(item)["id"]) == choice {
				available = true
				break
			}
		}
	}
	if !available {
		choice = antigravityDefaultModel(models)
	}
	if choice == "" {
		return
	}
	if choice != current {
		if _, err := w.setModel(session, choice); err != nil {
			logWarn("antigravity", "无法切换默认模型："+err.Error())
		}
	}
	w.ensurePreferredThinking(session)
}

// ensurePreferredThinking 只作用于新建会话：历史会话的思考档位属于那次对话，
// 不应在 load 时被设置页的默认值覆盖。
func (w *antigravityWorkspace) ensurePreferredThinking(session *agSession) {
	level := agentThinking(agentAntigravity)
	if level == "" {
		return
	}
	w.mu.Lock()
	current := session.thinking
	available := false
	for _, item := range session.levels {
		if item == level {
			available = true
			break
		}
	}
	w.mu.Unlock()
	if !available || level == current {
		return
	}
	if _, err := w.setThinking(session, level); err != nil {
		logWarn("antigravity", "无法应用默认思考档位："+err.Error())
	}
}

// ---------- 状态 / 快照 ----------

func (w *antigravityWorkspace) sessionStateLocked(session *agSession) map[string]any {
	if session == nil {
		return map[string]any{
			"sessionFile": "", "sessionName": "", "isStreaming": false, "isCompacting": false,
			"thinkingLevel": "medium",
		}
	}
	displayID := sessionModelID(session)
	var model any
	for _, item := range session.models {
		entry := asMap(item)
		if asString(entry["id"]) == displayID {
			model = entry
			break
		}
	}
	if model == nil {
		for _, item := range session.models {
			entry := asMap(item)
			if asString(entry["id"]) == session.model {
				model = entry
				break
			}
		}
	}
	if model == nil && len(session.models) > 0 {
		model = session.models[0]
	}
	return map[string]any{
		"sessionFile":   antigravityFile(session.id),
		"sessionName":   session.title,
		"model":         model,
		"thinkingLevel": firstNonEmpty(session.thinking, "medium"),
		"isStreaming":   session.streaming,
		"isCompacting":  false,
		"queue":         w.queueLocked(session),
		"agent":         agentAntigravity,
		"mode":          session.mode,
	}
}

// sessionModelID 把「基础模型 + 思考档位」合成完整 id（同 Antigravity 的模型名）。
func sessionModelID(session *agSession) string {
	base := session.model
	if base == "" {
		return ""
	}
	level := session.thinking
	if level == "" {
		return base
	}
	full := base + "-" + level
	for _, item := range session.models {
		if asString(asMap(item)["id"]) == full {
			return full
		}
	}
	return base
}

func (w *antigravityWorkspace) queueLocked(session *agSession) map[string]any {
	steering := make([]string, 0, len(session.steer))
	for _, item := range session.steer {
		steering = append(steering, item.text)
	}
	followUp := make([]string, 0, len(session.followUp))
	for _, item := range session.followUp {
		followUp = append(followUp, item.text)
	}
	return map[string]any{"steering": steering, "followUp": followUp}
}

func (w *antigravityWorkspace) sessionSummariesLocked() []sessionSummary {
	items := make([]sessionSummary, 0, len(w.sessions))
	for _, session := range w.sessions {
		if len(session.messages) == 0 && !session.listed && session.id != w.activeID {
			continue
		}
		stamp := session.updatedAt
		if stamp.IsZero() {
			stamp = time.Now()
		}
		items = append(items, sessionSummary{
			ID:        session.id,
			Path:      antigravityFile(session.id),
			Title:     firstNonEmpty(session.title, "新会话"),
			Empty:     len(session.messages) == 0,
			Timestamp: stamp.UnixMilli(),
			Cwd:       w.cwd,
			Project:   filepath.Base(w.cwd),
		})
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].Timestamp > items[j].Timestamp })
	return items
}

func (w *antigravityWorkspace) workerStatesLocked() []map[string]any {
	out := []map[string]any{}
	for _, session := range w.sessions {
		out = append(out, map[string]any{
			"sessionFile": antigravityFile(session.id),
			"streaming":   session.streaming,
			"compacting":  false,
		})
	}
	return out
}

func (w *antigravityWorkspace) statsLocked(session *agSession) map[string]any {
	users, assistants, tools, toolCalls := 0, 0, 0, 0
	for _, message := range session.messages {
		item := asMap(message)
		switch asString(item["role"]) {
		case "user":
			users++
		case "assistant":
			assistants++
			for _, part := range asSlice(item["content"]) {
				if asString(asMap(part)["type"]) == "toolCall" {
					toolCalls++
				}
			}
		case "toolResult":
			tools++
		}
	}
	tokens := map[string]any{
		"input":      int64(session.totals["input"]),
		"output":     int64(session.totals["output"]),
		"cacheRead":  int64(session.totals["cacheRead"]),
		"cacheWrite": int64(session.totals["cacheWrite"]),
		"total":      int64(session.totals["total"]),
	}
	contextUsage := map[string]any{"tokens": 0, "contextWindow": 0, "percent": 0}
	if used, ok := session.context["used"]; ok {
		size := asFloat(session.context["size"])
		contextUsage["tokens"] = int64(asFloat(used))
		contextUsage["contextWindow"] = int64(size)
		if size > 0 {
			contextUsage["percent"] = asFloat(used) / size * 100
		}
	}
	return map[string]any{
		"tokens": tokens, "cost": 0,
		"userMessages": users, "assistantMessages": assistants,
		"toolCalls": tools, "contextUsage": contextUsage,
	}
}

// ---------- 打开 / 关闭 ----------

func (h *Host) acpWorkspace(cwd string) *antigravityWorkspace {
	h.mu.Lock()
	defer h.mu.Unlock()
	if workspace := h.acpPools[cwd]; workspace != nil {
		return workspace
	}
	for key, workspace := range h.acpPools {
		if samePath(key, cwd) {
			return workspace
		}
	}
	return nil
}

func (h *Host) openAntigravity(cwd string, options map[string]any) (map[string]any, error) {
	h.agentStartMu.Lock()
	defer h.agentStartMu.Unlock()

	if existing := h.acpWorkspace(cwd); existing != nil {
		existing.mu.Lock()
		hasSession := existing.activeID != ""
		existing.mu.Unlock()
		if hasSession {
			return h.snapshotAntigravity(cwd, "")
		}
		h.closeAntigravity(cwd)
	}

	exe, location, err := antigravityCommand()
	if err != nil {
		return nil, err
	}
	workspace := &antigravityWorkspace{
		h: h, cwd: cwd, sessions: map[string]*agSession{},
	}
	client := newACPClient(cwd, h.childEnv(), workspace.onNotification, workspace.onRequest)
	workspace.client = client
	if err := client.attachProcess(exe, []string{"acp"}); err != nil {
		return nil, fmt.Errorf("Antigravity 启动失败：%w", err)
	}
	initResult, err := client.Call("initialize", map[string]any{
		"protocolVersion": 1,
		"clientCapabilities": map[string]any{
			"fs":       map[string]any{"readTextFile": false, "writeTextFile": false},
			"terminal": false,
		},
		"clientInfo": map[string]any{"name": "Pi Desktop", "version": "0.9.5"},
	}, 30*time.Second)
	if err != nil {
		client.Stop()
		return nil, fmt.Errorf("Antigravity 握手失败：%w", err)
	}
	workspace.agentInfo = map[string]any{
		"kind": agentAntigravity, "label": antigravityDefault,
		"version": location.Version, "path": location.Path,
		"agentInfo": asMap(initResult["agentInfo"]),
	}

	sessions, listErr := client.Call("session/list", map[string]any{"cwd": cwd}, 20*time.Second)
	if listErr == nil {
		for _, item := range asSlice(sessions["sessions"]) {
			info := asMap(item)
			id := asString(info["sessionId"])
			if id == "" || !sameAgentCwd(asString(info["cwd"]), cwd) {
				continue
			}
			session := workspace.ensureSessionLocked(id)
			session.listed = true
			session.title = asString(info["title"])
			if stamp, err := time.Parse(time.RFC3339, asString(info["updatedAt"])); err == nil {
				session.updatedAt = stamp
			}
		}
	}

	h.mu.Lock()
	h.acpPools[cwd] = workspace
	h.mu.Unlock()

	target := antigravityID(asString(options["targetSessionFile"]))
	if target == "" {
		target = antigravityID(asString(options["resumeSessionFile"]))
	}
	if target == "" {
		workspace.mu.Lock()
		var newest *agSession
		for _, session := range workspace.sessions {
			if newest == nil || session.updatedAt.After(newest.updatedAt) {
				newest = session
			}
		}
		if newest != nil {
			target = newest.id
		}
		workspace.mu.Unlock()
	}
	if target != "" {
		if _, err := h.loadAntigravitySession(workspace, target); err == nil {
			return h.snapshotAntigravity(cwd, "")
		}
		// 列出来的会话加载失败（被 CLI 删了 / 数据损坏）：退回新会话，别把项目卡在错误里。
	}
	if _, err := h.createAntigravitySession(workspace); err != nil {
		h.closeAntigravity(cwd)
		return nil, err
	}
	return h.snapshotAntigravity(cwd, "")
}

func sameAgentCwd(a, b string) bool {
	normalize := func(value string) string {
		value = strings.TrimSpace(value)
		// Antigravity 的 session/list 会把空格编码成 %20（例如 "Pi Desktop"）。
		if decoded, err := url.PathUnescape(value); err == nil {
			value = decoded
		}
		value = strings.TrimPrefix(value, "/")
		value = strings.ReplaceAll(value, "\\", "/")
		value = strings.TrimSuffix(value, "/")
		return strings.ToLower(value)
	}
	return normalize(a) == normalize(b)
}

func (h *Host) createAntigravitySession(workspace *antigravityWorkspace) (*agSession, error) {
	result, err := workspace.client.Call("session/new", map[string]any{
		"cwd": workspace.cwd, "mcpServers": []any{},
	}, 40*time.Second)
	if err != nil {
		return nil, friendlyAgentError(err)
	}
	id := asString(result["sessionId"])
	if id == "" {
		return nil, errors.New("Antigravity 没有返回会话 id")
	}
	session := workspace.ensureSessionLocked(id)
	session.updatedAt = time.Now()
	workspace.configureSession(session, result)
	workspace.mu.Lock()
	workspace.activeID = id
	workspace.mu.Unlock()
	workspace.ensurePreferredModel(session)
	return session, nil
}

func (h *Host) loadAntigravitySession(workspace *antigravityWorkspace, id string) (*agSession, error) {
	workspace.mu.Lock()
	session := workspace.ensureSessionLocked(id)
	session.loading = true
	workspace.mu.Unlock()

	result, err := workspace.client.Call("session/load", map[string]any{
		"sessionId": id, "cwd": workspace.cwd, "mcpServers": []any{},
	}, 60*time.Second)

	workspace.mu.Lock()
	session.loading = false
	if err == nil {
		workspace.flushUserLocked(session)
		workspace.flushAssistantLocked(session, "end_turn")
	}
	session.streaming = false
	session.activeTurns = 0
	workspace.mu.Unlock()
	if err != nil {
		return nil, friendlyAgentError(err)
	}
	workspace.configureSession(session, result)
	workspace.mu.Lock()
	session.updatedAt = time.Now()
	session.listed = true
	workspace.activeID = id
	workspace.mu.Unlock()
	return session, nil
}

func friendlyAgentError(err error) error {
	text := strings.ToLower(err.Error())
	if strings.Contains(text, "login") || strings.Contains(text, "auth") || strings.Contains(text, "credential") || strings.Contains(text, "sign in") {
		return errors.New("Antigravity CLI 还没有登录。请在终端运行 `agy acp --login` 完成 Google 登录，然后重试")
	}
	return err
}

func (h *Host) closeAntigravity(cwd string) {
	h.mu.Lock()
	workspace := h.acpPools[cwd]
	if workspace == nil {
		for key, item := range h.acpPools {
			if samePath(key, cwd) {
				workspace = item
				cwd = key
				break
			}
		}
	}
	if workspace != nil {
		delete(h.acpPools, cwd)
	}
	h.mu.Unlock()
	if workspace == nil {
		return
	}
	workspace.mu.Lock()
	workspace.closed = true
	client := workspace.client
	workspace.mu.Unlock()
	if client != nil {
		client.Stop()
	}
}

func (h *Host) snapshotAntigravity(cwd, sessionFile string) (map[string]any, error) {
	workspace := h.acpWorkspace(cwd)
	if workspace == nil {
		return nil, errors.New("这个工作区还没有启动 Antigravity")
	}
	workspace.mu.Lock()
	session := workspace.sessionLocked(sessionFile)
	if session == nil {
		workspace.mu.Unlock()
		return nil, errors.New("Antigravity 还没有可用会话")
	}
	state := workspace.sessionStateLocked(session)
	messages := append([]any{}, session.messages...)
	models := append([]any{}, session.models...)
	levels := append([]string{}, session.levels...)
	commands := append([]any{}, session.commands...)
	if len(levels) == 0 {
		levels = []string{"low", "medium", "high"}
	}
	sessions := workspace.sessionSummariesLocked()
	workers := workspace.workerStatesLocked()
	activeID := workspace.activeID
	workspace.mu.Unlock()

	if activeID != "" && activeID != session.id {
		workspace.mu.Lock()
		workspace.activeID = session.id
		workspace.mu.Unlock()
	}
	return map[string]any{
		"state": state, "models": models, "levels": levels, "messages": messages,
		"sessions": sessions, "commands": commands, "branch": gitBranch(cwd),
		"workerStates": workers, "agent": agentAntigravity,
		"agentInfo": workspace.agentInfo,
	}, nil
}

// ---------- RPC 映射 ----------

func (h *Host) callAntigravity(cwd, method string, args []any, sessionFile string) (any, error) {
	workspace := h.acpWorkspace(cwd)
	if workspace == nil {
		return nil, errors.New("这个工作区还没有启动 Antigravity")
	}
	workspace.mu.Lock()
	session := workspace.sessionLocked(sessionFile)
	workspace.mu.Unlock()
	if session == nil {
		return nil, errors.New("Antigravity 会话不存在，请重新打开项目")
	}

	switch method {
	case "prompt", "steer", "followUp":
		behavior := ""
		if method == "steer" {
			behavior = "steer"
		} else if method == "followUp" {
			behavior = "followUp"
		} else if len(args) > 2 {
			behavior = asString(args[2])
		}
		return workspace.prompt(session, asString(firstArg(args)), asSlice(argAt(args, 1)), behavior)
	case "abort":
		return workspace.abort(session), nil
	case "clearQueue":
		return workspace.clearQueue(session), nil
	case "newSession":
		created, err := h.createAntigravitySession(workspace)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"cancelled": false, "sessionFile": antigravityFile(created.id),
			"state": workspace.stateOf(created), "sessions": h.sessionsAntigravity(cwd),
			"workerStates": workspace.workerStates(),
		}, nil
	case "switchSession":
		target := antigravityID(asString(firstArg(args)))
		if target == "" {
			return nil, errors.New("未指定要切换的会话")
		}
		workspace.mu.Lock()
		known := workspace.sessions[target]
		needsLoad := known == nil || !known.loaded
		workspace.mu.Unlock()
		if needsLoad {
			if _, err := h.loadAntigravitySession(workspace, target); err != nil {
				return nil, err
			}
		} else {
			workspace.mu.Lock()
			workspace.activeID = target
			workspace.mu.Unlock()
		}
		workspace.mu.Lock()
		session = workspace.sessions[target]
		workspace.mu.Unlock()
		return map[string]any{
			"cancelled": false, "sessionFile": antigravityFile(target),
			"state": workspace.stateOf(session), "reusedWorker": true,
			"workerStates": workspace.workerStates(),
		}, nil
	case "getState":
		return workspace.stateOf(session), nil
	case "getMessages":
		workspace.mu.Lock()
		messages := append([]any{}, session.messages...)
		workspace.mu.Unlock()
		return messages, nil
	case "setModel":
		return workspace.setModel(session, asString(argAt(args, 1)))
	case "getAvailableModels":
		workspace.mu.Lock()
		models := append([]any{}, session.models...)
		workspace.mu.Unlock()
		return models, nil
	case "setThinkingLevel":
		return workspace.setThinking(session, asString(firstArg(args)))
	case "getAvailableThinkingLevels":
		workspace.mu.Lock()
		levels := append([]string{}, session.levels...)
		workspace.mu.Unlock()
		if len(levels) == 0 {
			levels = []string{"low", "medium", "high"}
		}
		return levels, nil
	case "setAutoCompaction", "setAutoRetry", "setSteeringMode", "setFollowUpMode", "setMaxIdleWorkers":
		return map[string]any{}, nil
	case "getSessionStats":
		workspace.mu.Lock()
		stats := workspace.statsLocked(session)
		workspace.mu.Unlock()
		return stats, nil
	case "getCommands":
		workspace.mu.Lock()
		commands := append([]any{}, session.commands...)
		workspace.mu.Unlock()
		return commands, nil
	case "compact":
		return workspace.prompt(session, "/compact", nil, "")
	case "bash":
		command := asString(firstArg(args))
		if strings.TrimSpace(command) == "" {
			return nil, errors.New("命令为空")
		}
		code, output := runShell(command, h.childEnv(), 10*time.Minute)
		return map[string]any{"output": output, "exitCode": code, "cancelled": false, "truncated": false}, nil
	case "abortBash":
		return map[string]any{}, nil
	case "setSessionName":
		return nil, errors.New("Antigravity 的会话名由 CLI 生成，桌面端暂不支持重命名")
	case "fork", "clone", "getTree", "getForkMessages":
		return nil, errors.New("Antigravity 暂不支持这个操作")
	case "exportHtml":
		return nil, errors.New("Antigravity 暂不支持导出 HTML")
	}
	return nil, errors.New("Antigravity 不支持的方法：" + method)
}

func (w *antigravityWorkspace) stateOf(session *agSession) map[string]any {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.sessionStateLocked(session)
}

func (w *antigravityWorkspace) workerStates() []map[string]any {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.workerStatesLocked()
}

func (w *antigravityWorkspace) prompt(session *agSession, text string, images []any, behavior string) (any, error) {
	return w.sendPrompt(session, text, images, behavior, true)
}

// sendPrompt 的 record 表示「这条用户消息是否要写入历史」。
// 排队消息在入队时已经写过一次，真正发出时不能再写，否则对话里会出现两遍。
func (w *antigravityWorkspace) sendPrompt(session *agSession, text string, images []any, behavior string, record bool) (any, error) {
	text = strings.TrimSpace(text)
	if text == "" && len(images) == 0 {
		return nil, errors.New("消息为空")
	}
	w.mu.Lock()
	streaming := session.activeTurns > 0 || session.streaming
	if behavior == "followUp" && streaming {
		session.followUp = append(session.followUp, agQueuedPrompt{text: text, images: images})
		if record && text != "" {
			session.messages = append(session.messages, map[string]any{
				"role": "user", "content": []any{map[string]any{"type": "text", "text": text}},
			})
		}
		queue := w.queueLocked(session)
		w.mu.Unlock()
		w.emit(session, map[string]any{"type": "queue_update", "steering": queue["steering"], "followUp": queue["followUp"]})
		return "queued", nil
	}
	session.activeTurns++
	session.streaming = true
	if record && text != "" {
		session.messages = append(session.messages, map[string]any{
			"role": "user", "content": []any{map[string]any{"type": "text", "text": text}},
		})
	}
	w.mu.Unlock()

	w.emit(session, map[string]any{"type": "agent_start"})
	go w.runPrompt(session, text, images)
	return "started", nil
}

func (w *antigravityWorkspace) runPrompt(session *agSession, text string, images []any) {
	prompt := []any{}
	if text != "" {
		prompt = append(prompt, map[string]any{"type": "text", "text": text})
	}
	prompt = append(prompt, images...)

	result, err := w.client.Call("session/prompt", map[string]any{
		"sessionId": session.id, "prompt": prompt,
	}, acpTurnTimeout)

	w.mu.Lock()
	session.activeTurns--
	if session.activeTurns < 0 {
		session.activeTurns = 0
	}
	var next *agQueuedPrompt
	if err != nil {
		session.streaming = session.activeTurns > 0
		w.flushAssistantLocked(session, "aborted")
		w.mu.Unlock()
		w.emit(session, map[string]any{
			"type": "message_end",
			"message": map[string]any{
				"role": "assistant", "content": []any{}, "stopReason": "error",
				"errorMessage": friendlyAgentError(err).Error(),
			},
		})
		w.emit(session, map[string]any{"type": "agent_settled"})
		return
	}
	usage := mapAcpUsage(asMap(result["usage"]))
	if usage != nil {
		session.usage = usage
		accumulateUsage(session, usage)
	}
	stopReason := asString(result["stopReason"])
	w.flushAssistantLocked(session, mapAcpStopReason(stopReason))
	session.streaming = session.activeTurns > 0
	if !session.streaming && len(session.followUp) > 0 {
		queued := session.followUp[0]
		session.followUp = session.followUp[1:]
		next = &queued
	}
	queue := w.queueLocked(session)
	settled := !session.streaming
	w.mu.Unlock()

	if settled {
		w.emit(session, map[string]any{"type": "agent_settled"})
		w.emit(session, map[string]any{"type": "queue_update", "steering": queue["steering"], "followUp": queue["followUp"]})
	} else {
		w.emit(session, map[string]any{"type": "queue_update", "steering": queue["steering"], "followUp": queue["followUp"]})
	}
	if next != nil {
		if _, err := w.sendPrompt(session, next.text, next.images, "", false); err != nil {
			w.emit(session, map[string]any{"type": "error", "message": err.Error()})
		}
	}
}

func mapAcpStopReason(reason string) string {
	switch reason {
	case "cancelled":
		return "aborted"
	case "max_tokens", "refusal":
		return "error"
	default:
		return "end_turn"
	}
}

func mapAcpUsage(usage map[string]any) map[string]any {
	if len(usage) == 0 {
		return nil
	}
	input := asFloat(usage["inputTokens"])
	output := asFloat(usage["outputTokens"])
	cacheRead := asFloat(usage["cachedReadTokens"])
	cacheWrite := asFloat(usage["cachedWriteTokens"])
	thought := asFloat(usage["thoughtTokens"])
	total := asFloat(usage["totalTokens"])
	if total == 0 {
		total = input + output + cacheRead + cacheWrite + thought
	}
	return map[string]any{
		"input": input, "output": output, "cacheRead": cacheRead,
		"cacheWrite": cacheWrite, "totalTokens": total,
		"reasoning": thought,
	}
}

func accumulateUsage(session *agSession, usage map[string]any) {
	if session.totals == nil {
		session.totals = map[string]float64{}
	}
	session.totals["input"] += asFloat(usage["input"])
	session.totals["output"] += asFloat(usage["output"])
	session.totals["cacheRead"] += asFloat(usage["cacheRead"])
	session.totals["cacheWrite"] += asFloat(usage["cacheWrite"])
	session.totals["total"] += asFloat(usage["totalTokens"])
}

func (w *antigravityWorkspace) abort(session *agSession) map[string]any {
	w.mu.Lock()
	queue := w.queueLocked(session)
	session.steer = nil
	session.followUp = nil
	w.mu.Unlock()
	_ = w.client.Notify("session/cancel", map[string]any{"sessionId": session.id})
	return queue
}

func (w *antigravityWorkspace) clearQueue(session *agSession) map[string]any {
	w.mu.Lock()
	queue := w.queueLocked(session)
	session.steer = nil
	session.followUp = nil
	w.mu.Unlock()
	return queue
}

func (w *antigravityWorkspace) setModel(session *agSession, id string) (any, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, errors.New("未指定模型")
	}
	base, suffix := acpModelBase(id)
	result, err := w.client.Call("session/set_config_option", map[string]any{
		"sessionId": session.id, "configId": "model", "value": base,
	}, 60*time.Second)
	if err != nil {
		return nil, friendlyAgentError(err)
	}
	if suffix != "" {
		if thoughtResult, thoughtErr := w.client.Call("session/set_config_option", map[string]any{
			"sessionId": session.id, "configId": "thought_level", "value": suffix,
		}, 60*time.Second); thoughtErr == nil {
			result = thoughtResult
		} else {
			return nil, friendlyAgentError(thoughtErr)
		}
	}
	w.mu.Lock()
	session.model = base
	if suffix != "" {
		session.thinking = suffix
	}
	w.applyConfigOptionsLocked(session, asSlice(result["configOptions"]))
	state := w.sessionStateLocked(session)
	w.mu.Unlock()
	return state, nil
}

func (w *antigravityWorkspace) setThinking(session *agSession, level string) (any, error) {
	level = strings.TrimSpace(level)
	if level == "" || level == "off" {
		level = "medium"
	}
	result, err := w.client.Call("session/set_config_option", map[string]any{
		"sessionId": session.id, "configId": "thought_level", "value": level,
	}, 60*time.Second)
	if err != nil {
		return nil, friendlyAgentError(err)
	}
	w.mu.Lock()
	session.thinking = level
	w.applyConfigOptionsLocked(session, asSlice(result["configOptions"]))
	state := w.sessionStateLocked(session)
	w.mu.Unlock()
	return state, nil
}

// ---------- 宿主入口 ----------

func (h *Host) AcpRespondPermission(cwd, sessionFile, permissionID, optionID string) error {
	workspace := h.acpWorkspace(cwd)
	if workspace == nil {
		return errors.New("Antigravity 工作区尚未启动")
	}
	id := antigravityID(sessionFile)
	workspace.mu.Lock()
	session := workspace.sessions[id]
	if session == nil {
		session = workspace.sessionLocked(sessionFile)
	}
	var permission *agPermission
	if session != nil {
		permission = session.permissions[permissionID]
		delete(session.permissions, permissionID)
	}
	workspace.mu.Unlock()
	if permission == nil {
		return errors.New("这条权限请求已经失效")
	}
	outcome := map[string]any{"outcome": "selected", "optionId": optionID}
	if strings.TrimSpace(optionID) == "" {
		outcome = map[string]any{"outcome": "cancelled"}
	}
	return workspace.client.Respond(permission.requestID, map[string]any{"outcome": outcome})
}

// AgentFor 返回项目最终会使用的 Agent（项目选择优先，其次新项目默认值）。
func (h *Host) AgentFor(cwd string) string {
	if strings.TrimSpace(cwd) == "" {
		return ""
	}
	return agentKindFor(cwd)
}

// AgentExplicit 只返回项目自己保存的选择，不落默认值。
// 启动恢复用它：用户只设了「新项目默认」但没打开过某个项目时，不该自动拉起进程。
func (h *Host) AgentExplicit(cwd string) string {
	if strings.TrimSpace(cwd) == "" {
		return ""
	}
	kind := readAgentSettings().Projects[normPathKey(cwd)]
	if kind == agentPi || kind == agentAntigravity {
		return kind
	}
	return ""
}

func (h *Host) Agents(cwd string) map[string]any {
	piInfo := AgentLocation{Kind: agentPi, Label: "Pi", Path: "", Version: h.piVersion}
	h.mu.Lock()
	piInfo.Path = ""
	if h.piCmd != nil {
		piInfo.Path = h.piCmd.String()
	}
	customPi := h.piCustomPath
	h.mu.Unlock()
	if located := locatePi(customPi); located.Found {
		piInfo.Found = true
		piInfo.Version = located.Version
		piInfo.Path = located.Path
	} else if piInfo.Path == "" {
		piInfo.Error = located.Error
	}
	antigravity := locateAntigravity("")
	active := ""
	if strings.TrimSpace(cwd) != "" {
		active = agentKindFor(cwd)
	}
	return map[string]any{
		"active":  active,
		"default": agentDefault(),
		"agents": []any{
			map[string]any{
				"kind": agentPi, "label": "Pi", "found": piInfo.Found,
				"version": piInfo.Version, "path": piInfo.Path, "error": piInfo.Error,
				"model": agentModel(agentPi),
			},
			map[string]any{
				"kind": agentAntigravity, "label": antigravityDefault, "found": antigravity.Found,
				"version": antigravity.Version, "path": antigravity.Path, "error": antigravity.Error,
				"model": agentModel(agentAntigravity), "thinking": agentThinking(agentAntigravity),
			},
		},
	}
}

// SetAgentDefault 设置「新项目默认 Agent」，空字符串表示每次询问。
func (h *Host) SetAgentDefault(kind string) error {
	return setAgentDefault(strings.TrimSpace(kind))
}

// AgentModels 返回某个 Agent 可以选择的模型。Pi 的模型是会话级能力，
// 不在这里枚举；Antigravity 的 `agy models` 可以离线列出。
func (h *Host) AgentModels(kind string) ([]map[string]any, error) {
	if kind != agentAntigravity {
		return []map[string]any{}, nil
	}
	exe, _, err := antigravityCommand()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, "models")
	cmd.Env = envListFromMap(h.childEnv())
	hideWindow(cmd)
	prepareProcessGroup(cmd)
	out, err := cmd.Output()
	if err != nil {
		return nil, friendlyAgentError(err)
	}
	seen := map[string]bool{}
	models := []map[string]any{}
	for _, line := range strings.Split(string(out), string(rune(10))) {
		line = strings.TrimSpace(line)
		parts := strings.SplitN(line, string(rune(9)), 2)
		if len(parts) != 2 {
			continue
		}
		id := strings.TrimSpace(parts[0])
		name := strings.TrimSpace(parts[1])
		if id == "" {
			continue
		}
		base, _ := acpModelBase(id)
		if base == "" || seen[base] {
			continue
		}
		seen[base] = true
		models = append(models, map[string]any{"id": base, "name": antigravityModelName(name)})
	}
	if len(models) == 0 {
		return nil, errors.New("没有从 `agy models` 读到模型列表")
	}
	return models, nil
}

func antigravityModelName(name string) string {
	for _, suffix := range []string{" (Low)", " (Medium)", " (High)", " (XHigh)"} {
		name = strings.TrimSuffix(name, suffix)
	}
	return name
}

// SetAgentModel 记住 Antigravity 的默认模型（基础型号，思考档位仍由会话选择）。
func (h *Host) SetAgentModel(kind, model string) error {
	if kind != agentAntigravity {
		return errors.New("Pi 的模型在会话里选择")
	}
	model = strings.TrimSpace(model)
	agentSettingsMu.Lock()
	defer agentSettingsMu.Unlock()
	store := readAgentSettings()
	if model == "" {
		delete(store.Models, kind)
	} else {
		base, _ := acpModelBase(model)
		store.Models[kind] = base
	}
	return writeAgentSettings(store)
}

// SetAgentThinking 记住 Antigravity 新会话的默认思考档位。
func (h *Host) SetAgentThinking(kind, level string) error {
	if kind != agentAntigravity {
		return errors.New("Pi 的思考档位在会话里选择")
	}
	return setAgentThinking(kind, level)
}

// AgentLogin 打开 Antigravity 的 Google 登录流程（agy acp --login）。
func (h *Host) AgentLogin(kind string) (map[string]any, error) {
	if kind != agentAntigravity {
		return nil, errors.New("Pi 的登录请用 pi 的 /login")
	}
	exe, _, err := antigravityCommand()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(exe, "acp", "--login")
	cmd.Env = envListFromMap(h.childEnv())
	hideWindow(cmd)
	prepareProcessGroup(cmd)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	go func() { _ = cmd.Wait() }()
	return map[string]any{"started": true}, nil
}

func (h *Host) SetAgent(cwd, kind string) (map[string]any, error) {
	if kind != agentPi && kind != agentAntigravity {
		return nil, errors.New("未知的 Agent：" + kind)
	}
	if kind == agentPi {
		h.mu.Lock()
		custom := h.piCustomPath
		h.mu.Unlock()
		if location := locatePi(custom); !location.Found {
			return nil, errors.New(firstNonEmpty(location.Error, "没有找到本机 Pi CLI"))
		}
	}
	if kind == agentAntigravity {
		location := locateAntigravity("")
		if !location.Found {
			return nil, errors.New(firstNonEmpty(location.Error, "没有找到本机 Antigravity CLI"))
		}
	}
	authorized, err := h.requireAuthorizedWorkspace(cwd)
	if err != nil {
		return nil, err
	}
	h.mu.Lock()
	pool := h.pools[authorized]
	h.mu.Unlock()
	if pool != nil {
		for _, slot := range pool.workers {
			if slot.busy() {
				return nil, errors.New("这个项目还有任务在运行，请先停止再切换 Agent")
			}
		}
	}
	if workspace := h.acpWorkspace(authorized); workspace != nil {
		workspace.mu.Lock()
		busy := false
		for _, session := range workspace.sessions {
			if session.streaming {
				busy = true
				break
			}
		}
		workspace.mu.Unlock()
		if busy {
			return nil, errors.New("这个项目还有任务在运行，请先停止再切换 Agent")
		}
	}
	if err := setAgentKindFor(authorized, kind); err != nil {
		return nil, err
	}
	h.closeWorkspace(authorized)
	return h.Agents(authorized), nil
}

func (h *Host) LocateAgent(kind, customPath string) map[string]any {
	switch kind {
	case agentAntigravity:
		if err := setAgentCustomPath(agentAntigravity, customPath); err != nil {
			return map[string]any{"found": false, "error": err.Error()}
		}
		location := locateAntigravity("")
		return map[string]any{
			"kind": location.Kind, "label": location.Label, "found": location.Found,
			"version": location.Version, "path": location.Path, "error": location.Error,
		}
	case agentPi:
		h.mu.Lock()
		h.piCustomPath = strings.TrimSpace(customPath)
		h.piCmd = nil
		h.mu.Unlock()
		located := locatePi(customPath)
		return map[string]any{
			"kind": agentPi, "label": "Pi", "found": located.Found,
			"version": located.Version, "path": located.Path, "error": located.Error,
		}
	}
	return map[string]any{"found": false, "error": "未知的 Agent：" + kind}
}

// sessionsAntigravity 返回 Antigravity 的会话列表（每次都重新问 CLI，命令行里新开的会话也能看到）。
func (h *Host) sessionsAntigravity(cwd string) []sessionSummary {
	workspace := h.acpWorkspace(cwd)
	if workspace == nil {
		return []sessionSummary{}
	}
	if result, err := workspace.client.Call("session/list", map[string]any{"cwd": cwd}, 15*time.Second); err == nil {
		workspace.mu.Lock()
		for _, item := range asSlice(result["sessions"]) {
			info := asMap(item)
			id := asString(info["sessionId"])
			if id == "" || !sameAgentCwd(asString(info["cwd"]), cwd) {
				continue
			}
			session := workspace.ensureSessionLocked(id)
			session.listed = true
			session.title = firstNonEmpty(asString(info["title"]), session.title)
			if stamp, err := time.Parse(time.RFC3339, asString(info["updatedAt"])); err == nil {
				session.updatedAt = stamp
			}
		}
		workspace.mu.Unlock()
	}
	workspace.mu.Lock()
	defer workspace.mu.Unlock()
	return workspace.sessionSummariesLocked()
}

// messagePageAntigravity 一次返回 Antigravity 会话的全部历史。
// ACP 没有「按文件分页读取」的接口，session/load 已经把历史回放进内存；
// 这里保持 startIndex=0，界面就不会再向上翻页（不会有「看起来还有更早消息」的死循环）。
func (h *Host) messagePageAntigravity(cwd, file string, endIndex, limit int) (map[string]any, error) {
	workspace := h.acpWorkspace(cwd)
	if workspace == nil {
		return nil, errors.New("这个工作区还没有启动 Antigravity")
	}
	workspace.mu.Lock()
	session := workspace.sessionLocked(file)
	if session == nil {
		workspace.mu.Unlock()
		return nil, errors.New("Antigravity 会话不存在")
	}
	messages := append([]any{}, session.messages...)
	workspace.mu.Unlock()
	return map[string]any{
		"messages": messages, "startIndex": 0, "total": len(messages),
	}, nil
}
