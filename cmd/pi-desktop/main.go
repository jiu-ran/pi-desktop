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
		width, height := initialWindowSize()
		opts := mygo.WindowOptions{
			Title:           "Pi Desktop",
			URL:             "/",
			Width:           width,
			Height:          height,
			MinWidth:        980,
			MinHeight:       640,
			// 换了自适应尺寸后，旧的状态文件里存的是「1400×900 被屏幕挤出来的」
			// 尺寸与位置，继续沿用会让人以为窗口一开就贴满屏幕。换一个 key，
			// 让大家这次按显示器工作区重新给一个默认尺寸。
			StateKey:        "main-v2",
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
		// 恢复上次的窗口状态后兜底：显示器换小了、或上次把窗口拖到屏幕外，
		// 本来会恢复出「标题栏在屏幕上方看不见」的位置。
		clampWindowToWorkArea(win)
		host.AttachWindow(h, win)
		if os.Getenv("PI_DESKTOP_SMOKE") == "1" {
			host.RunSmoke(win)
		}
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

// initialWindowSize 返回首次启动的窗口尺寸（DIP）：默认 1400×900，
// 但不超过当前显示器工作区的 86%，并保证不小于最小尺寸。
func initialWindowSize() (int, int) {
	const defaultWidth, defaultHeight = 1400, 900
	const minWidth, minHeight = 980, 640
	width, height := defaultWidth, defaultHeight
	display := mygo.Screen.PrimaryDisplay()
	if display.WorkArea.Width > 0 && display.WorkArea.Height > 0 {
		if limit := display.WorkArea.Width * 86 / 100; width > limit {
			width = limit
		}
		if limit := display.WorkArea.Height * 86 / 100; height > limit {
			height = limit
		}
	}
	if width < minWidth {
		width = minWidth
	}
	if height < minHeight {
		height = minHeight
	}
	return width, height
}

// clampWindowToWorkArea 把跑出工作区的窗口拉回来（只在超界时动，
// 不改变用户自己调好的、本来就在屏幕里的尺寸）。
func clampWindowToWorkArea(win *mygo.Window) {
	if win == nil {
		return
	}
	area := mygo.Screen.PrimaryDisplay().WorkArea
	if area.Width <= 0 || area.Height <= 0 {
		return
	}
	bounds := win.Bounds()
	if bounds.Width <= 0 || bounds.Height <= 0 {
		return
	}
	right, bottom := bounds.X+bounds.Width, bounds.Y+bounds.Height
	maxRight, maxBottom := area.X+area.Width, area.Y+area.Height
	if bounds.X >= area.X && bounds.Y >= area.Y && right <= maxRight && bottom <= maxBottom {
		return
	}
	x := clampInt(bounds.X, area.X, maxInt(area.X, maxRight-bounds.Width))
	y := clampInt(bounds.Y, area.Y, maxInt(area.Y, maxBottom-bounds.Height))
	win.SetBounds(mygo.Rectangle{X: x, Y: y, Width: bounds.Width, Height: bounds.Height})
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
