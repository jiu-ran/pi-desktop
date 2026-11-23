package host

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
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
	// Signed 表示这份安装包过了「内置公钥验过的 SHA256SUMS.txt」校验；
	// 只有它才能自动安装。
	Signed bool `json:"signed,omitempty"`
}

// manualUpdateError 表示这个更新不能自动安装，只能去发布页手动下载。
type manualUpdateError struct {
	reason string
	url    string
}

func (e *manualUpdateError) Error() string { return e.reason }

// asManualUpdateError 把错误还原成「只能手动下载」，其它错误返回 nil。
func asManualUpdateError(err error) *manualUpdateError {
	var target *manualUpdateError
	if errors.As(err, &target) {
		return target
	}
	return nil
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
	transport := &http.Transport{
		Proxy: func(*http.Request) (*url.URL, error) {
			if proxy == nil {
				return nil, nil
			}
			raw := proxy()
			if raw == "" {
				return nil, nil
			}
			return url.Parse(raw)
		},
		DialContext:           (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
	}
	// 不设 Client.Timeout：它把读响应体的时间也算进去，慢网下几十 MB 的安装包
	// 60 秒后一定失败。整体时限交给调用方的 ctx，连接阶段由 Transport 的超时兜住。
	return &appUpdater{prepared: map[string]preparedUpdate{}, client: &http.Client{Transport: transport}}
}

func appVersion() string {
	if version := strings.TrimSpace(mygo.App.Version()); version != "" {
		return version
	}
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for range 4 {
		data, err := os.ReadFile(filepath.Join(dir, "package.json"))
		if err == nil {
			var pkg struct {
				Name    string `json:"name"`
				Version string `json:"version"`
			}
			if json.Unmarshal(data, &pkg) == nil && pkg.Name == "pi-desktop" && strings.TrimSpace(pkg.Version) != "" {
				return strings.TrimSpace(pkg.Version)
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
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

// withCurrent 用当前版本重算「有更新」。
// 缓存里的结论可能是旧版本时算的：0.8.14 时查到 0.9.0 有更新，升到 0.9.0 后命中
// 缓存 / 304，如果继续沿用旧结论，就会一直显示「有更新 0.9.0」。
func (c appUpdateCheck) withCurrent(current string) appUpdateCheck {
	c.Current = current
	c.UpdateAvailable = c.Latest != "" && compareVersions(c.Latest, current) > 0
	return c
}

// cachedResult 标记这次结论是复用缓存 / 304 的，界面据此提示「刚检查过」
func (c appUpdateCheck) cachedResult() appUpdateCheck {
	c.Cached = true
	return c
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
	if current == "" {
		return appUpdateCheck{Error: "无法获取当前应用版本，请从发布页查看最新版本"}
	}
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
		return state.Result.withCurrent(current).cachedResult()
	}
	requestCtx, cancelRequest := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelRequest()
	request, _ := http.NewRequestWithContext(requestCtx, http.MethodGet, "https://api.github.com/repos/"+updateOwner+"/"+updateRepo+"/releases?per_page=20", nil)
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
		return state.Result.withCurrent(current).cachedResult()
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

// findSignedSums 找出签名清单和它的签名文件（发布时由 CI 生成）。
func findSignedSums(assets []githubAsset) (sums, signature githubAsset) {
	for _, item := range assets {
		switch strings.ToLower(strings.TrimSpace(item.Name)) {
		case "sha256sums.txt":
			sums = item
		case "sha256sums.txt.sig":
			signature = item
		}
	}
	return sums, signature
}

// hashFromSums 从验过签名的清单里取某个文件的 SHA-256。
func hashFromSums(text []byte, assetName string) string {
	for _, line := range strings.Split(string(text), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) >= 2 && strings.TrimPrefix(fields[1], "*") == assetName {
			return strings.ToLower(fields[0])
		}
	}
	return ""
}

// fetchAsset 取一个小体积的发布附件（签名、清单），单独限时，避免挂住整个下载。
func (u *appUpdater) fetchAsset(ctx context.Context, asset githubAsset, limit int64) ([]byte, error) {
	requestCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, asset.BrowserDownloadURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := u.httpClient().Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", response.StatusCode)
	}
	return io.ReadAll(io.LimitReader(response.Body, limit))
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

func (u *appUpdater) fetchReleases(ctx context.Context) ([]githubRelease, error) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/"+updateOwner+"/"+updateRepo+"/releases?per_page=20", nil)
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

	releases, err := u.fetchReleases(ctx)
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
	if current == "" {
		return preparedUpdate{}, errors.New("无法获取当前应用版本，请从发布页手动下载")
	}
	if compareVersions(latest, current) <= 0 {
		return preparedUpdate{}, errors.New("当前已是最新版本")
	}
	asset := findReleaseAsset(stable.Assets)
	if asset.Name == "" || asset.BrowserDownloadURL == "" {
		return preparedUpdate{}, errors.New("该版本没有适用于当前系统的安装包")
	}
	// 签名校验：只认「用内置公钥验过的 SHA256SUMS.txt」。公钥缺失、签名缺失、
	// 校验失败都不允许自动安装——发布附件可能被换掉，只有签名能把它们钉死。
	publicKey, keyErr := updateSigningKey()
	if keyErr != nil {
		return preparedUpdate{}, &manualUpdateError{reason: keyErr.Error(), url: stable.HTMLURL}
	}
	sumsAsset, sigAsset := findSignedSums(stable.Assets)
	if sumsAsset.BrowserDownloadURL == "" || sigAsset.BrowserDownloadURL == "" {
		return preparedUpdate{}, &manualUpdateError{reason: "这个版本没有提供签名文件（SHA256SUMS.txt / SHA256SUMS.txt.sig）", url: stable.HTMLURL}
	}
	sums, sumsErr := u.fetchAsset(ctx, sumsAsset, 256*1024)
	if sumsErr != nil {
		return preparedUpdate{}, errors.New("读取 SHA256SUMS.txt 失败：" + sumsErr.Error())
	}
	signature, sigErr := u.fetchAsset(ctx, sigAsset, 8*1024)
	if sigErr != nil {
		return preparedUpdate{}, errors.New("读取 SHA256SUMS.txt.sig 失败：" + sigErr.Error())
	}
	if err := verifyUpdateSignature(publicKey, sums, signature); err != nil {
		return preparedUpdate{}, &manualUpdateError{reason: err.Error(), url: stable.HTMLURL}
	}
	sha := hashFromSums(sums, asset.Name)
	if sha == "" {
		return preparedUpdate{}, &manualUpdateError{reason: "签名清单里没有找到安装包的 SHA-256", url: stable.HTMLURL}
	}
	updateDir := u.updatesDir()
	if err := os.MkdirAll(updateDir, 0o755); err != nil {
		return preparedUpdate{}, err
	}
	filePath := filepath.Join(updateDir, filepath.Base(asset.Name))
	u.cleanupDir(filePath)
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
	prepared := preparedUpdate{Version: latest, URL: stable.HTMLURL, AssetName: asset.Name, FilePath: filePath, SHA256: sha, Signed: true}
	u.mu.Lock()
	u.prepared[latest] = prepared
	u.mu.Unlock()
	return prepared, nil
}

func (u *appUpdater) updatesDir() string {
	return filepath.Join(userDataDir(), "updates")
}

func (u *appUpdater) cleanup(keepPath string) {
	u.mu.Lock()
	busy := u.cancel != nil || u.installing
	u.mu.Unlock()
	if busy {
		return
	}
	u.cleanupDir(keepPath)
}

func (u *appUpdater) cleanupDir(keepPath string) {
	dir := u.updatesDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	keepClean := ""
	if keepPath != "" {
		keepClean = filepath.Clean(keepPath)
	}
	for _, entry := range entries {
		target := filepath.Join(dir, entry.Name())
		if keepClean != "" && samePath(target, keepClean) {
			continue
		}
		_ = os.RemoveAll(target)
	}
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
	if !prepared.Signed {
		return errors.New("这个安装包没有通过签名校验，不能自动安装，请到发布页手动下载")
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
		if manual := asManualUpdateError(err); manual != nil {
			// 不报错：让界面拿到 manualOnly，只给「打开发布页手动下载」。
			return map[string]any{"manualOnly": true, "message": manual.Error(), "url": manual.url}, nil
		}
		return nil, err
	}
	return map[string]any{
		"version": prepared.Version, "url": prepared.URL, "assetName": prepared.AssetName,
		"filePath": prepared.FilePath, "sha256": prepared.SHA256, "signed": prepared.Signed,
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
