package host

import (
	"encoding/json"
	"testing"
)

func TestAntigravityToolMapping(t *testing.T) {
	cases := map[string]string{
		"read_file":            "read",
		"run_command":          "bash",
		"write_file":           "write",
		"edit_file":            "edit",
		"replace_file_content": "edit",
		"":                     "bash",
	}
	for input, want := range cases {
		kind := ""
		if input == "" {
			kind = "execute"
		}
		if got := mapAcpToolName(input, kind); got != want {
			t.Fatalf("mapAcpToolName(%q, %q) = %q, want %q", input, kind, got, want)
		}
	}

	args := mapAcpToolArgs("bash", map[string]any{"CommandLine": "echo hi", "WaitMsBeforeAsync": 5000})
	if args["command"] != "echo hi" {
		t.Fatalf("bash args 没有映射 command：%#v", args)
	}
	args = mapAcpToolArgs("read", map[string]any{"Path": `C:\a\b.txt`, "Offset": 4, "Limit": 10})
	if args["path"] != `C:\a\b.txt` || asFloat(args["offset"]) != 4 || asFloat(args["limit"]) != 10 {
		t.Fatalf("read args 映射不完整：%#v", args)
	}
	args = mapAcpToolArgs("edit", map[string]any{"Path": "a.txt", "OldText": "old", "NewText": "new"})
	edits, ok := args["edits"].([]any)
	if !ok || len(edits) != 1 {
		t.Fatalf("edit args 应生成一条 edits：%#v", args)
	}

	output, images, details, isError := acpToolResult(map[string]any{
		"status": "completed",
		"content": []any{
			map[string]any{"type": "content", "content": map[string]any{"type": "text", "text": "hello"}},
			map[string]any{"type": "diff", "path": "a.txt", "oldText": "old", "newText": "new"},
		},
		"rawOutput": map[string]any{"output": "hello", "exit_code": 0},
	})
	if output != "hello" || len(images) != 0 || details["diff"] == "" || isError {
		t.Fatalf("acpToolResult 解析错误：%q %#v %#v %v", output, images, details, isError)
	}
	if details["path"] != "a.txt" {
		t.Fatalf("diff 路径没有保留：%#v", details)
	}

	_, _, _, isError = acpToolResult(map[string]any{
		"status": "completed", "rawOutput": map[string]any{"exit_code": 1, "output": "boom"},
	})
	if !isError {
		t.Fatal("非零退出码应标记为错误")
	}
}

func TestAntigravityConfigOptions(t *testing.T) {
	options := []any{
		map[string]any{
			"id": "model", "currentValue": "gemini-4-argon",
			"options": []any{
				map[string]any{"value": "gemini-4-argon", "name": "Gemini 4 Argon"},
				map[string]any{"value": "claude-opus-5-5", "name": "Claude Opus 5.5"},
			},
		},
		map[string]any{
			"id": "thought_level", "currentValue": "high",
			"options": []any{
				map[string]any{"value": "low", "name": "Low"},
				map[string]any{"value": "medium", "name": "Medium"},
				map[string]any{"value": "high", "name": "High"},
			},
		},
		map[string]any{
			"id": "mode", "currentValue": "auto",
			"options": []any{map[string]any{"value": "auto", "name": "Auto"}},
		},
	}
	models, levels, mode, modes, modelID, thinking := parseAcpConfigOptions(options, nil)
	if len(models) != 2 || len(levels) != 3 || mode != "auto" || len(modes) != 1 {
		t.Fatalf("配置解析不完整：%#v %v %q %#v", models, levels, mode, modes)
	}
	if modelID != "gemini-4-argon" || thinking != "high" {
		t.Fatalf("当前模型 / 思考解析错误：%q %q", modelID, thinking)
	}
	model := asMap(models[0])
	if model["provider"] != agentAntigravity || model["reasoning"] != true {
		t.Fatalf("模型应带 Agent 提供方与推理标记：%#v", model)
	}
	thinkingMap := asMap(model["thinkingLevelMap"])
	if thinkingMap["off"] != nil || thinkingMap["high"] != "high" {
		t.Fatalf("思考档位映射错误：%#v", thinkingMap)
	}

	session := &agSession{model: "gemini-4-argon", thinking: "high", models: models, levels: levels}
	if got := sessionModelID(session); got != "gemini-4-argon" {
		t.Fatalf("没有完整档位 id 时应退回基础模型：%q", got)
	}
	session.models = append(session.models, map[string]any{"id": "gemini-4-argon-high"})
	if got := sessionModelID(session); got != "gemini-4-argon-high" {
		t.Fatalf("有完整档位 id 时应优先用它：%q", got)
	}
	if base, suffix := acpModelBase("claude-opus-5-5-medium"); base != "claude-opus-5-5" || suffix != "medium" {
		t.Fatalf("acpModelBase = %q %q", base, suffix)
	}
	if base, suffix := acpModelBase("gemini-pro-orchestrator-g1-pro"); base != "gemini-pro-orchestrator-g1-pro" || suffix != "" {
		t.Fatalf("无档位模型不应被截断：%q %q", base, suffix)
	}
}

func TestAntigravitySessionIdentity(t *testing.T) {
	if !isAntigravityFile(antigravityFile("abc")) || antigravityID(antigravityFile("abc")) != "abc" {
		t.Fatal("会话文件前缀解析失败")
	}
	if isAntigravityFile(`C:\Users\a\.pi\sessions\x.jsonl`) {
		t.Fatal("Pi 会话文件不应被当成 Antigravity 会话")
	}
	if antigravityID(`C:\Users\a\.pi\sessions\x.jsonl`) != "" {
		t.Fatal("Pi 会话文件不能当 sessionId 传给 Antigravity")
	}
	good := []struct{ a, b string }{
		{`C:\Users\me\proj`, "/C:/Users/me/proj"},
		{`C:\Users\me\proj`, `c:\Users\me\proj\`},
		{`C:\Users\me\Pi Desktop`, "/C:/Users/me/Pi%20Desktop"},
		{"/home/me/proj", "/home/me/proj"},
	}
	for _, item := range good {
		if !sameAgentCwd(item.a, item.b) {
			t.Fatalf("sameAgentCwd(%q, %q) 应为 true", item.a, item.b)
		}
	}
	if sameAgentCwd(`C:\Users\me\proj`, `C:\Users\me\other`) {
		t.Fatal("不同目录不应相等")
	}
}

func TestAntigravityUpdateTranslation(t *testing.T) {
	host := &Host{}
	workspace := &antigravityWorkspace{h: host, cwd: `C:\proj`, sessions: map[string]*agSession{}}
	session := workspace.ensureSessionLocked("s1")
	session.loading = true
	workspace.applyUpdateLocked(session, map[string]any{"sessionUpdate": "user_message_chunk", "content": map[string]any{"type": "text", "text": "hi"}})
	workspace.applyUpdateLocked(session, map[string]any{"sessionUpdate": "agent_thought_chunk", "content": map[string]any{"type": "text", "text": "thinking"}})
	workspace.applyUpdateLocked(session, map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": "hello"}})
	workspace.applyUpdateLocked(session, map[string]any{
		"sessionUpdate": "tool_call", "toolCallId": "t1", "name": "run_command", "kind": "execute", "status": "completed",
		"rawInput": map[string]any{"CommandLine": "echo hi"},
		"content":  []any{map[string]any{"type": "content", "content": map[string]any{"type": "text", "text": "hi"}}},
	})
	session.loading = false
	workspace.flushUserLocked(session)
	workspace.flushAssistantLocked(session, "end_turn")

	if len(session.messages) != 4 {
		raw, _ := json.MarshalIndent(session.messages, "", "  ")
		t.Fatalf("回放消息数应为 4（user / assistant / toolCall / toolResult），实际 %d：%s", len(session.messages), raw)
	}
	if asString(asMap(session.messages[0])["role"]) != "user" {
		t.Fatal("第一条应为 user")
	}
	assistant := asMap(session.messages[1])
	content := asSlice(assistant["content"])
	if asString(asMap(content[0])["type"]) != "thinking" || asString(asMap(content[1])["text"]) != "hello" {
		t.Fatalf("assistant 内容顺序应对应 thinking → text：%#v", content)
	}
	toolCall := asMap(asSlice(asMap(session.messages[2])["content"])[0])
	if asString(toolCall["name"]) != "bash" || asString(asMap(toolCall["arguments"])["command"]) != "echo hi" {
		t.Fatalf("工具调用映射错误：%#v", toolCall)
	}
	toolResult := asMap(session.messages[3])
	if asString(toolResult["toolName"]) != "bash" || toolResult["isError"] != false {
		t.Fatalf("工具结果映射错误：%#v", toolResult)
	}
}

func TestNormalizeAcpCommands(t *testing.T) {
	commands := normalizeAcpCommands([]any{
		map[string]any{"name": "compact", "description": "Compact"},
		map[string]any{"name": "", "description": "ignore"},
	})
	if len(commands) != 1 || asString(asMap(commands[0])["name"]) != "compact" {
		t.Fatalf("命令列表应过滤空名：%#v", commands)
	}
}

func TestAcpUsageMapping(t *testing.T) {
	usage := mapAcpUsage(map[string]any{
		"inputTokens": 10, "outputTokens": 4, "cachedReadTokens": 2,
		"cachedWriteTokens": 1, "thoughtTokens": 3,
	})
	if asFloat(usage["totalTokens"]) != 20 || asFloat(usage["cacheRead"]) != 2 {
		t.Fatalf("用量映射错误：%#v", usage)
	}
}
