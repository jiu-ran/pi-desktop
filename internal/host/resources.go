package host

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// ---------- 来源解析 ----------

type packageEntry struct {
	Source        string
	Scope         string
	Kind          string
	Filtered      bool
	FilteredEntry map[string]any
	InstalledPath string
}

func parseGitLocation(source string) (host, repoPath string, ok bool) {
	rest := strings.TrimSpace(strings.TrimPrefix(source, "git:"))
	if strings.Contains(rest, "://") {
		// 粗略拆协议 URL：host 与 path
		trimmed := rest[strings.Index(rest, "://")+3:]
		if at := strings.Index(trimmed, "@"); at >= 0 {
			trimmed = trimmed[at+1:]
		}
		slash := strings.IndexAny(trimmed, "/")
		if slash < 0 {
			return "", "", false
		}
		host = trimmed[:slash]
		repoPath = trimmed[slash+1:]
		if colon := strings.Index(host, ":"); colon >= 0 {
			host = host[:colon]
		}
	} else if strings.Contains(rest, "@") && strings.Contains(rest, ":") {
		at := strings.Index(rest, "@")
		colon := strings.Index(rest[at:], ":")
		if colon < 0 {
			return "", "", false
		}
		host = rest[at+1 : at+colon]
		repoPath = rest[at+colon+1:]
	} else {
		host = "github.com"
		repoPath = rest
	}
	repoPath = strings.TrimSuffix(repoPath, ".git")
	if hash := strings.Index(repoPath, "#"); hash >= 0 {
		repoPath = repoPath[:hash]
	}
	if at := strings.LastIndex(repoPath, "@"); at > 0 {
		repoPath = repoPath[:at]
	}
	repoPath = strings.Trim(repoPath, "/")
	if host == "" || repoPath == "" {
		return "", "", false
	}
	return host, repoPath, true
}

func parseInstallSource(source string) (kind, name, gitHost, gitPath, localPath string) {
	trimmed := strings.TrimSpace(source)
	if strings.HasPrefix(trimmed, "npm:") {
		spec := strings.TrimSpace(trimmed[4:])
		at := strings.LastIndex(spec, "@")
		if at > 0 {
			spec = spec[:at]
		}
		return "npm", spec, "", "", ""
	}
	if isGitSource(trimmed) {
		if host, path, ok := parseGitLocation(trimmed); ok {
			return "git", "", host, path, ""
		}
	}
	return "local", "", "", "", trimmed
}

func installedPathFor(source, scope, cwd, agentDir string) string {
	kind, name, host, gitPath, localPath := parseInstallSource(source)
	var candidate string
	switch kind {
	case "npm":
		if name == "" {
			return ""
		}
		if scope == "project" {
			candidate = filepath.Join(cwd, ".pi", "npm", "node_modules", filepath.FromSlash(name))
		} else {
			candidate = filepath.Join(agentDir, "npm", "node_modules", filepath.FromSlash(name))
		}
	case "git":
		if host == "" || gitPath == "" {
			return ""
		}
		if scope == "project" {
			candidate = filepath.Join(cwd, ".pi", "git", host, filepath.FromSlash(gitPath))
		} else {
			candidate = filepath.Join(agentDir, "git", host, filepath.FromSlash(gitPath))
		}
	default:
		base := agentDir
		if scope == "project" {
			base = filepath.Join(cwd, ".pi")
		}
		expanded := localPath
		if strings.HasPrefix(expanded, "~") {
			home, _ := os.UserHomeDir()
			expanded = filepath.Join(home, expanded[1:])
		} else if !filepath.IsAbs(expanded) {
			expanded = filepath.Join(base, expanded)
		}
		candidate = expanded
	}
	if candidate != "" && dirExists(candidate) {
		return candidate
	}
	return ""
}

func configuredPackages(global, project map[string]any, cwd, agentDir string) []packageEntry {
	var out []packageEntry
	for _, scope := range []string{"user", "project"} {
		settings := global
		if scope == "project" {
			settings = project
		}
		items, _ := settings["packages"].([]any)
		for _, raw := range items {
			source := ""
			filtered := false
			filteredEntry := map[string]any(nil)
			switch value := raw.(type) {
			case string:
				source = value
			case map[string]any:
				source = asString(value["source"])
				filtered = true
				filteredEntry = value
			}
			if source == "" {
				continue
			}
			kind, _, _, _, _ := parseInstallSource(source)
			out = append(out, packageEntry{
				Source: source, Scope: scope, Kind: kind, Filtered: filtered,
				FilteredEntry: filteredEntry, InstalledPath: installedPathFor(source, scope, cwd, agentDir),
			})
		}
	}
	return out
}

// ---------- 资源发现 ----------

type resourceItem struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Type    string `json:"type"`
	Enabled bool   `json:"enabled"`
	Scope   string `json:"scope"`
	Origin  string `json:"origin"`
	Source  string `json:"source"`
}

var (
	extensionFileRe = regexp.MustCompile(`(?i)\.(?:js|mjs|cjs|ts)$`)
	promptFileRe    = regexp.MustCompile(`(?i)\.md$`)
	themeFileRe     = regexp.MustCompile(`(?i)\.(?:json|jsonc)$`)
)

func collectFiles(dir string, accept func(string) bool, depth int) []string {
	if depth > 8 || !dirExists(dir) {
		return []string{}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []string{}
	}
	var files []string
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") || name == "node_modules" {
			continue
		}
		full := filepath.Join(dir, name)
		isDir := entry.IsDir()
		isFile := entry.Type().IsRegular()
		if entry.Type()&os.ModeSymlink != 0 {
			if info, err := os.Stat(full); err == nil {
				isDir = info.IsDir()
				isFile = info.Mode().IsRegular()
			} else {
				continue
			}
		}
		if isDir {
			files = append(files, collectFiles(full, accept, depth+1)...)
		} else if isFile && accept(name) {
			files = append(files, full)
		}
	}
	sort.Strings(files)
	return files
}

func filesForType(dir, resourceType string) []string {
	switch resourceType {
	case "skills":
		return collectFiles(dir, func(name string) bool { return name == "SKILL.md" }, 0)
	case "extensions":
		return collectFiles(dir, extensionFileRe.MatchString, 0)
	case "prompts":
		return collectFiles(dir, promptFileRe.MatchString, 0)
	default:
		return collectFiles(dir, themeFileRe.MatchString, 0)
	}
}

func enabledByOverrides(file string, overrides any, baseDir string) bool {
	items, ok := overrides.([]any)
	if !ok || len(items) == 0 {
		return true
	}
	rel, _ := filepath.Rel(baseDir, file)
	relative := strings.ReplaceAll(rel, string(os.PathSeparator), "/")
	for _, item := range items {
		value := strings.ReplaceAll(strings.TrimSpace(asString(item)), string(os.PathSeparator), "/")
		value = strings.TrimPrefix(value, "./")
		if value == "" {
			continue
		}
		if value == relative {
			return true
		}
		if strings.HasSuffix(value, "/") {
			if strings.HasPrefix(relative, value) {
				return true
			}
		} else if strings.HasPrefix(relative, value+"/") || strings.Contains(relative, "/"+value) {
			return true
		}
	}
	return false
}

func autoResources(state settingsState, cwd, agentDir string) []resourceItem {
	items := []resourceItem{}
	scopes := []struct {
		scope  string
		base   string
		values map[string]any
	}{
		{"project", filepath.Join(cwd, ".pi"), state.Project},
		{"user", agentDir, state.Global},
	}
	for _, resourceType := range []string{"extensions", "skills", "prompts", "themes"} {
		for _, scope := range scopes {
			for _, file := range filesForType(filepath.Join(scope.base, resourceType), resourceType) {
				items = append(items, resourceItem{
					Path: file, Name: filepath.Base(file), Type: resourceType,
					Enabled: enabledByOverrides(file, scope.values[resourceType], scope.base),
					Scope:   scope.scope, Origin: "top-level", Source: "auto",
				})
			}
		}
		if resourceType == "skills" {
			home, _ := os.UserHomeDir()
			agentsDir := filepath.Join(home, ".agents", "skills")
			for _, file := range filesForType(agentsDir, "skills") {
				items = append(items, resourceItem{
					Path: file, Name: filepath.Base(file), Type: "skills",
					Enabled: enabledByOverrides(file, state.Global["skills"], filepath.Dir(agentsDir)),
					Scope:   "user", Origin: "top-level", Source: "auto",
				})
			}
		}
	}
	return items
}

func packageResources(entry packageEntry, state settingsState) []resourceItem {
	if entry.InstalledPath == "" {
		return []resourceItem{}
	}
	manifestPath := filepath.Join(entry.InstalledPath, "package.json")
	if !fileExists(manifestPath) {
		return []resourceItem{}
	}
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return []resourceItem{}
	}
	var manifest map[string]any
	if json.Unmarshal(data, &manifest) != nil {
		return []resourceItem{}
	}
	declared := asMap(manifest["pi"])
	filter := entry.FilteredEntry
	items := []resourceItem{}
	for _, resourceType := range []string{"extensions", "skills", "prompts", "themes"} {
		var patterns []any
		autoloadOff := false
		if filter != nil {
			patterns, _ = filter[resourceType].([]any)
			if value, ok := filter["autoload"].(bool); ok {
				autoloadOff = !value
			}
		}
		values, _ := declared[resourceType].([]any)
		for _, raw := range values {
			target := asString(raw)
			if target == "" {
				continue
			}
			target = filepath.Join(entry.InstalledPath, filepath.FromSlash(target))
			var files []string
			if info, err := os.Stat(target); err == nil {
				if info.IsDir() {
					files = filesForType(target, resourceType)
				} else {
					files = []string{target}
				}
			}
			for _, file := range files {
				enabled := !autoloadOff
				if patterns != nil {
					enabled = enabledByOverrides(file, patterns, entry.InstalledPath)
				}
				items = append(items, resourceItem{
					Path: file, Name: filepath.Base(file), Type: resourceType,
					Enabled: enabled, Scope: entry.Scope, Origin: "package", Source: entry.Source,
				})
			}
		}
	}
	return items
}

// ---------- 技能 ----------

type skillFrontmatter struct {
	Name                   string
	Description            string
	DisableModelInvocation bool
}

var frontmatterRe = regexp.MustCompile(`(?s)^---\r?\n(.*?)\r?\n---`)

func parseSkillFrontmatter(text string) skillFrontmatter {
	trimmed := strings.TrimLeft(text, "\ufeff \t\r\n")
	match := frontmatterRe.FindStringSubmatch(trimmed)
	if len(match) < 2 {
		return skillFrontmatter{}
	}
	result := skillFrontmatter{}
	lines := strings.Split(match[1], "\n")
	for index := 0; index < len(lines); index++ {
		line := lines[index]
		colon := strings.Index(line, ":")
		if colon <= 0 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(line[:colon]))
		value := strings.TrimSpace(line[colon+1:])
		if value == "|" || value == "|+" || value == "|-" || value == ">" || value == ">+" || value == ">-" {
			block := value[0]
			var collected []string
			for index+1 < len(lines) && (strings.HasPrefix(lines[index+1], " ") || strings.HasPrefix(lines[index+1], "\t") || strings.TrimSpace(lines[index+1]) == "") {
				collected = append(collected, strings.TrimSpace(lines[index+1]))
				index++
			}
			for len(collected) > 0 && collected[len(collected)-1] == "" {
				collected = collected[:len(collected)-1]
			}
			if block == '|' {
				value = strings.Join(collected, "\n") + "\n"
			} else {
				value = strings.Join(collected, " ") + "\n"
			}
		} else {
			value = strings.Trim(value, `"'`)
		}
		switch key {
		case "name":
			result.Name = value
		case "description":
			result.Description = value
		case "disable-model-invocation", "disablemodelinvocation":
			result.DisableModelInvocation = value == "true"
		}
	}
	return result
}

func skillsFromResources(resources []resourceItem) ([]map[string]any, []string) {
	skills := []map[string]any{}
	diagnostics := []string{}
	for _, resource := range resources {
		if resource.Type != "skills" || !resource.Enabled {
			continue
		}
		data, err := os.ReadFile(resource.Path)
		if err != nil {
			diagnostics = append(diagnostics, resource.Path+"："+err.Error())
			continue
		}
		front := parseSkillFrontmatter(string(data))
		baseDir := filepath.Dir(resource.Path)
		name := front.Name
		if name == "" {
			name = filepath.Base(baseDir)
		}
		if front.Description == "" {
			diagnostics = append(diagnostics, resource.Path+"：缺少 description，列表里会显示为空")
		}
		skills = append(skills, map[string]any{
			"name": name, "description": front.Description, "filePath": resource.Path, "baseDir": baseDir,
			"scope": resource.Scope, "origin": resource.Origin, "source": resource.Source,
			"disableModelInvocation": front.DisableModelInvocation,
		})
	}
	return skills, diagnostics
}

// ---------- 概览 ----------

func packagesOverview(cwd string) map[string]any {
	agentDir := agentDirPath()
	effectiveCwd, _ := filepath.Abs(cwd)
	if cwd == "" {
		effectiveCwd, _ = os.UserHomeDir()
	}
	state := readSettings(effectiveCwd)
	configured := configuredPackages(state.Global, state.Project, effectiveCwd, agentDir)
	resources := autoResources(state, effectiveCwd, agentDir)
	for _, entry := range configured {
		resources = append(resources, packageResources(entry, state)...)
	}
	packages := []map[string]any{}
	for _, item := range configured {
		displayName := strings.TrimPrefix(strings.TrimPrefix(item.Source, "npm:"), "git:")
		version, description := "", ""
		if item.InstalledPath != "" {
			var manifest map[string]any
			if data, err := os.ReadFile(filepath.Join(item.InstalledPath, "package.json")); err == nil && json.Unmarshal(data, &manifest) == nil {
				if name := asString(manifest["name"]); name != "" {
					displayName = name
				}
				version = asString(manifest["version"])
				description = asString(manifest["description"])
			}
		}
		counts := map[string]int{"extensions": 0, "skills": 0, "prompts": 0, "themes": 0}
		if item.InstalledPath != "" {
			root := normPathKey(item.InstalledPath)
			for _, res := range resources {
				if res.Origin == "package" && strings.HasPrefix(normPathKey(res.Path), root+string(os.PathSeparator)) {
					counts[res.Type]++
				}
			}
		}
		packages = append(packages, map[string]any{
			"source": item.Source, "scope": item.Scope, "kind": item.Kind, "displayName": displayName,
			"version": version, "description": description, "installed": item.InstalledPath != "",
			"installedPath": item.InstalledPath, "filtered": item.Filtered, "counts": counts,
		})
	}
	projectPath := ""
	if cwd != "" {
		projectPath = filepath.Join(effectiveCwd, ".pi", "settings.json")
	}
	return map[string]any{
		"agentDir": agentDir, "globalSettingsPath": filepath.Join(agentDir, "settings.json"),
		"projectSettingsPath": projectPath, "packages": packages, "resources": resources,
	}
}

func skillsOverview(cwd string) map[string]any {
	agentDir := agentDirPath()
	effectiveCwd, _ := filepath.Abs(cwd)
	if cwd == "" {
		effectiveCwd, _ = os.UserHomeDir()
	}
	globalSkillsDir := filepath.Join(agentDir, "skills")
	projectSkillsDir := ""
	if cwd != "" {
		projectSkillsDir = filepath.Join(effectiveCwd, ".pi", "skills")
	}
	state := readSettings(effectiveCwd)
	configured := configuredPackages(state.Global, state.Project, effectiveCwd, agentDir)
	home, _ := os.UserHomeDir()
	userAgentsSkills := filepath.Join(home, ".agents", "skills")

	directories := []map[string]any{
		{"label": "全局技能目录", "path": globalSkillsDir},
		{"label": "用户 Agent Skills", "path": userAgentsSkills},
	}
	if projectSkillsDir != "" {
		directories = append(directories, map[string]any{"label": "当前项目技能目录", "path": projectSkillsDir})
	}
	dir := effectiveCwd
	for cwd != "" {
		directories = append(directories, map[string]any{"label": "项目 Agent Skills", "path": filepath.Join(dir, ".agents", "skills")})
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	// 去重（同一目录可能被列多次）
	seen := map[string]bool{}
	unique := []map[string]any{}
	for _, item := range directories {
		key := normPathKey(asString(item["path"]))
		if seen[key] {
			continue
		}
		seen[key] = true
		unique = append(unique, item)
	}
	resources := autoResources(state, effectiveCwd, agentDir)
	for _, entry := range configured {
		resources = append(resources, packageResources(entry, state)...)
	}
	skills, diagnostics := skillsFromResources(resources)
	return map[string]any{
		"agentDir": agentDir, "globalSkillsDir": globalSkillsDir, "projectSkillsDir": projectSkillsDir,
		"directories": unique, "skills": skills, "diagnostics": diagnostics,
	}
}

// ---------- pi CLI ----------

func (h *Host) runPiCommand(args []string, cwd string, timeout time.Duration) (int, string) {
	var (
		command PiCommand
		err     error
	)
	if h != nil {
		command, err = h.piCommand()
	} else {
		command, _, err = resolvePiCommand("")
	}
	if err != nil {
		return 1, err.Error()
	}
	cmd := exec.Command(command.Exe, command.Args(args...)...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	var baseEnv map[string]string
	if h != nil {
		baseEnv = h.childEnv()
	}
	cmd.Env = envSlice(baseEnv, "FORCE_COLOR=0", "GIT_TERMINAL_PROMPT=0")
	hideWindow(cmd)
	prepareProcessGroup(cmd)
	done := make(chan struct{})
	var output []byte
	var runErr error
	go func() {
		output, runErr = cmd.CombinedOutput()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(timeout):
		killProcess(cmd)
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		<-done
		return -1, strings.TrimSpace(string(output))
	}
	code := 0
	if runErr != nil {
		if exitErr, ok := runErr.(*exec.ExitError); ok {
			code = exitErr.ExitCode()
		} else {
			code = 1
		}
	}
	text := strings.TrimSpace(string(output))
	if text == "" && runErr != nil {
		text = runErr.Error()
	}
	return code, text
}

func normalizeInstallSource(raw, cwd string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	for _, prefix := range []string{"npm:", "git:", "http://", "https://", "ssh://", "./", "../", ".\\", "..\\", "/", "~"} {
		if strings.HasPrefix(trimmed, prefix) {
			return trimmed
		}
	}
	if len(trimmed) >= 3 && trimmed[1] == ':' && (trimmed[2] == '\\' || trimmed[2] == '/') {
		return trimmed
	}
	if cwd != "" && dirExists(filepath.Join(cwd, trimmed)) {
		return trimmed
	}
	if strings.HasPrefix(trimmed, "github.com/") {
		return "git:" + trimmed
	}
	return "npm:" + trimmed
}

func (h *Host) packagesInstall(cwd string, payload map[string]any) (map[string]any, error) {
	local := asBool(payload["local"])
	if local && cwd == "" {
		return nil, errors.New("当前未打开项目目录，无法安装到项目级配置")
	}
	normalized := normalizeInstallSource(asString(payload["source"]), cwd)
	if normalized == "" {
		return nil, errors.New("请输入要安装的软件包来源（如 npm:@scope/pkg 或 git:github.com/user/repo）")
	}
	args := []string{"install", normalized}
	if local {
		args = append(args, "-l")
	}
	targetCwd := ""
	if local && cwd != "" {
		targetCwd = cwd
	}
	code, output := h.runPiCommand(args, targetCwd, 180*time.Second)
	if code != 0 {
		return nil, errors.New("安装失败：" + firstNonEmpty(tailText(output, 400), "pi install 异常退出"))
	}
	return packagesOverview(cwd), nil
}

// packageSource 取要操作的软件包来源：以 - 开头的值会被 pi 当成命令行参数，直接拒掉。
func packageSource(payload map[string]any) (string, error) {
	source := strings.TrimSpace(asString(payload["source"]))
	if strings.HasPrefix(source, "-") {
		return "", errors.New("软件包来源不能以 - 开头")
	}
	return source, nil
}

func (h *Host) packagesRemove(cwd string, payload map[string]any) (map[string]any, error) {
	source, err := packageSource(payload)
	if err != nil {
		return nil, err
	}
	local := asBool(payload["local"])
	args := []string{"remove", source}
	if local {
		args = append(args, "-l")
	}
	targetCwd := ""
	if local && cwd != "" {
		targetCwd = cwd
	}
	code, output := h.runPiCommand(args, targetCwd, 180*time.Second)
	if code != 0 {
		return nil, errors.New("卸载失败：" + firstNonEmpty(tailText(output, 400), "pi remove 异常退出"))
	}
	return packagesOverview(cwd), nil
}

func (h *Host) packagesUpdate(cwd string, payload map[string]any) (map[string]any, error) {
	source, err := packageSource(payload)
	if err != nil {
		return nil, err
	}
	args := []string{"update"}
	if source != "" {
		args = append(args, "--extension", source)
	} else {
		args = append(args, "--extensions")
	}
	code, output := h.runPiCommand(args, cwd, 180*time.Second)
	if code != 0 {
		return nil, errors.New("更新失败：" + firstNonEmpty(tailText(output, 400), "pi update 异常退出"))
	}
	return packagesOverview(cwd), nil
}
