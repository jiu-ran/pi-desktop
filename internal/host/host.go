package host

import (
	"sync"

	"github.com/egoist/mygo"
)

// PiEvent 是 Pi RPC 事件转发给界面的通道（与 Electron 时代的 pi:event 同名）。
var PiEvent = mygo.NewEvent[map[string]any]("pi:event")

// WindowStateEvent 与 Electron 的 app:window-state 对应。
var WindowStateEvent = mygo.NewEvent[map[string]any]("app:window-state")

// DiskChangeEvent 对应原来的 files:disk-change。
var DiskChangeEvent = mygo.NewEvent[map[string]any]("files:disk-change")

// TerminalEvent 对应原来的 pi:terminal-event。
var TerminalEvent = mygo.NewEvent[map[string]any]("pi:terminal-event")

// DiscoveryEvent 通知界面 Pi 的定位结果发生变化（设置页 / 状态条）。
var DiscoveryEvent = mygo.NewEvent[map[string]any]("pi:location")

// Host 是界面能调用的唯一服务。所有状态都在这里，方法名与原来的
// window.piDesktop 一一对应（首字母大写后由 MyGo 生成 lowerCamel）。
type Host struct {
	mu    sync.Mutex
	win   *mygo.Window
	pools map[string]*workspacePool

	starting map[string]chan error

	authorized  map[string]string
	attachments map[string]string

	closing        bool
	dirty          bool
	startGen       map[string]int
	maxIdleWorkers int
	piCustomPath   string
	piCmd          *PiCommand
	piVersion      string

	terminals     *terminalManager
	networkMode   string
	networkCustom string
	updates       *appUpdater
	watcher       *workspaceWatcher
}

func New() *Host {
	h := &Host{
		pools:          map[string]*workspacePool{},
		starting:       map[string]chan error{},
		authorized:     map[string]string{},
		attachments:    map[string]string{},
		maxIdleWorkers: 3,
		startGen:       map[string]int{},
	}
	h.terminals = newTerminalManager(h)
	h.updates = newAppUpdater(func() string { _, proxy, _ := h.planProxy(); return proxy })
	h.watcher = newWorkspaceWatcher(func(change map[string]any) {
		h.emit(DiskChangeEvent, change)
	})
	return h
}

func (h *Host) AttachWindow(win *mygo.Window) {
	h.mu.Lock()
	h.win = win
	h.mu.Unlock()
	win.OnMaximize(func() { h.emitWindowState() })
	win.OnUnmaximize(func() { h.emitWindowState() })
	win.OnEnterFullScreen(func() { h.emitWindowState() })
	win.OnLeaveFullScreen(func() { h.emitWindowState() })
	win.OnClose(func(e *mygo.CloseEvent) {
		h.mu.Lock()
		dirty := h.dirty
		h.mu.Unlock()
		if !dirty {
			return
		}
		e.PreventDefault()
		go func() {
			result, err := mygo.Dialog.Message(mygo.MessageOptions{
				Parent: win, Type: mygo.MessageWarning, Title: "存在未保存的修改",
				Message: "关闭窗口会丢失文件编辑器中尚未保存的草稿。",
				Buttons: []string{"取消，返回保存", "放弃修改并继续"}, DefaultButton: 0, CancelButton: 0, DestructiveButtons: []int{1},
			})
			if err == nil && result.Button == 1 {
				win.Destroy()
			}
		}()
	})
	win.OnClosed(func() {
		h.watcher.close()
		h.stopAll()
		h.terminals.stopAll()
	})
}

func (h *Host) currentWindow() *mygo.Window {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.win
}

func (h *Host) emit(event *mygo.Event[map[string]any], payload map[string]any) {
	if win := h.currentWindow(); win != nil {
		if err := event.Emit(win, payload); err == nil {
			return
		}
	}
	_ = event.Broadcast(payload)
}

func (h *Host) FocusMainWindow() {
	win := h.currentWindow()
	if win == nil {
		return
	}
	win.Restore()
	win.Focus()
}

func (h *Host) emitWindowState() {
	win := h.currentWindow()
	if win == nil {
		return
	}
	h.emit(WindowStateEvent, map[string]any{
		"maximized":  win.IsMaximized(),
		"fullscreen": win.IsFullScreen(),
	})
}

// Ping 用于确认 Go 绑定与前端适配器已经连通。
func (h *Host) Ping() string { return "pong" }

// SetDirty 由界面同步「有未保存草稿」，关闭窗口时据此弹出原生确认。
func (h *Host) SetDirty(dirty bool) {
	h.mu.Lock()
	h.dirty = dirty
	h.mu.Unlock()
}
