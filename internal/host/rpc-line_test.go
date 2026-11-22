package host

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

// 4K 图片的 base64 可能把单行 JSON 撑到十几 MB。readStdout 用 bufio.Scanner
// 时 token 上限是 16 MB，超了 Scan 直接返回 false —— 事件流静默中断，
// get_messages 之类的请求永远等不到回应，会话就「打不开」了。
func TestReadStdoutHandlesHugeSingleLine(t *testing.T) {
	const blobSize = 24 * 1024 * 1024
	payload := map[string]any{
		"id":   "big",
		"type": "event",
		"data": strings.Repeat("A", blobSize),
	}
	line, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	reader := io.MultiReader(
		bytes.NewReader(line),
		bytes.NewReader([]byte("\n")),
		bytes.NewReader([]byte(`{"type":"event","id":"after"}`+"\n")),
	)

	got := []map[string]any{}
	client := &PiRpcClient{}
	client.OnEvent(func(event map[string]any) { got = append(got, event) })
	if err := client.readStdout(reader); err != nil {
		t.Fatalf("读取超长行不应报错：%v", err)
	}
	if len(got) != 2 {
		t.Fatalf("应读到 2 条消息，实际 %d 条（超长行之后的流被丢掉了）", len(got))
	}
	if data, _ := got[0]["data"].(string); len(data) != blobSize {
		t.Fatalf("第一条数据长度应为 %d，实际 %d", blobSize, len(data))
	}
}
