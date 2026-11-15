package host

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

type logStream string

const (
	logAppStream      logStream = "app"
	logRendererStream logStream = "renderer"
	logPiStream       logStream = "pi"
	logPerfStream     logStream = "perf"
)

const (
	defaultLogTotalBytes = 8 * 1024 * 1024
	maxLogFileBytes      = 8 * 1024 * 1024
	minLogFileBytes      = 512 * 1024
	maxLogKeepFiles      = 12
)

var logChoicesMb = []int{4, 8, 16, 32, 64, 128}

type LogFileEntry struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	MtimeMs int64  `json:"mtimeMs"`
}

type LogLimits struct {
	LimitBytes int64 `json:"limitBytes"`
	FileBytes  int64 `json:"fileBytes"`
	KeepFiles  int   `json:"keepFiles"`
	ChoicesMb  []int `json:"choicesMb"`
}

type LogSummary struct {
	Dir        string         `json:"dir"`
	TotalBytes int64          `json:"totalBytes"`
	Files      []LogFileEntry `json:"files"`
	LogLimits
}

type logStore struct {
	mu      sync.Mutex
	flusher sync.Once
	dir     string
	limit   int64
	fileMax int64
	keep    int
	// 写入缓冲，避免每个事件都 open/append/close。
	pending map[logStream]*strings.Builder
}

var logs = &logStore{
	limit:   defaultLogTotalBytes,
	fileMax: defaultLogTotalBytes / 4,
	keep:    4,
	pending: map[logStream]*strings.Builder{},
}

var (
	redactTokenRe  = regexp.MustCompile(`\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}`)
	redactGHRe     = regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{16,}`)
	redactSlackRe  = regexp.MustCompile(`\bxox[baprs]-[A-Za-z0-9-]{10,}`)
	redactGoogleRe = regexp.MustCompile(`\bAIza[0-9A-Za-z_-]{20,}`)
	redactBearerRe = regexp.MustCompile(`(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{8,}`)
	redactKeyRe    = regexp.MustCompile(`(?i)((?:api[-_]?key|token|secret|password|passwd|authorization)["']?\s*[:=]\s*["']?)[^\s"',;}]{6,}`)
	redactDataRe   = regexp.MustCompile(`(?i)data:([a-z]+\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/=]{64,}`)
	redactB64Re    = regexp.MustCompile(`\b[A-Za-z0-9+/]{200,}={0,2}\b`)
)

func redactLog(input string) string {
	text := redactTokenRe.ReplaceAllString(input, "$1-***")
	text = redactGHRe.ReplaceAllString(text, "gh*_***")
	text = redactSlackRe.ReplaceAllString(text, "xox*-***")
	text = redactGoogleRe.ReplaceAllString(text, "AIza***")
	text = redactBearerRe.ReplaceAllString(text, "$1***")
	text = redactKeyRe.ReplaceAllString(text, "$1***")
	text = redactDataRe.ReplaceAllString(text, "data:$1;base64,<省略>")
	text = redactB64Re.ReplaceAllStringFunc(text, func(m string) string { return fmt.Sprintf("<省略 %d 字符 base64>", len(m)) })
	return text
}

func logSizing(total int64) (limit, fileBytes int64, keep int) {
	if total < minLogFileBytes {
		total = defaultLogTotalBytes
	}
	if total > 1024*1024*1024 {
		total = 1024 * 1024 * 1024
	}
	fileBytes = total / 4
	if fileBytes < minLogFileBytes {
		fileBytes = minLogFileBytes
	}
	if fileBytes > maxLogFileBytes {
		fileBytes = maxLogFileBytes
	}
	keep = int((total + fileBytes - 1) / fileBytes)
	if keep < 2 {
		keep = 2
	}
	if keep > maxLogKeepFiles {
		keep = maxLogKeepFiles
	}
	return total, fileBytes, keep
}

func normalizeLogLimit(value int64) int64 {
	mb := (value + 512*1024) / (1024 * 1024)
	for _, choice := range logChoicesMb {
		if int64(choice) == mb {
			return int64(choice) * 1024 * 1024
		}
	}
	if value <= 0 {
		return defaultLogTotalBytes
	}
	if value < 1024*1024 {
		return 1024 * 1024
	}
	if value > 128*1024*1024 {
		return 128 * 1024 * 1024
	}
	return value
}

func (s *logStore) startFlusher() {
	s.flusher.Do(func() {
		go func() {
			ticker := time.NewTicker(400 * time.Millisecond)
			defer ticker.Stop()
			for range ticker.C {
				s.flush()
			}
		}()
	})
}

func (s *logStore) configure(dir string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if dir == s.dir {
		return
	}
	s.flushLocked()
	s.dir = dir
	s.pending = map[logStream]*strings.Builder{}
	_ = os.MkdirAll(dir, 0o755)
	s.startFlusher()
}

func (s *logStore) limits() LogLimits {
	return LogLimits{LimitBytes: s.limit, FileBytes: s.fileMax, KeepFiles: s.keep, ChoicesMb: append([]int{}, logChoicesMb...)}
}

func (s *logStore) setLimits(total int64) LogLimits {
	s.mu.Lock()
	s.limit, s.fileMax, s.keep = logSizing(normalizeLogLimit(total))
	s.mu.Unlock()
	s.prune()
	return s.limits()
}

func formatLogLine(stream logStream, level, scope, message string) string {
	_ = stream
	tag := ""
	if scope != "" {
		tag = " (" + scope + ")"
	}
	text := redactLog(message)
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.TrimRight(text, "\n")
	text = strings.ReplaceAll(text, "\n", " ⏎ ")
	return fmt.Sprintf("%s [%s]%s%s %s\n", time.Now().UTC().Format("2006-01-02T15:04:05.000Z"), strings.ToUpper(level), tag, streamSuffix(stream), text)
}

func streamSuffix(stream logStream) string { return "" }

func (s *logStore) write(stream logStream, level, scope, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.dir == "" {
		return
	}
	builder := s.pending[stream]
	if builder == nil {
		builder = &strings.Builder{}
		s.pending[stream] = builder
	}
	builder.WriteString(formatLogLine(stream, level, scope, message))
	if builder.Len() >= 64*1024 {
		s.flushStreamLocked(stream, builder)
		builder.Reset()
	}
}

func (s *logStore) flushLocked() {
	for stream, builder := range s.pending {
		if builder.Len() == 0 {
			continue
		}
		s.flushStreamLocked(stream, builder)
		builder.Reset()
	}
}

func (s *logStore) flushStreamLocked(stream logStream, builder *strings.Builder) {
	if s.dir == "" || builder.Len() == 0 {
		return
	}
	_ = os.MkdirAll(s.dir, 0o755)
	file := filepath.Join(s.dir, string(stream)+".log")
	if info, err := os.Stat(file); err == nil && info.Size() >= s.fileMax {
		stamp := time.Now().UTC().Format("2006-01-02T15-04-05.000")
		_ = os.Rename(file, filepath.Join(s.dir, fmt.Sprintf("%s-%s.log", stream, stamp)))
	}
	f, err := os.OpenFile(file, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	_, _ = f.WriteString(builder.String())
	_ = f.Close()
}

func (s *logStore) flush() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.flushLocked()
}

func (s *logStore) summary() LogSummary {
	s.flush()
	s.mu.Lock()
	dir := s.dir
	limits := s.limits()
	s.mu.Unlock()
	out := LogSummary{Dir: dir, Files: []LogFileEntry{}, LogLimits: limits}
	if dir == "" {
		return out
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return out
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".log") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		out.Files = append(out.Files, LogFileEntry{Name: entry.Name(), Size: info.Size(), MtimeMs: info.ModTime().UnixMilli()})
		out.TotalBytes += info.Size()
	}
	sort.Slice(out.Files, func(i, j int) bool { return out.Files[i].MtimeMs > out.Files[j].MtimeMs })
	return out
}

func (s *logStore) prune() {
	s.flush()
	s.mu.Lock()
	dir, limit, keep := s.dir, s.limit, s.keep
	s.mu.Unlock()
	if dir == "" {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	active := map[string]bool{"app.log": true, "renderer.log": true, "pi.log": true, "perf.log": true}
	type candidate struct {
		name string
		size int64
		at   int64
	}
	var files []candidate
	var total int64
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".log") || active[entry.Name()] {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, candidate{entry.Name(), info.Size(), info.ModTime().UnixMilli()})
		total += info.Size()
	}
	sort.Slice(files, func(i, j int) bool { return files[i].at < files[j].at })
	// 保留个数按「含活跃文件」算。
	for len(files)+len(active) > keep {
		oldest := files[0]
		files = files[1:]
		total -= oldest.size
		_ = os.Remove(filepath.Join(dir, oldest.name))
	}
	for total > limit && len(files) > 0 {
		oldest := files[0]
		files = files[1:]
		total -= oldest.size
		_ = os.Remove(filepath.Join(dir, oldest.name))
	}
}

func (s *logStore) clear() {
	s.flush()
	s.mu.Lock()
	dir := s.dir
	s.mu.Unlock()
	if dir == "" {
		return
	}
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".log") {
			_ = os.Remove(filepath.Join(dir, entry.Name()))
		}
	}
	s.mu.Lock()
	s.pending = map[logStream]*strings.Builder{}
	s.mu.Unlock()
}

func logInfo(scope, message string)  { logs.write(logAppStream, "info", scope, message) }
func logWarn(scope, message string)  { logs.write(logAppStream, "warn", scope, message) }
func logError(scope, message string) { logs.write(logAppStream, "error", scope, message) }
func logPi(level, scope, message string) {
	logs.write(logPiStream, level, scope, message)
}
func logPerf(message string) { logs.write(logPerfStream, "info", "perf", message) }
func logRenderer(level, scope, message string) {
	logs.write(logRendererStream, level, scope, message)
}

// ConfigureLogs 决定日志落盘位置：优先跟程序放在一起（安装目录 / 开发仓库根），
// 不可写时回落到 userData/logs。与 Electron 版的行为一致。
func ConfigureLogs() {
	preferred := ""
	if exe, err := os.Executable(); err == nil {
		preferred = filepath.Join(filepath.Dir(exe), "logs")
	}
	if mygo.IsDev() {
		if cwd, err := os.Getwd(); err == nil {
			preferred = filepath.Join(cwd, "logs")
		}
	}
	if preferred == "" || !isWriteableDir(preferred) {
		preferred = filepath.Join(userDataDir(), "logs")
	}
	logs.configure(preferred)
	logInfo("logs", "日志目录已切换："+preferred)
}
