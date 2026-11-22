package host

import (
	"strings"
	"testing"
)

// 历史分页把大图换成引用（只带 ref），小图继续内联；不能改动缓存里的原始历史。
func TestHistoryForPageReplacesLargeImages(t *testing.T) {
	big := strings.Repeat("A", historyInlineImageLimit+16)
	history := []map[string]any{
		{
			"role": "user",
			"content": []any{
				map[string]any{"type": "text", "text": "看看这张图"},
				map[string]any{"type": "image", "mimeType": "image/png", "data": big},
				map[string]any{"type": "image", "mimeType": "image/png", "data": "tiny"},
			},
		},
	}

	page := historyForPage(history, "C:/sessions/a.jsonl")
	parts := page[0]["content"].([]any)
	large := asMap(parts[1])
	small := asMap(parts[2])

	if data := asString(large["data"]); data != "" {
		t.Fatalf("大图不应再内联，实际还有 %d 字节", len(data))
	}
	ref := asString(large["ref"])
	if !strings.HasPrefix(ref, "C:/sessions/a.jsonl|0:1") {
		t.Fatalf("ref 形状不对：%q", ref)
	}
	if asString(small["data"]) != "tiny" {
		t.Fatal("小图应继续内联")
	}

	// 原始历史不能被改写（后面还会用到）
	original := asMap(history[0]["content"].([]any)[1])
	if len(asString(original["data"])) != len(big) {
		t.Fatal("historyForPage 不应修改缓存里的原数据")
	}
}

func TestParseImageRef(t *testing.T) {
	file, messageIndex, partIndex, ok := parseImageRef("C:/a/b.jsonl|3:2")
	if !ok || file != "C:/a/b.jsonl" || messageIndex != 3 || partIndex != 2 {
		t.Fatalf("解析失败：%q %d %d %v", file, messageIndex, partIndex, ok)
	}
	for _, bad := range []string{"", "no-bar", "C:/a.jsonl|x:1", "C:/a.jsonl|1:y", "|1:2"} {
		if _, _, _, ok := parseImageRef(bad); ok {
			t.Fatalf("%q 不应被当成合法引用", bad)
		}
	}
}
