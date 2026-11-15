package host

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
	writeFile(t, filepath.Join(cwd, "a.txt"), "hello")
	h := &Host{authorized: map[string]string{}, attachments: map[string]string{}, watcher: newWorkspaceWatcher(nil)}

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
