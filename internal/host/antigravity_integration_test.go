//go:build integration

package host

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

// 真实 ACP 往返（会调用一次本机 Antigravity，消耗少量配额）。
//
//	go test -tags integration ./internal/host -run TestAntigravityTurn -v -timeout 240s
//
// 需要本机已安装并登录 agy；未安装时自动跳过。
func TestAntigravityTurn(t *testing.T) {
	if os.Getenv("PI_ACP_TEST") == "" {
		t.Skip("设置 PI_ACP_TEST=1 才跑真实 Antigravity 会话")
	}
	location := locateAntigravity("")
	if !location.Found {
		t.Skip("本机没有可用的 agy：" + location.Error)
	}
	cwd := t.TempDir()
	host := &Host{acpPools: map[string]*antigravityWorkspace{}}
	workspace := &antigravityWorkspace{h: host, cwd: cwd, sessions: map[string]*agSession{}}
	// 测试里没有窗口，事件的 Broadcast 会一直等监听者；翻译逻辑本身不依赖 emit。
	workspace.h = nil
	var clientRef *acpClient
	onNotification := func(method string, params map[string]any) {
		update := asMap(params["update"])
		t.Logf("notify %s %s %s", method, asString(update["sessionUpdate"]), asString(update["status"]))
		workspace.onNotification(method, params)
	}
	onRequest := func(id, method string, params map[string]any) {
		t.Logf("request %s %v", method, params["options"])
		if method == "session/request_permission" {
			_ = clientRef.Respond(id, map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": "allow"}})
			return
		}
		_ = clientRef.RespondError(id, -32601, "unsupported")
	}
	client := newACPClient(cwd, host.childEnv(), onNotification, onRequest)
	clientRef = client
	workspace.client = client
	if err := client.attachProcess(location.Path, []string{"acp"}); err != nil {
		t.Fatalf("启动 agy acp 失败：%v", err)
	}
	defer client.Stop()

	if _, err := client.Call("initialize", map[string]any{
		"protocolVersion": 1,
		"clientCapabilities": map[string]any{
			"fs":       map[string]any{"readTextFile": false, "writeTextFile": false},
			"terminal": false,
		},
		"clientInfo": map[string]any{"name": "Pi Desktop test"},
	}, 30*time.Second); err != nil {
		t.Fatalf("initialize 失败：%v", err)
	}

	result, err := client.Call("session/new", map[string]any{"cwd": cwd, "mcpServers": []any{}}, 60*time.Second)
	if err != nil {
		t.Fatalf("session/new 失败：%v", err)
	}
	id := asString(result["sessionId"])
	if id == "" {
		t.Fatal("session/new 没有返回 sessionId")
	}
	session := workspace.ensureSessionLocked(id)
	workspace.configureSession(session, result)
	workspace.ensurePreferredModel(session)
	if len(session.models) == 0 || len(session.levels) == 0 {
		t.Fatalf("模型 / 思考档位没有解析出来：%#v %#v", session.models, session.levels)
	}
	t.Logf("默认模型：%s（thinking=%s）", sessionModelID(session), session.thinking)

	if _, err := workspace.prompt(session, "Reply with exactly: OK", nil, ""); err != nil {
		t.Fatalf("发送提示失败：%v", err)
	}
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		workspace.mu.Lock()
		streaming := session.streaming
		text := ""
		for _, message := range session.messages {
			item := asMap(message)
			if asString(item["role"]) != "assistant" {
				continue
			}
			for _, part := range asSlice(item["content"]) {
				if asString(asMap(part)["type"]) == "text" {
					text += asString(asMap(part)["text"])
				}
			}
		}
		workspace.mu.Unlock()
		if !streaming && strings.TrimSpace(text) != "" {
			if !strings.Contains(strings.ToUpper(text), "OK") {
				t.Fatalf("回复内容异常：%q", text)
			}
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
	workspace.mu.Lock()
	raw, _ := json.MarshalIndent(session.messages, "", "  ")
	active := session.activeTurns
	workspace.mu.Unlock()
	client.mu.Lock()
	stderr := client.stderr.String()
	client.mu.Unlock()
	t.Fatalf("等待 Antigravity 回复超时；messages=%s activeTurns=%d stderr=%s", raw, active, stderr)
}
