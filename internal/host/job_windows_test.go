//go:build windows

package host

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// 宿主退出时靠 Job 的 KILL_ON_JOB_CLOSE 连带结束 Pi 拉起的 MCP server 等子孙进程。
// 这里验证两件事：直接子进程进了 Job，以及它再拉起的孙进程自动继承同一个 Job。
func TestJoinChildJobCoversDescendants(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("没有 node，跳过")
	}
	dir := t.TempDir()
	script := filepath.Join(dir, "child.js")
	pidFile := filepath.Join(dir, "pid.txt")
	if err := os.WriteFile(script, []byte(`require("fs").writeFileSync(process.argv[2], String(process.pid)); setTimeout(() => {}, 60000);`), 0o644); err != nil {
		t.Fatal(err)
	}
	line := fmt.Sprintf(`"%s" "%s" "%s"`, strings.ReplaceAll(node, `"`, `""`), script, pidFile)
	cmd := exec.Command("cmd.exe")
	setRawCommandLine(cmd, `"cmd.exe" /d /s /c "`+line+`"`)
	hideWindow(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	job := newProcessJob()
	job.join(cmd.Process)

	if job == 0 {
		t.Fatal("Job 对象没创建成功")
	}
	defer func() {
		_ = cmd.Process.Kill()
		if raw, err := os.ReadFile(pidFile); err == nil {
			if pid, convErr := strconv.Atoi(strings.TrimSpace(string(raw))); convErr == nil {
				if proc, findErr := os.FindProcess(pid); findErr == nil {
					_ = proc.Kill()
				}
			}
		}
	}()

	if !job.contains(uint32(cmd.Process.Pid)) {
		t.Fatal("cmd.exe 不在 Job 里")
	}

	deadline := time.Now().Add(15 * time.Second)
	for {
		raw, readErr := os.ReadFile(pidFile)
		if readErr == nil && len(strings.TrimSpace(string(raw))) > 0 {
			pid, convErr := strconv.Atoi(strings.TrimSpace(string(raw)))
			if convErr == nil {
				if !job.contains(uint32(pid)) {
					t.Fatalf("孙进程 %d 没继承 Job，退出时会变孤儿", pid)
				}
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("等不到孙进程启动")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// 停一个 Pi worker 时，它拉起的子孙进程（MCP server 之类）必须一起结束，
// 否则用户在任务管理器里会看到「关掉软件后 Pi 还挂在那」。
func TestStopKillsDescendants(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("没有 node，跳过")
	}
	dir := t.TempDir()
	script := filepath.Join(dir, "worker.js")
	pidFile := filepath.Join(dir, "grandchild.txt")
	body := `const { spawn } = require("child_process");
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
require("fs").writeFileSync(process.argv[2], String(child.pid));
setTimeout(() => {}, 60000);
`
	if err := os.WriteFile(script, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	client := NewPiRpcClient(PiCommand{Exe: node}, dir, nil, []string{script, pidFile})
	if err := client.Start(); err != nil {
		t.Fatalf("启动失败：%v", err)
	}

	grandchild := 0
	deadline := time.Now().Add(15 * time.Second)
	for grandchild == 0 {
		if raw, readErr := os.ReadFile(pidFile); readErr == nil && len(strings.TrimSpace(string(raw))) > 0 {
			grandchild, _ = strconv.Atoi(strings.TrimSpace(string(raw)))
		} else if time.Now().After(deadline) {
			_ = client.Stop()
			t.Fatal("等不到孙进程启动")
		} else {
			time.Sleep(50 * time.Millisecond)
		}
	}

	if err := client.Stop(); err != nil {
		t.Fatalf("停止失败：%v", err)
	}

	gone := false
	for _, wait := range []time.Duration{50, 100, 200, 400, 800} {
		time.Sleep(wait * time.Millisecond)
		if !processAlive(grandchild) {
			gone = true
			break
		}
	}
	if !gone {
		t.Fatalf("孙进程 %d 在 Stop 之后仍活着", grandchild)
	}
}

// processAlive 判断 pid 是否还能被打开（Windows 上 FindProcess 拿不到真实句柄）。
func processAlive(pid int) bool {
	handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return false
	}
	syscall.CloseHandle(handle)
	return true
}
