package host

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const rpcDefaultTimeout = 30 * time.Second

// rpcParams 是允许的方法及其 wire 参数名；与 Electron 版的 COMMANDS 表一致。
var rpcParams = map[string][]string{
	"prompt":                     {"message", "images", "streamingBehavior"},
	"steer":                      {"message", "images"},
	"followUp":                   {"message", "images"},
	"abort":                      {},
	"clearQueue":                 {},
	"newSession":                 {"parentSession"},
	"switchSession":              {"sessionPath"},
	"getState":                   {},
	"getMessages":                {},
	"setModel":                   {"provider", "modelId"},
	"getAvailableModels":         {},
	"setThinkingLevel":           {"level"},
	"getAvailableThinkingLevels": {},
	"setAutoCompaction":          {"enabled"},
	"setAutoRetry":               {"enabled"},
	"setSteeringMode":            {"mode"},
	"setFollowUpMode":            {"mode"},
	"compact":                    {"customInstructions"},
	"getSessionStats":            {},
	"getCommands":                {},
	"getTree":                    {},
	"fork":                       {"entryId"},
	"setSessionName":             {"name"},
	"clone":                      {},
	"getForkMessages":            {},
	"getLastAssistantText":       {},
	"exportHtml":                 {"outputPath"},
	"bash":                       {"command", "excludeFromContext"},
	"abortBash":                  {},
}

var rpcResultKeys = map[string]string{
	"prompt":                     "disposition",
	"getAvailableModels":         "models",
	"getAvailableThinkingLevels": "levels",
	"getCommands":                "commands",
	"getMessages":                "messages",
	"getForkMessages":            "messages",
	"getLastAssistantText":       "text",
}

func rpcCommandType(method string) string {
	var b strings.Builder
	for _, r := range method {
		if r >= 'A' && r <= 'Z' {
			b.WriteByte('_')
			b.WriteRune(r + ('a' - 'A'))
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// PiCommand 是一条本机 Pi 的启动命令：可执行文件 + 前缀参数。
// npm 安装是 `node <cli.js>`，独立二进制则直接是 `pi`。
type PiCommand struct {
	Exe    string
	Prefix []string
}

func (c PiCommand) Args(args ...string) []string {
	out := make([]string, 0, len(c.Prefix)+len(args))
	out = append(out, c.Prefix...)
	out = append(out, args...)
	return out
}

func (c PiCommand) String() string {
	return strings.TrimSpace(c.Exe + " " + strings.Join(c.Prefix, " "))
}

type RpcTimeoutError struct {
	Method    string
	TimeoutMs int64
	Stderr    string
}

func (e *RpcTimeoutError) Error() string {
	suffix := ""
	if e.Stderr != "" {
		suffix = "：" + tailText(e.Stderr, 400)
	}
	return fmt.Sprintf("等待 %s 响应超时（%dms）%s", e.Method, e.TimeoutMs, suffix)
}

type rpcPending struct {
	resolve chan any
	reject  chan error
	timer   *time.Timer
}

type rpcListener struct {
	id int64
	fn func(map[string]any)
}

// PiRpcClient 是 Pi RPC（一行一个 JSON）的客户端。
type PiRpcClient struct {
	mu      sync.Mutex
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	process *os.Process

	listeners  []rpcListener
	listenerID int64
	pending    map[string]*rpcPending
	requestID int64
	stderr    strings.Builder
	exitErr   error
	buffer    strings.Builder
	stopping  bool
	started   bool

	command PiCommand
	cwd     string
	env     []string
	args    []string
}

func NewPiRpcClient(command PiCommand, cwd string, env map[string]string, args []string) *PiRpcClient {
	var envList []string
	if env != nil {
		envList = make([]string, 0, len(env))
		for key, value := range env {
			envList = append(envList, key+"="+value)
		}
	}
	return &PiRpcClient{
		command: command,
		cwd:     cwd,
		env:     envList,
		args:    args,
		pending: map[string]*rpcPending{},
	}
}

func (c *PiRpcClient) Start() error {
	c.mu.Lock()
	if c.started {
		c.mu.Unlock()
		return errors.New("RPC 客户端已经启动")
	}
	c.started = true
	c.exitErr = nil
	c.stopping = false
	c.buffer.Reset()
	c.stderr.Reset()
	c.mu.Unlock()

	args := append([]string{}, c.args...)
	args = append(args, "--mode", "rpc")
	cmd := exec.Command(c.command.Exe, c.command.Args(args...)...)
	cmd.Dir = c.cwd
	if len(c.env) > 0 {
		cmd.Env = c.env
	} else {
		cmd.Env = os.Environ()
	}
	hideWindow(cmd)
	prepareProcessGroup(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("Pi 进程启动失败：%w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("Pi 进程启动失败：%w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("Pi 进程启动失败：%w", err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("Pi 进程启动失败：%w", err)
	}

	c.mu.Lock()
	c.cmd = cmd
	c.stdin = stdin
	c.process = cmd.Process
	c.mu.Unlock()

	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			c.mu.Lock()
			if c.stderr.Len() < 64*1024 {
				c.stderr.WriteString(scanner.Text())
				c.stderr.WriteString("\n")
			}
			c.mu.Unlock()
		}
	}()
	go c.readStdout(stdout)
	go func() {
		err := cmd.Wait()
		c.mu.Lock()
		if c.cmd != cmd {
			c.mu.Unlock()
			return
		}
		exitErr := c.exitErrOf(err)
		c.exitErr = exitErr
		c.mu.Unlock()
		c.rejectAll(exitErr)
	}()

	time.Sleep(100 * time.Millisecond)
	c.mu.Lock()
	started := c.started
	c.mu.Unlock()
	if !started {
		return errors.New("Pi 进程未能启动")
	}
	if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		c.mu.Lock()
		err := c.exitErr
		c.mu.Unlock()
		if err != nil {
			return err
		}
		return errors.New("Pi 进程启动后立即退出")
	}
	return nil
}

func (c *PiRpcClient) readStdout(reader io.Reader) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		c.handleLine(strings.TrimSpace(scanner.Text()))
	}
}

func (c *PiRpcClient) handleLine(line string) {
	if line == "" {
		return
	}
	var data map[string]any
	if err := json.Unmarshal([]byte(line), &data); err != nil {
		return
	}
	if typ, _ := data["type"].(string); typ == "response" {
		id, _ := data["id"].(string)
		c.mu.Lock()
		pending, ok := c.pending[id]
		if ok {
			delete(c.pending, id)
		}
		c.mu.Unlock()
		if ok {
			if success, exists := data["success"]; exists && success == false {
				message := "Pi 返回失败"
				if text, ok := data["error"].(string); ok && text != "" {
					message = text
				}
				pending.reject <- errors.New(message)
			} else {
				pending.resolve <- data["data"]
			}
			return
		}
	}
	c.mu.Lock()
	listeners := make([]func(map[string]any), len(c.listeners))
	for i, item := range c.listeners {
		listeners[i] = item.fn
	}
	c.mu.Unlock()
	for _, listener := range listeners {
		listener(data)
	}
}

func (c *PiRpcClient) OnEvent(listener func(map[string]any)) func() {
	c.mu.Lock()
	c.listenerID++
	id := c.listenerID
	c.listeners = append(c.listeners, rpcListener{id: id, fn: listener})
	c.mu.Unlock()
	return func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		for i, item := range c.listeners {
			if item.id == id {
				c.listeners = append(c.listeners[:i], c.listeners[i+1:]...)
				return
			}
		}
	}
}

// Send 发送一条命令。timeout <= 0 表示不设超时。
func (c *PiRpcClient) Send(method string, args []any, timeout time.Duration, requestID string) (any, error) {
	params, ok := rpcParams[method]
	if !ok {
		return nil, fmt.Errorf("不支持的 RPC 方法：%s", method)
	}
	c.mu.Lock()
	if c.exitErr != nil {
		err := c.exitErr
		c.mu.Unlock()
		return nil, err
	}
	stdin := c.stdin
	if stdin == nil {
		c.mu.Unlock()
		return nil, errors.New("RPC 客户端未启动")
	}
	payload := map[string]any{"type": rpcCommandType(method)}
	for index, name := range params {
		if index < len(args) && args[index] != nil {
			payload[name] = args[index]
		}
	}
	c.requestID++
	id := requestID
	if strings.TrimSpace(id) == "" {
		id = fmt.Sprintf("req_%d", c.requestID)
	}
	payload["id"] = id
	pending := &rpcPending{resolve: make(chan any, 1), reject: make(chan error, 1)}
	c.pending[id] = pending
	c.mu.Unlock()

	if timeout > 0 {
		pending.timer = time.AfterFunc(timeout, func() {
			c.mu.Lock()
			delete(c.pending, id)
			c.mu.Unlock()
			pending.reject <- &RpcTimeoutError{Method: method, TimeoutMs: timeout.Milliseconds(), Stderr: c.Stderr()}
		})
	}

	data, err := json.Marshal(payload)
	if err != nil {
		c.finishPending(id, pending)
		return nil, fmt.Errorf("写入 Pi 进程失败：%w", err)
	}
	if _, err := stdin.Write(append(data, '\n')); err != nil {
		c.finishPending(id, pending)
		return nil, fmt.Errorf("写入 Pi 进程失败：%w", err)
	}
	select {
	case value := <-pending.resolve:
		return value, nil
	case err := <-pending.reject:
		return nil, err
	}
}

func (c *PiRpcClient) finishPending(id string, pending *rpcPending) {
	c.mu.Lock()
	delete(c.pending, id)
	c.mu.Unlock()
	if pending.timer != nil {
		pending.timer.Stop()
	}
}

func (c *PiRpcClient) Call(method string, args ...any) (any, error) {
	data, err := c.Send(method, args, rpcDefaultTimeout, "")
	if err != nil {
		return nil, err
	}
	key := rpcResultKeys[method]
	if key == "" {
		return data, nil
	}
	if obj, ok := data.(map[string]any); ok {
		if value, exists := obj[key]; exists {
			return value, nil
		}
	}
	if key == "text" {
		return nil, nil
	}
	return []any{}, nil
}

func (c *PiRpcClient) Prompt(message string, images any, streamingBehavior any) (any, error) {
	return c.Call("prompt", message, images, streamingBehavior)
}

func (c *PiRpcClient) GetState() (map[string]any, error) {
	value, err := c.Call("getState")
	if err != nil {
		return nil, err
	}
	return asMap(value), nil
}

func (c *PiRpcClient) GetMessages() ([]any, error) {
	value, err := c.Call("getMessages")
	if err != nil {
		return nil, err
	}
	if items, ok := value.([]any); ok {
		return items, nil
	}
	return []any{}, nil
}

func (c *PiRpcClient) GetAvailableModels() ([]any, error) {
	value, err := c.Call("getAvailableModels")
	if err != nil {
		return nil, err
	}
	if items, ok := value.([]any); ok {
		return items, nil
	}
	return []any{}, nil
}

func (c *PiRpcClient) GetAvailableThinkingLevels() ([]any, error) {
	value, err := c.Call("getAvailableThinkingLevels")
	if err != nil {
		return nil, err
	}
	if items, ok := value.([]any); ok {
		return items, nil
	}
	return []any{}, nil
}

func (c *PiRpcClient) GetCommands() ([]any, error) {
	value, err := c.Call("getCommands")
	if err != nil {
		return nil, err
	}
	if items, ok := value.([]any); ok {
		return items, nil
	}
	return []any{}, nil
}

func (c *PiRpcClient) SwitchSession(path string) (map[string]any, error) {
	value, err := c.Call("switchSession", path)
	if err != nil {
		return nil, err
	}
	return asMap(value), nil
}

func (c *PiRpcClient) NewSession(parent string) (map[string]any, error) {
	var value any
	var err error
	if parent == "" {
		value, err = c.Call("newSession")
	} else {
		value, err = c.Call("newSession", parent)
	}
	if err != nil {
		return nil, err
	}
	return asMap(value), nil
}

func (c *PiRpcClient) Bash(command string, excludeFromContext bool, requestID string) (any, error) {
	return c.Send("bash", []any{command, excludeFromContext}, 0, requestID)
}

func (c *PiRpcClient) WriteRaw(text string) error {
	c.mu.Lock()
	stdin := c.stdin
	c.mu.Unlock()
	if stdin == nil {
		return errors.New("Pi 进程不可写")
	}
	_, err := stdin.Write([]byte(text))
	return err
}

func (c *PiRpcClient) Stderr() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return tailText(c.stderr.String(), 4000)
}

func (c *PiRpcClient) Stop() error {
	c.mu.Lock()
	cmd := c.cmd
	stdin := c.stdin
	proc := c.process
	c.stopping = true
	c.cmd = nil
	c.stdin = nil
	c.process = nil
	c.mu.Unlock()
	if stdin != nil {
		_ = stdin.Close()
	}
	if cmd != nil && proc != nil {
		killProcess(cmd)
		done := make(chan struct{})
		go func() {
			_, _ = proc.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(1200 * time.Millisecond):
			_ = proc.Kill()
		}
	}
	c.rejectAll(errors.New("RPC 客户端已停止"))
	return nil
}

func (c *PiRpcClient) rejectAll(err error) {
	c.mu.Lock()
	pending := c.pending
	c.pending = map[string]*rpcPending{}
	c.mu.Unlock()
	for _, item := range pending {
		if item.timer != nil {
			item.timer.Stop()
		}
		select {
		case item.reject <- err:
		default:
		}
	}
}

func (c *PiRpcClient) exitErrOf(err error) error {
	c.mu.Lock()
	stopping := c.stopping
	stderr := tailText(c.stderr.String(), 400)
	c.mu.Unlock()
	if stopping {
		return errors.New("Pi 进程已停止")
	}
	if err != nil {
		return fmt.Errorf("Pi 进程退出：%s", firstNonEmpty(stderr, err.Error()))
	}
	if stderr != "" {
		return fmt.Errorf("Pi 进程退出：%s", stderr)
	}
	return errors.New("Pi 进程退出：没有输出")
}

// rpcCall 是一个便捷包装：用统一超时调用并解包。
func rpcCall(client *PiRpcClient, method string, args ...any) (any, error) {
	return client.Call(method, args...)
}
