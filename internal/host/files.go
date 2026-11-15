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
	return base, nil
}

func (h *Host) writeWorkspaceFile(cwd, requested, content, expectedRevision string) (map[string]any, error) {
	root, target, external, err := workspaceFilePath(cwd, requested)
	if err != nil {
		return nil, err
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
	} else if err := assertRealWorkspacePath(cwd, target, false); err != nil {
		return "", err
	}
	info, err := os.Lstat(target)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("文件不存在或无法打开")
	}
	h.watcher.watch(cwd)
	return target, nil
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

var regexpNonWord = mustRegexp(`[^\w.-]+`)

func mustRegexp(pattern string) *regexp.Regexp {
	return regexp.MustCompile(pattern)
}

func randomSuffix() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	var b strings.Builder
	seed := time.Now().UnixNano()
	for i := 0; i < 6; i++ {
		b.WriteByte(alphabet[seed%int64(len(alphabet))])
		seed /= int64(len(alphabet))
		seed += int64(i * 7919)
	}
	return b.String()
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
				gitDir = filepath.Join(dir, strings.TrimSpace(match[1]))
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
