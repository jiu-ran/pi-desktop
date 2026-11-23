//go:build windows

package host

import (
	"os/exec"
	"strconv"
	"syscall"
)

func hideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= 0x08000000 // CREATE_NO_WINDOW
}

func prepareProcessGroup(cmd *exec.Cmd) {}

func killProcess(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	// 先连子孙一起杀：npm / node / ssh 这类孙进程握着继承来的管道，
	// 只杀直接子进程时 CombinedOutput 会一直等在 ReadAll 上。
	kill := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))
	hideWindow(kill)
	_ = kill.Run()
	_ = cmd.Process.Kill()
}

// setRawCommandLine 把完整命令行原样交给 CreateProcess。
// cmd.exe 的 /S /C 需要外层引号，而 Go 的 exec 会转义 Args 里的引号，
// 所以这里必须绕过 Args 自己拼命令行。
func setRawCommandLine(cmd *exec.Cmd, line string) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CmdLine = line
}
