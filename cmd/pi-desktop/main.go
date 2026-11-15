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
	h := host.New()
	h.LogEvent("info", "main", "Pi Desktop 宿主启动")
	mygo.BindAs("Host", h)

	mygo.App.OnSecondInstance(func(_ []string, _ string) {
		h.FocusMainWindow()
	})

	mygo.App.WhenReady(func() {
		opts := mygo.WindowOptions{
			Title:           "Pi Desktop",
			URL:             "/",
			Width:           1400,
			Height:          900,
			MinWidth:        980,
			MinHeight:       640,
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
		h.AttachWindow(win)
		if os.Getenv("PI_DESKTOP_SMOKE") == "1" {
			host.RunSmoke(win)
		}
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
