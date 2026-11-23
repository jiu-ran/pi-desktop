package host

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	textPreviewMax  = 20 * 1024 * 1024
	imagePreviewMax = 20 * 1024 * 1024
	attachmentImage = 20 * 1024 * 1024
)

type attachmentItem struct {
	Path     string
	Name     string
	Kind     string
	Image    bool
	MimeType string
	Data     string
	Size     int64
	Inlined  bool
	Text     string
}

func (a attachmentItem) publicMap() map[string]any {
	item := map[string]any{
		"path": a.Path, "name": a.Name, "kind": a.Kind, "image": a.Image, "size": a.Size, "inlined": a.Inlined,
	}
	if a.Image {
		item["mimeType"] = a.MimeType
		if len(a.Data) <= 8*1024*1024 {
			item["data"] = a.Data
		}
	}
	return item
}

func walkDirectory(root, current string, output []string, limit int) []string {
	if len(output) >= limit {
		return output
	}
	entries, err := os.ReadDir(current)
	if err != nil {
		return output
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if len(output) >= limit {
			break
		}
		name := entry.Name()
		if name == ".git" || name == "node_modules" || name == ".pi" || name == ".pi-desktop" || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		full := filepath.Join(current, name)
		rel, _ := filepath.Rel(root, full)
		if entry.IsDir() {
			output = append(output, rel+string(os.PathSeparator))
			output = walkDirectory(root, full, output, limit)
		} else {
			output = append(output, rel)
		}
	}
	return output
}

func prepareAttachment(target string) (attachmentItem, error) {
	file, _ := filepath.Abs(target)
	info, err := os.Lstat(file)
	if err != nil {
		return attachmentItem{}, fmt.Errorf("找不到附件：%s", file)
	}
	item := attachmentItem{Path: file, Name: filepath.Base(file), Kind: "file"}
	if info.IsDir() {
		item.Kind = "folder"
		listing := walkDirectory(file, file, []string{}, 500)
		item.Text = fmt.Sprintf("<directory name=\"%s\">\n%s\n</directory>\n", escapeXML(file), strings.Join(listing, "\n"))
		return item, nil
	}
	if !info.Mode().IsRegular() {
		return attachmentItem{}, fmt.Errorf("不支持添加此类型的路径：%s", file)
	}
	item.Size = info.Size()
	mime := imageMIMEByExt[strings.ToLower(filepath.Ext(file))]
	if mime != "" {
		if item.Size > attachmentImage {
			return attachmentItem{}, fmt.Errorf("图片超过 20 MB：%s", filepath.Base(file))
		}
		data, err := os.ReadFile(file)
		if err != nil {
			return attachmentItem{}, err
		}
		item.Image = true
		item.MimeType = mime
		item.Data = base64Encode(data)
		item.Text = fmt.Sprintf("<file name=\"%s\"></file>\n", escapeXML(file))
		return item, nil
	}
	hint := fmt.Sprintf("[二进制文件（%s），未内联。请使用相应工具读取或处理。]", formatBytes(item.Size))
	if isProbablyText(file) {
		hint = fmt.Sprintf("[已通过路径引用（%s），未内联文件内容。需要时请使用 read 工具读取该文件。]", formatBytes(item.Size))
	}
	item.Text = fmt.Sprintf("<file name=\"%s\" size=\"%d\" inline=\"false\">\n%s\n</file>\n", escapeXML(file), item.Size, hint)
	return item, nil
}

// ---------- 工作区文件 ----------

func (h *Host) listDirectory(cwd, relative string) ([]map[string]any, error) {
	root, target, err := workspacePath(cwd, relative)
	if err != nil {
		return nil, err
	}
	if err := assertRealWorkspacePath(cwd, target, false); err != nil {
		return nil, err
	}
	info, err := os.Lstat(target)
	if err != nil {
		return nil, errors.New("目录不存在或无法访问")
	}
	if !info.IsDir() {
		return nil, errors.New("只能查看目录内容")
	}
	entries, err := os.ReadDir(target)
	if err != nil {
		return nil, errors.New("无法读取目录内容")
	}
	result := []map[string]any{}
	for _, entry := range entries {
		name := entry.Name()
		if name == ".git" || name == ".pi" || name == ".pi-desktop" || name == "node_modules" {
			continue
		}
		absolute := filepath.Join(target, name)
		info, err := os.Lstat(absolute)
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		kind := "other"
		if info.IsDir() {
			kind = "folder"
		} else if info.Mode().IsRegular() {
			kind = "file"
		}
		if kind == "other" {
			continue
		}
		rel, _ := filepath.Rel(root, absolute)
		result = append(result, map[string]any{
			"path": absolute, "relative": strings.ReplaceAll(rel, "\\", "/"), "name": name, "kind": kind,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		ki := 1
		if result[i]["kind"] == "folder" {
			ki = 0
		}
		kj := 1
		if result[j]["kind"] == "folder" {
			kj = 0
		}
		if ki != kj {
			return ki < kj
		}
		return strings.ToLower(asString(result[i]["name"])) < strings.ToLower(asString(result[j]["name"]))
	})
	return result, nil
}

func (h *Host) readWorkspaceFile(cwd, requested string) (map[string]any, error) {
	root, target, external, err := workspaceFilePath(cwd, requested)
	if err != nil {
		return nil, err
	}
	if external {
		if _, err := realPath(target); err != nil {
			return nil, errors.New("文件不存在或无法访问")
		}
	} else if err := assertRealWorkspacePath(cwd, target, false); err != nil {
		return nil, err
	}
	info, err := os.Lstat(target)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("文件不存在或无法打开")
	}
	rel := target
	if !external {
		rel, _ = filepath.Rel(root, target)
		rel = strings.ReplaceAll(rel, "\\", "/")
	}
	base := map[string]any{
		"path": target, "relative": rel, "name": filepath.Base(target), "size": info.Size(),
	}
	head := readHead(target, 16)
	if mime := imageMimeOfFile(target, head); mime != "" {
		if info.Size() > imagePreviewMax {
			return nil, errors.New("图片超过 20 MB，暂不支持在桌面端预览，可使用系统程序打开")
		}
		data, err := os.ReadFile(target)
		if err != nil {
			return nil, err
		}
		base["content"] = ""
		base["binary"] = true
		base["preview"] = map[string]any{"mimeType": mime, "dataUrl": "data:" + mime + ";base64," + base64Encode(data)}
		return base, nil
	}
	if info.Size() > textPreviewMax {
		return nil, errors.New("文件超过 20 MB，暂不支持在桌面端预览，可使用系统程序打开")
	}
	data, err := os.ReadFile(target)
	if err != nil {
		return nil, err
	}
	if looksBinary(data) {
		base["content"] = ""
		base["binary"] = true
		return base, nil
	}
	base["content"] = string(data)
	base["revision"] = sha256Hex(data)
	if external {
		h.rememberExternalFile(target)
	}
	return base, nil
}

// localImageMaxBytes 是内嵌图片的上限：data URL 会让内存翻 1.33 倍，再大就不合适了。
const localImageMaxBytes = 20 * 1024 * 1024

// readLocalImage 把一张图片读成 data URL，只给对话里的图片用。
// 与 readWorkspaceFile 的区别：只接受图片（扩展名 + 文件头魔数）、不登记 externalFiles、
// 不监听目录——它是纯展示用途，不该因为显示一张图就给写盘开权限。
func (h *Host) readLocalImage(cwd, requested string) (map[string]any, error) {
	_, target, external, err := workspaceFilePath(cwd, requested)
	if err != nil {
		return nil, err
	}
	if external {
		if _, err := realPath(target); err != nil {
			return nil, errors.New("图片不存在或无法访问")
		}
	} else if err := assertRealWorkspacePath(cwd, target, false); err != nil {
		return nil, err
	}
	info, err := os.Lstat(target)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("图片不存在或无法访问")
	}
	if imageMIMEByExt[strings.ToLower(filepath.Ext(target))] == "" {
		return nil, errors.New("只能读取图片文件")
	}
	if info.Size() > localImageMaxBytes {
		return nil, errors.New("图片超过 20 MB，暂不支持内嵌预览")
	}
	data, err := os.ReadFile(target)
	if err != nil {
		return nil, errors.New("图片读取失败")
	}
	// 光看扩展名不够：SVG 没有魔数，其余格式必须真的像图片，否则 HTML / 脚本会被
	// 当成 image/png 塞进 data URL。
	mime := sniffImageMIME(data)
	if mime == "" {
		if strings.ToLower(filepath.Ext(target)) != ".svg" {
			return nil, errors.New("文件内容不是可识别的图片")
		}
		mime = "image/svg+xml"
	}
	return map[string]any{
		"path": target, "mimeType": mime, "size": info.Size(),
		"dataUrl": "data:" + mime + ";base64," + base64Encode(data),
	}, nil
}

// rememberExternalFile 记下在编辑器里打开过的项目外文件。只有这些允许写回，
// 免得写文件接口被用来覆盖磁盘上任意一个文件。
func (h *Host) rememberExternalFile(target string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.externalFiles == nil {
		h.externalFiles = map[string]string{}
	}
	h.externalFiles[normPathKey(target)] = target
}

func (h *Host) isRememberedExternalFile(target string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := h.externalFiles[normPathKey(target)]
	return ok
}

func (h *Host) writeWorkspaceFile(cwd, requested, content, expectedRevision string) (map[string]any, error) {
	root, target, external, err := workspaceFilePath(cwd, requested)
	if err != nil {
		return nil, err
	}
	if external && !within(root, target) && !h.isRememberedExternalFile(target) {
		return nil, errors.New("项目目录外的文件只能保存在编辑器里打开过的，请先重新打开再保存")
	}
	if len(content) > textPreviewMax {
		return nil, errors.New("文件超过 20 MB，暂不支持保存")
	}
	var result map[string]any
	err = withFileWrite(target, func() error {
		info, err := os.Lstat(target)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("文件不存在或无法修改")
		}
		if info.Size() > textPreviewMax {
			return errors.New("文件超过 20 MB，暂不支持保存")
		}
		previous, err := os.ReadFile(target)
		if err != nil {
			return err
		}
		if imageMimeOfFile(target, readHead(target, 16)) != "" || looksBinary(previous) {
			return errors.New("图片等二进制文件不支持在文本编辑器中保存")
		}
		revision := sha256Hex(previous)
		if expectedRevision != "" && revision != expectedRevision {
			return errors.New("文件已在磁盘上被改动，已阻止覆盖；请先重新读取再合并修改")
		}
		if err := atomicWriteText(target, content); err != nil {
			return err
		}
		rel := target
		if !external {
			rel, _ = filepath.Rel(root, target)
			rel = strings.ReplaceAll(rel, "\\", "/")
		}
		result = map[string]any{
			"path": target, "relative": rel, "name": filepath.Base(target),
			"content": content, "size": len(content), "revision": sha256Hex([]byte(content)),
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (h *Host) openWorkspacePath(cwd, requested string) (string, error) {
	_, target, external, err := workspaceFilePath(cwd, requested)
	if err != nil {
		return "", err
	}
	if external {
		if _, err := realPath(target); err != nil {
			return "", errors.New("文件不存在或无法访问")
		}
		// 项目外的脚本/可执行文件不用系统程序打开：那等于双击运行一个界面刚拿到的路径。
		if isDangerousOpenPath(target) {
			return "", errors.New("项目外的可执行文件和脚本不能用系统程序直接打开，请改用「在文件管理器中显示」")
		}
	} else if err := assertRealWorkspacePath(cwd, target, false); err != nil {
		return "", err
	}
	info, err := os.Lstat(target)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("文件不存在或无法打开")
	}
	h.watchWorkspace(cwd)
	return target, nil
}

// isNetworkPath 判断 UNC / 网络位置（`\\srv\share`、`//srv/share`、`\\?\UNC\srv`）。
// Windows 访问 SMB 时会先向对方发 NTLM 凭据，而对话里的 markdown 图片、文件链接
// 可以带任意路径进来，所以外部路径一律不接网络位置。
func isNetworkPath(path string) bool {
	if len(path) < 2 {
		return false
	}
	first, second := path[0], path[1]
	return (first == '\\' || first == '/') && (second == '\\' || second == '/')
}

// dangerousOpenExts 是交给系统程序打开时会被直接执行/加载的脚本类扩展名。
var dangerousOpenExts = map[string]bool{
	".exe": true, ".bat": true, ".cmd": true, ".com": true, ".ps1": true,
	".vbs": true, ".js": true, ".jse": true, ".wsf": true, ".msi": true,
	".lnk": true, ".scr": true, ".hta": true, ".cpl": true,
}

func isDangerousOpenPath(path string) bool {
	return dangerousOpenExts[strings.ToLower(filepath.Ext(path))]
}

func workspaceFilePath(cwd, requested string) (root, target string, external bool, err error) {
	if strings.TrimSpace(requested) == "" {
		return "", "", false, errors.New("文件路径无效")
	}
	root, rootErr := filepath.Abs(cwd)
	if rootErr != nil {
		return "", "", false, errors.New("项目目录无效")
	}
	raw := strings.TrimSpace(requested)
	if filepath.IsAbs(raw) {
		if isNetworkPath(raw) {
			return "", "", false, errors.New("不支持网络位置（UNC）上的文件，请先把文件复制到本机")
		}
		target, _ = filepath.Abs(raw)
		return root, target, true, nil
	}
	_, resolved, err := workspacePath(cwd, raw)
	if err != nil {
		return "", "", false, err
	}
	return root, resolved, false, nil
}

func (h *Host) entryName(cwd, parent, name string) (root, target string, err error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || trimmed == "." || trimmed == ".." || strings.ContainsAny(trimmed, `\/`) {
		return "", "", errors.New("名称不能为空，也不能包含路径分隔符")
	}
	relative := trimmed
	if parent != "" {
		relative = strings.TrimRight(parent, `\/`) + "/" + trimmed
	}
	root, target, err = workspacePath(cwd, relative)
	if err != nil {
		return "", "", err
	}
	if err := assertRealWorkspacePath(cwd, filepath.Dir(target), false); err != nil {
		return "", "", err
	}
	if _, err := os.Lstat(target); err == nil {
		return "", "", fmt.Errorf("已存在同名项：%s", trimmed)
	}
	return root, target, nil
}

func (h *Host) createWorkspaceEntry(cwd, parent, name, kind string) (map[string]any, error) {
	root, target, err := h.entryName(cwd, parent, name)
	if err != nil {
		return nil, err
	}
	parentInfo, err := os.Lstat(filepath.Dir(target))
	if err != nil || !parentInfo.IsDir() {
		return nil, errors.New("目标目录不存在")
	}
	if kind == "folder" {
		if err := os.Mkdir(target, 0o755); err != nil {
			return nil, err
		}
	} else {
		f, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			return nil, err
		}
		_ = f.Close()
	}
	clearCompletionCache(cwd)
	rel, _ := filepath.Rel(root, target)
	return map[string]any{"path": target, "relative": strings.ReplaceAll(rel, "\\", "/"), "name": filepath.Base(target), "kind": kind}, nil
}

func (h *Host) renameWorkspaceEntry(cwd, relative, name string) (map[string]any, error) {
	root, current, err := workspacePath(cwd, relative)
	if err != nil {
		return nil, err
	}
	if err := assertRealWorkspacePath(cwd, current, false); err != nil {
		return nil, err
	}
	info, err := os.Lstat(current)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || (!info.Mode().IsRegular() && !info.IsDir()) {
		return nil, errors.New("项目不存在或无法重命名")
	}
	parent, _ := filepath.Rel(root, filepath.Dir(current))
	parent = strings.ReplaceAll(parent, "\\", "/")
	if parent == "." {
		parent = ""
	}
	nextRoot, next, err := h.entryName(cwd, parent, name)
	if err != nil {
		return nil, err
	}
	if err := os.Rename(current, next); err != nil {
		return nil, err
	}
	clearCompletionCache(cwd)
	rel, _ := filepath.Rel(nextRoot, next)
	kind := "file"
	if info.IsDir() {
		kind = "folder"
	}
	return map[string]any{"path": next, "relative": strings.ReplaceAll(rel, "\\", "/"), "name": filepath.Base(next), "kind": kind}, nil
}

func (h *Host) deleteWorkspaceEntry(cwd, relative string) error {
	root, target, err := workspacePath(cwd, relative)
	if err != nil {
		return err
	}
	if err := assertRealWorkspacePath(cwd, target, false); err != nil {
		return err
	}
	if target == root {
		return errors.New("不能删除项目根目录")
	}
	info, err := os.Lstat(target)
	if err != nil || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("项目不存在或无法删除")
	}
	if err := trashFile(target); err != nil {
		return err
	}
	clearCompletionCache(cwd)
	return nil
}

// ---------- @ 文件补全 ----------

type completionCacheEntry struct {
	at      time.Time
	entries []string
}

var (
	completionMu    sync.Mutex
	completionCache = map[string]completionCacheEntry{}
)

func completionKey(root string) string { return normPathKey(root) }

func clearCompletionCache(root string) {
	completionMu.Lock()
	delete(completionCache, completionKey(root))
	completionMu.Unlock()
}

func (h *Host) completePaths(cwd, query string) ([]map[string]any, error) {
	root, _, err := workspacePath(cwd, "")
	if err != nil {
		return nil, err
	}
	if err := assertRealWorkspacePath(cwd, root, false); err != nil {
		return nil, err
	}
	key := completionKey(root)
	completionMu.Lock()
	cached, ok := completionCache[key]
	completionMu.Unlock()
	var entries []string
	if ok && time.Since(cached.at) < 2*time.Second {
		entries = cached.entries
	} else {
		entries = walkDirectory(root, root, []string{}, 5000)
		completionMu.Lock()
		completionCache[key] = completionCacheEntry{time.Now(), entries}
		if len(completionCache) > 8 {
			for old := range completionCache {
				if old != key {
					delete(completionCache, old)
					break
				}
			}
		}
		completionMu.Unlock()
	}
	q := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(strings.ReplaceAll(query, "\\", "/")), "./"))
	type scored struct {
		rel   string
		score int
	}
	var ranked []scored
	for _, rel := range entries {
		normalized := strings.ReplaceAll(rel, "\\", "/")
		value := strings.ToLower(normalized)
		trimmed := strings.TrimSuffix(value, "/")
		parts := strings.Split(trimmed, "/")
		name := parts[len(parts)-1]
		score := -1
		switch {
		case q == "":
			score = 0
		case name == q:
			score = 0
		case strings.HasPrefix(name, q):
			score = 10
		case strings.HasPrefix(trimmed, q):
			score = 20
		case strings.Contains(name, q):
			score = 30
		case strings.Contains(trimmed, q):
			score = 40
		default:
			cursor, gaps := 0, 0
			matched := true
			for _, r := range q {
				found := strings.IndexRune(value[cursor:], r)
				if found < 0 {
					matched = false
					break
				}
				gaps += found
				cursor += found + 1
			}
			if matched {
				score = 60 + gaps
			}
		}
		if score >= 0 {
			ranked = append(ranked, scored{normalized, score})
		}
	}
	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].score != ranked[j].score {
			return ranked[i].score < ranked[j].score
		}
		return strings.ToLower(ranked[i].rel) < strings.ToLower(ranked[j].rel)
	})
	if len(ranked) > 30 {
		ranked = ranked[:30]
	}
	out := []map[string]any{}
	for _, item := range ranked {
		folder := strings.HasSuffix(item.rel, "/")
		trimmed := strings.TrimSuffix(item.rel, "/")
		segments := strings.Split(trimmed, "/")
		kind := "file"
		if folder {
			kind = "folder"
		}
		out = append(out, map[string]any{
			"path": filepath.Join(append([]string{root}, segments...)...), "relative": item.rel,
			"name": segments[len(segments)-1], "kind": kind,
		})
	}
	return out, nil
}

// ---------- 粘贴图片 ----------

var pasteImageTypes = map[string]string{
	"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/bmp": "bmp",
}

func (h *Host) savePastedImage(payload map[string]any) (string, error) {
	mime := strings.ToLower(firstNonEmpty(asString(payload["mimeType"]), "image/png"))
	ext := pasteImageTypes[mime]
	if ext == "" {
		return "", fmt.Errorf("不支持的图片格式：%s", mime)
	}
	dataURL := asString(payload["data"])
	if strings.TrimSpace(dataURL) == "" {
		return "", errors.New("剪贴板图片内容为空")
	}
	if len(dataURL) > 20*1024*1024*14/10 {
		return "", errors.New("图片过大（最大 20MB）")
	}
	data, err := decodeBase64(dataURL)
	if err != nil || len(data) == 0 {
		return "", errors.New("剪贴板图片解码失败")
	}
	dir := filepath.Join(os.TempDir(), "pi-desktop-paste")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	go cleanupPastedImages(dir, 30*24*time.Hour)
	stem := regexpNonWord.ReplaceAllString(strings.TrimSuffix(asString(payload["name"]), filepath.Ext(asString(payload["name"]))), "-")
	if stem == "" {
		stem = "pasted"
	}
	if len(stem) > 40 {
		stem = stem[:40]
	}
	file := filepath.Join(dir, fmt.Sprintf("%s-%d-%s.%s", stem, time.Now().UnixMilli(), randomSuffix(), ext))
	if err := os.WriteFile(file, data, 0o644); err != nil {
		return "", err
	}
	h.authorizedAttachmentPaths([]string{file})
	return file, nil
}

// cleanupPastedImages 清掉很久以前粘贴的临时图片，免得系统临时目录越积越多。
// 图片发送时已经按 base64 写进会话，这里的文件只是给 Pi 的路径提示，30 天足够宽松。
func cleanupPastedImages(dir string, maxAge time.Duration) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-maxAge)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if info, err := entry.Info(); err == nil && info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(dir, entry.Name()))
		}
	}
}

var regexpNonWord = mustRegexp(`[^\w.-]+`)

func mustRegexp(pattern string) *regexp.Regexp {
	return regexp.MustCompile(pattern)
}

// ---------- Git 分支（只读 HEAD，不调用 git） ----------

func gitBranch(cwd string) string {
	dir, _ := filepath.Abs(cwd)
	for depth := 0; depth < 32; depth++ {
		dotGit := filepath.Join(dir, ".git")
		gitDir := dotGit
		if info, err := os.Stat(dotGit); err == nil && info.Mode().IsRegular() {
			data, _ := os.ReadFile(dotGit)
			if match := regexpGitdir.FindStringSubmatch(string(data)); len(match) > 1 {
				// git worktree 写的是绝对路径（submodule 才是相对路径），直接 Join 会拼出无效地址，
				// 隔离工作区的标题栏分支名因此一直是空的。
				target := filepath.FromSlash(strings.TrimSpace(match[1]))
				if filepath.IsAbs(target) {
					gitDir = filepath.Clean(target)
				} else {
					gitDir = filepath.Join(dir, target)
				}
			} else {
				return ""
			}
		}
		if head, err := os.ReadFile(filepath.Join(gitDir, "HEAD")); err == nil {
			text := strings.TrimSpace(string(head))
			if strings.HasPrefix(text, "ref: refs/heads/") {
				return strings.TrimPrefix(text, "ref: refs/heads/")
			}
			if len(text) > 7 {
				return text[:7]
			}
			return text
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
	return ""
}

var regexpGitdir = mustRegexp(`gitdir:\s*(.+)`)

var _ = json.Marshal
