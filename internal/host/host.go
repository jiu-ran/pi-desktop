package host

import (
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// PiEvent 是 Pi RPC 事件转发给界面的通道（沿用 pi:event 这个通道名）。
var PiEvent = mygo.NewEvent[map[string]any]("pi:event")

// WindowStateEvent 把窗口最大化 / 全屏状态推给界面（通道名 app:window-state）。
var WindowStateEvent = mygo.NewEvent[map[string]any]("app:window-state")

// DiskChangeEvent 对应原来的 files:disk-change。
var DiskChangeEvent = mygo.NewEvent[map[string]any]("files:disk-change")

// TerminalEvent 对应原来的 pi:terminal-event。
var TerminalEvent = mygo.NewEvent[map[string]any]("pi:terminal-event")

type startAttempt struct {
	done chan struct{}
	err  error
}

// Host 是界面能调用的唯一服务。所有状态都在这里，方法名与原来的
// window.piDesktop 一一对应（首字母大写后由 MyGo 生成 lowerCamel）。
type Host struct {
	mu    sync.Mutex
	win   *mygo.Window
	pools map[string]*workspacePool

	starting map[string]*startAttempt

	authorized  map[string]string
	attachments map[string]string

	// externalFiles 是编辑器里打开过的项目外文件，只有它们允许写回
	externalFiles map[string]string

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
	// systemProxyCache 缓存注册表里的系统代理：childEnv 每次 git / Pi 调用都会走到，
	// 更新客户端的 Proxy 回调也是每个请求一次，每次都起一个 reg.exe 太贵。
	systemProxyCache   string
	systemProxyCacheAt time.Time
	updates            *appUpdater
	watcher            *workspaceWatcher
	crashTimes         []time.Time
}

func New() *Host {
	h := &Host{
		pools:          map[string]*workspacePool{},
		starting:       map[string]*startAttempt{},
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

// AttachWindow 把主窗口绑定到宿主并挂接安全与生命周期钩子；作为包级函数避免暴露给前端 JS 绑定。
func AttachWindow(h *Host, win *mygo.Window) {
	if h != nil {
		h.attachWindow(win)
	}
}

// Shutdown 释放宿主全部资源；作为包级函数避免暴露给前端 JS 绑定。
func Shutdown(h *Host) {
	if h != nil {
		h.shutdown()
	}
}

func (h *Host) attachWindow(win *mygo.Window) {
	h.mu.Lock()
	if win == nil || h.win != nil {
		h.mu.Unlock()
		return
	}
	h.win = win
	h.mu.Unlock()

	go h.updates.cleanup("")

	if page := win.Page(); page != nil {
		page.OnWillNavigate(func(e *mygo.NavigateEvent) {
			if isAllowedRendererURL(e.URL) {
				return
			}
			e.PreventDefault()
			if e.UserInitiated && isAllowedExternalURL(e.URL) {
				target := e.URL
				go func() { _ = mygo.Shell.OpenExternal(target) }()
			}
		})
		page.SetWindowOpenHandler(func(req mygo.WindowOpenRequest) *mygo.WindowOptions {
			if isAllowedExternalURL(req.URL) {
				target := req.URL
				go func() { _ = mygo.Shell.OpenExternal(target) }()
			}
			return nil
		})
		page.OnRenderProcessGone(func(reason string) {
			logError("renderer", "界面进程异常退出："+reason)
			if h.recordCrashAndShouldReload() {
				page.Reload()
				return
			}
			go func() {
				result, err := mygo.Dialog.Message(mygo.MessageOptions{
					Parent: win, Type: mygo.MessageError, Title: "界面进程多次异常退出",
					Message:       "界面进程在 60 秒内多次崩溃，是否尝试重新加载界面？",
					Buttons:       []string{"退出应用", "重新加载"},
					DefaultButton: 1, CancelButton: 0,
				})
				if err == nil && result.Button == 1 {
					h.resetCrashWindow()
					page.Reload()
					return
				}
				mygo.App.Quit()
			}()
		})
		page.OnContextMenu(func(e *mygo.ContextMenuEvent) {
			if !e.Editable && e.SelectionText == "" {
				e.PreventDefault()
				return
			}
			if e.Menu == nil {
				return
			}
			removed := []string{
				mygo.ContextMenuBack,
				mygo.ContextMenuForward,
				mygo.ContextMenuReload,
				mygo.ContextMenuStop,
				mygo.ContextMenuPrint,
				mygo.ContextMenuOpenLink,
				mygo.ContextMenuOpenLinkInNewWindow,
				mygo.ContextMenuDownloadLink,
				mygo.ContextMenuOpenImageInNewWindow,
				mygo.ContextMenuDownloadImage,
				mygo.ContextMenuOpenFrameInNewWindow,
				mygo.ContextMenuOpenMediaInNewWindow,
				mygo.ContextMenuDownloadMedia,
				mygo.ContextMenuShare,
				"saveAs",
				"createQrCode",
				"webCapture",
			}
			if !mygo.IsDev() {
				removed = append(removed, mygo.ContextMenuInspect)
			}
			e.Menu.Remove(removed...)
		})
	}

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
		h.shutdown()
	})
}

func (h *Host) shutdown() {
	if h.updates != nil {
		h.updates.cancelDownload()
	}
	if h.watcher != nil {
		h.watcher.close()
	}
	h.stopAll()
	if h.terminals != nil {
		h.terminals.stopAll()
	}
	logs.flush()
}

func (h *Host) recordCrashAndShouldReload() bool {
	now := time.Now()
	cutoff := now.Add(-60 * time.Second)
	h.mu.Lock()
	defer h.mu.Unlock()
	kept := h.crashTimes[:0]
	for _, ts := range h.crashTimes {
		if ts.After(cutoff) {
			kept = append(kept, ts)
		}
	}
	kept = append(kept, now)
	h.crashTimes = kept
	return len(kept) < 3
}

func (h *Host) resetCrashWindow() {
	h.mu.Lock()
	h.crashTimes = nil
	h.mu.Unlock()
}

func isAllowedRendererURL(rawURL string) bool {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return false
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return false
	}
	scheme := strings.ToLower(parsed.Scheme)
	switch scheme {
	case "about", "mygo":
		return true
	case "http", "https":
		host := strings.ToLower(parsed.Hostname())
		if host == "mygo.localhost" {
			return true
		}
		if mygo.IsDev() && (host == "localhost" || host == "127.0.0.1" || host == "::1") {
			return true
		}
	}
	return false
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
