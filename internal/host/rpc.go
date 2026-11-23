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

// rpcParams 是允许的方法及其 wire 参数名（camelCase 调用在这里映射成 Pi 的 snake_case）。
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
	requestID  int64
	stderr     strings.Builder
	exitErr    error
	readErr    error
	buffer     strings.Builder
	stopping   bool
	started    bool
	// exited 在子进程退出时关闭（cmd.Wait 返回）；Stop 用它判断要不要硬杀
	exited chan struct{}
	// job 是这个 Pi 进程所在的 Job（Windows 有效）；Stop 时用它连带结束子孙进程
	job processJob

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
	c.readErr = nil
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
	// Windows：放进 Job，停这个 worker 时连带结束 Pi 拉起的 MCP server 等子进程
	job := newProcessJob()
	job.join(cmd.Process)
	exited := make(chan struct{})

	c.mu.Lock()
	c.cmd = cmd
	c.stdin = stdin
	c.process = cmd.Process
	c.exited = exited
	c.job = job
	c.mu.Unlock()

	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
		for scanner.Scan() {
			c.mu.Lock()
			if c.stderr.Len() < 64*1024 {
				c.stderr.WriteString(scanner.Text())
				c.stderr.WriteString("\n")
			}
			c.mu.Unlock()
		}
	}()
	go func() {
		if err := c.readStdout(stdout); err != nil {
			c.setReadError(err)
		}
	}()
	go func() {
		err := cmd.Wait()
		close(exited)
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

// readStdout 逐行读 JSON。这里不能用 bufio.Scanner：它的 token 上限（16 MB）
// 装不下 4K 图片的 base64，超限时 Scan 直接返回 false，事件流静默中断、
// 请求永远等不到回应（表现为会话打不开）。用 ReadLine 分片拼接就没有上限。
func (c *PiRpcClient) readStdout(reader io.Reader) error {
	buf := bufio.NewReaderSize(reader, 64*1024)
	var acc []byte
	for {
		chunk, isPrefix, err := buf.ReadLine()
		if len(chunk) > 0 {
			acc = append(acc, chunk...)
		}
		if !isPrefix {
			if len(acc) > 0 {
				line := string(acc)
				acc = acc[:0]
				c.handleLine(strings.TrimSpace(line))
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
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
	if c.readErr != nil {
		err := c.readErr
		c.mu.Unlock()
		return nil, err
	}
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
	exited := c.exited
	job := c.job
	c.stopping = true
	c.cmd = nil
	c.stdin = nil
	c.process = nil
	c.exited = nil
	c.job = 0
	c.mu.Unlock()
	if stdin != nil {
		_ = stdin.Close()
	}
	if cmd != nil && cmd.Process != nil {
		// 先关 stdin 等它自己退：Pi 收到 EOF 会顺手关掉自己拉起的 MCP server。
		// 只给一小段时间，超时后再强杀（Windows 的 Job 会兜底子孙进程）。
		if exited == nil || !waitClosed(exited, 800*time.Millisecond) {
			killProcess(cmd)
			// 直接子进程结束不代表子孙也结束，Windows 上按 Job 一起清掉
			job.terminate()
			if exited != nil {
				waitClosed(exited, 1200*time.Millisecond)
			}
		}
	}
	job.close()
	c.rejectAll(errors.New("RPC 客户端已停止"))
	return nil
}

// waitClosed 等 channel 关闭，返回是否在超时前关掉。
func waitClosed(ch <-chan struct{}, timeout time.Duration) bool {
	select {
	case <-ch:
		return true
	case <-time.After(timeout):
		return false
	}
}

// setReadError 记录读流中断：流断了以后所有请求都等不到回应，直接让它们失败，
// 别让界面卡在「启动中」。
func (c *PiRpcClient) setReadError(err error) {
	c.mu.Lock()
	if c.readErr == nil {
		c.readErr = err
	}
	c.mu.Unlock()
	c.rejectAll(err)
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
