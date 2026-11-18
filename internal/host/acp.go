package host

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// acpClient 是 Agent Client Protocol（JSON-RPC over stdio）的客户端。
//
// 协议只有三类帧：客户端请求、服务端请求、通知。这里不绑定任何具体 Agent，
// Antigravity 只是第一个使用者；以后接入别的 ACP CLI 只需要换启动命令。
type acpClient struct {
	mu      sync.Mutex
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	pending map[string]chan acpCallResult
	nextID  int64

	onNotification func(method string, params map[string]any)
	onRequest      func(id string, method string, params map[string]any)

	stderr  strings.Builder
	exited  chan struct{}
	stopped bool
	job     processJob

	cwd string
	env map[string]string
}

type acpCallResult struct {
	result map[string]any
	err    error
}

type acpRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func (e *acpRPCError) Error() string {
	if e == nil {
		return ""
	}
	message := strings.TrimSpace(e.Message)
	if message == "" {
		message = "Agent 返回了未知错误"
	}
	return message
}

const acpMaxLine = 32 * 1024 * 1024

func newACPClient(cwd string, env map[string]string, onNotification func(string, map[string]any), onRequest func(string, string, map[string]any)) *acpClient {
	if onNotification == nil {
		onNotification = func(string, map[string]any) {}
	}
	if onRequest == nil {
		onRequest = func(string, string, map[string]any) {}
	}
	return &acpClient{
		pending:        map[string]chan acpCallResult{},
		cwd:            cwd,
		env:            env,
		onNotification: onNotification,
		onRequest:      onRequest,
	}
}

// 这两个字段只用于 Start；放在结构体里避免再传一长串参数。
func (c *acpClient) attachProcess(command string, args []string) error {
	cmd := exec.Command(command, args...)
	cmd.Dir = c.cwd
	if len(c.env) > 0 {
		cmd.Env = envListFromMap(c.env)
	} else {
		cmd.Env = os.Environ()
	}
	hideWindow(cmd)
	prepareProcessGroup(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	job := newProcessJob()
	job.join(cmd.Process)
	exited := make(chan struct{})

	c.mu.Lock()
	c.cmd = cmd
	c.stdin = stdin
	c.exited = exited
	c.job = job
	c.stopped = false
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
	go c.readLoop(stdout)
	go func() {
		err := cmd.Wait()
		close(exited)
		c.mu.Lock()
		stopped := c.stopped
		text := c.stderr.String()
		cmdNow := c.cmd == cmd
		c.mu.Unlock()
		if !cmdNow {
			return
		}
		if !stopped {
			reason := strings.TrimSpace(tailText(text, 400))
			if reason == "" && err != nil {
				reason = err.Error()
			}
			if reason == "" {
				reason = "进程已退出"
			}
			c.failAll(errors.New("Agent 进程已退出：" + reason))
		}
	}()
	return nil
}

func envListFromMap(env map[string]string) []string {
	out := make([]string, 0, len(env))
	for key, value := range env {
		out = append(out, key+"="+value)
	}
	return out
}

func (c *acpClient) readLoop(stdout io.ReadCloser) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), acpMaxLine)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var frame map[string]any
		if err := json.Unmarshal([]byte(line), &frame); err != nil {
			continue
		}
		if method := asString(frame["method"]); method != "" {
			params := asMap(frame["params"])
			if rawID, ok := frame["id"]; ok && rawID != nil {
				c.onRequest(acpIDKey(rawID), method, params)
			} else {
				c.onNotification(method, params)
			}
			continue
		}
		rawID, ok := frame["id"]
		if !ok {
			continue
		}
		key := acpIDKey(rawID)
		c.mu.Lock()
		waiter := c.pending[key]
		delete(c.pending, key)
		c.mu.Unlock()
		if waiter == nil {
			continue
		}
		if errObj := asMap(frame["error"]); len(errObj) > 0 {
			waiter <- acpCallResult{err: &acpRPCError{
				Code:    int(asFloat(errObj["code"])),
				Message: asString(errObj["message"]),
				Data:    errObj["data"],
			}}
			continue
		}
		waiter <- acpCallResult{result: asMap(frame["result"])}
	}
}

func (c *acpClient) failAll(err error) {
	c.mu.Lock()
	pending := c.pending
	c.pending = map[string]chan acpCallResult{}
	c.mu.Unlock()
	for _, waiter := range pending {
		select {
		case waiter <- acpCallResult{err: err}:
		default:
		}
	}
}

func (c *acpClient) write(frame map[string]any) error {
	data, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	c.mu.Lock()
	stdin := c.stdin
	exited := c.exited
	c.mu.Unlock()
	if stdin == nil {
		return errors.New("Agent 进程还没有启动")
	}
	select {
	case <-exited:
		return errors.New("Agent 进程已经退出")
	default:
	}
	_, err = io.WriteString(stdin, string(data)+"\n")
	return err
}

func (c *acpClient) Call(method string, params map[string]any, timeout time.Duration) (map[string]any, error) {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	waiter := make(chan acpCallResult, 1)
	c.mu.Lock()
	c.nextID++
	id := c.nextID
	key := strconv.FormatInt(id, 10)
	c.pending[key] = waiter
	c.mu.Unlock()

	if err := c.write(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
		c.mu.Lock()
		delete(c.pending, key)
		c.mu.Unlock()
		return nil, err
	}
	select {
	case reply := <-waiter:
		return reply.result, reply.err
	case <-time.After(timeout):
		c.mu.Lock()
		delete(c.pending, key)
		c.mu.Unlock()
		return nil, fmt.Errorf("等待 %s 响应超时（%s）", method, timeout)
	}
}

func (c *acpClient) Notify(method string, params map[string]any) error {
	return c.write(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
}

func (c *acpClient) Respond(id string, result any) error {
	return c.write(map[string]any{"jsonrpc": "2.0", "id": acpIDValue(id), "result": result})
}

func (c *acpClient) RespondError(id string, code int, message string) error {
	return c.write(map[string]any{
		"jsonrpc": "2.0",
		"id":      acpIDValue(id),
		"error":   map[string]any{"code": code, "message": message},
	})
}

func acpIDValue(id string) any {
	if value, err := strconv.ParseInt(id, 10, 64); err == nil {
		return value
	}
	return id
}

func acpIDKey(value any) string {
	switch item := value.(type) {
	case string:
		return item
	case float64:
		return strconv.FormatInt(int64(item), 10)
	case json.Number:
		return item.String()
	default:
		return fmt.Sprint(item)
	}
}

func (c *acpClient) Stop() {
	c.mu.Lock()
	if c.stopped {
		c.mu.Unlock()
		return
	}
	c.stopped = true
	stdin := c.stdin
	cmd := c.cmd
	exited := c.exited
	job := c.job
	c.stdin = nil
	c.mu.Unlock()

	if stdin != nil {
		_ = stdin.Close()
	}
	if exited != nil {
		select {
		case <-exited:
			if job != 0 {
				job.close()
			}
			return
		case <-time.After(2500 * time.Millisecond):
		}
	}
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	if job != 0 {
		job.close()
	}
	if exited != nil {
		select {
		case <-exited:
		case <-time.After(time.Second):
		}
	}
}
