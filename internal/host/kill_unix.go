//go:build !windows

package host

import "syscall"

func syscallKillTree(pid int) error {
	if pid <= 0 {
		return nil
	}
	// 整个进程组（PTY 子进程通常自成一个组）。
	_ = syscall.Kill(-pid, syscall.SIGTERM)
	_ = syscall.Kill(pid, syscall.SIGTERM)
	return nil
}
