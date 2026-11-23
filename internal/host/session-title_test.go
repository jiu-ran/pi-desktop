package host

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 首条用户消息里带整张图片时，那一行可能超过读取窗口被截断；
// 标题不能因此变空，否则会话会被当成空会话从列表里消失。
func TestTitleFromPartialUserLine(t *testing.T) {
	bs := string(rune(92))
	text := `<file name="C:` + bs + `Users` + bs + `me` + bs + `shot.png"></file>
我想要使用这个同步`
	payload, err := json.Marshal(text)
	if err != nil {
		t.Fatal(err)
	}
	partial := `{"type":"message","id":"e90908fe","parentId":"eccc810e","timestamp":"2026-11-22T06:11:18.389Z","message":{"role":"user","content":[{"type":"text","text":` +
		string(payload) + `},{"type":"image","data":"iVBORw0KGgoAAAANSUhEUg`

	title, quoted, ok := titleFromPartialUserLine(partial)
	if !ok {
		t.Fatal("截断的用户消息应能捞到标题")
	}
	if title != "我想要使用这个同步" || quoted != "" {
		t.Fatalf("标题应是正文，实际 %q / %q", title, quoted)
	}
}

func TestTitleFromPartialUserLineImageOnly(t *testing.T) {
	partial := `{"type":"message","message":{"role":"user","content":[{"type":"image","data":"iVBORw0K`
	title, _, ok := titleFromPartialUserLine(partial)
	if !ok || title != "图片消息" {
		t.Fatalf("只有图片时应退成「图片消息」，实际 %q ok=%v", title, ok)
	}
}

func TestTitleFromPartialUserLineIgnoresAssistant(t *testing.T) {
	partial := `{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"hi`
	if _, _, ok := titleFromPartialUserLine(partial); ok {
		t.Fatal("assistant 的截断消息不应被当成标题")
	}
}

// 端到端：首条用户消息带 700 KB base64 图片，摘要仍要给出标题且不标记为空会话。
func TestSummarizeSessionWithHugeFirstMessage(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "2026-11-22T06-11-18-389Z_01a201e1-64f4-735c-b9bf-7fae044d587c.jsonl")

	header := `{"type":"session","version":3,"id":"01a201e1","timestamp":"2026-11-22T06:11:18.389Z","cwd":"C:/work/chat"}`
	content := []any{
		map[string]any{"type": "text", "text": "<file name=\"C:/tmp/shot.png\"></file>\n这张图里是什么"},
		map[string]any{"type": "image", "data": strings.Repeat("A", 700*1024)},
	}
	message := map[string]any{
		"type":    "message",
		"id":      "e90908fe",
		"message": map[string]any{"role": "user", "content": content},
	}
	line, err := json.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	if len(line) <= sessionHeadLimit {
		t.Fatalf("构造的消息行应超过读取窗口，实际 %d 字节", len(line))
	}
	if err := os.WriteFile(file, []byte(header+"\n"+string(line)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	summary, ok := summarizeSessionFile(file)
	if !ok {
		t.Fatal("摘要应成功")
	}
	if summary.Empty {
		t.Fatalf("有用户消息的会话不应被标记为空会话（title=%q）", summary.Title)
	}
	if summary.Title != "这张图里是什么" {
		t.Fatalf("标题应取正文，实际 %q", summary.Title)
	}
}
