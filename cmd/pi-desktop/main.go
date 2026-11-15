// Pi Desktop 的 MyGo 宿主：把原来的 Electron 主进程换成 Go。
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
		opts := mygo.WindowOptions{
			Title:           "Pi Desktop",
			URL:             "/",
			Width:           1400,
			Height:          900,
			MinWidth:        980,
			MinHeight:       640,
			StateKey:        "main",
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
		host.AttachWindow(h, win)
		if os.Getenv("PI_DESKTOP_SMOKE") == "1" {
			host.RunSmoke(win)
		}
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
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
