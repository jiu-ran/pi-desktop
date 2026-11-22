package host

import (
	"os"
	"path/filepath"
	"testing"
)

// 快照里的 messages 只在首屏用一次，界面随后从会话文件分页补齐；
// 只有会话文件不存在或为空时才需要让 pi 把整份消息再传一遍。
func TestRpcMessagesNeeded(t *testing.T) {
	dir := t.TempDir()
	empty := filepath.Join(dir, "empty.jsonl")
	if err := os.WriteFile(empty, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	filled := filepath.Join(dir, "filled.jsonl")
	if err := os.WriteFile(filled, []byte("{\"type\":\"session\"}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		file string
		want bool
	}{
		{"没有会话文件", "", true},
		{"文件不存在", filepath.Join(dir, "missing.jsonl"), true},
		{"空文件", empty, true},
		{"已经有内容", filled, false},
	}
	for _, item := range cases {
		if got := rpcMessagesNeeded(item.file); got != item.want {
			t.Fatalf("%s：rpcMessagesNeeded=%v，期望 %v", item.name, got, item.want)
		}
	}
}
