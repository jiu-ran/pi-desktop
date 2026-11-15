//go:build !windows

package host

import (
	"os/exec"
	"syscall"
)

func hideWindow(cmd *exec.Cmd) {}

func prepareProcessGroup(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}

func killProcess(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	// 负 pid 结束整个进程组，避免 Pi 拉起的子进程变成孤儿。
	if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM); err != nil {
		_ = syscall.Kill(cmd.Process.Pid, syscall.SIGTERM)
	}
}

func setRawCommandLine(cmd *exec.Cmd, line string) {}
