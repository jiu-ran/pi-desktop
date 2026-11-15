//go:build windows

package host

import (
	"os"
	"sync"
	"syscall"
	"unsafe"
)

// Windows 没有「父进程退出就带走子进程」的语义：`Process.Kill()` 只结束直接子进程，
// Pi 自己拉起的 MCP server、子代理会变成孤儿一直挂着。
//
// 这里用 Job 对象兜底：设 KILL_ON_JOB_CLOSE 之后，关闭 Job 句柄（或持有它的宿主
// 进程退出，句柄被系统关掉）就会连带结束 Job 里所有进程及其子孙。加入 Job 的进程
// 再生出来的孩子自动属于同一个 Job，所以不怕中间那层父进程先退出。
const (
	jobObjectExtendedLimitInformation = 9
	jobObjectLimitKillOnJobClose      = 0x2000
	processTerminate                  = 0x0001
	processSetQuota                   = 0x0100
	processQueryLimitedInformation    = 0x1000
)

type ioCounters struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type jobBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type jobExtendedLimitInformation struct {
	BasicLimitInformation jobBasicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

var (
	kernel32                     = syscall.NewLazyDLL("kernel32.dll")
	procCreateJobObjectW         = kernel32.NewProc("CreateJobObjectW")
	procSetInformationJobObject  = kernel32.NewProc("SetInformationJobObject")
	procAssignProcessToJobObject = kernel32.NewProc("AssignProcessToJobObject")
	procTerminateJobObject       = kernel32.NewProc("TerminateJobObject")
	procIsProcessInJob           = kernel32.NewProc("IsProcessInJob")

	terminalJobOnce   sync.Once
	terminalJobHandle processJob
)

// processJob 是一个 Windows Job 对象的句柄；0 表示没建起来（此时退回只杀直接子进程）。
type processJob uintptr

// newProcessJob 建一个「句柄关闭就结束里面所有进程」的 Job。
func newProcessJob() processJob {
	handle, _, _ := procCreateJobObjectW.Call(0, 0)
	if handle == 0 {
		return 0
	}
	info := jobExtendedLimitInformation{}
	info.BasicLimitInformation.LimitFlags = jobObjectLimitKillOnJobClose
	ok, _, _ := procSetInformationJobObject.Call(
		handle,
		jobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		unsafe.Sizeof(info),
	)
	if ok == 0 {
		syscall.CloseHandle(syscall.Handle(handle))
		return 0
	}
	return processJob(handle)
}

// join 把已启动的进程放进 Job；它之后拉起的子孙也自动在同一个 Job 里。
func (j processJob) join(proc *os.Process) {
	if j == 0 || proc == nil {
		return
	}
	handle, err := syscall.OpenProcess(processSetQuota|processTerminate, false, uint32(proc.Pid))
	if err != nil {
		return
	}
	defer syscall.CloseHandle(handle)
	_, _, _ = procAssignProcessToJobObject.Call(uintptr(j), uintptr(handle))
}

// terminate 立刻结束 Job 里的全部进程（关掉再点一次「重启会话」时用）。
func (j processJob) terminate() {
	if j == 0 {
		return
	}
	_, _, _ = procTerminateJobObject.Call(uintptr(j), 1)
}

// close 释放句柄；因为设了 KILL_ON_JOB_CLOSE，里面残留的进程会被一起结束。
func (j processJob) close() {
	if j == 0 {
		return
	}
	syscall.CloseHandle(syscall.Handle(j))
}

// contains 只给测试用：确认某个 pid 真的在 Job 里。
func (j processJob) contains(pid uint32) bool {
	if j == 0 {
		return false
	}
	handle, err := syscall.OpenProcess(processQueryLimitedInformation|processSetQuota, false, pid)
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(handle)
	var result int32
	ret, _, _ := procIsProcessInJob.Call(uintptr(handle), uintptr(j), uintptr(unsafe.Pointer(&result)))
	return ret != 0 && result != 0
}

// terminalJob 是终端会话共用的 Job：宿主意外退出时终端也一起结束。
func terminalJob() processJob {
	terminalJobOnce.Do(func() { terminalJobHandle = newProcessJob() })
	return terminalJobHandle
}
