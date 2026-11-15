//go:build !windows

package host

import (
	"os/exec"
	"syscall"
)

func hideWindow(cmd *exec.Cmd) {}

func killProcess(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	// 负 pid 结束整个进程组，避免 Pi 拉起的子进程变成孤儿。
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
}

func setRawCommandLine(cmd *exec.Cmd, line string) {}
