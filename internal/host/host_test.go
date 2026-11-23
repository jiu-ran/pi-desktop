package host

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/egoist/mygo"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSessionHistoryBranchAndPaging(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "s.jsonl")
	lines := []map[string]any{
		{"type": "session", "version": 3, "id": "root"},
		{"type": "message", "id": "a", "parentId": "root", "message": map[string]any{"role": "user", "content": "first"}},
		{"type": "message", "id": "b", "parentId": "a", "message": map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "hello"}}}},
		{"type": "message", "id": "c", "parentId": "b", "message": map[string]any{"role": "user", "content": "second"}},
		{"type": "message", "id": "d", "parentId": "c", "message": map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "world"}}}},
	}
	var b strings.Builder
	for _, line := range lines {
		data, _ := json.Marshal(line)
		b.Write(data)
		b.WriteByte('\n')
	}
	writeFile(t, file, b.String())

	history := readSessionHistory(file)
	if len(history) != 4 {
		t.Fatalf("history = %d, want 4", len(history))
	}
	if asString(history[3]["role"]) != "assistant" {
		t.Fatalf("last role = %v", history[3]["role"])
	}
	page := readSessionHistoryPage(file, 4, 2, 0, 0)
	if page["total"] != 4 || page["startIndex"] != 2 || page["endIndex"] != 4 {
		t.Fatalf("page = %#v", page)
	}
	if got := len(page["messages"].([]map[string]any)); got != 2 {
		t.Fatalf("page messages = %d", got)
	}
}

func TestModelDefaultsWritesPiSettings(t *testing.T) {
	agent := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", agent)
	cwd := t.TempDir()
	t.Cleanup(func() {
		_ = filepath.WalkDir(cwd, func(p string, d os.DirEntry, err error) error {
			if err == nil {
				_ = os.Chmod(p, 0o700)
			}
			return nil
		})
	})

	if _, err := setModelDefaults(cwd, map[string]any{"scope": "global", "provider": "deepseek", "model": "flash", "thinkingLevel": "high"}); err != nil {
		t.Fatal(err)
	}
	state := readSettings(cwd)
	if state.Global["defaultProvider"] != "deepseek" || state.Global["defaultModel"] != "flash" || state.Global["defaultThinkingLevel"] != "high" {
		t.Fatalf("global settings = %#v", state.Global)
	}
	overview := modelDefaultsOverview(cwd)
	if asMap(overview["effective"])["thinkingLevel"] != "high" {
		t.Fatalf("effective = %#v", overview["effective"])
	}
	if _, err := setModelDefaults(cwd, map[string]any{"scope": "global", "provider": "", "model": ""}); err != nil {
		t.Fatal(err)
	}
	state = readSettings(cwd)
	if _, ok := state.Global["defaultProvider"]; ok {
		t.Fatalf("defaultProvider should be removed: %#v", state.Global)
	}
}

func TestToolsToggle(t *testing.T) {
	agent := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", agent)
	cwd := t.TempDir()
	t.Cleanup(func() {
		_ = filepath.WalkDir(cwd, func(p string, d os.DirEntry, err error) error {
			if err == nil {
				_ = os.Chmod(p, 0o700)
			}
			return nil
		})
	})
	result, err := toolsSet(cwd, map[string]any{"scope": "global", "name": "write", "enabled": false})
	if err != nil {
		t.Fatal(err)
	}
	enabled := result["enabledNames"].([]string)
	for _, name := range enabled {
		if name == "write" {
			t.Fatalf("write still enabled: %v", enabled)
		}
	}
	result, err = toolsSet(cwd, map[string]any{"scope": "global", "name": "write", "enabled": true})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, name := range result["enabledNames"].([]string) {
		if name == "write" {
			found = true
		}
	}
	if !found {
		t.Fatal("write was not re-enabled")
	}
}

func TestWorkspaceFiles(t *testing.T) {
	cwd := t.TempDir()
	t.Cleanup(func() {
		_ = filepath.WalkDir(cwd, func(p string, d os.DirEntry, err error) error {
			if err == nil {
				_ = os.Chmod(p, 0o700)
			}
			return nil
		})
	})
	writeFile(t, filepath.Join(cwd, "a.txt"), "hello")
	h := &Host{authorized: map[string]string{}, attachments: map[string]string{}, watcher: newWorkspaceWatcher(nil)}
	defer h.watcher.close()

	entries, err := h.listDirectory(cwd, "")
	if err != nil || len(entries) != 1 || asString(entries[0]["name"]) != "a.txt" {
		t.Fatalf("entries = %#v, err = %v", entries, err)
	}
	data, err := h.readWorkspaceFile(cwd, "a.txt")
	if err != nil || asString(data["content"]) != "hello" {
		t.Fatalf("read = %#v, err = %v", data, err)
	}
	revision := asString(data["revision"])
	written, err := h.writeWorkspaceFile(cwd, "a.txt", "world", revision)
	if err != nil || asString(written["content"]) != "world" {
		t.Fatalf("write = %#v, err = %v", written, err)
	}
	if _, err := h.writeWorkspaceFile(cwd, "a.txt", "stale", revision); err == nil {
		t.Fatal("expected revision conflict")
	}
	created, err := h.createWorkspaceEntry(cwd, "", "b.txt", "file")
	if err != nil || asString(created["name"]) != "b.txt" {
		t.Fatalf("create = %#v, err = %v", created, err)
	}
	renamed, err := h.renameWorkspaceEntry(cwd, "b.txt", "c.txt")
	if err != nil || asString(renamed["name"]) != "c.txt" {
		t.Fatalf("rename = %#v, err = %v", renamed, err)
	}
	if _, err := h.listDirectory(cwd, "../"); err == nil {
		t.Fatal("expected escape rejection")
	}
}

func TestGitOverviewAndWorktree(t *testing.T) {
	mygo.App.SetPath(mygo.PathUserData, t.TempDir())
	defer mygo.App.SetPath(mygo.PathUserData, "")
	cwd := t.TempDir()
	t.Cleanup(func() {
		_ = filepath.WalkDir(cwd, func(p string, d os.DirEntry, err error) error {
			if err == nil {
				_ = os.Chmod(p, 0o700)
			}
			return nil
		})
	})
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = cwd
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v (%s)", args, err, out)
		}
	}
	run("init", "-b", "main")
	run("config", "user.name", "Pi Test")
	run("config", "user.email", "pi@example.com")
	writeFile(t, filepath.Join(cwd, "a.txt"), "one")
	run("add", "-A")
	run("commit", "-m", "first")
	writeFile(t, filepath.Join(cwd, "a.txt"), "two")

	h := &Host{authorized: map[string]string{}, attachments: map[string]string{}, watcher: newWorkspaceWatcher(nil), startGen: map[string]int{}}
	defer h.watcher.close()
	overview, err := h.gitOverview(cwd)
	if err != nil {
		t.Fatal(err)
	}
	if !asBool(overview["isRepo"]) || asString(overview["branch"]) != "main" {
		t.Fatalf("overview = %#v", overview)
	}
	status := overview["status"].([]map[string]any)
	if len(status) != 1 || asString(asMap(status[0])["path"]) != "a.txt" {
		t.Fatalf("status = %#v", status)
	}
	result, err := h.gitAction(cwd, "stage", map[string]any{"all": true})
	if err != nil {
		t.Fatal(err)
	}
	if !asBool(result["ok"]) {
		t.Fatalf("stage = %#v", result)
	}
	if _, err := h.gitAction(cwd, "commit", map[string]any{"message": "second"}); err != nil {
		t.Fatal(err)
	}
	created, err := h.gitWorktreeCreate(cwd, "test-worktree", nil)
	if err != nil {
		t.Fatal(err)
	}
	worktree := asMap(created["worktree"])
	path := asString(worktree["path"])
	if path == "" || !dirExists(path) {
		t.Fatalf("worktree = %#v", created)
	}
	if _, err := h.gitWorktreeRemove(cwd, path, map[string]any{"deleteBranch": true}); err != nil {
		t.Fatal(err)
	}
	if dirExists(path) {
		t.Fatal("worktree still exists")
	}
}

func TestFindReleaseAssetPrefersWindowsSetup(t *testing.T) {
	assets := []githubAsset{
		{Name: "Pi Desktop.exe", BrowserDownloadURL: "https://example.test/portable.exe"},
		{Name: "pi-desktop-setup-0.9.0-amd64.exe", BrowserDownloadURL: "https://example.test/setup.exe"},
	}
	got := findReleaseAssetFor("windows", "amd64", assets)
	if got.Name != "pi-desktop-setup-0.9.0-amd64.exe" {
		t.Fatalf("应优先选择安装包，实际 %q", got.Name)
	}
	got = findReleaseAssetFor("darwin", "arm64", []githubAsset{
		{Name: "pi-desktop-0.9.0-amd64.dmg", BrowserDownloadURL: "https://example.test/a.dmg"},
		{Name: "pi-desktop-0.9.0-arm64.dmg", BrowserDownloadURL: "https://example.test/b.dmg"},
	})
	if got.Name != "pi-desktop-0.9.0-arm64.dmg" {
		t.Fatalf("应选择 arm64 dmg，实际 %q", got.Name)
	}
	got = findReleaseAssetFor("linux", "amd64", []githubAsset{
		{Name: "pi-desktop-0.9.0-amd64.AppImage", BrowserDownloadURL: "https://example.test/a.AppImage"},
		{Name: "pi-desktop-0.9.0-amd64.tar.gz", BrowserDownloadURL: "https://example.test/a.tar.gz"},
	})
	if got.Name != "pi-desktop-0.9.0-amd64.AppImage" {
		t.Fatalf("应优先选择 AppImage，实际 %q", got.Name)
	}
}

func TestLatin1BytesAndTaskID(t *testing.T) {
	raw := latin1Bytes("\x00\x7f\u009b\u00ff")
	want := []byte{0x00, 0x7f, 0x9b, 0xff}
	if !bytes.Equal(raw, want) {
		t.Fatalf("latin1Bytes = %x, want %x", raw, want)
	}
	id := newTaskID()
	parts := strings.Split(id, "-")
	if len(parts) != 3 || parts[0] != "term" || len(parts[1]) != 6 {
		t.Fatalf("unexpected task id = %q", id)
	}
}

func TestAppVersionAndUpdateCleanup(t *testing.T) {
	mygo.App.SetPath(mygo.PathUserData, t.TempDir())
	defer mygo.App.SetPath(mygo.PathUserData, "")

	if ver := appVersion(); ver == "" {
		t.Fatal("appVersion should read package.json version when mygo.App.Version is empty")
	}

	updater := newAppUpdater(nil)
	dir := updater.updatesDir()
	keep := filepath.Join(dir, "pi-desktop-setup-0.9.0-amd64.exe")
	stale := filepath.Join(dir, "pi-desktop-setup-0.8.13-amd64.exe")
	part := keep + ".part"
	writeFile(t, keep, "new")
	writeFile(t, stale, "old")
	writeFile(t, part, "part")

	updater.cleanupDir(keep)
	if !fileExists(keep) {
		t.Fatal("keep installer should remain after cleanupDir")
	}
	if fileExists(stale) || fileExists(part) {
		t.Fatal("stale installer and .part file should be removed")
	}
	updater.cleanup("")
	if fileExists(keep) {
		t.Fatal("cleanup(\"\") should remove all cached installers")
	}
}

func TestWatcherUnwatchAndFlushClosed(t *testing.T) {
	root := t.TempDir()
	w := newWorkspaceWatcher(nil)
	defer w.close()

	w.watch(root)
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 20 {
				w.watch(root)
				w.unwatch(root)
			}
		}()
	}
	wg.Wait()
	w.close()
	w.flush()
}

func TestRendererURLGuardAndCrashLimit(t *testing.T) {
	if !isAllowedRendererURL("mygo://localhost/index.html") {
		t.Fatal("expected mygo://localhost to be allowed")
	}
	if !isAllowedRendererURL("about:blank") {
		t.Fatal("expected about:blank to be allowed")
	}
	if isAllowedRendererURL("https://example.com") {
		t.Fatal("expected external https URL to be blocked from in-app navigation")
	}
	if isAllowedRendererURL("javascript:alert(1)") {
		t.Fatal("expected javascript: URL to be blocked")
	}

	h := New()
	defer Shutdown(h)
	if !h.recordCrashAndShouldReload() || !h.recordCrashAndShouldReload() {
		t.Fatal("first two crashes within 60s should reload")
	}
	if h.recordCrashAndShouldReload() {
		t.Fatal("third crash within 60s should stop auto-reload")
	}
	h.resetCrashWindow()
	if !h.recordCrashAndShouldReload() {
		t.Fatal("after resetCrashWindow should reload again")
	}
}

func TestWorkerSlotConcurrentState(t *testing.T) {
	slot := &workerSlot{}
	var wg sync.WaitGroup
	for i := range 6 {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			for j := range 50 {
				slot.applyState(map[string]any{
					"sessionFile":  "/tmp/s.jsonl",
					"isStreaming":  j%2 == 0,
					"isCompacting": idx%2 == 0,
				}, false)
				slot.setStreaming(true)
				slot.setCompacting(false)
				_, _, _ = slot.stateFields()
				_, _ = slot.snapshotInfo()
				_ = slot.busy()
			}
		}(i)
	}
	wg.Wait()
}

func TestUTF8ChunkDecoderAndUniqueRandomSuffix(t *testing.T) {
	// 3-byte Chinese + 4-byte emoji split at every single byte boundary
	sample := "你好👋世界"
	raw := []byte(sample)
	for split := 1; split < len(raw); split++ {
		var dec utf8ChunkDecoder
		got := dec.decode(raw[:split]) + dec.decode(raw[split:]) + dec.flush()
		if got != sample {
			t.Fatalf("split %d: got %q, want %q", split, got, sample)
		}
	}
	// 1-byte-at-a-time streaming with invalid byte in middle
	var dec utf8ChunkDecoder
	stream := append([]byte("a"), 0xe4, 0xb8, 0xad, 0xff, 0xf0, 0x9f, 0x91, 0x8b, 'z')
	var out strings.Builder
	for i := range stream {
		out.WriteString(dec.decode(stream[i : i+1]))
	}
	out.WriteString(dec.flush())
	if out.String() != "a中\ufffd👋z" {
		t.Fatalf("byte-by-byte got %q", out.String())
	}

	seen := map[string]bool{}
	for range 200 {
		seen[randomSuffix()] = true
	}
	if len(seen) < 190 {
		t.Fatalf("randomSuffix collided too often: %d/200 unique", len(seen))
	}
}

func TestRpcOnEventUnsubscribeByID(t *testing.T) {
	c := NewPiRpcClient(PiCommand{}, "", nil, nil)
	var a, b int
	offA := c.OnEvent(func(map[string]any) { a++ })
	offB := c.OnEvent(func(map[string]any) { b++ })

	c.handleLine(`{"type":"agent_start"}`)
	offA()
	c.handleLine(`{"type":"agent_start"}`)
	offB()
	c.handleLine(`{"type":"agent_start"}`)

	if a != 1 || b != 2 {
		t.Fatalf("listener counts a=%d b=%d, want a=1 b=2", a, b)
	}
}

func TestSessionHistoryCacheConcurrentReads(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "concurrent.jsonl")
	writeFile(t, file, `{"type":"session","version":3,"id":"r"}`+"\n"+
		`{"type":"message","id":"m1","parentId":"r","message":{"role":"user","content":"hi"}}`+"\n")
	defer clearSessionHistoryCache(file)

	var wg sync.WaitGroup
	for range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 25 {
				hist := readSessionHistory(file)
				if len(hist) == 0 {
					t.Error("expected non-empty history")
					return
				}
			}
		}()
	}
	wg.Wait()
}

func TestTerminalManagerPrunesOldestFinished(t *testing.T) {
	h := New()
	defer Shutdown(h)
	m := h.terminals
	for i := 1; i <= 25; i++ {
		task := &terminalTask{
			id:        fmt.Sprintf("t-%02d", i),
			finished:  true,
			status:    "exited",
			startedAt: int64(i * 10),
			endedAt:   int64(i * 100),
		}
		m.add(task)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.tasks) != 20 {
		t.Fatalf("tasks len = %d, want 20", len(m.tasks))
	}
	for i := 1; i <= 5; i++ {
		if _, exists := m.tasks[fmt.Sprintf("t-%02d", i)]; exists {
			t.Fatalf("oldest finished task t-%02d should have been pruned", i)
		}
	}
	for i := 6; i <= 25; i++ {
		if _, exists := m.tasks[fmt.Sprintf("t-%02d", i)]; !exists {
			t.Fatalf("newer finished task t-%02d should be retained", i)
		}
	}
}

func TestHostChildEnvAndEnvSlice(t *testing.T) {
	h := New()
	defer Shutdown(h)
	h.networkApply("custom", "http://127.0.0.1:7890")
	env := h.childEnv()
	if env["HTTPS_PROXY"] != "http://127.0.0.1:7890" || env["HTTP_PROXY"] != "http://127.0.0.1:7890" {
		t.Fatalf("unexpected proxy env: %#v", env)
	}
	joined := strings.Join(envSlice(env, "GIT_TERMINAL_PROMPT=0"), "\n")
	if !strings.Contains(joined, "HTTPS_PROXY=http://127.0.0.1:7890") || !strings.Contains(joined, "GIT_TERMINAL_PROMPT=0") {
		t.Fatalf("envSlice missing expected entries")
	}
	h.networkApply("direct", "")
	envDirect := h.childEnv()
	if envDirect["NO_PROXY"] != "*" || envDirect["HTTPS_PROXY"] != "" {
		t.Fatalf("unexpected direct env: %#v", envDirect)
	}
}

// 最近项目：最后一次打开的目录必须排在最前，而且不能被「去重」顺手删掉。
// 之前的写法是「先把新路径拼到最前，再过滤掉与它相同的项」，结果刚加的那条被删了，
// 最近项目永远是空的，重启后回到空白页。
func TestWriteRecentKeepsNewestFirst(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "first")
	second := filepath.Join(dir, "second")
	for _, path := range []string{first, second} {
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	file := filepath.Join(dir, "recent-workspaces.json")

	writeRecent(file, first)
	if got := readRecent(file); len(got) != 1 || got[0] != first {
		t.Fatalf("after opening first: %#v", got)
	}

	// 再打开第二个、然后回到第一个：两个都要在，顺序按最近打开
	writeRecent(file, second)
	writeRecent(file, first)
	got := readRecent(file)
	if len(got) != 2 || got[0] != first || got[1] != second {
		t.Fatalf("recent order wrong: %#v", got)
	}

	// 不存在的目录在读取时被丢掉，但不会影响其它项
	if err := os.RemoveAll(second); err != nil {
		t.Fatal(err)
	}
	if got := readRecent(file); len(got) != 1 || got[0] != first {
		t.Fatalf("missing dir should be dropped: %#v", got)
	}
}

// 更新检查的缓存 / 304 分支要按「当前版本」重算有没有更新。
// 否则 0.8.14 时看到的「0.9.0 有更新」在升级到 0.9.0 之后会一直挂着。
func TestUpdateCheckRecomputesAvailability(t *testing.T) {
	cached := appUpdateCheck{Latest: "0.9.0", UpdateAvailable: true}
	if got := cached.withCurrent("0.9.0"); got.UpdateAvailable {
		t.Fatalf("same version must not look like an update: %#v", got)
	}
	if !cached.withCurrent("0.8.14").UpdateAvailable {
		t.Fatalf("older current version should still see the update")
	}
	if cached.withCurrent("0.9.0").cachedResult().Cached != true {
		t.Fatalf("cached result should be flagged")
	}
	empty := appUpdateCheck{}
	if empty.withCurrent("0.9.0").UpdateAvailable {
		t.Fatalf("empty latest must not look like an update")
	}
	if compareVersions("v0.9.0", "0.9.0") != 0 || compareVersions("0.10.0", "0.9.9") <= 0 {
		t.Fatalf("version comparison broken")
	}
}

// 「恢复 Pi 默认」= 删掉 defaultTools 键。写成空数组是反的：在 Pi 里空数组表示全部关闭。
func TestToolsResetRemovesSelection(t *testing.T) {
	agent := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", agent)
	global := filepath.Join(agent, "settings.json")
	if err := os.WriteFile(global, []byte(`{"defaultTools":["bash","edit"],"tuiMode":"fullscreen"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	reset, err := toolsReset("", map[string]any{"scope": "global"})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(global)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "defaultTools") {
		t.Fatalf("defaultTools 应该被删掉：%s", raw)
	}
	if !strings.Contains(string(raw), "fullscreen") {
		t.Fatalf("其它键不能被一起删掉：%s", raw)
	}

	enabled, _ := reset["enabledNames"].([]string)
	if len(enabled) != 4 {
		t.Fatalf("恢复后应回到 Pi 默认的 4 个工具，实际 %v", enabled)
	}
	for _, name := range []string{"read", "bash", "edit", "write"} {
		if !strings.Contains(strings.Join(enabled, ","), name) {
			t.Fatalf("默认工具缺少 %s：%v", name, enabled)
		}
	}
	if reset["globalConfigured"] != false {
		t.Fatalf("恢复后 globalConfigured 应为 false")
	}
}

// 什么都没配 → 显示 Pi 的默认 4 个（不是 0；0 只应该出现在显式空数组时）。
func TestToolsOverviewDefaultsWhenUnconfigured(t *testing.T) {
	agent := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", agent)
	overview := toolsOverview("")
	enabled := overview["enabledNames"].([]string)
	if len(enabled) != 4 {
		t.Fatalf("未配置时应是 Pi 默认的 4 个，实际 %v", enabled)
	}
	if overview["globalConfigured"] != false {
		t.Fatalf("未配置时 globalConfigured 应为 false")
	}
	if overview["effectiveScope"] != "default" {
		t.Fatalf("effectiveScope 应为 default，实际 %v", overview["effectiveScope"])
	}
}

// 显式空数组 = 全部关掉（和「没配」必须区分开）。
func TestToolsEmptyArrayDisablesAll(t *testing.T) {
	agent := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", agent)
	if err := os.WriteFile(filepath.Join(agent, "settings.json"), []byte(`{"defaultTools":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	overview := toolsOverview("")
	if enabled := overview["enabledNames"].([]string); len(enabled) != 0 {
		t.Fatalf("空数组应一个都不启用，实际 %v", enabled)
	}
	if overview["globalConfigured"] != true {
		t.Fatalf("空数组也算配置过，globalConfigured 应为 true")
	}
}

// 会话改名记录可能离文件末尾很远（改完之后又追加了几十上百 MB），只看尾部会退回首条消息当标题，
// 于是桌面端显示的名字和 Pi CLI 不一致。
func TestSessionNameFoundBeyondTailWindow(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "2026-10-19T11-07-51-575Z_01a153d8.jsonl")
	var body strings.Builder
	body.WriteString(`{"type":"session","id":"s1","timestamp":"2026-10-19T11:07:51.000Z","cwd":"C:\work"}` + "\n")
	body.WriteString(`{"type":"message","id":"m1","parentId":null,"timestamp":"2026-10-19T11:07:51.700Z","message":{"role":"user","content":[{"type":"text","text":"请先了解一下本项目"}]}}` + "\n")
	body.WriteString(`{"type":"session_info","id":"n1","parentId":"m1","timestamp":"2026-10-23T15:07:03.095Z","name":"Pi Desktop"}` + "\n")
	pad := strings.Repeat("x", 900)
	for i := 0; i < 4000; i++ {
		body.WriteString(fmt.Sprintf(`{"type":"message","id":"m%d","parentId":"m1","timestamp":"2026-10-24T00:00:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"%s"}]}}`+"\n", i, pad))
	}
	if err := os.WriteFile(file, []byte(body.String()), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() < 3*1024*1024 {
		t.Fatalf("测试文件太小，没覆盖到尾部窗口之外：%d", info.Size())
	}
	if got := readSessionName(file, info.Size(), "请先了解一下本项目"); got != "Pi Desktop" {
		t.Fatalf("应读到远处的改名记录，实际 %q", got)
	}
	// 缓存之后继续追加内容，名字不能丢
	handle, err := os.OpenFile(file, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()
	if _, err := handle.WriteString(`{"type":"message","id":"mz","parentId":"m1","timestamp":"2026-10-25T00:00:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"more"}]}}` + "\n"); err != nil {
		t.Fatal(err)
	}
	if got := readSessionName(file, info.Size(), "请先了解一下本项目"); got != "Pi Desktop" {
		t.Fatalf("追加内容后名字丢了，实际 %q", got)
	}
}

// 改名（含清除）写在文件末尾时要立刻生效，不能等下次全量扫描。
func TestSessionNamePicksUpLaterRename(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "2026-11-16T00-00-00-000Z_rename.jsonl")
	body := `{"type":"session","id":"s2","timestamp":"2026-11-16T00:00:00.000Z"}` + "\n" +
		`{"type":"message","id":"m1","parentId":null,"timestamp":"2026-11-16T00:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"原始标题"}]}}` + "\n"
	if err := os.WriteFile(file, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(file)
	if got := readSessionName(file, info.Size(), "原始标题"); got != "原始标题" {
		t.Fatalf("没有改名记录时应回落到首条消息，实际 %q", got)
	}

	appendLine := func(line string) {
		handle, err := os.OpenFile(file, os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			t.Fatal(err)
		}
		defer handle.Close()
		if _, err := handle.WriteString(line + "\n"); err != nil {
			t.Fatal(err)
		}
	}
	appendLine(`{"type":"session_info","id":"n1","parentId":"m1","timestamp":"2026-11-16T00:00:02.000Z","name":"改过的名字"}`)
	if got := readSessionName(file, info.Size(), "原始标题"); got != "改过的名字" {
		t.Fatalf("追加的改名没生效，实际 %q", got)
	}
	appendLine(`{"type":"session_info","id":"n2","parentId":"n1","timestamp":"2026-11-16T00:00:03.000Z","name":""}`)
	// 空名字表示清除自定义标题：调用方（会话列表 / snapshot）会回落到首条消息
	if got := readSessionName(file, info.Size(), "原始标题"); got != "" {
		t.Fatalf("清空名字后应返回空标题，实际 %q", got)
	}
}

// 引用会话的消息开头顶着 <session name="…" title="…"> 原文，标题要取被引用会话的名字。
// 引用会话的消息开头顶着 <session name="…" title="…"> 原文，标题要取被引用会话的名字。
func TestSessionTitleFromQuotedSession(t *testing.T) {
	quote := func(title, tail string) string {
		return `<session name="C:/agent/sessions/--C--x--/2026-10-19T11-07-51-575Z_01a153d8.jsonl" title="` + title + `" messages="8">
<session name="…">正文略</session>
</session>` + tail
	}
	cases := []struct{ input, want string }{
		{quote("Pi Desktop", ""), "Pi Desktop（引用）"},
		{quote("Pi Desktop（引用）", ""), "Pi Desktop（引用）"},
		{quote("A &amp; B", ""), "A & B（引用）"},
		// 引用块后面还有用户自己写的内容时，用那段内容当标题
		{quote("Pi Desktop", "\n你是否能调用内置工具"), "你是否能调用内置工具"},
		{"普通消息", "普通消息"},
		{"<file name=\"C:/a/b.md\"></file>", "b.md"},
	}
	for _, item := range cases {
		if got := sessionTitleFromText(item.input); got != item.want {
			t.Fatalf("标题应为 %q，实际 %q", item.want, got)
		}
	}
	// 没有 title 属性时保持原样（退回首条消息原文），不要凭空造名字
	if got := sessionTitleFromText(quote("", "")); !strings.HasPrefix(got, "<session name=") {
		t.Fatalf("没有标题时不应改写，实际 %q", got)
	}
	long := strings.Repeat("长", 60)
	got := sessionTitleFromText(quote(long, ""))
	if !strings.HasSuffix(got, quotedTitleSuffix) || len([]rune(got)) > sessionTitleMax {
		t.Fatalf("超长标题要截断并保留后缀，实际 %q（%d 字符）", got, len([]rune(got)))
	}
}

// 引用头里记的是「引用那一刻」的标题；被引用会话后来改了名，列表要跟上新名字。
func TestQuotedTitleUsesLiveSessionName(t *testing.T) {
	// 引用头里的路径只允许指向 agent 会话目录（见 liveSessionTitle 的限制）
	t.Setenv("PI_CODING_AGENT_DIR", t.TempDir())
	dir := filepath.Join(agentSessionsRoot(), "quote-live")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	quoted := filepath.Join(dir, "2026-10-19T11-07-51-575Z_quoted.jsonl")
	body := `{"type":"session","id":"q1","timestamp":"2026-10-19T11:07:51.000Z"}` + "\n" +
		`{"type":"message","id":"m1","parentId":null,"timestamp":"2026-10-19T11:07:52.000Z","message":{"role":"user","content":[{"type":"text","text":"请先了解一下本项目"}]}}` + "\n" +
		`{"type":"session_info","id":"n1","parentId":"m1","timestamp":"2026-10-23T15:07:03.095Z","name":"Pi Desktop"}` + "\n"
	if err := os.WriteFile(quoted, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	// 引用时记下的还是旧标题；用户自己写的内容优先当标题，出处跟上传记后的名字
	header := `<session name="` + strings.ReplaceAll(quoted, `\`, `/`) + `" title="请先了解一下本项目" messages="8">
<session name="…">正文略</session>
</session>`
	text := header + "\n帮我看看这个"
	if got := userTextTitle(text); got != "帮我看看这个" {
		t.Fatalf("有正文时标题应是正文，实际 %q", got)
	}
	if _, quotedName, ok := resolveQuotedMessage(text); !ok || quotedName != "Pi Desktop" {
		t.Fatalf("应跟上传记后的名字，实际 %q（识别=%v）", quotedName, ok)
	}
	// 只有引用块、且被引用会话不存在时，退回引用时记下的标题
	missing := `<session name="C:/nope/does-not-exist.jsonl" title="旧标题" messages="8">正文</session>`
	if got := userTextTitle(missing); got != "旧标题（引用）" {
		t.Fatalf("找不到被引用会话时应退回记下的标题，实际 %q", got)
	}
	if got := sessionTitleFromText(text); got != "帮我看看这个" {
		t.Fatalf("纯函数也应按正文取标题（不读文件），实际 %q", got)
	}
}

func readDefaultTools(t *testing.T, file string) ([]string, bool) {
	t.Helper()
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	entries, ok := value["defaultTools"]
	if !ok {
		return nil, false
	}
	items, _ := entries.([]any)
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, asString(item))
	}
	return out, true
}

// 开关写成 Pi 的增量写法（+name / -name），这样 Pi 以后调整默认集合时会跟着走。
func TestToolsToggleWritesModifiers(t *testing.T) {
	agent := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", agent)
	cwd := t.TempDir()
	file := filepath.Join(agent, "settings.json")

	// 没配置过 → 打开 grep：只记 +grep
	if _, err := toolsSet(cwd, map[string]any{"scope": "global", "name": "grep", "enabled": true}); err != nil {
		t.Fatal(err)
	}
	if entries, ok := readDefaultTools(t, file); !ok || len(entries) != 1 || entries[0] != "+grep" {
		t.Fatalf("打开 grep 应写 [+grep]，实际 %v（存在=%v）", entries, ok)
	}

	// 起 Pi 时把结果翻译成 --tools 参数
	if args := strings.Join(toolArgs(cwd), " "); !strings.Contains(args, "+grep") {
		t.Fatalf("--tools 里应带上 +grep，实际 %q", args)
	}
	// 再关掉 grep → 与继承一致，键直接删掉（不能留空数组）
	result, err := toolsSet(cwd, map[string]any{"scope": "global", "name": "grep", "enabled": false})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := readDefaultTools(t, file); ok {
		t.Fatal("关回去后应该删掉 defaultTools 键")
	}
	if enabled := result["enabledNames"].([]string); len(enabled) != 4 {
		t.Fatalf("应回到 Pi 默认的 4 个，实际 %v", enabled)
	}

	// 关掉默认工具 → 只记 -bash
	if _, err := toolsSet(cwd, map[string]any{"scope": "global", "name": "bash", "enabled": false}); err != nil {
		t.Fatal(err)
	}
	if entries, _ := readDefaultTools(t, file); len(entries) != 1 || entries[0] != "-bash" {
		t.Fatalf("关掉 bash 应写 [-bash]，实际 %v", entries)
	}
}

// 全部关掉要写成空数组（Pi 里 [] 表示一个都不启用），不是四个 -name。
func TestToolsToggleAllOffWritesEmptyArray(t *testing.T) {
	agent := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", agent)
	cwd := t.TempDir()
	for _, name := range []string{"read", "bash", "edit", "write"} {
		if _, err := toolsSet(cwd, map[string]any{"scope": "global", "name": name, "enabled": false}); err != nil {
			t.Fatal(err)
		}
	}
	entries, ok := readDefaultTools(t, filepath.Join(agent, "settings.json"))
	if !ok || len(entries) != 0 {
		t.Fatalf("全关应写 [] ，实际 %v（存在=%v）", entries, ok)
	}
}

// 项目级只记与全局的差异，跟着全局走。
func TestToolsProjectWritesDiffAgainstGlobal(t *testing.T) {
	agent := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", agent)
	if err := os.WriteFile(filepath.Join(agent, "settings.json"), []byte(`{"defaultTools":["+grep"],"defaultProjectTrust":"always"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	cwd := t.TempDir()
	projectFile := filepath.Join(cwd, ".pi", "settings.json")

	// 继承全局 = read/bash/edit/write/grep（5 个），项目里关掉 grep → -grep
	result, err := toolsSet(cwd, map[string]any{"scope": "project", "name": "grep", "enabled": false})
	if err != nil {
		t.Fatal(err)
	}
	if entries, _ := readDefaultTools(t, projectFile); len(entries) != 1 || entries[0] != "-grep" {
		t.Fatalf("项目级应写 [-grep]，实际 %v", entries)
	}
	enabled := result["enabledNames"].([]string)
	if len(enabled) != 4 {
		t.Fatalf("项目里关掉 grep 后应剩 4 个，实际 %v", enabled)
	}

	// 再打开 → 与全局一致，项目设置里的键删掉（跟随全局）
	if _, err := toolsSet(cwd, map[string]any{"scope": "project", "name": "grep", "enabled": true}); err != nil {
		t.Fatal(err)
	}
	if _, ok := readDefaultTools(t, projectFile); ok {
		t.Fatal("与全局一致后应删掉项目里的 defaultTools")
	}
}

// 旧版写过完整清单的文件，切开关后要重写成等价的增量写法。
func TestToolsToggleRewritesLegacyPlainList(t *testing.T) {
	agent := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", agent)
	cwd := t.TempDir()
	file := filepath.Join(agent, "settings.json")
	if err := os.WriteFile(file, []byte(`{"defaultTools":["grep"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := toolsSet(cwd, map[string]any{"scope": "global", "name": "find", "enabled": true}); err != nil {
		t.Fatal(err)
	}
	entries, _ := readDefaultTools(t, file)
	want := []string{"-read", "-bash", "-edit", "-write", "+grep", "+find"}
	if strings.Join(entries, ",") != strings.Join(want, ",") {
		t.Fatalf("应重写成 %v，实际 %v", want, entries)
	}
}

// 引用会话的标题优先用用户自己写的内容；只有引用块时才用「原会话名（引用）」。
func TestQuotedMessageTitlePrefersUserText(t *testing.T) {
	// 引用头里的路径只允许指向 agent 会话目录（见 liveSessionTitle 的限制）
	t.Setenv("PI_CODING_AGENT_DIR", t.TempDir())
	dir := filepath.Join(agentSessionsRoot(), "quote-test")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	quoted := filepath.Join(dir, "2026-10-19T11-07-51-575Z_quoted.jsonl")
	body := `{"type":"session","id":"q1","timestamp":"2026-10-19T11:07:51.000Z"}` + "\n" +
		`{"type":"session_info","id":"n1","parentId":null,"timestamp":"2026-10-23T15:07:03.095Z","name":"Pi Desktop"}` + "\n"
	if err := os.WriteFile(quoted, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	header := `<session name="` + strings.ReplaceAll(quoted, `\`, `/`) + `" title="旧标题" messages="8">正文略</session>`

	messageLine := func(text string) string {
		content, _ := json.Marshal([]map[string]any{{"type": "text", "text": text}})
		entry, _ := json.Marshal(map[string]any{
			"type":      "message",
			"id":        "m1",
			"parentId":  nil,
			"timestamp": "2026-11-16T00:00:00.000Z",
			"message":   map[string]any{"role": "user", "content": json.RawMessage(content)},
		})
		return string(entry)
	}

	title, quotedName := firstUserTitleWithQuote([]string{messageLine(header + "\n你是否能调用内置工具")}, false)
	if title != "你是否能调用内置工具" {
		t.Fatalf("有正文时标题应是正文，实际 %q", title)
	}
	if quotedName != "Pi Desktop" {
		t.Fatalf("引用的会话名应为 Pi Desktop，实际 %q", quotedName)
	}

	title, quotedName = firstUserTitleWithQuote([]string{messageLine(header)}, false)
	if title != "Pi Desktop（引用）" {
		t.Fatalf("只有引用块时标题应是「Pi Desktop（引用）」，实际 %q", title)
	}
	if quotedName != "Pi Desktop" {
		t.Fatalf("引用的会话名应为 Pi Desktop，实际 %q", quotedName)
	}

	// 普通消息不受影响
	title, quotedName = firstUserTitleWithQuote([]string{messageLine("普通消息")}, false)
	if title != "普通消息" || quotedName != "" {
		t.Fatalf("普通消息应为 (普通消息, 空)，实际 (%q, %q)", title, quotedName)
	}
}
