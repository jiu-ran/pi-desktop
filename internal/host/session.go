package host

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	sessionTitleMax      = 48
	historyAlignWindow   = 60
	historyMaxPage       = 240
	historyPageSize      = 8
	sessionNameColdScan  = 2 * 1024 * 1024
	sessionNameChunkSize = 64 * 1024
	sessionDigestPerMsg  = 700
	sessionDigestMax     = 12000
	sessionDigestHead    = 2
)

var historyRoles = map[string]bool{"user": true, "assistant": true, "toolResult": true, "bashExecution": true}

// ---------- 标题 ----------

var attachmentMarkerRe = regexp.MustCompile(`(?s)<(file|directory) name="([^"]*)"[^>]*>.*?</(?:file|directory)>`)

// 引用会话时，首条消息以 `<session name="<文件>" title="<标题>" messages="N">` 开头。
// 直接拿原文当标题会显示成一串路径（Pi CLI 就是这样），所以改成「被引用会话的名字（引用）」。
var (
	sessionQuoteHeaderRe = regexp.MustCompile(`^<session\s[^>]*>`)
	sessionQuoteNameRe   = regexp.MustCompile(`name="([^"]*)"`)
	sessionQuoteTitleRe  = regexp.MustCompile(`title="([^"]*)"`)
)

const quotedTitleSuffix = "（引用）"

// parseQuotedSessionHeader 拆出引用头里的会话文件与当时记录的标题。
func parseQuotedSessionHeader(text string) (path, title string, ok bool) {
	header := sessionQuoteHeaderRe.FindString(strings.TrimSpace(text))
	if header == "" {
		return "", "", false
	}
	if sub := sessionQuoteNameRe.FindStringSubmatch(header); len(sub) >= 2 {
		path = unescapeXML(sub[1])
	}
	if sub := sessionQuoteTitleRe.FindStringSubmatch(header); len(sub) >= 2 {
		title = strings.TrimSpace(unescapeXML(sub[1]))
	}
	return path, title, true
}

// quotedTitleText 统一成「X（引用）」并限制长度。
func quotedTitleText(title string) string {
	title = strings.TrimSpace(strings.TrimSuffix(title, quotedTitleSuffix))
	if title == "" {
		return ""
	}
	limit := sessionTitleMax - len([]rune(quotedTitleSuffix)) - 1 // 还要留一位给省略号
	if runes := []rune(title); limit > 0 && len(runes) > limit {
		title = string(runes[:limit]) + "…"
	}
	return title + quotedTitleSuffix
}

// resolveQuotedTitle 优先用被引用会话**当前**的名字（用户可能后来改过名），读不到才用引用时记下的标题。
func resolveQuotedTitle(text string) (string, bool) {
	path, title, ok := parseQuotedSessionHeader(text)
	if !ok {
		return "", false
	}
	if live := liveSessionTitle(path); live != "" {
		title = live
	}
	if result := quotedTitleText(title); result != "" {
		return result, true
	}
	return "", false
}

// liveSessionTitle 读被引用会话文件里存的会话名（不再递归解析它自己的首条消息）。
func liveSessionTitle(path string) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	info, err := os.Stat(filepath.Clean(path))
	if err != nil || info.IsDir() {
		return ""
	}
	return readSessionName(filepath.Clean(path), info.Size(), nil)
}

func attachmentNameFromPath(path string) string {
	parts := strings.FieldsFunc(path, func(r rune) bool { return r == '\\' || r == '/' })
	if len(parts) == 0 {
		return ""
	}
	return parts[len(parts)-1]
}

func sessionTitleFromText(text string) string {
	if _, title, ok := parseQuotedSessionHeader(text); ok && title != "" {
		return quotedTitleText(title)
	}
	fallback := ""
	stripped := attachmentMarkerRe.ReplaceAllStringFunc(text, func(match string) string {
		sub := attachmentMarkerRe.FindStringSubmatch(match)
		if len(sub) >= 3 && fallback == "" {
			fallback = attachmentNameFromPath(unescapeXML(sub[2]))
		}
		return " "
	})
	compact := strings.Join(strings.Fields(stripped), " ")
	source := compact
	if source == "" {
		source = fallback
	}
	if source == "" {
		return ""
	}
	runes := []rune(source)
	if len(runes) > sessionTitleMax {
		return string(runes[:sessionTitleMax]) + "…"
	}
	return source
}

// userTextTitle 给「用户消息 → 标题」用：引用会话要现读被引用会话的名字，其余走纯文本规则。
func userTextTitle(text string) string {
	if quoted, ok := resolveQuotedTitle(text); ok {
		return quoted
	}
	return sessionTitleFromText(text)
}
func unescapeXML(value string) string {
	replacer := strings.NewReplacer("&lt;", "<", "&gt;", ">", "&quot;", `"`, "&amp;", "&")
	return replacer.Replace(value)
}

func firstUserTitle(lines []string) string {
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}
		message := asMap(entry["message"])
		if len(message) == 0 {
			message = entry
		}
		if role, _ := message["role"].(string); role != "user" {
			continue
		}
		content := message["content"]
		if text, ok := content.(string); ok && text != "" {
			if title := userTextTitle(text); title != "" {
				return title
			}
		}
		if parts, ok := content.([]any); ok {
			for _, part := range parts {
				partMap := asMap(part)
				if partMap["type"] == "text" {
					if text, ok := partMap["text"].(string); ok {
						if title := userTextTitle(text); title != "" {
							return title
						}
					}
				}
			}
			for _, part := range parts {
				if asMap(part)["type"] == "image" {
					return "图片消息"
				}
			}
		}
		return "新会话"
	}
	return ""
}

func firstUserTitleFromMessages(messages []map[string]any) string {
	for _, message := range messages {
		if asString(message["role"]) != "user" {
			continue
		}
		content := message["content"]
		var text string
		switch value := content.(type) {
		case string:
			text = value
		case []any:
			var parts []string
			for _, part := range value {
				p := asMap(part)
				if p["type"] == "text" {
					parts = append(parts, asString(p["text"]))
				}
			}
			text = strings.Join(parts, " ")
		}
		if quoted, ok := resolveQuotedTitle(text); ok {
			return quoted
		}
		text = regexp.MustCompile(`(?s)<[^>]*>.*?</[^>]*>`).ReplaceAllString(text, " ")
		text = strings.Join(strings.Fields(text), " ")
		if text != "" {
			runes := []rune(text)
			if len(runes) > 40 {
				text = string(runes[:40])
			}
			return text
		}
	}
	return ""
}

// ---------- 会话名称（session_info） ----------

// 会话名称是 Pi 写进 JSONL 的一条 `session_info` 记录（后写的覆盖前面的，空名字表示清除）。
// 改名不会挪动文件里的位置，所以「最近一次改名」可能离文件末尾很远：这个长会话在 10 月
// 改过名，之后又追加了 100 多 MB，只看尾部就找不到了（CLI 从文件头扫，所以两边不一致）。
//
// 文件只追加，于是记住「已经扫到第几个字节」，下次只看新追加的部分；第一次碰到老文件
// 才从尾部 2MB 开始试，找不到再从头完整扫一遍。
type sessionNameCache struct {
	scanned int64 // 已经扫到的字节偏移
	mtimeMs int64
	hasName bool
	name    string
}

var (
	sessionNameMu       sync.Mutex
	sessionNameCacheMap = map[string]sessionNameCache{}
)

func readSessionName(file string, size int64, legacy any) string {
	legacyName := ""
	if text, ok := legacy.(string); ok {
		legacyName = sessionTitleFromText(text)
	}
	info, err := os.Stat(file)
	actualSize := size
	mtimeMs := int64(0)
	if err == nil {
		actualSize = info.Size()
		mtimeMs = info.ModTime().UnixMilli()
	}
	key := normPathKey(file)
	sessionNameMu.Lock()
	cached, hasCached := sessionNameCacheMap[key]
	sessionNameMu.Unlock()
	if hasCached && cached.scanned == actualSize && cached.mtimeMs == mtimeMs {
		if cached.hasName {
			return cached.name
		}
		return legacyName
	}

	state := sessionNameCache{}
	if hasCached && actualSize >= cached.scanned {
		state = cached
	}
	if actualSize > state.scanned {
		if state.scanned > 0 {
			// 只扫新追加的字节：改名总是追加在末尾
			if name, found, err := scanSessionNameRange(file, state.scanned, actualSize); err == nil && found {
				state.hasName, state.name = true, name
			}
		} else {
			tailStart := actualSize - sessionNameColdScan
			if tailStart < 0 {
				tailStart = 0
			}
			found := false
			if name, ok, err := scanSessionNameRange(file, tailStart, actualSize); err == nil && ok {
				state.hasName, state.name, found = true, name, true
			}
			if !found && tailStart > 0 {
				if name, ok, err := scanSessionNameRange(file, 0, actualSize); err == nil && ok {
					state.hasName, state.name = true, name
				}
			}
		}
	}
	state.scanned = actualSize
	state.mtimeMs = mtimeMs

	sessionNameMu.Lock()
	sessionNameCacheMap[key] = state
	if len(sessionNameCacheMap) > 200 {
		for old := range sessionNameCacheMap {
			if old != key {
				delete(sessionNameCacheMap, old)
				break
			}
		}
	}
	sessionNameMu.Unlock()
	if state.hasName {
		return state.name
	}
	return legacyName
}

// scanSessionNameRange 扫 [start,end) 这段，返回最后一条 session_info 的名字。
// start 落在某一行中间时，那半行解析失败会被跳过。
func scanSessionNameRange(file string, start, end int64) (string, bool, error) {
	if end <= start {
		return "", false, nil
	}
	f, err := os.Open(file)
	if err != nil {
		return "", false, err
	}
	defer f.Close()
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return "", false, err
	}
	reader := bufio.NewReaderSize(io.LimitReader(f, end-start), sessionNameChunkSize)
	name := ""
	found := false
	for {
		line, readErr := reader.ReadString('\n')
		if trimmed := strings.TrimSpace(line); trimmed != "" && strings.Contains(trimmed, `"session_info"`) {
			var entry map[string]any
			if json.Unmarshal([]byte(trimmed), &entry) == nil && entry["type"] == "session_info" {
				name = sessionTitleFromText(asString(entry["name"]))
				found = true
			}
		}
		if readErr != nil {
			break
		}
	}
	return name, found, nil
}
// ---------- 历史解析 ----------

func parseSessionEntries(text string) []map[string]any {
	entries := []map[string]any{}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var entry map[string]any
		if json.Unmarshal([]byte(line), &entry) != nil {
			continue
		}
		if entry != nil {
			entries = append(entries, entry)
		}
	}
	return entries
}

func messagesFromEntries(entries []map[string]any) []map[string]any {
	messages := []map[string]any{}
	if len(entries) == 0 {
		return messages
	}
	linked := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		if entry["type"] == "session" {
			continue
		}
		if _, ok := entry["id"].(string); ok {
			linked = append(linked, entry)
		}
	}
	branch := entries
	hasParent := false
	for _, entry := range linked {
		if _, ok := entry["parentId"]; ok {
			hasParent = true
			break
		}
	}
	if len(linked) > 0 && hasParent {
		index := map[string]map[string]any{}
		for _, entry := range linked {
			index[asString(entry["id"])] = entry
		}
		visited := map[string]bool{}
		selected := []map[string]any{}
		var entry map[string]any
		if len(linked) > 0 {
			entry = linked[len(linked)-1]
		}
		for entry != nil {
			id := asString(entry["id"])
			if id == "" || visited[id] {
				break
			}
			visited[id] = true
			selected = append(selected, entry)
			parentID := asString(entry["parentId"])
			if parentID == "" {
				break
			}
			entry = index[parentID]
		}
		for left, right := 0, len(selected)-1; left < right; left, right = left+1, right-1 {
			selected[left], selected[right] = selected[right], selected[left]
		}
		branch = selected
	}
	for _, entry := range branch {
		var payload map[string]any
		if entry["type"] == "message" {
			payload = asMap(entry["message"])
		} else if _, ok := entry["role"]; ok {
			payload = entry
		}
		if payload == nil {
			continue
		}
		role := asString(payload["role"])
		if role == "" || !historyRoles[role] {
			continue
		}
		messages = append(messages, payload)
	}
	return messages
}

func countBlocks(message map[string]any) int {
	switch asString(message["role"]) {
	case "user", "bashExecution":
		return 1
	case "assistant":
		count := 0
		if parts, ok := message["content"].([]any); ok {
			for _, part := range parts {
				p := asMap(part)
				switch asString(p["type"]) {
				case "thinking":
					if strings.TrimSpace(asString(p["thinking"])) != "" {
						count++
					}
				case "text":
					if strings.TrimSpace(asString(p["text"])) != "" {
						count++
					}
				case "toolCall":
					count++
				}
			}
		}
		if asString(message["stopReason"]) == "error" && asString(message["errorMessage"]) != "" {
			count++
		}
		return count
	}
	return 0
}

func sliceHistoryPage(history []map[string]any, endIndex, limit, minTurns, minBlocks int) map[string]any {
	total := len(history)
	size := limit
	if size <= 0 {
		size = historyPageSize
	}
	if size > historyMaxPage {
		size = historyMaxPage
	}
	requested := endIndex
	if requested <= 0 {
		requested = total
	}
	end := requested
	if end < 0 {
		end = 0
	}
	if end > total {
		end = total
	}
	start := end - size
	if start < 0 {
		start = 0
	}
	if start > 0 {
		floor := end - historyMaxPage
		if floor < 0 {
			floor = 0
		}
		probe := start
		for probe > floor && asString(history[probe]["role"]) != "user" {
			probe--
		}
		if probe > 0 && asString(history[probe]["role"]) == "user" && start-probe <= historyAlignWindow {
			start = probe
		}
	}
	if minTurns > 0 && start > 0 {
		users := 0
		for i := start; i < end; i++ {
			if asString(history[i]["role"]) == "user" {
				users++
			}
		}
		probe := start
		for users < minTurns && probe > 0 && end-probe < historyMaxPage {
			probe--
			if asString(history[probe]["role"]) == "user" {
				users++
			}
		}
		start = probe
	}
	if minBlocks > 0 && start > 0 {
		blocks := 0
		for i := start; i < end; i++ {
			blocks += countBlocks(history[i])
		}
		probe := start
		for blocks < minBlocks && probe > 0 && end-probe < historyMaxPage {
			probe--
			blocks += countBlocks(history[probe])
		}
		start = probe
	}
	page := make([]map[string]any, end-start)
	copy(page, history[start:end])
	return map[string]any{"messages": page, "startIndex": start, "endIndex": end, "total": total}
}

type historyCache struct {
	mu      sync.Mutex
	mtimeMs int64
	size    int64
	offset  int64
	entries []map[string]any
	history []map[string]any
}

var (
	historyCacheMu sync.Mutex
	historyCaches  = map[string]*historyCache{}
)

func cloneHistorySlice(items []map[string]any) []map[string]any {
	out := make([]map[string]any, len(items))
	copy(out, items)
	return out
}

func readSessionHistory(file string) []map[string]any {
	info, err := os.Stat(file)
	if err != nil || info.IsDir() {
		return []map[string]any{}
	}
	key := normPathKey(file)
	mtime := info.ModTime().UnixMilli()
	size := info.Size()

	historyCacheMu.Lock()
	hit := historyCaches[key]
	historyCacheMu.Unlock()

	if hit != nil {
		hit.mu.Lock()
		if hit.mtimeMs == mtime && hit.size == size {
			out := cloneHistorySlice(hit.history)
			hit.mu.Unlock()
			return out
		}
		if size > hit.offset {
			// 只解析新追加的完整行。
			f, err := os.Open(file)
			if err == nil {
				_, _ = f.Seek(hit.offset, 0)
				buf := make([]byte, size-hit.offset)
				n, _ := f.Read(buf)
				_ = f.Close()
				chunk := buf[:n]
				if lastBreak := lastIndexByte(chunk, '\n'); lastBreak >= 0 {
					hit.entries = append(hit.entries, parseSessionEntries(string(chunk[:lastBreak+1]))...)
					hit.offset += int64(lastBreak + 1)
				}
				hit.history = messagesFromEntries(hit.entries)
				hit.size = size
				hit.mtimeMs = mtime
				out := cloneHistorySlice(hit.history)
				hit.mu.Unlock()
				return out
			}
		}
		hit.mu.Unlock()
	}

	data, err := os.ReadFile(file)
	if err != nil {
		return []map[string]any{}
	}
	entries := parseSessionEntries(string(data))
	history := messagesFromEntries(entries)
	historyCacheMu.Lock()
	historyCaches[key] = &historyCache{mtimeMs: mtime, size: size, offset: size, entries: entries, history: history}
	if len(historyCaches) > 24 {
		for old := range historyCaches {
			if old != key {
				delete(historyCaches, old)
				break
			}
		}
	}
	historyCacheMu.Unlock()
	return cloneHistorySlice(history)
}

func lastIndexByte(data []byte, b byte) int {
	for i := len(data) - 1; i >= 0; i-- {
		if data[i] == b {
			return i
		}
	}
	return -1
}

func readSessionHistoryPage(file string, endIndex, limit, minTurns, minBlocks int) map[string]any {
	return sliceHistoryPage(readSessionHistory(file), endIndex, limit, minTurns, minBlocks)
}

func clearSessionHistoryCache(file string) {
	historyCacheMu.Lock()
	defer historyCacheMu.Unlock()
	if file == "" {
		historyCaches = map[string]*historyCache{}
		return
	}
	delete(historyCaches, normPathKey(file))
}

// ---------- 会话摘要 / 列表 ----------

type sessionSummary struct {
	ID        string `json:"id"`
	Path      string `json:"path"`
	Title     string `json:"title"`
	Empty     bool   `json:"empty"`
	Timestamp int64  `json:"timestamp"`
	Cwd       string `json:"cwd,omitempty"`
	Project   string `json:"project,omitempty"`
}

type sessionMetaCached struct {
	mtimeMs int64
	size    int64
	summary sessionSummary
}

var (
	sessionMetaMu    sync.Mutex
	sessionMetaCache = map[string]sessionMetaCached{}
)

func sessionTimestamp(header any, mtimeMs int64) int64 {
	headerMs := int64(0)
	if text, ok := header.(string); ok {
		if parsed, err := time.Parse(time.RFC3339Nano, text); err == nil {
			headerMs = parsed.UnixMilli()
		}
	}
	if mtimeMs > headerMs {
		return mtimeMs
	}
	return headerMs
}

func summarizeSessionFile(file string) (sessionSummary, bool) {
	info, err := os.Stat(file)
	if err != nil || info.IsDir() {
		return sessionSummary{}, false
	}
	key := normPathKey(file)
	sessionMetaMu.Lock()
	cached, hasCache := sessionMetaCache[key]
	sessionMetaMu.Unlock()

	head := readHeadText(file, info.Size(), 128*1024)
	lines := strings.Split(head, "\n")
	header := map[string]any{}
	if len(lines) > 0 {
		_ = json.Unmarshal([]byte(strings.TrimSpace(lines[0])), &header)
	}
	cwd := asString(header["cwd"])
	project := ""
	if cwd != "" {
		project = filepath.Base(cwd)
	}
	if hasCache && cached.mtimeMs == info.ModTime().UnixMilli() && cached.size == info.Size() {
		summary := cached.summary
		summary.Cwd = cwd
		summary.Project = project
		return summary, true
	}
	title := firstUserTitle(lines)
	customTitle := readSessionName(file, info.Size(), header["name"])
	summary := sessionSummary{
		ID:        file,
		Path:      file,
		Title:     firstNonEmpty(customTitle, title, "新会话"),
		Empty:     customTitle == "" && title == "",
		Timestamp: sessionTimestamp(header["timestamp"], info.ModTime().UnixMilli()),
		Cwd:       cwd,
		Project:   project,
	}
	sessionMetaMu.Lock()
	sessionMetaCache[key] = sessionMetaCached{mtimeMs: info.ModTime().UnixMilli(), size: info.Size(), summary: sessionSummary{
		ID: summary.ID, Path: summary.Path, Title: summary.Title, Empty: summary.Empty, Timestamp: summary.Timestamp,
	}}
	sessionMetaMu.Unlock()
	return summary, true
}

func readHeadText(file string, size, maxBytes int64) string {
	if size <= maxBytes {
		data, _ := os.ReadFile(file)
		return string(data)
	}
	f, err := os.Open(file)
	if err != nil {
		return ""
	}
	defer f.Close()
	buf := make([]byte, maxBytes)
	n, _ := f.Read(buf)
	return string(buf[:n])
}

func listSessions(cwd string, keep ...string) []sessionSummary {
	dir := sessionDir(cwd)
	names := readDirNames(dir)
	keepSet := map[string]bool{}
	for _, item := range keep {
		if item != "" {
			keepSet[normPathKey(item)] = true
		}
	}
	items := []sessionSummary{}
	for _, name := range names {
		if !strings.HasSuffix(strings.ToLower(name), ".jsonl") {
			continue
		}
		summary, ok := summarizeSessionFile(filepath.Join(dir, name))
		if !ok {
			continue
		}
		if summary.Empty && !keepSet[normPathKey(summary.Path)] {
			continue
		}
		items = append(items, summary)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Timestamp > items[j].Timestamp })
	return items
}

var (
	crossProjectMu    sync.Mutex
	crossProjectCache = map[string]struct {
		at    time.Time
		items []sessionSummary
	}{}
)

func listCrossProjectSessions(limit int) []sessionSummary {
	root := agentSessionsRoot()
	crossProjectMu.Lock()
	cached, ok := crossProjectCache[root]
	crossProjectMu.Unlock()
	if ok && time.Since(cached.at) < 3*time.Second {
		if len(cached.items) > limit {
			return cached.items[:limit]
		}
		return cached.items
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return []sessionSummary{}
	}
	type picked struct {
		file string
		at   int64
	}
	var picks []picked
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		files := readDirNames(filepath.Join(root, entry.Name()))
		var recent []picked
		for _, name := range files {
			if !strings.HasSuffix(strings.ToLower(name), ".jsonl") {
				continue
			}
			file := filepath.Join(root, entry.Name(), name)
			info, err := os.Stat(file)
			if err != nil || info.IsDir() {
				continue
			}
			recent = append(recent, picked{file, info.ModTime().UnixMilli()})
		}
		sort.Slice(recent, func(i, j int) bool { return recent[i].at > recent[j].at })
		if len(recent) > 4 {
			recent = recent[:4]
		}
		picks = append(picks, recent...)
	}
	sort.Slice(picks, func(i, j int) bool { return picks[i].at > picks[j].at })
	items := []sessionSummary{}
	for index, candidate := range picks {
		if len(items) >= limit || index >= limit {
			break
		}
		if summary, ok := summarizeSessionFile(candidate.file); ok && !summary.Empty {
			items = append(items, summary)
		}
		if index%3 == 2 {
			runtime.Gosched()
		}
	}
	crossProjectMu.Lock()
	crossProjectCache[root] = struct {
		at    time.Time
		items []sessionSummary
	}{time.Now(), items}
	crossProjectMu.Unlock()
	if len(items) > limit {
		return items[:limit]
	}
	return items
}

func isKnownEmptySession(file string) bool {
	key := normPathKey(file)
	sessionMetaMu.Lock()
	cached, ok := sessionMetaCache[key]
	sessionMetaMu.Unlock()
	if !ok || !cached.summary.Empty {
		return false
	}
	info, err := os.Stat(file)
	return err == nil && info.ModTime().UnixMilli() == cached.mtimeMs && info.Size() == cached.size
}

// cloneSessionToWorkspace 复制会话到另一个工作区，并更新首行的 cwd/id/timestamp。
func cloneSessionToWorkspace(srcFile, targetCwd string) (string, error) {
	data, err := os.ReadFile(srcFile)
	if err != nil {
		return "", err
	}
	lines := strings.Split(string(data), "\n")
	now := time.Now().UTC()
	nowISO := now.Format("2006-01-02T15:04:05.000Z")
	newID := randomUUID()
	if len(lines) > 0 && strings.TrimSpace(lines[0]) != "" {
		var head map[string]any
		if json.Unmarshal([]byte(lines[0]), &head) == nil && head["type"] == "session" {
			head["cwd"] = targetCwd
			head["id"] = newID
			head["timestamp"] = nowISO
			if encoded, err := json.Marshal(head); err == nil {
				lines[0] = string(encoded)
			}
		}
	}
	destDir := sessionDir(targetCwd)
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return "", err
	}
	name := fmt.Sprintf("%s_%s.jsonl", strings.NewReplacer(":", "-", ".", "-").Replace(nowISO), newID)
	dest := filepath.Join(destDir, name)
	content := strings.Join(lines, "\n")
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	if err := atomicWriteText(dest, content); err != nil {
		return "", err
	}
	return dest, nil
}

// ---------- 会话上下文（@ 引用对话） ----------

var sessionBlockMarkerRe = regexp.MustCompile(`(?s)<(file|directory|session) name="([^"]*)"[^>]*>.*?</(?:file|directory|session)>`)

func stripAttachmentMarkers(input string) string {
	return sessionBlockMarkerRe.ReplaceAllStringFunc(input, func(match string) string {
		sub := sessionBlockMarkerRe.FindStringSubmatch(match)
		label := "文件"
		if len(sub) >= 2 {
			switch sub[1] {
			case "directory":
				label = "目录"
			case "session":
				label = "对话"
			}
		}
		name := ""
		if len(sub) >= 3 {
			name = sub[2]
		}
		return "[" + label + ": " + name + "]"
	})
}

func messageText(message map[string]any) string {
	role := asString(message["role"])
	if role == "toolResult" {
		return ""
	}
	content := message["content"]
	if text, ok := content.(string); ok {
		return stripAttachmentMarkers(text)
	}
	parts, ok := content.([]any)
	if !ok {
		return ""
	}
	var out []string
	for _, part := range parts {
		p := asMap(part)
		switch asString(p["type"]) {
		case "text":
			out = append(out, stripAttachmentMarkers(asString(p["text"])))
		case "image":
			out = append(out, "[图片]")
		}
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

func clipText(value string, limit int) string {
	text := strings.TrimSpace(strings.ReplaceAll(value, "\r\n", "\n"))
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit]) + fmt.Sprintf("…（其后省略 %d 字）", len(runes)-limit)
}

type digestResult struct {
	text    string
	total   int
	kept    int
	omitted int
}

func formatSessionDigest(messages []map[string]any) digestResult {
	type row struct {
		role string
		text string
	}
	rows := []row{}
	for _, message := range messages {
		text := messageText(message)
		if text == "" {
			continue
		}
		role := "用户"
		if asString(message["role"]) == "assistant" {
			role = "助手"
		}
		rows = append(rows, row{role, clipText(text, sessionDigestPerMsg)})
	}
	if len(rows) == 0 {
		return digestResult{text: "（这个会话还没有可读的文字内容）"}
	}
	headCount := sessionDigestHead
	if headCount > len(rows) {
		headCount = len(rows)
	}
	head := rows[:headCount]
	used := 0
	for _, item := range head {
		used += len([]rune(item.text)) + len([]rune(item.role)) + 2
	}
	var tail []row
	index := len(rows)
	for index > headCount {
		item := rows[index-1]
		cost := len([]rune(item.text)) + len([]rune(item.role)) + 2
		if used+cost > sessionDigestMax {
			break
		}
		tail = append([]row{item}, tail...)
		used += cost
		index--
	}
	omitted := len(rows) - headCount - len(tail)
	if omitted < 0 {
		omitted = 0
	}
	lines := []string{}
	for _, item := range head {
		lines = append(lines, item.role+"："+item.text)
	}
	if omitted > 0 {
		lines = append(lines, fmt.Sprintf("…（省略中间 %d 条消息）…", omitted))
	}
	for _, item := range tail {
		lines = append(lines, item.role+"："+item.text)
	}
	return digestResult{text: strings.Join(lines, "\n\n"), total: len(rows), kept: len(head) + len(tail), omitted: omitted}
}

func sessionContextBlock(file, title string, messages []map[string]any) string {
	digest := formatSessionDigest(messages)
	if strings.TrimSpace(title) == "" {
		title = "未命名会话"
	}
	total := len(messages)
	scope := ""
	if digest.total > 0 && digest.total != total {
		scope = fmt.Sprintf("（其中 %d 条有文字）", digest.total)
	}
	head := []string{
		fmt.Sprintf("下面是用户通过 @ 引用的另一个会话「%s」，只保留关键片段：", title),
		fmt.Sprintf("共 %d 条消息%s，这里保留 %d 条%s。", total, scope, digest.kept, map[bool]string{true: fmt.Sprintf("（省略 %d 条）", digest.omitted), false: ""}[digest.omitted > 0]),
	}
	headText := strings.Join(head, "\n")
	return strings.Join([]string{
		fmt.Sprintf(`<session name="%s" title="%s" messages="%d">`, escapeXML(file), escapeXML(title), total),
		headText,
		"",
		digest.text,
		"</session>",
		"",
	}, "\n")
}
