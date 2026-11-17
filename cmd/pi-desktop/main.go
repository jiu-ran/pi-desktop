// Pi Desktop 的 MyGo 宿主：窗口、绑定、Pi 进程与终端都在 Go 里，界面上是 packages/ui 的 Vue 应用。
//
// 窗口里仍然是 packages/ui 的 Vue 界面，宿主通过绑定方法提供 Pi RPC、
// 文件、Git、终端与设置等能力；界面侧由 src/mygo/host.ts 适配成原来的
// window.piDesktop 形状，业务代码不需要感知宿主换了实现。
package main

import (
	"log"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/jiu-ran/pi-desktop/internal/host"
	// 让 locales 目录里的语言目录（zh-Hans / en）成为 app 声明的语言：
	// 安装程序、文件属性与 MyGo 自带控件都据此选语言。
	_ "github.com/jiu-ran/pi-desktop/locales"
)

func main() {
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}

	host.ConfigureLogs()
	configureAppMenu()
	h := host.New()
	h.LogEvent("info", "main", "Pi Desktop 宿主启动")
	mygo.BindAs("Host", h)

	mygo.App.OnSecondInstance(func(_ []string, _ string) {
		h.FocusMainWindow()
	})
	mygo.App.OnQuit(func() {
		host.Shutdown(h)
	})

	mygo.App.WhenReady(func() {
		// 首次启动按显示器工作区给一个舒服的尺寸：逻辑分辨率小的机器
		// （比如 1920×1080 开 125% 缩放，工作区只有 1536×864）用固定的
		// 1400×900 会被挤到贴满屏幕，看起来像被最大化过。
		width, height, minWidth, minHeight := initialWindowGeometry()
		opts := mygo.WindowOptions{
			Title:     "Pi Desktop",
			URL:       "/",
			Width:     width,
			Height:    height,
			MinWidth:  minWidth,
			MinHeight: minHeight,
			// 每次换默认尺寸都要换 key：旧状态文件存的是按旧默认值被屏幕
			// 挤出来的尺寸（比如 1400×900 压出来的 1400×882），继续沿用就
			// 会让升级后的首次启动还是旧的、贴满屏幕的样子。

			StateKey:        "main-v3",
			BackgroundColor: "#111214",
			Page: mygo.PageOptions{
				DevTools: mygo.DevToolsAuto,
			},
		}
		if runtime.GOOS == "darwin" {
			opts.TitleBarStyle = mygo.TitleBarHidden
			opts.TrafficLightPosition = &mygo.Point{X: 14, Y: 13}
		} else {
			// Windows / Linux 由页面自绘窗口按钮（TitleBar.vue）。
			opts.Frameless = true
		}
		win := mygo.NewWindow(opts)
		if mygo.IsDev() {
			retryDevLoad(win.Page())
		}
		// 恢复上次的窗口状态后兜底：显示器换小了、或上次把窗口拖到屏幕外，
		// 本来会恢复出「标题栏在屏幕上方看不见」的位置。
		clampWindowToWorkArea(win)
		mygo.Screen.OnDisplaysChanged(func() {
			if !win.IsMaximized() {
				clampWindowToWorkArea(win)
			}
		})
		host.AttachWindow(h, win)
		if os.Getenv("PI_DESKTOP_SMOKE") == "1" {
			host.RunSmoke(win)
		}
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

// retryDevLoad 让开发窗口自己从「无法访问此页面」里恢复。
//
// 开发模式下界面来自 devUrl；改 Go 代码、重启 dev server 或 HMR 刷新的那几秒，
// WebView 会停在 ERR_CONNECTION_REFUSED 上，以前必须手动点「刷新」。
// 这里在加载失败后按 600ms 重试，成功一次就把计数清零；连续失败 60 次（约 36 秒）
// 就停手，免得真的起不来时一直刷。
func retryDevLoad(page *mygo.Page) {
	if page == nil {
		return
	}
	const maxAttempts = 60
	const retryDelay = 600 * time.Millisecond
	var mu sync.Mutex
	var attempts int
	var timer *time.Timer
	page.OnDidFinishLoad(func() {
		mu.Lock()
		attempts = 0
		mu.Unlock()
	})
	page.OnDidFailLoad(func(err *mygo.LoadError) {
		mu.Lock()
		defer mu.Unlock()
		if attempts >= maxAttempts {
			return
		}
		attempts++
		log.Printf("开发窗口加载失败，%d 次，稍后重试：%s（%s）", attempts, err.URL, err.Description)
		if timer != nil {
			timer.Stop()
		}
		timer = time.AfterFunc(retryDelay, func() {
			page.Reload()
		})
	})
}

// initialWindowGeometry 返回首次启动的窗口尺寸与最小尺寸（DIP）：
// 默认 1030×730，但不超过当前主显示器工作区的 86%；最小尺寸 980×640，
// 若工作区本身更小则跟着缩小，避免小屏或高缩放下窗口撑出屏幕。
func initialWindowGeometry() (width, height, minWidth, minHeight int) {
	// 默认尺寸 1030×730 DIP（125% 缩放下等于 1288×912 物理像素）。
	const defaultWidth, defaultHeight = 1030, 730
	minWidth, minHeight = 980, 640
	width, height = defaultWidth, defaultHeight
	area := mygo.Screen.PrimaryDisplay().WorkArea
	if area.Width > 0 && area.Height > 0 {
		if area.Width < minWidth {
			minWidth = area.Width
		}
		if area.Height < minHeight {
			minHeight = area.Height
		}
		if limit := area.Width * 86 / 100; width > limit {
			width = limit
		}
		if limit := area.Height * 86 / 100; height > limit {
			height = limit
		}
	}
	if width < minWidth {
		width = minWidth
	}
	if height < minHeight {
		height = minHeight
	}
	return width, height, minWidth, minHeight
}

// clampWindowToWorkArea 把超出所在显示器工作区的窗口拉回并缩进可见范围
// （支持多显示器；只在超界时动，不改变本来就在屏幕里的尺寸与位置）。
func clampWindowToWorkArea(win *mygo.Window) {
	if win == nil {
		return
	}
	bounds := win.Bounds()
	if bounds.Width <= 0 || bounds.Height <= 0 {
		return
	}
	area := mygo.Screen.DisplayMatching(bounds).WorkArea
	if area.Width <= 0 || area.Height <= 0 {
		area = mygo.Screen.PrimaryDisplay().WorkArea
	}
	if area.Width <= 0 || area.Height <= 0 {
		return
	}
	w, h := bounds.Width, bounds.Height
	if w > area.Width {
		w = area.Width
	}
	if h > area.Height {
		h = area.Height
	}
	right, bottom := bounds.X+w, bounds.Y+h
	maxRight, maxBottom := area.X+area.Width, area.Y+area.Height
	if w == bounds.Width && h == bounds.Height &&
		bounds.X >= area.X && bounds.Y >= area.Y && right <= maxRight && bottom <= maxBottom {
		return
	}
	x := clampInt(bounds.X, area.X, maxInt(area.X, maxRight-w))
	y := clampInt(bounds.Y, area.Y, maxInt(area.Y, maxBottom-h))
	win.SetBounds(mygo.Rectangle{X: x, Y: y, Width: w, Height: h})
}

func clampInt(value, low, high int) int {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// configureAppMenu 在 macOS 上覆盖 MyGo 默认菜单：保留系统编辑、窗口与退出快捷键，
// 去掉 Cmd+W 关闭窗口、Cmd+R 刷新与快捷键缩放，避免和终端/编辑器及设置页缩放冲突。
func configureAppMenu() {
	if runtime.GOOS != "darwin" {
		return
	}
	viewItems := []*mygo.MenuItem{
		{Role: mygo.RoleToggleFullScreen},
	}
	if mygo.IsDev() {
		viewItems = append([]*mygo.MenuItem{
			{Role: mygo.RoleToggleDevTools},
			mygo.Separator(),
		}, viewItems...)
	}
	mygo.App.SetMenu(mygo.NewMenu([]*mygo.MenuItem{
		{Role: mygo.RoleAppMenu},
		{Role: mygo.RoleEditMenu},
		{Label: "View", Submenu: viewItems},
		{Role: mygo.RoleWindowMenu},
	}))
}
