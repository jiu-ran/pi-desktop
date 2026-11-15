//go:build windows

package host

func syscallKillTree(pid int) error { return nil }
