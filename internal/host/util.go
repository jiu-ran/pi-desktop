package host

import (
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

// ---------- 路径 ----------

func isWindows() bool { return runtime.GOOS == "windows" }

func samePath(a, b string) bool {
	x, _ := filepath.Abs(a)
	y, _ := filepath.Abs(b)
	if isWindows() {
		return strings.EqualFold(filepath.Clean(x), filepath.Clean(y))
	}
	return filepath.Clean(x) == filepath.Clean(y)
}

func normPathKey(p string) string {
	abs, _ := filepath.Abs(p)
	if isWindows() {
		return strings.ToLower(filepath.Clean(abs))
	}
	return filepath.Clean(abs)
}

// within 判断 child 是否严格位于 parent 内（不含 parent 自身）。
func within(parent, child string) bool {
	rel, err := filepath.Rel(filepath.Clean(parent), filepath.Clean(child))
	if err != nil {
		return false
	}
	return rel != "." && rel != "" && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) && rel != ".." && !filepath.IsAbs(rel)
}

func realPath(p string) (string, error) {
	resolved, err := filepath.EvalSymlinks(p)
	if err != nil {
		return "", err
	}
	abs, err := filepath.Abs(resolved)
	if err != nil {
		return "", err
	}
	return abs, nil
}

// workspacePath 把相对路径限制在项目目录里。返回根与目标绝对路径。
func workspacePath(cwd, rel string) (root, target string, err error) {
	if strings.TrimSpace(cwd) == "" {
		return "", "", errors.New("项目目录无效")
	}
	root, err = filepath.Abs(cwd)
	if err != nil {
		return "", "", errors.New("项目目录无效")
	}
	target, err = filepath.Abs(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		return "", "", errors.New("路径无效")
	}
	if target != root && !within(root, target) {
		return "", "", errors.New("路径必须位于当前项目目录内")
	}
	return root, target, nil
}

// assertRealWorkspacePath 用真实路径再校验一次，防止符号链接跳出项目。
func assertRealWorkspacePath(cwd, target string, allowMissing bool) error {
	root, _, err := workspacePath(cwd, "")
	if err != nil {
		return err
	}
	realRoot, err := realPath(root)
	if err != nil {
		return errors.New("路径不存在或无法访问")
	}
	candidate := target
	for {
		resolved, err := realPath(candidate)
		if err == nil {
			candidate = resolved
			break
		}
		if !allowMissing {
			return errors.New("路径不存在或无法访问")
		}
		parent := filepath.Dir(candidate)
		if parent == candidate {
			return errors.New("路径不存在或无法访问")
		}
		candidate = parent
	}
	if candidate != realRoot && !within(realRoot, candidate) {
		return errors.New("路径必须位于当前项目目录内")
	}
	return nil
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

func readSmallFile(p string, limit int64) string {
	info, err := os.Stat(p)
	if err != nil || info.IsDir() || (limit > 0 && info.Size() > limit) {
		return ""
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	return string(data)
}

func readJSONFile(p string) (map[string]any, error) {
	data, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	obj, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s：根节点必须是 JSON 对象", p)
	}
	return obj, nil
}

func asMap(value any) map[string]any {
	if m, ok := value.(map[string]any); ok && m != nil {
		return m
	}
	return map[string]any{}
}

func asSlice(value any) []any {
	if s, ok := value.([]any); ok {
		return s
	}
	return nil
}

func asString(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}

func asBool(value any) bool {
	b, _ := value.(bool)
	return b
}

func asFloat(value any) float64 {
	switch n := value.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case json.Number:
		f, _ := n.Float64()
		return f
	}
	return 0
}

func strSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// stringList 总是返回非 nil 的 []string，JSON 里是 [] 而不是 null。
func stringList(value any) []string {
	out := strSlice(value)
	if out == nil {
		return []string{}
	}
	return out
}

// ---------- 原子写入 / 文件锁 ----------

var fileLocks sync.Map

func lockFor(file string) *sync.Mutex {
	key := normPathKey(file)
	value, _ := fileLocks.LoadOrStore(key, &sync.Mutex{})
	return value.(*sync.Mutex)
}

func withFileWrite(file string, fn func() error) error {
	mu := lockFor(file)
	mu.Lock()
	defer mu.Unlock()
	return fn()
}

// atomicWriteText 同目录临时文件 + 原子替换；与 Electron 版一致。
func atomicWriteText(file, content string) error {
	dir := filepath.Dir(file)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".pi-desktop-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	cleanup := func() {
		tmp.Close()
		os.Remove(name)
	}
	if _, err := tmp.WriteString(content); err != nil {
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Rename(name, file); err != nil {
		// Windows 上目标被占用时 rename 会失败：先删目标再重试一次。
		if removeErr := os.Remove(file); removeErr == nil {
			if retry := os.Rename(name, file); retry == nil {
				return nil
			}
		}
		os.Remove(name)
		return err
	}
	return nil
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func shortHash(value string) string {
	sum := sha1.Sum([]byte(value))
	return hex.EncodeToString(sum[:])[:8]
}

func randomSuffix() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	var buf [6]byte
	if _, err := rand.Read(buf[:]); err == nil {
		for i := range buf {
			buf[i] = alphabet[int(buf[i])%len(alphabet)]
		}
		return string(buf[:])
	}
	return fmt.Sprintf("%06x", os.Getpid()&0xffffff)
}

func envSlice(env map[string]string, extra ...string) []string {
	var out []string
	if env != nil {
		out = make([]string, 0, len(env)+len(extra))
		for k, v := range env {
			out = append(out, k+"="+v)
		}
	} else {
		out = os.Environ()
	}
	return append(out, extra...)
}

func randomUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", os.Getpid())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ---------- 文本 ----------

func escapeXML(value string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(value)
}

func formatBytes(bytes int64) string {
	switch {
	case bytes >= 1024*1024:
		return fmt.Sprintf("%.1f MB", float64(bytes)/(1024*1024))
	case bytes >= 1024:
		return fmt.Sprintf("%d KB", (bytes+512)/1024)
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}

func worktreeSlug(value string) string {
	text := strings.ToLower(strings.TrimSpace(value))
	var out strings.Builder
	lastDash := false
	for _, r := range text {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '.' || r == '_' || r == '-' {
			if r == '-' {
				if lastDash || out.Len() == 0 {
					continue
				}
				lastDash = true
			} else {
				lastDash = false
			}
			out.WriteRune(r)
		} else {
			if !lastDash && out.Len() > 0 {
				out.WriteRune('-')
				lastDash = true
			}
		}
	}
	slug := out.String()
	slug = strings.Trim(slug, "._-")
	for strings.Contains(slug, "..") {
		slug = strings.ReplaceAll(slug, "..", "-")
	}
	slug = strings.TrimSuffix(slug, ".lock")
	runes := []rune(slug)
	if len(runes) > 40 {
		slug = string(runes[:40])
	}
	return strings.Trim(slug, "._-")
}

var gitSourceRe = regexp.MustCompile(`(?i)^(git:|https?://|ssh://|git://)|^[^@\s/]+@[^:/\s]+:|(^|\.)(github|gitlab|bitbucket)\.com[/:]`)

func isGitSource(source string) bool { return gitSourceRe.MatchString(source) }

// ---------- 会话 ----------

func agentSessionsRoot() string {
	dir := os.Getenv("PI_CODING_AGENT_DIR")
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".pi", "agent")
	}
	return normPathKey(filepath.Join(dir, "sessions")) + string(os.PathSeparator)
}

// sessionDir 与 Pi 的 getDefaultSessionDir 同一编码规则。
func sessionDir(cwd string) string {
	agent := os.Getenv("PI_CODING_AGENT_DIR")
	if agent == "" {
		home, _ := os.UserHomeDir()
		agent = filepath.Join(home, ".pi", "agent")
	}
	resolved, _ := filepath.Abs(cwd)
	var b strings.Builder
	b.WriteString("--")
	trimmed := strings.TrimLeft(resolved, "/\\")
	for _, r := range trimmed {
		switch r {
		case '\\', '/', ':':
			b.WriteRune('-')
		default:
			b.WriteRune(r)
		}
	}
	b.WriteString("--")
	return filepath.Join(agent, "sessions", b.String())
}

func assertSessionFile(cwd, file string) (string, error) {
	dir := normPathKey(sessionDir(cwd)) + string(os.PathSeparator)
	if !strings.HasSuffix(strings.ToLower(file), ".jsonl") || !strings.HasPrefix(normPathKey(file)+string(os.PathSeparator), dir) {
		return "", errors.New("只能删除该项目自己的会话文件")
	}
	abs, _ := filepath.Abs(file)
	return abs, nil
}

func assertReadableSessionFile(cwd, file string) (string, error) {
	if !strings.HasSuffix(strings.ToLower(file), ".jsonl") {
		return "", errors.New("只能读取会话文件")
	}
	dir := normPathKey(sessionDir(cwd)) + string(os.PathSeparator)
	target := normPathKey(file) + string(os.PathSeparator)
	if !strings.HasPrefix(target, dir) && !strings.HasPrefix(target, agentSessionsRoot()) {
		return "", errors.New("只能读取会话目录下的记录")
	}
	abs, _ := filepath.Abs(file)
	return abs, nil
}

// ---------- 二进制 / 预览 ----------

func looksBinary(data []byte) bool {
	head := data
	if len(head) > 8192 {
		head = head[:8192]
	}
	for _, b := range head {
		if b == 0 {
			return true
		}
	}
	// 截断的多字节字符不算二进制：退到完整字符边界再严格解码。
	end := len(head)
	if len(data) > len(head) {
		lead := end - 1
		for lead >= 0 && end-lead <= 4 && head[lead]&0xc0 == 0x80 {
			lead--
		}
		if lead >= 0 {
			b := head[lead]
			expected := 1
			switch {
			case b >= 0xf0:
				expected = 4
			case b >= 0xe0:
				expected = 3
			case b >= 0xc0:
				expected = 2
			}
			if lead+expected > end {
				end = lead
			}
		}
	}
	return !utf8.Valid(head[:end])
}

func sniffImageMIME(head []byte) string {
	if len(head) >= 8 && string(head[:8]) == "\x89PNG\r\n\x1a\n" {
		return "image/png"
	}
	if len(head) >= 3 && head[0] == 0xff && head[1] == 0xd8 && head[2] == 0xff {
		return "image/jpeg"
	}
	if len(head) >= 4 && string(head[:4]) == "GIF8" {
		return "image/gif"
	}
	if len(head) >= 12 && string(head[:4]) == "RIFF" && string(head[8:12]) == "WEBP" {
		return "image/webp"
	}
	if len(head) >= 2 && head[0] == 0x42 && head[1] == 0x4d {
		return "image/bmp"
	}
	if len(head) >= 4 && head[0] == 0 && head[1] == 0 && head[2] == 1 && head[3] == 0 {
		return "image/x-icon"
	}
	if len(head) >= 12 && strings.Contains(string(head[4:12]), "ftypavi") {
		return "image/avif"
	}
	return ""
}

var imageMIMEByExt = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
	".webp": "image/webp", ".bmp": "image/bmp", ".ico": "image/x-icon", ".avif": "image/avif",
	".svg": "image/svg+xml",
}

var textExtensions = map[string]bool{
	".js": true, ".jsx": true, ".ts": true, ".tsx": true, ".vue": true, ".svelte": true,
	".css": true, ".scss": true, ".less": true, ".html": true, ".xml": true, ".json": true,
	".jsonl": true, ".md": true, ".txt": true, ".log": true, ".yml": true, ".yaml": true,
	".toml": true, ".ini": true, ".env": true, ".csv": true, ".py": true, ".java": true,
	".kt": true, ".go": true, ".rs": true, ".c": true, ".h": true, ".cpp": true, ".hpp": true,
	".cs": true, ".php": true, ".rb": true, ".sh": true, ".ps1": true,
}

func isProbablyText(file string) bool {
	ext := strings.ToLower(filepath.Ext(file))
	return textExtensions[ext] || ext == ""
}

func imageMimeOfFile(file string, head []byte) string {
	if mime := sniffImageMIME(head); mime != "" {
		return mime
	}
	return imageMIMEByExt[strings.ToLower(filepath.Ext(file))]
}

func readHead(file string, length int) []byte {
	f, err := os.Open(file)
	if err != nil {
		return nil
	}
	defer f.Close()
	buf := make([]byte, length)
	n, _ := io.ReadFull(f, buf)
	return buf[:n]
}

func base64Encode(data []byte) string { return base64.StdEncoding.EncodeToString(data) }

func decodeBase64(data string) ([]byte, error) {
	if idx := strings.Index(data, ";base64,"); idx >= 0 {
		data = data[idx+len(";base64,"):]
	}
	return base64.StdEncoding.DecodeString(strings.TrimSpace(data))
}

// ---------- 杂项 ----------

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func dedupeStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func tailText(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	return text[len(text)-limit:]
}

func readDirNames(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		out = append(out, entry.Name())
	}
	return out
}

func isWriteableDir(dir string) bool {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return false
	}
	probe := filepath.Join(dir, ".write-probe")
	if err := os.WriteFile(probe, []byte("1"), 0o644); err != nil {
		return false
	}
	_ = os.Remove(probe)
	return true
}

var _ = fs.SkipDir
var _ = errors.New

