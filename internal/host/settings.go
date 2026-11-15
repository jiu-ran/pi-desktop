package host

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// ---------- Pi 设置文件 ----------

func agentDirPath() string {
	if dir := os.Getenv("PI_CODING_AGENT_DIR"); dir != "" {
		return dir
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".pi", "agent")
}

type settingsPaths struct {
	Global  string `json:"global"`
	Project string `json:"project"`
}

type settingsState struct {
	Global      map[string]any
	Project     map[string]any
	Paths       settingsPaths
	Diagnostics []string
}

func settingsFilePaths(cwd string) settingsPaths {
	return settingsPaths{
		Global:  filepath.Join(agentDirPath(), "settings.json"),
		Project: filepath.Join(cwd, ".pi", "settings.json"),
	}
}

func readSettingsFile(file string) (map[string]any, string) {
	if !fileExists(file) {
		return map[string]any{}, ""
	}
	value, err := readJSONFile(file)
	if err != nil {
		return map[string]any{}, file + "：" + err.Error()
	}
	return value, ""
}

func readSettings(cwd string) settingsState {
	paths := settingsFilePaths(cwd)
	global, globalErr := readSettingsFile(paths.Global)
	project, projectErr := readSettingsFile(paths.Project)
	diagnostics := []string{}
	for _, item := range []string{globalErr, projectErr} {
		if item != "" {
			diagnostics = append(diagnostics, item)
		}
	}
	return settingsState{Global: global, Project: project, Paths: paths, Diagnostics: diagnostics}
}

func writeSettingsFile(file string, value map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteText(file, string(data)+"\n")
}

// ---------- 项目信任 ----------

var trustRequiringEntries = []string{
	"settings.json", "mcp.json", "extensions", "skills", "prompts", "themes", "SYSTEM.md", "APPEND_SYSTEM.md",
}

type trustStore map[string]any

func trustFilePath(agentDir string) string { return filepath.Join(agentDir, "trust.json") }

func canonicalTrustPath(target string) string {
	resolved, _ := filepath.Abs(target)
	if real, err := realPath(resolved); err == nil {
		return real
	}
	return resolved
}

func readTrustStore(file string) (trustStore, string) {
	data, err := os.ReadFile(file)
	if err != nil {
		return trustStore{}, ""
	}
	text := strings.TrimPrefix(string(data), "\ufeff")
	var parsed map[string]any
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		return trustStore{}, file + "：" + err.Error()
	}
	store := trustStore{}
	for key, value := range parsed {
		if value == nil || value == true || value == false {
			store[key] = value
		}
	}
	return store, ""
}

func writeTrustStore(file string, store trustStore) error {
	keys := make([]string, 0, len(store))
	for key := range store {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	clean := map[string]any{}
	for _, key := range keys {
		value := store[key]
		if value == true || value == false {
			clean[key] = value
		}
	}
	data, err := json.MarshalIndent(clean, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	return atomicWriteText(file, string(data)+"\n")
}

func nearestTrustEntry(store trustStore, cwd string) (string, any, bool) {
	current := canonicalTrustPath(cwd)
	for {
		value, ok := store[current]
		if ok && (value == true || value == false) {
			return current, value, true
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", nil, false
		}
		current = parent
	}
}

func projectNeedsTrust(cwd string) bool {
	start := canonicalTrustPath(cwd)
	configDir := filepath.Join(start, ".pi")
	for _, entry := range trustRequiringEntries {
		if _, err := os.Stat(filepath.Join(configDir, entry)); err == nil {
			return true
		}
	}
	home, _ := os.UserHomeDir()
	userSkills := filepath.Join(canonicalTrustPath(home), ".agents", "skills")
	current := start
	for {
		skills := filepath.Join(current, ".agents", "skills")
		if skills != userSkills {
			if info, err := os.Stat(skills); err == nil && info.IsDir() {
				return true
			}
		}
		parent := filepath.Dir(current)
		if parent == current {
			return false
		}
		current = parent
	}
}

func projectTrustStatus(cwd, defaultTrust string) map[string]any {
	agentDir := agentDirPath()
	store, _ := readTrustStore(trustFilePath(agentDir))
	recordedAt, decision, has := nearestTrustEntry(store, cwd)
	needs := projectNeedsTrust(cwd)
	fallback := false
	if defaultTrust == "always" {
		fallback = true
	}
	effective := true
	if needs {
		if has {
			effective = decision == true
		} else {
			effective = fallback
		}
	}
	status := map[string]any{
		"cwd":        canonicalTrustPath(cwd),
		"decision":   nil,
		"recordedAt": recordedAt,
		"needsTrust": needs,
		"effective":  effective,
	}
	if has {
		status["decision"] = decision == true
	}
	return status
}

func trustInfo(cwd string) (trusted, writable bool) {
	settings := readSettings(cwd)
	defaultTrust := asString(settings.Global["defaultProjectTrust"])
	if defaultTrust == "" {
		defaultTrust = "ask"
	}
	status := projectTrustStatus(cwd, defaultTrust)
	trusted = asBool(status["effective"])
	writable = status["decision"] == true || defaultTrust == "always"
	return trusted, writable
}

func setProjectTrust(cwd, action string) map[string]any {
	agentDir := agentDirPath()
	settings := readSettings(cwd)
	defaultTrust := asString(settings.Global["defaultProjectTrust"])
	if defaultTrust == "" {
		defaultTrust = "ask"
	}
	file := trustFilePath(agentDir)
	target := canonicalTrustPath(cwd)
	parent := filepath.Dir(target)
	type update struct {
		path     string
		decision any
	}
	var updates []update
	switch action {
	case "trust":
		updates = []update{{target, true}}
	case "distrust":
		updates = []update{{target, false}}
	default:
		if parent == target {
			updates = []update{{target, true}}
		} else {
			updates = []update{{parent, true}, {target, nil}}
		}
	}
	_ = withFileWrite(file, func() error {
		store, _ := readTrustStore(file)
		for _, item := range updates {
			if item.decision == nil {
				delete(store, item.path)
			} else {
				store[item.path] = item.decision
			}
		}
		return writeTrustStore(file, store)
	})
	return projectTrustStatus(cwd, defaultTrust)
}

// ---------- 新会话默认模型 / 思考等级 ----------

var thinkingLevels = []string{"off", "minimal", "low", "medium", "high", "xhigh", "max"}

func normalizeThinkingLevel(value any) string {
	text := strings.ToLower(strings.TrimSpace(asString(value)))
	for _, level := range thinkingLevels {
		if level == text {
			return text
		}
	}
	return ""
}

func modelDefaultOf(settings map[string]any) map[string]any {
	return map[string]any{
		"provider":      strings.TrimSpace(asString(settings["defaultProvider"])),
		"model":         strings.TrimSpace(asString(settings["defaultModel"])),
		"thinkingLevel": normalizeThinkingLevel(settings["defaultThinkingLevel"]),
	}
}

func applyModelDefault(settings map[string]any, patch map[string]any) map[string]any {
	next := map[string]any{}
	for key, value := range settings {
		next[key] = value
	}
	provider := strings.TrimSpace(asString(patch["provider"]))
	model := strings.TrimSpace(asString(patch["model"]))
	_, hasProvider := patch["provider"]
	_, hasModel := patch["model"]
	if provider != "" && model != "" {
		next["defaultProvider"] = provider
		next["defaultModel"] = model
	} else if hasProvider || hasModel {
		delete(next, "defaultProvider")
		delete(next, "defaultModel")
	}
	if level, ok := patch["thinkingLevel"]; ok {
		if normalized := normalizeThinkingLevel(level); normalized != "" {
			next["defaultThinkingLevel"] = normalized
		} else {
			delete(next, "defaultThinkingLevel")
		}
	}
	return next
}

func effectiveModelDefault(global, project map[string]any) map[string]any {
	g := modelDefaultOf(global)
	p := modelDefaultOf(project)
	pick := func(field string) string {
		if value := asString(p[field]); value != "" {
			return value
		}
		return asString(g[field])
	}
	return map[string]any{"provider": pick("provider"), "model": pick("model"), "thinkingLevel": pick("thinkingLevel")}
}

func modelDefaultsOverview(cwd string) map[string]any {
	effectiveCwd := os.Getenv("HOME")
	if cwd != "" {
		effectiveCwd, _ = filepath.Abs(cwd)
	}
	trusted, writable := true, true
	if cwd != "" {
		trusted, writable = trustInfo(effectiveCwd)
	}
	state := readSettings(effectiveCwd)
	projectSettings := map[string]any{}
	if cwd != "" && trusted {
		projectSettings = state.Project
	}
	projectPath := ""
	if cwd != "" {
		projectPath = state.Paths.Project
	}
	return map[string]any{
		"global":              modelDefaultOf(state.Global),
		"project":             modelDefaultOf(projectSettings),
		"effective":           effectiveModelDefault(state.Global, projectSettings),
		"thinkingLevels":      append([]string{}, thinkingLevels...),
		"projectSettingsPath": projectPath,
		"projectTrusted":      trusted,
		"projectWritable":     writable,
	}
}

func setModelDefaults(cwd string, payload map[string]any) (map[string]any, error) {
	scope := "global"
	if asString(payload["scope"]) == "project" {
		scope = "project"
	}
	if scope == "project" && cwd == "" {
		return nil, errors.New("项目级设置需要先打开一个项目")
	}
	effectiveCwd, _ := filepath.Abs(cwd)
	if cwd == "" {
		effectiveCwd, _ = os.UserHomeDir()
	}
	if scope == "project" {
		if _, writable := trustInfo(effectiveCwd); !writable {
			return nil, errors.New("项目级设置需要先信任此项目：Pi 不会加载未信任项目的 .pi/settings.json（设置 → Skills 或 /trust）")
		}
	}
	state := readSettings(effectiveCwd)
	file := state.Paths.Global
	if scope == "project" {
		file = state.Paths.Project
	}
	for _, diagnostic := range state.Diagnostics {
		if strings.HasPrefix(diagnostic, file) {
			label := "全局"
			if scope == "project" {
				label = "项目"
			}
			return nil, errors.New(label + "设置文件不是合法 JSON，先修好再改默认模型")
		}
	}
	err := withFileWrite(file, func() error {
		fresh := readSettings(effectiveCwd)
		target := fresh.Global
		if scope == "project" {
			target = fresh.Project
		}
		next := applyModelDefault(target, payload)
		return writeSettingsFile(file, next)
	})
	if err != nil {
		return nil, err
	}
	return modelDefaultsOverview(cwd), nil
}

// ---------- 工具开关 ----------

var piDefaultToolNames = []string{"read", "bash", "edit", "write"}

type piToolMeta struct {
	Name        string `json:"name"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Group       string `json:"group"`
	WindowsOnly bool   `json:"-"`
}

var piToolCatalog = []piToolMeta{
	{"read", "读取文件", "读取文本文件与支持的图片", "builtin", false},
	{"bash", "运行命令", "在本机 shell 里执行命令；关闭后模型不能跑命令，但终端与文件区不受影响", "builtin", false},
	{"powershell", "PowerShell", "在 Windows 上执行 PowerShell 命令", "builtin", true},
	{"edit", "编辑文件", "对已有文件做精确文本替换", "builtin", false},
	{"write", "写入文件", "创建文件或覆盖已有内容", "builtin", false},
	{"grep", "搜索内容", "按模式搜索文件内容", "builtin", false},
	{"find", "查找文件", "按 glob 查找路径", "builtin", false},
	{"ls", "列出目录", "列出目录内容", "builtin", false},
	{"codemode", "Codemode 脚本", "用一段 JavaScript 并行调用其它工具，只把脚本输出交给模型", "extension", false},
	{"tool_search", "工具搜索", "按需搜索并加载尚未声明给模型的工具（含 MCP 工具）", "extension", false},
}

func isToolModifier(entry string) bool {
	return strings.HasPrefix(entry, "+") || strings.HasPrefix(entry, "-")
}

func toolEntries(value any) []string {
	switch items := value.(type) {
	case []any:
		out := make([]string, 0, len(items))
		for _, item := range items {
			if text, ok := item.(string); ok {
				out = append(out, text)
			}
		}
		return out
	case []string:
		return append([]string{}, items...)
	default:
		return []string{}
	}
}

func hasToolSelection(settings map[string]any) bool {
	if settings == nil {
		return false
	}
	_, ok := settings["defaultTools"]
	return ok
}

func mergeToolEntries(base, override any) []string {
	if override == nil {
		if base == nil {
			return nil
		}
		return toolEntries(base)
	}
	baseList, baseOK := base.([]any)
	_, overrideOK := override.([]any)
	if !baseOK || !overrideOK {
		return toolEntries(override)
	}
	overrides := toolEntries(override)
	for _, entry := range overrides {
		if !isToolModifier(entry) {
			return overrides
		}
	}
	_ = baseList
	return append(toolEntries(base), overrides...)
}

func resolveToolEntries(entries any) []string {
	if entries == nil {
		return append([]string{}, piDefaultToolNames...)
	}
	list := toolEntries(entries)
	var modifiers, plain []string
	for _, entry := range list {
		if isToolModifier(entry) {
			modifiers = append(modifiers, entry)
		} else {
			plain = append(plain, entry)
		}
	}
	base := plain
	if len(plain) == 0 && len(list) > 0 {
		base = append([]string{}, piDefaultToolNames...)
	}
	result := append([]string{}, base...)
	for _, entry := range modifiers {
		name := entry[1:]
		if name == "" {
			continue
		}
		index := -1
		for i, item := range result {
			if item == name {
				index = i
				break
			}
		}
		if strings.HasPrefix(entry, "+") && index == -1 {
			result = append(result, name)
		} else if strings.HasPrefix(entry, "-") && index != -1 {
			result = append(result[:index], result[index+1:]...)
		}
	}
	return result
}

func scopeBaseEntries(scope string, globalEntries, projectEntries any, projectConfigured bool) []string {
	if scope == "global" || !projectConfigured {
		return resolveToolEntries(globalEntries)
	}
	project := toolEntries(projectEntries)
	for _, entry := range project {
		if !isToolModifier(entry) {
			return resolveToolEntries(project)
		}
	}
	return resolveToolEntries(mergeToolEntries(globalEntries, projectEntries))
}

func resolveSettingsTools(global, project map[string]any) []string {
	merged := mergeToolEntries(global["defaultTools"], project["defaultTools"])
	return resolveToolEntries(merged)
}

func toolModifierArguments(enabled []string) []string {
	active := map[string]bool{}
	for _, name := range enabled {
		active[name] = true
	}
	entries := []string{}
	for _, tool := range piToolCatalog {
		if tool.WindowsOnly && runtime.GOOS != "windows" {
			continue
		}
		prefix := "-"
		if active[tool.Name] {
			prefix = "+"
		}
		entries = append(entries, prefix+tool.Name)
	}
	if len(entries) == 0 {
		return []string{}
	}
	return []string{"--tools", strings.Join(entries, ",")}
}

func toolsOverview(cwd string) map[string]any {
	effectiveCwd, _ := filepath.Abs(cwd)
	if cwd == "" {
		effectiveCwd, _ = os.UserHomeDir()
	}
	trusted, writable := true, true
	if cwd != "" {
		trusted, writable = trustInfo(effectiveCwd)
	}
	state := readSettings(effectiveCwd)
	projectSettings := map[string]any{}
	if cwd != "" && trusted {
		projectSettings = state.Project
	}
	diagnostics := state.Diagnostics
	if cwd == "" {
		filtered := []string{}
		for _, item := range diagnostics {
			if strings.HasPrefix(item, state.Paths.Global) {
				filtered = append(filtered, item)
			}
		}
		diagnostics = filtered
	}
	globalConfigured := hasToolSelection(state.Global)
	projectConfigured := hasToolSelection(projectSettings)
	globalEntries := toolEntries(state.Global["defaultTools"])
	projectEntries := toolEntries(projectSettings["defaultTools"])
	enabled := resolveSettingsTools(state.Global, projectSettings)
	enabledSet := map[string]bool{}
	for _, name := range enabled {
		enabledSet[name] = true
	}
	effectiveScope := "default"
	if projectConfigured {
		effectiveScope = "project"
	} else if globalConfigured {
		effectiveScope = "global"
	}
	defaults := map[string]bool{"read": true, "bash": true, "edit": true, "write": true}
	tools := []map[string]any{}
	for _, tool := range piToolCatalog {
		if tool.WindowsOnly && runtime.GOOS != "windows" {
			continue
		}
		tools = append(tools, map[string]any{
			"name": tool.Name, "label": tool.Label, "description": tool.Description,
			"group": tool.Group, "enabled": enabledSet[tool.Name], "defaultEnabled": defaults[tool.Name],
		})
	}
	extra := []string{}
	seenExtra := map[string]bool{}
	catalogNames := map[string]bool{}
	for _, tool := range piToolCatalog {
		catalogNames[tool.Name] = true
	}
	for _, entry := range append(toolEntries(state.Global["defaultTools"]), toolEntries(projectSettings["defaultTools"])...) {
		if isToolModifier(entry) || catalogNames[entry] || seenExtra[entry] {
			continue
		}
		seenExtra[entry] = true
		extra = append(extra, entry)
	}
	projectPath := ""
	if cwd != "" {
		projectPath = state.Paths.Project
	}
	return map[string]any{
		"agentDir":            agentDirPath(),
		"globalSettingsPath":  state.Paths.Global,
		"projectSettingsPath": projectPath,
		"effectiveScope":      effectiveScope,
		"globalConfigured":    globalConfigured,
		"projectConfigured":   projectConfigured,
		"projectTrusted":      trusted,
		"projectWritable":     writable,
		"globalEntries":       globalEntries,
		"projectEntries":      projectEntries,
		"tools":               tools,
		"enabledNames":        enabled,
		"extraEntries":        extra,
		"diagnostics":         diagnostics,
	}
}

func toolsSet(cwd string, payload map[string]any) (map[string]any, error) {
	scope := "global"
	if asString(payload["scope"]) == "project" {
		scope = "project"
	}
	name := strings.TrimSpace(asString(payload["name"]))
	enabled := asBool(payload["enabled"])
	validName := true
	for _, r := range name {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '.' || r == '-' || r == '*') {
			validName = false
			break
		}
	}
	if name == "" || !validName {
		return nil, errors.New("工具名不合法：" + firstNonEmpty(name, "(空)"))
	}
	if scope == "project" && cwd == "" {
		return nil, errors.New("项目级工具开关需要先打开一个项目")
	}
	effectiveCwd, _ := filepath.Abs(cwd)
	if cwd == "" {
		effectiveCwd, _ = os.UserHomeDir()
	}
	if cwd != "" {
		if err := assertRealWorkspacePath(cwd, effectiveCwd, false); err != nil {
			return nil, err
		}
	}
	if scope == "project" {
		if _, writable := trustInfo(effectiveCwd); !writable {
			return nil, errors.New("项目级工具设置需要先信任此项目：Pi 不会加载未信任项目的 .pi/settings.json（设置 → Skills 或 /trust）")
		}
	}
	file := filepath.Join(agentDirPath(), "settings.json")
	if scope == "project" {
		file = filepath.Join(effectiveCwd, ".pi", "settings.json")
	}
	err := withFileWrite(file, func() error {
		fresh := readSettings(effectiveCwd)
		for _, diagnostic := range fresh.Diagnostics {
			if strings.HasPrefix(diagnostic, file) {
				label := "全局"
				if scope == "project" {
					label = "项目"
				}
				return errors.New(label + "设置文件不是合法 JSON，先修好再改工具开关")
			}
		}
		base := scopeBaseEntries(scope, fresh.Global["defaultTools"], fresh.Project["defaultTools"], hasToolSelection(fresh.Project))
		next := []string{}
		if enabled {
			next = append(base, name)
		} else {
			for _, entry := range base {
				if entry != name {
					next = append(next, entry)
				}
			}
		}
		next = dedupeStrings(next)
		target := fresh.Global
		if scope == "project" {
			target = fresh.Project
		}
		copied := map[string]any{}
		for key, value := range target {
			copied[key] = value
		}
		items := make([]any, len(next))
		for i, entry := range next {
			items[i] = entry
		}
		copied["defaultTools"] = items
		return writeSettingsFile(file, copied)
	})
	if err != nil {
		return nil, err
	}
	return toolsOverview(cwd), nil
}

// toolArgs 只在用户配置过 defaultTools 时才加 --tools。
func toolArgs(cwd string) []string {
	state := readSettings(cwd)
	trusted, _ := trustInfo(cwd)
	project := state.Project
	if !trusted {
		project = map[string]any{}
	}
	if !hasToolSelection(state.Global) && !hasToolSelection(project) {
		return []string{}
	}
	return toolModifierArguments(resolveSettingsTools(state.Global, project))
}

// ---------- 全局 AGENTS.md ----------

func globalAgentsPath() string { return filepath.Join(agentDirPath(), "AGENTS.md") }
