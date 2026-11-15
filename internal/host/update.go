package host

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

const (
	updateOwner = "jiu-ran"
	updateRepo  = "pi-desktop"
	autoCheckMS = 6 * 60 * 60 * 1000
	manualCheck = 5 * 60 * 1000
)

type appUpdateCheck struct {
	Current         string `json:"current"`
	Latest          string `json:"latest"`
	UpdateAvailable bool   `json:"updateAvailable"`
	URL             string `json:"url"`
	AssetName       string `json:"assetName"`
	SHA256          string `json:"sha256,omitempty"`
	Error           string `json:"error,omitempty"`
	Cached          bool   `json:"cached,omitempty"`
}

type preparedUpdate struct {
	Version   string `json:"version"`
	URL       string `json:"url"`
	AssetName string `json:"assetName"`
	FilePath  string `json:"filePath"`
	SHA256    string `json:"sha256,omitempty"`
}

type updateCacheState struct {
	At           int64          `json:"at"`
	Current      string         `json:"current"`
	Result       appUpdateCheck `json:"result"`
	ETag         string         `json:"etag,omitempty"`
	LastModified string         `json:"lastModified,omitempty"`
	BlockedUntil int64          `json:"blockedUntil"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
	Digest             string `json:"digest"`
}

type githubRelease struct {
	TagName    string        `json:"tag_name"`
	HTMLURL    string        `json:"html_url"`
	Draft      bool          `json:"draft"`
	Prerelease bool          `json:"prerelease"`
	Assets     []githubAsset `json:"assets"`
}

type appUpdater struct {
	mu         sync.Mutex
	cache      *updateCacheState
	prepared   map[string]preparedUpdate
	client     *http.Client
	cancel     context.CancelFunc
	installing bool
}

func newAppUpdater(proxy func() string) *appUpdater {
	transport := &http.Transport{Proxy: func(*http.Request) (*url.URL, error) {
		raw := proxy()
		if raw == "" {
			return nil, nil
		}
		return url.Parse(raw)
	}}
	return &appUpdater{prepared: map[string]preparedUpdate{}, client: &http.Client{Timeout: 60 * time.Second, Transport: transport}}
}

func appVersion() string {
	if version := mygo.App.Version(); version != "" {
		return version
	}
	return "0.8.14"
}

func compareVersions(left, right string) int {
	parse := func(value string) []int {
		value = strings.TrimPrefix(strings.TrimPrefix(value, "v"), "V")
		parts := strings.Split(value, ".")
		out := make([]int, 0, len(parts))
		for _, part := range parts {
			number := 0
			for _, r := range part {
				if r < '0' || r > '9' {
					break
				}
				number = number*10 + int(r-'0')
			}
			out = append(out, number)
		}
		return out
	}
	a, b := parse(left), parse(right)
	count := len(a)
	if len(b) > count {
		count = len(b)
	}
	for i := 0; i < count; i++ {
		av, bv := 0, 0
		if i < len(a) {
			av = a[i]
		}
		if i < len(b) {
			bv = b[i]
		}
		if av != bv {
			return av - bv
		}
	}
	return 0
}

func (u *appUpdater) httpClient() *http.Client {
	if u.client != nil {
		return u.client
	}
	return http.DefaultClient
}

func (u *appUpdater) cacheFile() string {
	return filepath.Join(userDataDir(), "app-update-cache.json")
}

func (u *appUpdater) loadCache() updateCacheState {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.cache != nil {
		return *u.cache
	}
	state := updateCacheState{}
	if data, err := os.ReadFile(u.cacheFile()); err == nil {
		_ = json.Unmarshal(data, &state)
	}
	u.cache = &state
	return state
}

func (u *appUpdater) saveCache(state updateCacheState) {
	u.mu.Lock()
	u.cache = &state
	u.mu.Unlock()
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(u.cacheFile()), 0o755)
	_ = atomicWriteText(u.cacheFile(), string(data)+"\n")
}

func (u *appUpdater) check(manual bool) appUpdateCheck {
	current := appVersion()
	ttl := int64(autoCheckMS)
	if manual {
		ttl = manualCheck
	}
	state := u.loadCache()
	now := time.Now().UnixMilli()
	if state.BlockedUntil > now {
		until := time.UnixMilli(state.BlockedUntil).Format("15:04")
		return appUpdateCheck{Current: current, Error: "GitHub 接口暂时限流，请在 " + until + " 之后重试"}
	}
	if state.At > 0 && state.Current == current && now-state.At < ttl {
		result := state.Result
		result.Current = current
		result.Cached = true
		return result
	}
	request, _ := http.NewRequest(http.MethodGet, "https://api.github.com/repos/"+updateOwner+"/"+updateRepo+"/releases?per_page=20", nil)
	request.Header.Set("Accept", "application/vnd.github+json")
	if state.ETag != "" {
		request.Header.Set("If-None-Match", state.ETag)
	} else if state.LastModified != "" {
		request.Header.Set("If-Modified-Since", state.LastModified)
	}
	response, err := u.httpClient().Do(request)
	if err != nil {
		return appUpdateCheck{Current: current, Error: "检查更新失败：无法连接 GitHub"}
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotModified {
		state.At = now
		u.saveCache(state)
		result := state.Result
		result.Current = current
		result.Cached = true
		return result
	}
	if response.StatusCode == http.StatusForbidden || response.StatusCode == http.StatusTooManyRequests {
		until := now + 60*60*1000
		if reset := response.Header.Get("X-RateLimit-Reset"); reset != "" {
			if seconds, err := strconv.ParseInt(reset, 10, 64); err == nil {
				until = seconds * 1000
			}
		}
		state.BlockedUntil = until
		u.saveCache(state)
		return appUpdateCheck{Current: current, Error: "GitHub 接口暂时限流，请稍后重试"}
	}
	if response.StatusCode != http.StatusOK {
		return appUpdateCheck{Current: current, Error: fmt.Sprintf("检查更新失败：GitHub 返回 %d", response.StatusCode)}
	}
	var releases []githubRelease
	if err := json.NewDecoder(response.Body).Decode(&releases); err != nil {
		return appUpdateCheck{Current: current, Error: "检查更新失败：版本列表无法解析"}
	}
	var stable *githubRelease
	for index := range releases {
		release := &releases[index]
		if release.Draft || release.Prerelease {
			continue
		}
		tag := strings.TrimPrefix(strings.TrimPrefix(release.TagName, "v"), "V")
		if !regexpVersion.MatchString(tag) {
			continue
		}
		if stable == nil || compareVersions(release.TagName, stable.TagName) > 0 {
			stable = release
		}
	}
	if stable == nil {
		return appUpdateCheck{Current: current, Error: "未发现可用的正式版本"}
	}
	latest := strings.TrimPrefix(strings.TrimPrefix(stable.TagName, "v"), "V")
	asset := findReleaseAsset(stable.Assets)
	result := appUpdateCheck{
		Current: current, Latest: latest, UpdateAvailable: compareVersions(latest, current) > 0,
		URL: stable.HTMLURL, AssetName: asset.Name, SHA256: shaFromDigest(asset.Digest),
	}
	state.At = now
	state.Current = current
	state.Result = result
	state.ETag = response.Header.Get("ETag")
	state.LastModified = response.Header.Get("Last-Modified")
	state.BlockedUntil = 0
	u.saveCache(state)
	return result
}

var regexpVersion = mustRegexp(`^v?\d+(?:\.\d+){1,3}$`)

func shaFromDigest(digest string) string {
	parts := strings.SplitN(digest, ":", 2)
	if len(parts) == 2 && strings.EqualFold(parts[0], "sha256") {
		return strings.ToLower(parts[1])
	}
	return ""
}

func findReleaseAsset(assets []githubAsset) githubAsset {
	return findReleaseAssetFor(runtime.GOOS, runtime.GOARCH, assets)
}

func findReleaseAssetFor(goos, goarch string, assets []githubAsset) githubAsset {
	patterns := []string{}
	switch goos {
	case "windows":
		patterns = []string{`setup.*\.exe$`, `\.exe$`, `win.*\.zip$`}
	case "darwin":
		patterns = []string{`.dmg$`, `mac.*\.zip$`}
	default:
		patterns = []string{`.AppImage$`, `linux.*\.tar\.gz$`}
	}
	matchArch := func(name string) bool {
		lower := strings.ToLower(name)
		arch := goarch
		if strings.Contains(lower, "arm64") || strings.Contains(lower, "aarch64") {
			return arch == "arm64"
		}
		if strings.Contains(lower, "x64") || strings.Contains(lower, "x86_64") {
			return arch == "amd64"
		}
		return true
	}
	for _, pattern := range patterns {
		re := mustRegexp(`(?i)` + pattern)
		best := githubAsset{}
		for _, asset := range assets {
			if asset.BrowserDownloadURL == "" || !re.MatchString(asset.Name) {
				continue
			}
			if !matchArch(asset.Name) {
				continue
			}
			if strings.Contains(strings.ToLower(asset.Name), strings.ToLower(goarch)) {
				return asset
			}
			if best.Name == "" {
				best = asset
			}
		}
		if best.Name != "" {
			return best
		}
	}
	return githubAsset{}
}

func (u *appUpdater) fetchReleases() ([]githubRelease, error) {
	request, _ := http.NewRequest(http.MethodGet, "https://api.github.com/repos/"+updateOwner+"/"+updateRepo+"/releases?per_page=20", nil)
	request.Header.Set("Accept", "application/vnd.github+json")
	response, err := u.httpClient().Do(request)
	if err != nil {
		return nil, errors.New("无法连接 GitHub")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub 返回 %d", response.StatusCode)
	}
	var releases []githubRelease
	if err := json.NewDecoder(response.Body).Decode(&releases); err != nil {
		return nil, errors.New("版本列表无法解析")
	}
	return releases, nil
}

func (u *appUpdater) download() (preparedUpdate, error) {
	u.mu.Lock()
	if u.cancel != nil {
		u.mu.Unlock()
		return preparedUpdate{}, errors.New("已有下载任务正在进行中")
	}
	ctx, cancel := context.WithCancel(context.Background())
	u.cancel = cancel
	u.mu.Unlock()
	defer func() {
		u.mu.Lock()
		u.cancel = nil
		u.mu.Unlock()
		cancel()
	}()

	releases, err := u.fetchReleases()
	if err != nil {
		return preparedUpdate{}, err
	}
	var stable *githubRelease
	for index := range releases {
		release := &releases[index]
		if release.Draft || release.Prerelease {
			continue
		}
		if !regexpVersion.MatchString(strings.TrimPrefix(release.TagName, "v")) {
			continue
		}
		if stable == nil || compareVersions(release.TagName, stable.TagName) > 0 {
			stable = release
		}
	}
	if stable == nil {
		return preparedUpdate{}, errors.New("未发现可用的正式版本")
	}
	latest := strings.TrimPrefix(strings.TrimPrefix(stable.TagName, "v"), "V")
	current := appVersion()
	if compareVersions(latest, current) <= 0 {
		return preparedUpdate{}, errors.New("当前已是最新版本")
	}
	asset := findReleaseAsset(stable.Assets)
	if asset.Name == "" || asset.BrowserDownloadURL == "" {
		return preparedUpdate{}, errors.New("该版本没有适用于当前系统的安装包")
	}
	sha := shaFromDigest(asset.Digest)
	if sha == "" {
		for _, candidate := range stable.Assets {
			if candidate.Name != "SHA256SUMS.txt" && !strings.HasSuffix(strings.ToLower(candidate.Name), "sha256sums.txt") {
				continue
			}
			request, _ := http.NewRequestWithContext(ctx, http.MethodGet, candidate.BrowserDownloadURL, nil)
			response, err := u.httpClient().Do(request)
			if err != nil {
				continue
			}
			text, _ := io.ReadAll(io.LimitReader(response.Body, 64*1024))
			response.Body.Close()
			for _, line := range strings.Split(string(text), "\n") {
				fields := strings.Fields(strings.TrimSpace(line))
				if len(fields) >= 2 && strings.TrimPrefix(fields[1], "*") == asset.Name {
					sha = strings.ToLower(fields[0])
					break
				}
			}
			break
		}
	}
	if sha == "" {
		return preparedUpdate{}, errors.New("安装包缺少 SHA-256 校验值，请从发布页手动下载")
	}
	updateDir := filepath.Join(userDataDir(), "updates")
	if err := os.MkdirAll(updateDir, 0o755); err != nil {
		return preparedUpdate{}, err
	}
	filePath := filepath.Join(updateDir, filepath.Base(asset.Name))
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, asset.BrowserDownloadURL, nil)
	response, err := u.httpClient().Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return preparedUpdate{}, errors.New("下载更新失败：已取消")
		}
		return preparedUpdate{}, errors.New("下载更新失败：" + err.Error())
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return preparedUpdate{}, fmt.Errorf("下载更新失败：HTTP %d", response.StatusCode)
	}
	tmp := filePath + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return preparedUpdate{}, err
	}
	hash := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(out, hash), response.Body)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		if ctx.Err() != nil {
			return preparedUpdate{}, errors.New("下载更新失败：已取消")
		}
		return preparedUpdate{}, errors.New("下载更新失败：" + copyErr.Error())
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return preparedUpdate{}, closeErr
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if actual != sha {
		_ = os.Remove(tmp)
		return preparedUpdate{}, errors.New("更新包校验失败，已删除下载文件，请重试")
	}
	if err := os.Rename(tmp, filePath); err != nil {
		_ = os.Remove(tmp)
		return preparedUpdate{}, err
	}
	prepared := preparedUpdate{Version: latest, URL: stable.HTMLURL, AssetName: asset.Name, FilePath: filePath, SHA256: sha}
	u.mu.Lock()
	u.prepared[latest] = prepared
	u.mu.Unlock()
	return prepared, nil
}

func (u *appUpdater) cancelDownload() bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.cancel == nil {
		return false
	}
	u.cancel()
	return true
}

func (u *appUpdater) install(version string) error {
	u.mu.Lock()
	prepared, ok := u.prepared[version]
	installing := u.installing
	if ok && !installing {
		u.installing = true
	}
	u.mu.Unlock()
	if !ok {
		return errors.New("请先下载并准备更新")
	}
	if installing {
		return errors.New("更新安装程序已经启动")
	}
	data, err := os.ReadFile(prepared.FilePath)
	if err != nil {
		u.mu.Lock()
		u.installing = false
		u.mu.Unlock()
		return errors.New("更新安装包失效，请重新下载")
	}
	sum := sha256.Sum256(data)
	if prepared.SHA256 == "" || hex.EncodeToString(sum[:]) != prepared.SHA256 {
		u.mu.Lock()
		u.installing = false
		u.mu.Unlock()
		return errors.New("安装包在下载后被修改，已阻止执行，请重新下载")
	}
	if runtime.GOOS == "windows" && strings.HasSuffix(strings.ToLower(prepared.FilePath), ".exe") {
		if strings.Contains(strings.ToLower(filepath.Base(prepared.FilePath)), "setup") {
			if err := startWindowsSetup(prepared.FilePath); err != nil {
				u.mu.Lock()
				u.installing = false
				u.mu.Unlock()
				return err
			}
		} else {
			cmd := exec.Command(prepared.FilePath, "--updated")
			hideWindow(cmd)
			if err := cmd.Start(); err != nil {
				u.mu.Lock()
				u.installing = false
				u.mu.Unlock()
				return err
			}
			go func() { _ = cmd.Wait() }()
		}
	} else {
		if runtime.GOOS != "windows" && strings.HasSuffix(strings.ToLower(prepared.FilePath), ".appimage") {
			_ = os.Chmod(prepared.FilePath, 0o700)
		}
		if err := mygo.Shell.OpenPath(prepared.FilePath); err != nil {
			u.mu.Lock()
			u.installing = false
			u.mu.Unlock()
			return fmt.Errorf("打开安装包失败：%w", err)
		}
	}
	go func() {
		time.Sleep(300 * time.Millisecond)
		mygo.App.Quit()
	}()
	return nil
}

func (h *Host) checkAppUpdate(manual bool) map[string]any {
	result := h.updates.check(manual)
	return map[string]any{
		"current": result.Current, "latest": result.Latest, "updateAvailable": result.UpdateAvailable,
		"url": result.URL, "assetName": result.AssetName, "sha256": result.SHA256,
		"error": result.Error, "cached": result.Cached,
	}
}

func (h *Host) downloadAppUpdate() (map[string]any, error) {
	prepared, err := h.updates.download()
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"version": prepared.Version, "url": prepared.URL, "assetName": prepared.AssetName,
		"filePath": prepared.FilePath, "sha256": prepared.SHA256,
	}, nil
}

func (h *Host) cancelAppUpdate() bool { return h.updates.cancelDownload() }

func (h *Host) installAppUpdate(version string) error { return h.updates.install(version) }

func (h *Host) openAppUpdate(rawURL string) bool {
	if !isAllowedExternalURL(rawURL) {
		return false
	}
	return mygo.Shell.OpenExternal(rawURL) == nil
}

func (h *Host) openExternalURL(rawURL string) bool {
	if !isAllowedExternalURL(rawURL) {
		return false
	}
	return mygo.Shell.OpenExternal(rawURL) == nil
}

func isAllowedExternalURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	switch parsed.Scheme {
	case "https", "http", "mailto":
		return true
	}
	return false
}

func (h *Host) reveal(target string) bool {
	if strings.TrimSpace(target) == "" {
		return false
	}
	if info, err := os.Stat(target); err == nil && info.IsDir() {
		return mygo.Shell.OpenPath(target) == nil
	}
	mygo.Shell.ShowItemInFolder(target)
	return true
}

func (h *Host) readClipboard() string { return mygo.Clipboard.ReadText() }

// startWindowsSetup 启动 MyGo 的 NSIS 安装包并让当前进程退出。
//
// 安装包会先关掉占用文件的旧进程，因此不能在这里同步等待：用 PowerShell
// 作为脱离的安装器，静默安装完成后从注册表读回安装目录并重新启动应用。
func startWindowsSetup(setupPath string) error {
	const appID = "dev.pi.desktop"
	psQuote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }
	script := "$ErrorActionPreference='Stop'; " +
		"$p=Start-Process -FilePath " + psQuote(setupPath) + " -ArgumentList '/S' -Wait -PassThru; " +
		"if($p.ExitCode -ne 0){exit $p.ExitCode}; " +
		"$key=" + psQuote(`HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\`+appID) + "; " +
		"$loc=(Get-ItemProperty -Path $key -ErrorAction Stop).InstallLocation; " +
		"$exe=Join-Path ([string]$loc).Trim('\"') 'Pi Desktop.exe'; " +
		"if(Test-Path -LiteralPath $exe){Start-Process -FilePath $exe}"
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	hideWindow(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动更新安装程序失败：%w", err)
	}
	go func() { _ = cmd.Wait() }()
	go func() {
		time.Sleep(300 * time.Millisecond)
		mygo.App.Quit()
	}()
	return nil
}
