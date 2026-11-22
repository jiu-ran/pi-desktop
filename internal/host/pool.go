package host

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

const (
	startTimeout    = 25 * time.Second
	snapshotTimeout = 15 * time.Second
)

type workerSlot struct {
	mu          sync.Mutex
	client      *PiRpcClient
	sessionFile string
	streaming   bool
	compacting  bool
	bashRunning bool
	lastState   map[string]any
}

func (s *workerSlot) setStreaming(value bool) {
	s.mu.Lock()
	s.streaming = value
	s.mu.Unlock()
}

func (s *workerSlot) setCompacting(value bool) {
	s.mu.Lock()
	s.compacting = value
	s.mu.Unlock()
}

func (s *workerSlot) setSessionFile(file string) {
	s.mu.Lock()
	s.sessionFile = file
	s.mu.Unlock()
}

func (s *workerSlot) applyState(state map[string]any, keepExistingFile bool) string {
	file := asString(state["sessionFile"])
	s.mu.Lock()
	if !keepExistingFile || file != "" {
		s.sessionFile = file
	}
	s.streaming = asBool(state["isStreaming"])
	s.compacting = asBool(state["isCompacting"])
	s.lastState = state
	out := s.sessionFile
	s.mu.Unlock()
	return out
}

func (s *workerSlot) sessionPath() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessionFile
}

func (s *workerSlot) snapshotInfo() (string, map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessionFile, s.lastState
}

func (s *workerSlot) busy() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.streaming || s.compacting || s.bashRunning
}

func (s *workerSlot) stateFields() (string, bool, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessionFile, s.streaming, s.compacting
}

type workspacePool struct {
	mu                sync.Mutex
	client            *PiRpcClient
	activeSessionFile string
	workers           map[string]*workerSlot
	standby           *workerSlot
}

func newPool() *workspacePool {
	return &workspacePool{workers: map[string]*workerSlot{}}
}

func (p *workspacePool) workerStates() []map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := []map[string]any{}
	for _, slot := range p.workers {
		file, streaming, compacting := slot.stateFields()
		out = append(out, map[string]any{"sessionFile": file, "streaming": streaming, "compacting": compacting})
	}
	return out
}

func (h *Host) emitPi(cwd, sessionFile string, event map[string]any) {
	payload := map[string]any{"cwd": cwd, "event": event}
	if sessionFile != "" {
		payload["sessionFile"] = sessionFile
	}
	h.mu.Lock()
	win := h.win
	h.mu.Unlock()
	if win != nil {
		if err := PiEvent.Emit(win, payload); err == nil {
			return
		}
	}
	_ = PiEvent.Broadcast(payload)
}

// ---------- 授权 ----------

func (h *Host) authorizeWorkspace(cwd string) (string, error) {
	if strings.TrimSpace(cwd) == "" {
		return "", errors.New("项目目录无效")
	}
	abs, err := filepath.Abs(cwd)
	if err != nil {
		return "", errors.New("项目目录无效")
	}
	canonical, err := realPath(abs)
	if err != nil {
		return "", errors.New("项目目录无效")
	}
	info, err := os.Stat(canonical)
	if err != nil || !info.IsDir() {
		return "", errors.New("项目目录无效")
	}
	h.mu.Lock()
	h.authorized[normPathKey(canonical)] = canonical
	h.mu.Unlock()
	return canonical, nil
}

func (h *Host) requireAuthorizedWorkspace(cwd string) (string, error) {
	if strings.TrimSpace(cwd) == "" {
		return "", errors.New("项目目录无效")
	}
	abs, _ := filepath.Abs(cwd)
	canonical, err := realPath(abs)
	if err != nil {
		return "", errors.New("项目目录无效")
	}
	h.mu.Lock()
	registered, ok := h.authorized[normPathKey(canonical)]
	h.mu.Unlock()
	if !ok {
		return "", errors.New("项目目录尚未获得授权")
	}
	return registered, nil
}

func (h *Host) revokeWorkspace(cwd string) {
	h.mu.Lock()
	delete(h.authorized, normPathKey(cwd))
	h.mu.Unlock()
}

func (h *Host) authorizedAttachmentPaths(paths []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, path := range paths {
		if strings.TrimSpace(path) != "" && filepath.IsAbs(path) {
			abs, _ := filepath.Abs(path)
			h.attachments[normPathKey(abs)] = abs
		}
	}
}

// ---------- Pi 命令 ----------

func (h *Host) piCommand() (PiCommand, error) {
	h.mu.Lock()
	if h.piCmd != nil {
		cmd := *h.piCmd
		h.mu.Unlock()
		return cmd, nil
	}
	custom := h.piCustomPath
	h.mu.Unlock()
	command, located, err := resolvePiCommand(custom)
	if err != nil {
		// 这条以前只往界面里抛，pi.log 里什么都没有，用户只能看到一个红点。
		logPi("error", "pi", "无法启动 Pi："+err.Error())
		return PiCommand{}, err
	}
	logPi("info", "pi", "Pi 启动命令："+command.String()+"（来源："+firstNonEmpty(located.Source, "PATH")+"，路径："+located.Path+"）")
	h.mu.Lock()
	h.piCmd = &command
	h.piVersion = located.Version
	h.mu.Unlock()
	return command, nil
}

func (h *Host) invalidatePiEntry() {
	h.mu.Lock()
	h.piCmd = nil
	h.mu.Unlock()
}

// ---------- 启动 / 停止 ----------

func (h *Host) open(cwd string, options map[string]any) (map[string]any, error) {
	authorized, err := h.requireAuthorizedWorkspace(cwd)
	if err != nil {
		return nil, err
	}
	cwd = authorized

	h.mu.Lock()
	if h.closing {
		h.mu.Unlock()
		return nil, errors.New("Pi 宿主正在关闭")
	}
	_, hasPool := h.pools[cwd]
	attempt, starting := h.starting[cwd]
	gen := h.startGen[cwd]
	if !hasPool && !starting {
		attempt = &startAttempt{done: make(chan struct{})}
		h.starting[cwd] = attempt
		h.mu.Unlock()
		go func() {
			err := h.startWorkspace(cwd, gen)
			attempt.err = err
			close(attempt.done)
			h.mu.Lock()
			if h.starting[cwd] == attempt {
				delete(h.starting, cwd)
			}
			h.mu.Unlock()
		}()
	} else {
		h.mu.Unlock()
	}

	if !hasPool {
		select {
		case <-attempt.done:
			if attempt.err != nil {
				h.discardWorkspace(cwd)
				return nil, attempt.err
			}
		case <-time.After(startTimeout):
			h.mu.Lock()
			if h.starting[cwd] == attempt {
				delete(h.starting, cwd)
			}
			h.startGen[cwd]++
			h.mu.Unlock()
			h.discardWorkspace(cwd)
			return nil, errors.New("启动 Pi 超时（25s）：会话进程没有响应，请重试")
		}
	}
	return h.snapshotWithTimeout(cwd, "")
}

func (h *Host) snapshotWithTimeout(cwd, sessionFile string) (map[string]any, error) {
	type result struct {
		data map[string]any
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		data, err := h.snapshot(cwd, sessionFile)
		ch <- result{data, err}
	}()
	select {
	case item := <-ch:
		return item.data, item.err
	case <-time.After(snapshotTimeout):
		return nil, errors.New("读取会话状态超时，请重试")
	}
}

func (h *Host) startWorkspace(cwd string, gen int) error {
	pool := newPool()
	if _, err := h.spawnWorker(cwd, pool, nil); err != nil {
		return err
	}
	h.mu.Lock()
	stale := h.startGen[cwd] != gen
	if !stale {
		h.pools[cwd] = pool
	}
	h.mu.Unlock()
	if stale {
		pool.mu.Lock()
		clients := make([]*PiRpcClient, 0, len(pool.workers))
		for _, slot := range pool.workers {
			clients = append(clients, slot.client)
		}
		pool.workers = map[string]*workerSlot{}
		pool.mu.Unlock()
		for _, client := range clients {
			_ = client.Stop()
		}
		return errors.New("启动已取消")
	}
	return nil
}

func (h *Host) spawnWorker(cwd string, pool *workspacePool, options map[string]any) (*workerSlot, error) {
	command, err := h.piCommand()
	if err != nil {
		return nil, err
	}
	client := NewPiRpcClient(command, cwd, h.childEnv(), toolArgs(cwd))
	slot := &workerSlot{client: client}
	client.OnEvent(func(event map[string]any) {
		switch asString(event["type"]) {
		case "agent_start":
			slot.setStreaming(true)
		case "agent_settled":
			slot.setStreaming(false)
			h.pruneIdleWorkers(pool)
		case "compaction_start":
			slot.setCompacting(true)
			logPi("info", "compaction", "开始压缩上下文")
		case "compaction_end":
			slot.setCompacting(false)
			h.pruneIdleWorkers(pool)
			logPi("info", "compaction", "压缩结束")
		}
		file, _, _ := slot.stateFields()
		if file != "" {
			h.emitPi(cwd, file, event)
		}
	})
	if err := client.Start(); err != nil {
		return nil, err
	}
	state, err := client.GetState()
	if err != nil {
		_ = client.Stop()
		return nil, err
	}
	initialFile := asString(state["sessionFile"])
	logPi("info", "worker", "已启动 "+cwd+" · "+filepath.Base(firstNonEmpty(initialFile, "(新会话)")))

	if target := asString(options["targetSessionFile"]); target != "" {
		if normPathKey(initialFile) != normPathKey(target) {
			if _, switchErr := client.SwitchSession(target); switchErr != nil {
				if !isBrokenSessionError(switchErr) {
					_ = client.Stop()
					return nil, switchErr
				}
				logWarn("session", "会话文件无法加载，改用新会话："+filepath.Base(target))
			}
			state, err = client.GetState()
			if err != nil {
				_ = client.Stop()
				return nil, err
			}
		}
	} else if parent := asString(options["parentSession"]); parent != "" {
		if _, newErr := client.NewSession(parent); newErr != nil {
			_ = client.Stop()
			return nil, newErr
		}
		state, err = client.GetState()
		if err != nil {
			_ = client.Stop()
			return nil, err
		}
	}

	sessionFile := slot.applyState(state, false)
	pool.mu.Lock()
	if sessionFile != "" {
		pool.workers[normPathKey(sessionFile)] = slot
	}
	pool.client = slot.client
	pool.activeSessionFile = sessionFile
	pool.mu.Unlock()
	h.pruneIdleWorkers(pool)
	return slot, nil
}

func isBrokenSessionError(err error) bool {
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "not a valid pi session") || strings.Contains(text, "invalid session file") || strings.Contains(text, "无法读取会话")
}

func (h *Host) discardWorkspace(cwd string) {
	key := h.resolvePoolKey(cwd)
	h.mu.Lock()
	pool := h.pools[key]
	delete(h.pools, key)
	h.mu.Unlock()
	if pool == nil {
		return
	}
	pool.mu.Lock()
	clients := []*PiRpcClient{}
	for _, slot := range pool.workers {
		clients = append(clients, slot.client)
	}
	pool.workers = map[string]*workerSlot{}
	if pool.standby != nil {
		clients = append(clients, pool.standby.client)
		pool.standby = nil
	}
	pool.mu.Unlock()
	for _, client := range clients {
		_ = client.Stop()
	}
}

func (h *Host) resolvePoolKey(cwd string) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.pools[cwd]; ok {
		return cwd
	}
	registered := h.authorized[normPathKey(cwd)]
	if registered != "" {
		if _, ok := h.pools[registered]; ok {
			return registered
		}
	}
	for key := range h.pools {
		if samePath(key, cwd) {
			return key
		}
	}
	if registered != "" {
		return registered
	}
	return cwd
}

func (h *Host) requirePool(cwd string) *workspacePool {
	key := h.resolvePoolKey(cwd)
	h.mu.Lock()
	pool := h.pools[key]
	h.mu.Unlock()
	return pool
}

func (h *Host) resolveSlot(cwd, sessionFile string) (*workerSlot, error) {
	pool := h.requirePool(cwd)
	if pool == nil {
		return nil, errors.New("这个工作区还没有启动 Pi")
	}
	pool.mu.Lock()
	defer pool.mu.Unlock()
	if sessionFile != "" {
		if slot := pool.workers[normPathKey(sessionFile)]; slot != nil {
			return slot, nil
		}
		return nil, fmt.Errorf("未知的会话文件：%s", filepath.Base(sessionFile))
	}
	if slot := pool.workers[normPathKey(pool.activeSessionFile)]; slot != nil {
		return slot, nil
	}
	for _, slot := range pool.workers {
		return slot, nil
	}
	return nil, errors.New("当前工作区没有可用的会话 Worker")
}

func (h *Host) findIdleSlot(pool *workspacePool) *workerSlot {
	pool.mu.Lock()
	defer pool.mu.Unlock()
	if slot := pool.workers[normPathKey(pool.activeSessionFile)]; slot != nil && !slot.busy() {
		return slot
	}
	for _, slot := range pool.workers {
		if !slot.busy() {
			return slot
		}
	}
	return nil
}

func (h *Host) pruneIdleWorkers(pool *workspacePool) {
	h.mu.Lock()
	maxIdle := h.maxIdleWorkers
	h.mu.Unlock()
	pool.mu.Lock()
	defer pool.mu.Unlock()
	activeKey := normPathKey(pool.activeSessionFile)
	var idle []struct {
		key  string
		slot *workerSlot
	}
	for key, slot := range pool.workers {
		if key != activeKey && !slot.busy() {
			idle = append(idle, struct {
				key  string
				slot *workerSlot
			}{key, slot})
		}
	}
	for len(idle) > maxIdle {
		oldest := idle[0]
		idle = idle[1:]
		delete(pool.workers, oldest.key)
		if pool.client == oldest.slot.client {
			for _, remaining := range pool.workers {
				pool.client = remaining.client
				break
			}
		}
		go oldest.slot.client.Stop()
	}
}

// ---------- 快照 ----------

// rpcMessagesNeeded 判断快照要不要向 pi 要整份消息：只有当会话文件不存在或为空
// （刚新建、还没落盘）时才需要，其余情况界面会从文件分页读。
func rpcMessagesNeeded(file string) bool {
	if strings.TrimSpace(file) == "" {
		return true
	}
	info, err := os.Stat(file)
	if err != nil || info.IsDir() {
		return true
	}
	return info.Size() == 0
}

func (h *Host) snapshot(cwd, sessionFile string) (map[string]any, error) {
	cwd = h.resolvePoolKey(cwd)
	slot, err := h.resolveSlot(cwd, sessionFile)
	if err != nil {
		return nil, err
	}
	client := slot.client
	state, err := client.GetState()
	if err != nil {
		return nil, err
	}
	pool := h.requirePool(cwd)
	if pool == nil {
		return nil, errors.New("这个工作区已关闭")
	}
	oldFile := slot.sessionPath()
	currentFile := slot.applyState(state, true)
	pool.mu.Lock()
	if file := asString(state["sessionFile"]); file != "" {
		oldKey := normPathKey(oldFile)
		newKey := normPathKey(file)
		if oldKey != "" && oldKey != newKey {
			delete(pool.workers, oldKey)
		}
		pool.workers[newKey] = slot
	}
	keep := []string{currentFile}
	for _, worker := range pool.workers {
		file, _, _ := worker.stateFields()
		keep = append(keep, file)
	}
	pool.mu.Unlock()

	models, modelsErr := client.GetAvailableModels()
	if modelsErr != nil {
		models = []any{}
	}
	levels, levelsErr := client.GetAvailableThinkingLevels()
	if levelsErr != nil {
		levels = []any{}
	}
	// 快照里的 messages 只在首屏用一次：界面拿到快照后立刻用 messagePage 从会话文件
	// 分页补齐（applySnapshot → hydrateHistory）。所以文件里已有历史时，不必再让 pi
	// 把整份消息（含图片 base64）序列化一遍再传回来 —— 128 MB 的会话光这一趟就十几秒。
	messages := []any{}
	if rpcMessagesNeeded(currentFile) {
		if value, messagesErr := client.GetMessages(); messagesErr == nil {
			messages = value
		}
	}
	commands, commandsErr := client.GetCommands()
	if commandsErr != nil {
		commands = []any{}
	}
	branch := gitBranch(cwd)
	return map[string]any{
		"state":        state,
		"models":       models,
		"levels":       levels,
		"messages":     messages,
		"sessions":     listSessions(cwd, keep...),
		"commands":     commands,
		"branch":       branch,
		"workerStates": pool.workerStates(),
	}, nil
}

// ---------- call ----------

var allowedRpcMethods = map[string]bool{
	"prompt": true, "steer": true, "followUp": true, "abort": true, "clearQueue": true,
	"newSession": true, "switchSession": true, "getState": true, "getMessages": true,
	"setModel": true, "getAvailableModels": true, "setThinkingLevel": true, "getAvailableThinkingLevels": true,
	"setAutoCompaction": true, "setAutoRetry": true, "setSteeringMode": true, "setFollowUpMode": true,
	"setMaxIdleWorkers": true, "compact": true, "getSessionStats": true, "getCommands": true,
	"getTree": true, "fork": true, "setSessionName": true, "clone": true, "getForkMessages": true,
	"getLastAssistantText": true, "exportHtml": true, "bash": true, "abortBash": true,
}

func (h *Host) call(cwd, method string, args []any, sessionFile string) (any, error) {
	cwd = h.resolvePoolKey(cwd)
	if !allowedRpcMethods[method] {
		return nil, errors.New("不允许的 RPC 方法：" + method)
	}
	if method == "setMaxIdleWorkers" {
		if h.requirePool(cwd) == nil {
			return nil, errors.New("这个工作区还没有启动 Pi")
		}
		limit := int(asFloat(firstArg(args)))
		if limit < 1 {
			limit = 1
		}
		if limit > 8 {
			limit = 8
		}
		h.mu.Lock()
		h.maxIdleWorkers = limit
		h.mu.Unlock()
		for _, pool := range h.allPools() {
			h.pruneIdleWorkers(pool)
		}
		return map[string]any{"maxIdleWorkers": limit}, nil
	}

	pool := h.requirePool(cwd)
	if pool == nil {
		return nil, errors.New("这个工作区还没有启动 Pi")
	}

	switch method {
	case "switchSession":
		return h.switchSession(cwd, pool, asString(firstArg(args)))
	case "newSession":
		parent := ""
		if len(args) > 0 {
			parent = asString(args[0])
		}
		return h.newSession(cwd, pool, parent)
	}

	slot, err := h.resolveSlot(cwd, sessionFile)
	if err != nil {
		return nil, err
	}
	client := slot.client

	switch method {
	case "prompt":
		slot.mu.Lock()
		wasStreaming := slot.streaming
		slot.streaming = true
		slot.mu.Unlock()
		var callArgs []any
		for _, arg := range args {
			if arg == nil {
				callArgs = append(callArgs, nil)
			} else {
				callArgs = append(callArgs, arg)
			}
		}
		disposition, err := client.Prompt(asString(firstArg(callArgs)), argAt(callArgs, 1), argAt(callArgs, 2))
		if err != nil {
			slot.mu.Lock()
			slot.streaming = wasStreaming
			slot.mu.Unlock()
			return nil, err
		}
		if disposition == "handled" {
			slot.mu.Lock()
			slot.streaming = wasStreaming
			slot.mu.Unlock()
		}
		return disposition, nil
	case "compact":
		return h.compact(client, args)
	case "fork", "clone":
		oldFile, _, _ := slot.stateFields()
		result, err := client.Call(method, args...)
		if err != nil {
			return nil, err
		}
		if obj := asMap(result); asBool(obj["cancelled"]) {
			return result, nil
		}
		state, err := client.GetState()
		if err == nil {
			nextFile := slot.applyState(state, false)
			pool.mu.Lock()
			if oldFile != "" {
				delete(pool.workers, normPathKey(oldFile))
			}
			if nextFile != "" {
				pool.workers[normPathKey(nextFile)] = slot
			}
			pool.client = client
			pool.activeSessionFile = nextFile
			pool.mu.Unlock()
		}
		return result, nil
	case "bash":
		slot.mu.Lock()
		if slot.bashRunning {
			slot.mu.Unlock()
			return nil, errors.New("这个会话已有命令在运行，先停止它再执行新的命令")
		}
		slot.bashRunning = true
		slot.mu.Unlock()
		defer func() {
			slot.mu.Lock()
			slot.bashRunning = false
			slot.mu.Unlock()
		}()
		requestID := asString(argAt(args, 2))
		return client.Bash(asString(firstArg(args)), asBool(argAt(args, 1)), requestID)
	}
	return client.Call(method, args...)
}

func firstArg(args []any) any {
	if len(args) == 0 {
		return nil
	}
	return args[0]
}

func argAt(args []any, index int) any {
	if index < 0 || index >= len(args) {
		return nil
	}
	return args[index]
}

func (h *Host) allPools() []*workspacePool {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]*workspacePool, 0, len(h.pools))
	for _, pool := range h.pools {
		out = append(out, pool)
	}
	return out
}

func (h *Host) switchSession(cwd string, pool *workspacePool, targetFile string) (any, error) {
	if targetFile == "" {
		return nil, errors.New("未指定要切换的会话文件")
	}
	if _, err := assertSessionFile(cwd, targetFile); err != nil {
		owner := filepath.Base(filepath.Dir(targetFile))
		return nil, fmt.Errorf("这个会话属于另一个项目（%s），请从左侧对应的项目里打开", owner)
	}
	pool.mu.Lock()
	existing := pool.workers[normPathKey(targetFile)]
	pool.mu.Unlock()
	if existing != nil {
		existingFile := existing.sessionPath()
		pool.mu.Lock()
		pool.client = existing.client
		pool.activeSessionFile = existingFile
		pool.mu.Unlock()
		return map[string]any{
			"cancelled": false, "sessionFile": existingFile, "reusedWorker": true,
			"workerStates": pool.workerStates(),
		}, nil
	}
	idle := h.findIdleSlot(pool)
	if idle != nil {
		oldFile, _, _ := idle.stateFields()
		result, err := idle.client.SwitchSession(targetFile)
		if err != nil {
			if isBrokenSessionError(err) {
				h.discardSlot(cwd, pool, idle)
				return nil, fmt.Errorf("这个会话文件读不出来（可能已损坏或被其它工具改写过）：%s。文件已保留，换一个会话或新建会话即可继续。", filepath.Base(targetFile))
			}
			return nil, err
		}
		if asBool(result["cancelled"]) {
			return result, nil
		}
		pool.mu.Lock()
		if oldFile != "" {
			delete(pool.workers, normPathKey(oldFile))
		}
		pool.mu.Unlock()
		if oldFile != "" && isKnownEmptySession(oldFile) {
			_ = os.Remove(oldFile)
		}
		state, err := idle.client.GetState()
		if err != nil {
			return nil, err
		}
		idleFile := idle.applyState(state, false)
		pool.mu.Lock()
		pool.workers[normPathKey(idleFile)] = idle
		pool.client = idle.client
		pool.activeSessionFile = idleFile
		pool.mu.Unlock()
		response := map[string]any{}
		for key, value := range result {
			response[key] = value
		}
		response["sessionFile"] = idleFile
		response["state"] = state
		response["workerStates"] = pool.workerStates()
		return response, nil
	}
	spawned, err := h.spawnWorker(cwd, pool, map[string]any{"targetSessionFile": targetFile})
	if err != nil {
		return nil, err
	}
	spawnedFile, spawnedState := spawned.snapshotInfo()
	return map[string]any{
		"cancelled": false, "sessionFile": spawnedFile, "state": spawnedState,
		"workerStates": pool.workerStates(),
	}, nil
}

func (h *Host) newSession(cwd string, pool *workspacePool, parent string) (any, error) {
	idle := h.findIdleSlot(pool)
	if idle != nil {
		oldFile, _, _ := idle.stateFields()
		result, err := idle.client.NewSession(parent)
		if err != nil {
			return nil, err
		}
		if asBool(result["cancelled"]) {
			return result, nil
		}
		pool.mu.Lock()
		if oldFile != "" {
			delete(pool.workers, normPathKey(oldFile))
		}
		pool.mu.Unlock()
		if oldFile != "" && isKnownEmptySession(oldFile) {
			_ = os.Remove(oldFile)
		}
		state, err := idle.client.GetState()
		if err != nil {
			return nil, err
		}
		idleFile := idle.applyState(state, false)
		pool.mu.Lock()
		if idleFile != "" {
			pool.workers[normPathKey(idleFile)] = idle
		}
		pool.client = idle.client
		pool.activeSessionFile = idleFile
		pool.mu.Unlock()
		response := map[string]any{}
		for key, value := range result {
			response[key] = value
		}
		response["sessionFile"] = idleFile
		response["state"] = state
		response["sessions"] = listSessions(cwd)
		response["workerStates"] = pool.workerStates()
		return response, nil
	}
	spawned, err := h.spawnWorker(cwd, pool, map[string]any{"parentSession": parent})
	if err != nil {
		return nil, err
	}
	spawnedFile, spawnedState := spawned.snapshotInfo()
	return map[string]any{
		"cancelled": false, "sessionFile": spawnedFile, "state": spawnedState,
		"sessions": listSessions(cwd), "workerStates": pool.workerStates(),
	}, nil
}

func (h *Host) discardSlot(cwd string, pool *workspacePool, slot *workerSlot) {
	pool.mu.Lock()
	for key, item := range pool.workers {
		if item == slot {
			delete(pool.workers, key)
		}
	}
	if pool.client == slot.client {
		for _, remaining := range pool.workers {
			pool.client = remaining.client
			break
		}
	}
	pool.mu.Unlock()
	_ = slot.client.Stop()
}

func (h *Host) compact(client *PiRpcClient, args []any) (any, error) {
	instructions := asString(firstArg(args))
	done := make(chan struct{}, 1)
	off := client.OnEvent(func(event map[string]any) {
		if asString(event["type"]) == "compaction_end" {
			select {
			case done <- struct{}{}:
			default:
			}
		}
	})
	defer off()
	value, err := client.Call("compact", instructions)
	if err == nil {
		return value, nil
	}
	var timeoutErr *RpcTimeoutError
	if !errors.As(err, &timeoutErr) || timeoutErr.Method != "compact" {
		return nil, err
	}
	select {
	case <-done:
		return map[string]any{"slow": true}, nil
	case <-time.After(10 * time.Minute):
		return nil, errors.New("压缩上下文超时（10 分钟没结束）：压缩可能仍在后台进行，稍后刷新会话即可看到结果")
	}
}

// ---------- 其他会话操作 ----------

func (h *Host) sessions(cwd string) []sessionSummary {
	cwd = h.resolvePoolKey(cwd)
	pool := h.requirePool(cwd)
	if pool == nil {
		return listSessions(cwd)
	}
	pool.mu.Lock()
	keep := []string{pool.activeSessionFile}
	for _, slot := range pool.workers {
		file, _, _ := slot.stateFields()
		keep = append(keep, file)
	}
	pool.mu.Unlock()
	return listSessions(cwd, keep...)
}

func (h *Host) messagePage(cwd, file string, endIndex, limit, minTurns, minBlocks int) (map[string]any, error) {
	if _, err := assertReadableSessionFile(cwd, file); err != nil {
		return nil, errors.New("读取会话历史失败: " + err.Error())
	}
	return readSessionHistoryPage(file, endIndex, limit, minTurns, minBlocks), nil
}

func (h *Host) deleteSession(cwd, file string) ([]sessionSummary, error) {
	cwd = h.resolvePoolKey(cwd)
	target, err := assertSessionFile(cwd, file)
	if err != nil {
		return nil, err
	}
	targetKey := normPathKey(target)
	pool := h.requirePool(cwd)
	if pool != nil {
		pool.mu.Lock()
		slot := pool.workers[targetKey]
		pool.mu.Unlock()
		if slot != nil {
			state, _ := slot.client.GetState()
			streaming := asBool(state["isStreaming"]) || slot.busy()
			if streaming {
				return nil, errors.New("任务正在运行，请先停止再删除")
			}
			pool.mu.Lock()
			_, exists := pool.workers[targetKey]
			pool.mu.Unlock()
			if exists && len(pool.workers) > 1 {
				pool.mu.Lock()
				delete(pool.workers, targetKey)
				if normPathKey(pool.activeSessionFile) == targetKey {
					for _, next := range pool.workers {
						pool.client = next.client
						pool.activeSessionFile = next.sessionPath()
						break
					}
				}
				pool.mu.Unlock()
				_ = slot.client.Stop()
			} else {
				var next *sessionSummary
				for _, item := range listSessions(cwd) {
					if !item.Empty && normPathKey(item.Path) != targetKey {
						copy := item
						next = &copy
						break
					}
				}
				if next != nil {
					if _, err := slot.client.SwitchSession(next.Path); err != nil {
						return nil, err
					}
				} else if _, err := slot.client.NewSession(""); err != nil {
					return nil, err
				}
				state, err := slot.client.GetState()
				if err != nil {
					return nil, err
				}
				nextFile := slot.applyState(state, false)
				pool.mu.Lock()
				delete(pool.workers, targetKey)
				if nextFile != "" {
					pool.workers[normPathKey(nextFile)] = slot
				}
				pool.client = slot.client
				pool.activeSessionFile = nextFile
				pool.mu.Unlock()
			}
		}
	}
	if err := trashFile(target); err != nil {
		return nil, err
	}
	clearSessionHistoryCache(target)
	return h.sessions(cwd), nil
}

func trashFile(file string) error {
	if err := mygo.Shell.TrashItem(file); err != nil {
		return fmt.Errorf("无法移入回收站：%w", err)
	}
	return nil
}

func (h *Host) deleteAllSessions(cwd string) (map[string]any, error) {
	cwd = h.resolvePoolKey(cwd)
	if h.requirePool(cwd) != nil {
		return nil, errors.New("请先关闭该项目的 Pi 进程")
	}
	items := listSessions(cwd)
	deleted, failed := 0, 0
	for _, item := range items {
		target, err := assertSessionFile(cwd, item.Path)
		if err != nil || trashFile(target) != nil {
			failed++
		} else {
			deleted++
		}
	}
	return map[string]any{"deleted": deleted, "failed": failed}, nil
}

func (h *Host) restart(cwd, sessionFile string) (map[string]any, error) {
	cwd = h.resolvePoolKey(cwd)
	pool := h.requirePool(cwd)
	target := sessionFile
	if target == "" && pool != nil {
		pool.mu.Lock()
		target = pool.activeSessionFile
		pool.mu.Unlock()
	}
	if pool != nil {
		pool.mu.Lock()
		slot := pool.workers[normPathKey(target)]
		count := len(pool.workers)
		pool.mu.Unlock()
		if slot != nil && count > 1 {
			pool.mu.Lock()
			delete(pool.workers, normPathKey(target))
			pool.mu.Unlock()
			_ = slot.client.Stop()
			replacement, err := h.spawnWorker(cwd, pool, map[string]any{"targetSessionFile": target})
			if err != nil {
				return nil, err
			}
			return h.snapshot(cwd, replacement.sessionPath())
		}
		h.discardWorkspace(cwd)
	}
	if _, err := h.open(cwd, nil); err != nil {
		return nil, err
	}
	if target != "" {
		_, _ = h.call(cwd, "switchSession", []any{target}, "")
	}
	return h.snapshot(cwd, target)
}

func (h *Host) closeWorkspace(cwd string) bool {
	cwd = h.resolvePoolKey(cwd)
	h.mu.Lock()
	_, exists := h.pools[cwd]
	h.mu.Unlock()
	if !exists {
		return false
	}
	h.discardWorkspace(cwd)
	return true
}

func (h *Host) stopAll() {
	h.mu.Lock()
	h.closing = true
	pools := h.pools
	h.pools = map[string]*workspacePool{}
	h.mu.Unlock()
	var stopping sync.WaitGroup
	for _, pool := range pools {
		pool.mu.Lock()
		clients := []*PiRpcClient{}
		for _, slot := range pool.workers {
			clients = append(clients, slot.client)
		}
		if pool.standby != nil {
			clients = append(clients, pool.standby.client)
		}
		pool.workers = map[string]*workerSlot{}
		pool.standby = nil
		pool.mu.Unlock()
		for _, client := range clients {
			// 并发停：每个客户端要等 Pi 自己退（关闭 stdin 后的短暂宽限），
			// 串起来会让退出变慢
			stopping.Add(1)
			go func(target *PiRpcClient) {
				defer stopping.Done()
				_ = target.Stop()
			}(client)
		}
	}
	stopping.Wait()
}

func (h *Host) respondExtensionUI(cwd string, response map[string]any, sessionFile string) error {
	slot, err := h.resolveSlot(cwd, sessionFile)
	if err != nil {
		return err
	}
	payload := map[string]any{"type": "extension_ui_response", "id": asString(response["id"])}
	if asBool(response["cancelled"]) {
		payload["cancelled"] = true
	} else if _, ok := response["confirmed"]; ok {
		payload["confirmed"] = asBool(response["confirmed"])
	} else {
		payload["value"] = response["value"]
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return slot.client.WriteRaw(string(data) + "\n")
}

// ---------- 附件 ----------

func (h *Host) prepareAttachments(cwd string, paths, authorize []string) (map[string]any, error) {
	h.authorizedAttachmentPaths(authorize)
	if len(paths) > 20 {
		return nil, errors.New("一次最多添加 20 个文件或文件夹")
	}
	root, _, err := workspacePath(cwd, "")
	if err != nil {
		return nil, err
	}
	if err := assertRealWorkspacePath(cwd, root, false); err != nil {
		return nil, err
	}
	items := []map[string]any{}
	texts := []string{}
	images := []map[string]any{}
	for _, target := range paths {
		if strings.TrimSpace(target) == "" {
			continue
		}
		resolved, _ := filepath.Abs(target)
		inside := resolved == root || within(root, resolved)
		if !inside {
			h.mu.Lock()
			_, authorized := h.attachments[normPathKey(resolved)]
			h.mu.Unlock()
			if !authorized {
				return nil, errors.New("附件必须位于当前项目目录内，或由系统文件选择器授权")
			}
		} else if err := assertRealWorkspacePath(cwd, resolved, false); err != nil {
			return nil, err
		}
		item, err := prepareAttachment(resolved)
		if err != nil {
			return nil, err
		}
		items = append(items, item.publicMap())
		texts = append(texts, item.Text)
		if item.Image {
			images = append(images, map[string]any{"type": "image", "mimeType": item.MimeType, "data": item.Data})
		}
	}
	return map[string]any{"items": items, "text": strings.Join(texts, ""), "images": images}, nil
}

func (h *Host) prepareSessionAttachments(cwd string, files []string) (map[string]any, error) {
	if len(files) > 5 {
		return nil, errors.New("一次最多引用 5 个会话")
	}
	items := []map[string]any{}
	blocks := []string{}
	for _, file := range files {
		if strings.TrimSpace(file) == "" {
			continue
		}
		target, err := assertReadableSessionFile(cwd, file)
		if err != nil {
			return nil, err
		}
		info, err := os.Stat(target)
		if err != nil || info.IsDir() {
			return nil, errors.New("这个会话文件已不存在")
		}
		messages := readSessionHistory(target)
		if len(messages) == 0 {
			return nil, errors.New("这个会话还没有内容，无法引用")
		}
		title := readSessionName(target, info.Size(), nil)
		if title == "" {
			title = firstUserTitleFromMessages(messages)
		}
		if title == "" {
			title = "未命名会话"
		}
		items = append(items, map[string]any{
			"path": target, "name": title, "kind": "session", "size": info.Size(), "inlined": true, "messages": len(messages),
		})
		blocks = append(blocks, sessionContextBlock(target, title, messages))
	}
	return map[string]any{"items": items, "text": strings.Join(blocks, ""), "images": []any{}}, nil
}
