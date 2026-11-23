package host

import (
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func newTestHost(t *testing.T) *Host {
	t.Helper()
	h := &Host{
		authorized:  map[string]string{},
		attachments: map[string]string{},
		watcher:     newWorkspaceWatcher(nil),
	}
	t.Cleanup(h.watcher.close)
	return h
}

// 界面上带值的 env / headers 会被回填成空输入框：保存时按 key 合并，不能让真实令牌被空串覆盖。
func TestMcpMergeSecretMapKeepsMaskedValues(t *testing.T) {
	previous := map[string]any{"TOKEN": "real", "OLD": "gone", "MASKED": mcpMaskedValue}
	next := map[string]any{"TOKEN": "", "NEW": "fresh", "MASKED": mcpMaskedValue}
	merged := mcpMergeSecretMap(next, previous)

	if got := asString(merged["TOKEN"]); got != "real" {
		t.Fatalf("空值应沿用旧值，得到 %q", got)
	}
	if got := asString(merged["NEW"]); got != "fresh" {
		t.Fatalf("新值应写入，得到 %q", got)
	}
	if _, ok := merged["OLD"]; ok {
		t.Fatal("用户删掉的 key 应该消失")
	}
	if got, ok := merged["MASKED"]; !ok || got != "" {
		t.Fatalf("掩码且旧值也是掩码时按空值处理，得到 %v", got)
	}
	if mcpMergeSecretMap(nil, previous) != nil {
		t.Fatal("没有任何 key 时应当整段删除")
	}
	if got := asString(mcpMergeSecretMap(map[string]any{"A": "1"}, nil)["A"]); got != "1" {
		t.Fatalf("没有旧配置时按新值写入，得到 %q", got)
	}
}

func TestMcpSaveServerKeepsMaskedSecrets(t *testing.T) {
	t.Setenv("PI_CODING_AGENT_DIR", t.TempDir())
	h := newTestHost(t)

	if _, err := h.mcpSaveServer("", map[string]any{
		"scope": "global", "name": "stdio-srv",
		"config": map[string]any{"command": "npx", "env": map[string]any{"TOKEN": "real", "DROP": "x"}},
	}); err != nil {
		t.Fatal(err)
	}
	// 第二次保存：界面回填的是空串（掩码），只有 NEW 是用户新加的。
	if _, err := h.mcpSaveServer("", map[string]any{
		"scope": "global", "name": "stdio-srv", "previousName": "stdio-srv",
		"config": map[string]any{"command": "npx", "env": map[string]any{"TOKEN": "", "NEW": "1"}},
	}); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(agentDirPath(), "mcp.json")
	data, readErr := readMcpFile(file)
	if readErr != "" {
		t.Fatal(readErr)
	}
	env := asMap(asMap(mcpServersOf(data)["stdio-srv"])["env"])
	if asString(env["TOKEN"]) != "real" {
		t.Fatalf("令牌被覆盖了：%v", env)
	}
	if asString(env["NEW"]) != "1" {
		t.Fatalf("新 key 没写进去：%v", env)
	}
	if _, ok := env["DROP"]; ok {
		t.Fatalf("删掉的 key 还在：%v", env)
	}

	// headers 走同一套合并逻辑。
	if _, err := h.mcpSaveServer("", map[string]any{
		"scope": "global", "name": "http-srv",
		"config": map[string]any{"url": "https://example.com/mcp", "headers": map[string]any{"Authorization": "Bearer x"}},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.mcpSaveServer("", map[string]any{
		"scope": "global", "name": "http-srv", "previousName": "http-srv",
		"config": map[string]any{"url": "https://example.com/mcp", "headers": map[string]any{"Authorization": "", "X-New": "1"}},
	}); err != nil {
		t.Fatal(err)
	}
	data, readErr = readMcpFile(file)
	if readErr != "" {
		t.Fatal(readErr)
	}
	headers := asMap(asMap(mcpServersOf(data)["http-srv"])["headers"])
	if asString(headers["Authorization"]) != "Bearer x" {
		t.Fatalf("headers 被覆盖了：%v", headers)
	}
	if asString(headers["X-New"]) != "1" {
		t.Fatalf("新 header 没写进去：%v", headers)
	}
}

// 读改写以前没有串行化，并发保存会互相覆盖。
func TestMcpSaveServerConcurrentKeepsAllServers(t *testing.T) {
	t.Setenv("PI_CODING_AGENT_DIR", t.TempDir())
	h := newTestHost(t)

	const total = 12
	var wg sync.WaitGroup
	for index := range total {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			_, _ = h.mcpSaveServer("", map[string]any{
				"scope": "global", "name": "srv" + strconv.Itoa(index),
				"config": map[string]any{"command": "npx"},
			})
		}(index)
	}
	wg.Wait()

	data, readErr := readMcpFile(filepath.Join(agentDirPath(), "mcp.json"))
	if readErr != "" {
		t.Fatal(readErr)
	}
	if got := len(mcpServersOf(data)); got != total {
		t.Fatalf("并发保存后应留下 %d 个服务，实际 %d", total, got)
	}
}

func (w *workspaceWatcher) rootsSnapshot() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := make([]string, 0, len(w.roots))
	for root := range w.roots {
		out = append(out, root)
	}
	return out
}

func (w *workspaceWatcher) watchedSnapshot() map[string]map[string]bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := make(map[string]map[string]bool, len(w.watched))
	for root, dirs := range w.watched {
		copied := make(map[string]bool, len(dirs))
		for dir := range dirs {
			copied[dir] = true
		}
		out[root] = copied
	}
	return out
}

// 新建的 mcp.json 里可能有令牌，不能被组 / 其他用户读到。
func TestMcpWriteFileIsPrivate(t *testing.T) {
	if isWindows() {
		t.Skip("Windows 没有 Unix 权限位")
	}
	file := filepath.Join(t.TempDir(), "mcp.json")
	if err := writeMcpFile(file, map[string]any{"mcpServers": map[string]any{}}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("新建的 mcp.json 应为 0600，实际 %v", info.Mode().Perm())
	}
}

func TestProjectScopeMcpRequiresAuthorizedWorkspace(t *testing.T) {
	t.Setenv("PI_CODING_AGENT_DIR", t.TempDir())
	h := newTestHost(t)
	cwd := t.TempDir()
	payload := map[string]any{
		"scope": "project", "name": "svc",
		"config": map[string]any{"command": "npx"},
	}

	if _, err := h.McpSaveServer(cwd, payload); err == nil {
		t.Fatal("未授权的项目目录不应能写项目级 MCP 配置")
	}
	if _, err := h.McpSaveServer("", payload); err == nil {
		t.Fatal("cwd 为空时不应能写项目级 MCP 配置")
	}
	if _, err := h.authorizeWorkspace(cwd); err != nil {
		t.Fatal(err)
	}
	if _, err := h.McpSaveServer(cwd, payload); err != nil {
		t.Fatalf("授权后应能保存：%v", err)
	}
	// 全局作用域不需要授权。
	if _, err := h.McpRemoveServer("", map[string]any{"scope": "global", "name": "svc"}); err != nil {
		t.Fatalf("全局作用域不该被拦：%v", err)
	}
}

func TestLocalPackagesRequireAuthorizedWorkspace(t *testing.T) {
	h := newTestHost(t)
	cwd := t.TempDir()
	if err := h.requireLocalPackages(cwd, map[string]any{"local": true}); err == nil {
		t.Fatal("未授权目录不应能做项目级安装")
	}
	if err := h.requireLocalPackages("", map[string]any{"local": true}); err == nil {
		t.Fatal("cwd 为空时不应能做项目级安装")
	}
	if err := h.requireLocalPackages("", map[string]any{}); err != nil {
		t.Fatalf("全局安装不需要授权：%v", err)
	}
	if _, err := h.PackagesRemove(cwd, map[string]any{"local": true, "source": "npm:@scope/pkg"}); err == nil {
		t.Fatal("未授权目录的卸载应被拒绝")
	}
}

func TestSetProjectTrustRejectsUnknownAction(t *testing.T) {
	t.Setenv("PI_CODING_AGENT_DIR", t.TempDir())
	h := newTestHost(t)
	cwd := t.TempDir()
	if _, err := h.authorizeWorkspace(cwd); err != nil {
		t.Fatal(err)
	}
	if _, err := h.SetProjectTrust(cwd, "trust-everything"); err == nil {
		t.Fatal("未知 action 应当报错")
	}
	if fileExists(trustFilePath(agentDirPath())) {
		t.Fatal("未知 action 不应写信任记录")
	}
	if _, err := h.SetProjectTrust("", "trust"); err == nil {
		t.Fatal("cwd 为空应当报错")
	}
	if _, err := h.SetProjectTrust(cwd, "trust"); err != nil {
		t.Fatalf("正常信任应通过：%v", err)
	}
	if _, err := h.SetProjectTrust(cwd, "trust-parent"); err != nil {
		t.Fatalf("信任上级目录应通过：%v", err)
	}
}

func TestWorkspaceFilePathRejectsNetworkPaths(t *testing.T) {
	cwd := t.TempDir()
	for _, raw := range []string{
		`\\server\share\a.png`,
		`\\?\UNC\server\share\a.png`,
	} {
		if !isNetworkPath(raw) {
			t.Fatalf("应识别为网络路径：%s", raw)
		}
	}
	for _, raw := range []string{"//server/share/a.png", "file://attacker/s/a.png"} {
		// file:// 由界面转成 //host/share；宿主收到的是以 // 开头的绝对路径。
		path := strings.TrimPrefix(raw, "file:")
		if path == raw {
			path = raw
		} else if !strings.HasPrefix(path, "//") {
			path = "//" + strings.TrimLeft(path, "/")
		}
		if _, _, _, err := workspaceFilePath(cwd, path); err == nil {
			t.Fatalf("网络路径应被拒绝：%s", path)
		}
	}
	inside := filepath.Join(cwd, "a.txt")
	writeFile(t, inside, "x")
	if _, target, external, err := workspaceFilePath(cwd, inside); err != nil || !external || target != inside {
		t.Fatalf("本机绝对路径应照常可用：target=%s external=%v err=%v", target, external, err)
	}
}

func TestOpenWorkspacePathRejectsExecutableOutsideWorkspace(t *testing.T) {
	h := newTestHost(t)
	cwd := t.TempDir()
	outside := filepath.Join(t.TempDir(), "evil.bat")
	writeFile(t, outside, "@echo off\r\n")

	if _, err := h.openWorkspacePath(cwd, outside); err == nil {
		t.Fatal("项目外的脚本不应交给系统程序打开")
	}
	// 项目内的同名文件不受影响。
	writeFile(t, filepath.Join(cwd, "build.bat"), "@echo off\r\n")
	if _, err := h.openWorkspacePath(cwd, "build.bat"); err != nil {
		t.Fatalf("项目内的文件应照常打开：%v", err)
	}
	// 外部普通文件也不受影响。
	note := filepath.Join(t.TempDir(), "note.txt")
	writeFile(t, note, "hi")
	if _, err := h.openWorkspacePath(cwd, note); err != nil {
		t.Fatalf("项目外的普通文件应照常打开：%v", err)
	}
}

// 这些接口的 cwd 直接来自界面：只允许监听已授权的工作区。
func TestWatchWorkspaceRequiresAuthorization(t *testing.T) {
	h := newTestHost(t)
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "a.txt"), "x")
	sub := filepath.Join(root, "src")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}

	h.watchWorkspace(root)
	if roots := h.watcher.rootsSnapshot(); len(roots) != 0 {
		t.Fatalf("未授权目录不应被监听：%v", roots)
	}

	if _, err := h.authorizeWorkspace(root); err != nil {
		t.Fatal(err)
	}
	h.watchWorkspace(root)
	if roots := h.watcher.rootsSnapshot(); len(roots) != 1 {
		t.Fatalf("授权后应监听：%v", roots)
	}
	watched := h.watcher.watchedSnapshot()
	abs, _ := filepath.Abs(root)
	if len(watched[abs]) == 0 {
		t.Fatal("应当记录加给 fsnotify 的目录")
	}
	h.watcher.unwatch(root)
	if roots := h.watcher.rootsSnapshot(); len(roots) != 0 {
		t.Fatalf("unwatch 后应移除 root：%v", roots)
	}
	if watched := h.watcher.watchedSnapshot(); len(watched) != 0 {
		t.Fatalf("unwatch 后应清掉句柄记录：%v", watched)
	}
}

// 设了代理时不能把用户自己的 NO_PROXY 丢掉，否则本地模型 / 本机 MCP 也会走代理。
func TestChildEnvKeepsUserNoProxy(t *testing.T) {
	t.Setenv("NO_PROXY", "corp.example,10.0.0.0/8")
	t.Setenv("no_proxy", "corp.example,10.0.0.0/8")
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:7890")
	h := &Host{networkMode: "custom", networkCustom: "http://127.0.0.1:7890"}

	env := h.childEnv()
	for _, item := range []string{"corp.example", "10.0.0.0/8", "localhost", "127.0.0.1", "::1"} {
		if !strings.Contains(env["NO_PROXY"], item) {
			t.Fatalf("NO_PROXY 缺少 %s：%s", item, env["NO_PROXY"])
		}
	}
	if env["no_proxy"] != env["NO_PROXY"] {
		t.Fatalf("大小写两份应一致：%q vs %q", env["no_proxy"], env["NO_PROXY"])
	}
	if env["HTTPS_PROXY"] == "" {
		t.Fatal("设了代理时应当写入 HTTPS_PROXY")
	}

	direct := &Host{networkMode: "direct"}
	env = direct.childEnv()
	if env["NO_PROXY"] != "*" || env["no_proxy"] != "*" {
		t.Fatalf("直连时应屏蔽代理：%v / %v", env["NO_PROXY"], env["no_proxy"])
	}
}

func TestNetworkApplyClearsSystemProxyCache(t *testing.T) {
	h := &Host{systemProxyCache: "http://cached:1", systemProxyCacheAt: time.Now()}
	h.networkApply("system", "")
	// networkStatus 会重新查一次系统代理，所以只要旧值不再被沿用即可。
	if h.systemProxyCache == "http://cached:1" {
		t.Fatal("切换代理设置后应清掉系统代理缓存")
	}
}

// 下载安装包的 client 不能有整体 Timeout（读响应体也算在内），但要保留连接阶段超时。
func TestAppUpdaterClientTimeouts(t *testing.T) {
	updater := newAppUpdater(nil)
	client := updater.httpClient()
	if client.Timeout != 0 {
		t.Fatalf("不应设置整体 Timeout，实际 %v", client.Timeout)
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("Transport 类型不对：%T", client.Transport)
	}
	if transport.DialContext == nil || transport.TLSHandshakeTimeout <= 0 || transport.ResponseHeaderTimeout <= 0 {
		t.Fatal("应当设置连接 / TLS / 响应头超时")
	}
	// proxy 为 nil 时不能 panic。
	request := &http.Request{URL: &url.URL{Scheme: "https", Host: "example.com"}}
	if _, err := transport.Proxy(request); err != nil {
		t.Fatalf("Proxy 回调不应报错：%v", err)
	}
}

func TestPackageSourceRejectsFlag(t *testing.T) {
	h := &Host{}
	if _, err := h.packagesRemove("", map[string]any{"source": "--force"}); err == nil {
		t.Fatal("以 - 开头的来源应被拒绝")
	}
	if _, err := h.packagesUpdate("", map[string]any{"source": "-y"}); err == nil {
		t.Fatal("以 - 开头的来源应被拒绝")
	}
	if source, err := packageSource(map[string]any{"source": " npm:@scope/pkg "}); err != nil || source != "npm:@scope/pkg" {
		t.Fatalf("正常来源应原样返回：%q %v", source, err)
	}
}
