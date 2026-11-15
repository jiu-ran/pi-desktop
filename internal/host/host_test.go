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
