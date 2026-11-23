package host

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Pi 自己退出（崩溃 / 启动即失败）时，挂起的请求要立刻失败，Stop 也不能卡住。
// 以前退出回调里重入加锁，整个客户端会永久死锁。
func TestRpcClientSurvivesSelfExit(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("没有 node，跳过")
	}
	dir := t.TempDir()
	script := filepath.Join(dir, "exit.js")
	body := "process.stderr.write(\"boom\\n\");\nsetTimeout(() => process.exit(3), 300);\n"
	if err := os.WriteFile(script, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	client := NewPiRpcClient(PiCommand{Exe: node}, dir, nil, []string{script})
	done := make(chan error, 1)
	go func() {
		if startErr := client.Start(); startErr != nil {
			done <- startErr
			return
		}
		_, callErr := client.Call("getState")
		done <- callErr
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("进程已退出，请求不应成功")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Pi 自己退出后，请求一直等不到结果（客户端死锁）")
	}
	stopped := make(chan struct{})
	go func() {
		_ = client.Stop()
		close(stopped)
	}()
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("Stop 卡住")
	}
}

func TestAtomicWriteKeepsMode(t *testing.T) {
	if isWindows() {
		t.Skip("Windows 没有 Unix 权限位")
	}
	dir := t.TempDir()
	script := filepath.Join(dir, "run.sh")
	writeFile(t, script, "echo 1\n")
	if err := os.Chmod(script, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := atomicWriteText(script, "echo 2\n"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(script)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o755 {
		t.Fatalf("覆盖后权限应保持 0755，实际 %v", info.Mode().Perm())
	}
	fresh := filepath.Join(dir, "token.json")
	if err := atomicWriteText(fresh, "{}"); err != nil {
		t.Fatal(err)
	}
	info, err = os.Stat(fresh)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("新文件应保持 0600，实际 %v", info.Mode().Perm())
	}
}

// git worktree 的 .git 文件里写的是绝对路径。
func TestGitBranchReadsAbsoluteGitdir(t *testing.T) {
	root := t.TempDir()
	gitDir := filepath.Join(root, "main", ".git", "worktrees", "feat")
	writeFile(t, filepath.Join(gitDir, "HEAD"), "ref: refs/heads/pi/feat-demo\n")
	worktree := filepath.Join(root, "wt")
	writeFile(t, filepath.Join(worktree, ".git"), "gitdir: "+filepath.ToSlash(gitDir)+"\r\n")
	if got := gitBranch(worktree); got != "pi/feat-demo" {
		t.Fatalf("branch = %q", got)
	}
}

func TestExternalWriteKeepsDataGuards(t *testing.T) {
	cwd := t.TempDir()
	outside := filepath.Join(t.TempDir(), "notes.txt")
	writeFile(t, outside, "old")
	h := &Host{authorized: map[string]string{}, attachments: map[string]string{}, watcher: newWorkspaceWatcher(nil)}
	defer h.watcher.close()

	// 项目外文件不再要求「先在编辑器里打开过」：桌面端的本分是把内容如实读写。
	if _, err := h.writeWorkspaceFile(cwd, outside, "new", ""); err != nil {
		t.Fatalf("项目外文本应可直接保存：%v", err)
	}
	// 但 revision 冲突检测必须还在：磁盘上被别人改过就挡住，别覆盖
	writeFile(t, outside, "changed-by-someone-else")
	if _, err := h.writeWorkspaceFile(cwd, outside, "mine", "stale-revision"); err == nil {
		t.Fatal("revision 过期时应拒绝覆盖")
	}
	inside := filepath.Join(cwd, "a.txt")
	writeFile(t, inside, "x")
	if _, err := h.writeWorkspaceFile(cwd, inside, "y", ""); err != nil {
		t.Fatalf("项目内的绝对路径应照常可写：%v", err)
	}
}

func TestGitTimeoutForNetworkCommands(t *testing.T) {
	if gitTimeout([]string{"clone", "--", "a", "b"}) <= 120*time.Second {
		t.Fatal("clone 应放宽时限")
	}
	if gitTimeout([]string{"status"}) != 120*time.Second {
		t.Fatal("本地命令保持 120s")
	}
}

func TestHistoryCacheEvictsByBytes(t *testing.T) {
	historyCacheMu.Lock()
	saved := historyCaches
	historyCaches = map[string]*historyCache{
		"a":    {size: 200 * 1024 * 1024},
		"b":    {size: 200 * 1024 * 1024},
		"keep": {size: 10},
	}
	evictHistoryCachesLocked("keep")
	_, kept := historyCaches["keep"]
	remaining := len(historyCaches)
	historyCaches = saved
	historyCacheMu.Unlock()
	if !kept || remaining != 2 {
		t.Fatalf("kept = %v, remaining = %d", kept, remaining)
	}
}
