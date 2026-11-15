//go:build !windows

package host

import "os"

// 非 Windows 平台靠进程组（Setpgid + kill(-pid)）连带结束子进程，Job 相关全是空实现。
type processJob int

func newProcessJob() processJob               { return 0 }
func (j processJob) join(proc *os.Process)    {}
func (j processJob) terminate()               {}
func (j processJob) close()                   {}
func (j processJob) contains(pid uint32) bool { return false }
func terminalJob() processJob                 { return 0 }
