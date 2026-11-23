package host

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// mcpMaskedValue 是界面回显的掩码值：真值不外传，界面上一个点都不能少。
const mcpMaskedValue = "••••••"

type mcpProbeInfo struct {
	State     string   `json:"state,omitempty"`
	Tools     []string `json:"tools,omitempty"`
	Error     string   `json:"error,omitempty"`
	Resources bool     `json:"resources,omitempty"`
}

var (
	mcpProbeMu    sync.Mutex
	mcpProbeCache = map[string]mcpProbeInfo{}
)

func (h *Host) mcpConfigFile(scope, cwd string) (string, error) {
	if scope == "project" {
		if cwd == "" {
			return "", errors.New("当前未打开项目目录，无法操作项目级 .pi/mcp.json")
		}
		root, _ := filepath.Abs(cwd)
		return filepath.Join(root, ".pi", "mcp.json"), nil
	}
	return filepath.Join(agentDirPath(), "mcp.json"), nil
}

func readMcpFile(file string) (map[string]any, string) {
	if !fileExists(file) {
		return map[string]any{}, ""
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return map[string]any{}, file + "：" + err.Error()
	}
	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		return map[string]any{}, file + "：" + err.Error()
	}
	if parsed == nil {
		return map[string]any{}, file + "：根节点必须是 JSON 对象"
	}
	return parsed, ""
}

func writeMcpFile(file string, data map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	// atomicWriteText 用 0600 建临时文件，新建的 mcp.json 不会带上组/其他用户可读的权限。
	return atomicWriteText(file, string(encoded)+"\n")
}

// mcpEditFile 把「读 → 改 → 写」串成一次带锁的操作。
// 以前各接口自己读、改、写，两处同时保存时后写的会把先写的整份覆盖掉。
func mcpEditFile(file string, edit func(data map[string]any) error) error {
	return withFileWrite(file, func() error {
		data, readErr := readMcpFile(file)
		if readErr != "" {
			return errors.New(readErr)
		}
		if err := edit(data); err != nil {
			return err
		}
		return writeMcpFile(file, data)
	})
}

// mcpMergeSecretMap 按 key 合并可能被界面掩码过的键值表（env / headers）。
// 界面把已配置的项回填成空输入框，所以「空值或掩码」且上一版有同名 key 时沿用旧值；
// 只保留新表里出现过的 key，用户删掉的 key 照常消失。
func mcpMergeSecretMap(next, previous map[string]any) map[string]any {
	if len(next) == 0 {
		return nil
	}
	merged := make(map[string]any, len(next))
	for key, raw := range next {
		value := asString(raw)
		trimmed := strings.TrimSpace(value)
		if trimmed == "" || trimmed == mcpMaskedValue {
			if old := strings.TrimSpace(asString(previous[key])); old != "" && old != mcpMaskedValue {
				merged[key] = asString(previous[key])
				continue
			}
			if trimmed == mcpMaskedValue {
				// 界面只给了掩码、旧值也拿不到：留空值，别把掩码字面写进配置。
				merged[key] = ""
				continue
			}
		}
		merged[key] = value
	}
	return merged
}

func mcpServersOf(data map[string]any) map[string]any {
	if servers, ok := data["mcpServers"].(map[string]any); ok {
		return servers
	}
	return map[string]any{}
}

func (h *Host) toMcpServerItem(name string, raw map[string]any, scope, sourcePath string) map[string]any {
	isHTTP := asString(raw["url"]) != "" || asString(raw["type"]) == "http"
	item := map[string]any{
		"name": name, "scope": scope, "sourcePath": sourcePath, "type": "stdio",
		"enabled": raw["enabled"] != false,
	}
	if isHTTP {
		item["type"] = "http"
		if url := asString(raw["url"]); strings.HasPrefix(strings.ToLower(url), "http://") || strings.HasPrefix(strings.ToLower(url), "https://") {
			item["url"] = url
		}
		if headers := asMap(raw["headers"]); len(headers) > 0 {
			masked := map[string]string{}
			for key := range headers {
				masked[key] = mcpMaskedValue
			}
			item["headers"] = masked
		}
		if auth := asMap(raw["auth"]); len(auth) > 0 {
			item["auth"] = map[string]any{"provider": firstNonEmpty(asString(auth["provider"]), "configured")}
		}
		if oauth := asMap(raw["oauth"]); len(oauth) > 0 {
			item["oauth"] = map[string]any{"configured": true}
		}
	} else {
		if command := asString(raw["command"]); command != "" {
			item["command"] = command
		}
		if args := strSlice(raw["args"]); len(args) > 0 {
			item["args"] = args
		}
		if env := asMap(raw["env"]); len(env) > 0 {
			masked := map[string]string{}
			for key := range env {
				masked[key] = mcpMaskedValue
			}
			item["env"] = masked
		}
		if cwd := asString(raw["cwd"]); cwd != "" {
			item["cwd"] = cwd
		}
	}
	exposure := asString(raw["exposure"])
	if exposure != "direct" && exposure != "deferred" && exposure != "hidden" {
		exposure = "codemode"
	}
	item["exposure"] = exposure
	if description := asString(raw["description"]); description != "" {
		item["description"] = description
	}
	if timeout, ok := raw["timeout"].(float64); ok {
		item["timeout"] = timeout
	}
	mcpProbeMu.Lock()
	probe, ok := mcpProbeCache[scope+":"+name]
	if !ok {
		probe, ok = mcpProbeCache[name]
	}
	mcpProbeMu.Unlock()
	if raw["enabled"] == false {
		item["state"] = "disabled"
	} else if ok {
		item["state"] = probe.State
		if len(probe.Tools) > 0 {
			item["tools"] = probe.Tools
		}
		if probe.Error != "" {
			item["error"] = probe.Error
		}
		if probe.Resources {
			item["resources"] = true
		}
	}
	return item
}

func (h *Host) mcpOverview(cwd string) (map[string]any, error) {
	if cwd != "" {
		root, _ := filepath.Abs(cwd)
		if err := assertRealWorkspacePath(cwd, root, false); err != nil {
			return nil, err
		}
	}
	agentDir := agentDirPath()
	globalPath := filepath.Join(agentDir, "mcp.json")
	projectPath := ""
	if cwd != "" {
		projectPath = filepath.Join(cwd, ".pi", "mcp.json")
	}
	errorsList := []string{}
	globalData, globalErr := readMcpFile(globalPath)
	if globalErr != "" {
		errorsList = append(errorsList, globalErr)
	}
	projectData := map[string]any{}
	if projectPath != "" {
		var projectErr string
		projectData, projectErr = readMcpFile(projectPath)
		if projectErr != "" {
			errorsList = append(errorsList, projectErr)
		}
	}
	globalServers := mcpServersOf(globalData)
	projectServers := mcpServersOf(projectData)
	servers := []map[string]any{}
	index := map[string]int{}
	for name, raw := range globalServers {
		if rec, ok := raw.(map[string]any); ok {
			servers = append(servers, h.toMcpServerItem(name, rec, "global", globalPath))
			index[name] = len(servers) - 1
		}
	}
	for name, raw := range projectServers {
		rec, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		overrideOnly := rec["command"] == nil && rec["url"] == nil && rec["type"] == nil
		if overrideOnly {
			if baseIdx, exists := index[name]; exists {
				merged := map[string]any{}
				for key, value := range asMap(globalServers[name]) {
					merged[key] = value
				}
				for key, value := range rec {
					merged[key] = value
				}
				servers[baseIdx] = h.toMcpServerItem(name, merged, "global", globalPath)
				continue
			}
		}
		servers = append(servers, h.toMcpServerItem(name, rec, "project", projectPath))
	}
	autoCodemode := true
	if value, ok := projectData["autoEnableCodemode"].(bool); ok {
		autoCodemode = value
	} else if value, ok := globalData["autoEnableCodemode"].(bool); ok {
		autoCodemode = value
	}
	return map[string]any{
		"agentDir": agentDir, "globalConfigPath": globalPath, "projectConfigPath": projectPath,
		"autoEnableCodemode": autoCodemode, "servers": servers, "errors": errorsList,
	}, nil
}

func (h *Host) runMcpAuth(cwd string, args []string, timeout time.Duration) (map[string]any, error) {
	target := cwd
	if target == "" {
		target, _ = os.UserHomeDir()
	}
	code, output := h.runPiCommand(append([]string{"mcp"}, args...), target, timeout)
	if code != 0 {
		return nil, errors.New(firstNonEmpty(output, fmt.Sprintf("pi mcp %s 失败（退出码 %d）", args[0], code)))
	}
	return map[string]any{"output": output}, nil
}

func (h *Host) mcpLogin(cwd, name string) (map[string]any, error) {
	return h.runMcpAuth(cwd, []string{"login", name}, 300*time.Second)
}

func (h *Host) mcpLogout(cwd, name string) (map[string]any, error) {
	return h.runMcpAuth(cwd, []string{"logout", name}, 60*time.Second)
}

func (h *Host) mcpProbe(cwd string) (map[string]any, error) {
	target := cwd
	if target == "" {
		target, _ = os.UserHomeDir()
	}
	code, output := h.runPiCommand([]string{"mcp", "list", "--json"}, target, 45*time.Second)
	extraErrors := []string{}
	if code == 0 {
		var parsed map[string]any
		if json.Unmarshal([]byte(output), &parsed) == nil {
			if servers, ok := parsed["servers"].([]any); ok {
				for _, raw := range servers {
					server := asMap(raw)
					name := asString(server["name"])
					if name == "" {
						continue
					}
					state := asString(server["state"])
					if state == "" {
						if server["enabled"] == false {
							state = "disabled"
						} else {
							state = "unknown"
						}
					}
					info := mcpProbeInfo{State: state, Tools: strSlice(server["tools"]), Resources: asBool(server["resources"])}
					if asBool(server["error"]) || asString(server["error"]) != "" {
						info.Error = "MCP 服务返回错误（详细诊断已隐藏）"
					}
					scope := "global"
					if asString(server["scope"]) == "project" {
						scope = "project"
					}
					mcpProbeMu.Lock()
					mcpProbeCache[scope+":"+name] = info
					mcpProbeCache[name] = info
					mcpProbeMu.Unlock()
				}
			}
			if errs, ok := parsed["errors"].([]any); ok && len(errs) > 0 {
				extraErrors = append(extraErrors, "MCP 列表包含错误（详细诊断已隐藏）")
			}
		}
	} else if strings.TrimSpace(output) != "" {
		extraErrors = append(extraErrors, "MCP 探测失败（详细诊断已隐藏）")
	}
	overview, err := h.mcpOverview(cwd)
	if err != nil {
		return nil, err
	}
	if len(extraErrors) > 0 {
		existing := strSlice(overview["errors"])
		overview["errors"] = dedupeStrings(append(existing, extraErrors...))
	}
	return overview, nil
}

func (h *Host) mcpSaveServer(cwd string, payload map[string]any) (map[string]any, error) {
	name := strings.TrimSpace(asString(payload["name"]))
	if name == "" {
		return nil, errors.New("请输入 MCP 服务名称")
	}
	valid := true
	for _, r := range name {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '-') {
			valid = false
			break
		}
	}
	if !valid {
		return nil, errors.New("MCP 服务名称只能包含字母、数字、点、下划线或连字符")
	}
	cfg := asMap(payload["config"])
	if asString(cfg["command"]) == "" && asString(cfg["url"]) == "" {
		return nil, errors.New("MCP 服务必须提供本地命令（command）或远程地址（url）")
	}
	scope := firstNonEmpty(asString(payload["scope"]), "global")
	if scope != "project" {
		scope = "global"
	}
	file, err := h.mcpConfigFile(scope, cwd)
	if err != nil {
		return nil, err
	}
	// 读改写串成一次带锁的操作，并发保存时才不会互相覆盖。
	writeErr := mcpEditFile(file, func(data map[string]any) error {
		servers := map[string]any{}
		for key, value := range mcpServersOf(data) {
			servers[key] = value
		}
		previousName := asString(payload["previousName"])
		previousConfig := asMap(servers[previousName])
		if len(previousConfig) == 0 {
			previousConfig = asMap(servers[name])
		}
		if previousName != "" && previousName != name {
			delete(servers, previousName)
			mcpProbeMu.Lock()
			delete(mcpProbeCache, scope+":"+previousName)
			mcpProbeMu.Unlock()
		}
		clean := map[string]any{}
		if url := strings.TrimSpace(asString(cfg["url"])); url != "" {
			clean["url"] = url
			if headers := mcpMergeSecretMap(asMap(cfg["headers"]), asMap(previousConfig["headers"])); len(headers) > 0 {
				clean["headers"] = headers
			}
			if auth := asMap(cfg["auth"]); len(auth) > 0 {
				clean["auth"] = auth
			} else if auth := previousConfig["auth"]; auth != nil {
				clean["auth"] = auth
			}
			if oauth := asMap(cfg["oauth"]); len(oauth) > 0 {
				clean["oauth"] = oauth
			} else if oauth := previousConfig["oauth"]; oauth != nil {
				clean["oauth"] = oauth
			}
		} else {
			clean["command"] = strings.TrimSpace(asString(cfg["command"]))
			if args := strSlice(cfg["args"]); len(args) > 0 {
				clean["args"] = args
			}
			if env := mcpMergeSecretMap(asMap(cfg["env"]), asMap(previousConfig["env"])); len(env) > 0 {
				clean["env"] = env
			}
			if cwdValue := strings.TrimSpace(asString(cfg["cwd"])); cwdValue != "" {
				clean["cwd"] = cwdValue
			}
		}
		if description := strings.TrimSpace(asString(cfg["description"])); description != "" {
			clean["description"] = description
		}
		if exposure := asString(cfg["exposure"]); exposure != "" && exposure != "codemode" {
			clean["exposure"] = exposure
		}
		if cfg["enabled"] == false {
			clean["enabled"] = false
		}
		if timeout := asFloat(cfg["timeout"]); timeout > 0 && timeout != 60 {
			clean["timeout"] = timeout
		}
		servers[name] = clean
		data["mcpServers"] = servers
		return nil
	})
	if writeErr != nil {
		return nil, writeErr
	}
	return h.mcpOverview(cwd)
}

func (h *Host) mcpUpdateServer(cwd string, payload map[string]any) (map[string]any, error) {
	scope := firstNonEmpty(asString(payload["scope"]), "global")
	file, err := h.mcpConfigFile(scope, cwd)
	if err != nil {
		return nil, err
	}
	writeErr := mcpEditFile(file, func(data map[string]any) error {
		servers := map[string]any{}
		for key, value := range mcpServersOf(data) {
			servers[key] = value
		}
		name := asString(payload["name"])
		existing := asMap(servers[name])
		if len(existing) == 0 {
			return fmt.Errorf("找不到 MCP 服务：%s", name)
		}
		next := map[string]any{}
		for key, value := range existing {
			next[key] = value
		}
		patch := asMap(payload["patch"])
		if enabled, ok := patch["enabled"].(bool); ok {
			if enabled {
				delete(next, "enabled")
			} else {
				next["enabled"] = false
			}
		}
		if exposure, ok := patch["exposure"].(string); ok {
			if exposure == "codemode" {
				delete(next, "exposure")
			} else {
				next["exposure"] = exposure
			}
		}
		servers[name] = next
		data["mcpServers"] = servers
		return nil
	})
	if writeErr != nil {
		return nil, writeErr
	}
	return h.mcpOverview(cwd)
}

func (h *Host) mcpRemoveServer(cwd string, payload map[string]any) (map[string]any, error) {
	scope := firstNonEmpty(asString(payload["scope"]), "global")
	file, err := h.mcpConfigFile(scope, cwd)
	if err != nil {
		return nil, err
	}
	writeErr := mcpEditFile(file, func(data map[string]any) error {
		servers := map[string]any{}
		for key, value := range mcpServersOf(data) {
			servers[key] = value
		}
		name := asString(payload["name"])
		delete(servers, name)
		mcpProbeMu.Lock()
		delete(mcpProbeCache, scope+":"+name)
		delete(mcpProbeCache, name)
		mcpProbeMu.Unlock()
		data["mcpServers"] = servers
		return nil
	})
	if writeErr != nil {
		return nil, writeErr
	}
	return h.mcpOverview(cwd)
}

func (h *Host) mcpSetAutoCodemode(cwd string, payload map[string]any) (map[string]any, error) {
	scope := firstNonEmpty(asString(payload["scope"]), "global")
	file, err := h.mcpConfigFile(scope, cwd)
	if err != nil {
		return nil, err
	}
	writeErr := mcpEditFile(file, func(data map[string]any) error {
		if asBool(payload["enabled"]) {
			delete(data, "autoEnableCodemode")
		} else {
			data["autoEnableCodemode"] = false
		}
		return nil
	})
	if writeErr != nil {
		return nil, writeErr
	}
	return h.mcpOverview(cwd)
}

func (h *Host) mcpImportJSON(cwd string, payload map[string]any) (map[string]any, error) {
	var parsed map[string]any
	if err := json.Unmarshal([]byte(asString(payload["jsonText"])), &parsed); err != nil {
		return nil, fmt.Errorf("JSON 格式无法解析：%s", err.Error())
	}
	if parsed == nil {
		return nil, errors.New("请粘贴包含 mcpServers 的 JSON 对象")
	}
	entries := map[string]any{}
	if servers := asMap(parsed["mcpServers"]); len(servers) > 0 {
		entries = servers
	} else if name := asString(parsed["name"]); name != "" && (asString(parsed["command"]) != "" || asString(parsed["url"]) != "") {
		rest := map[string]any{}
		for key, value := range parsed {
			if key != "name" {
				rest[key] = value
			}
		}
		entries[name] = rest
	} else {
		entries = parsed
	}
	valid := map[string]any{}
	for name, raw := range entries {
		cfg, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		nameValid := name != ""
		for _, r := range name {
			if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '-') {
				nameValid = false
				break
			}
		}
		if nameValid && (asString(cfg["command"]) != "" || asString(cfg["url"]) != "") {
			valid[name] = cfg
		}
	}
	if len(valid) == 0 {
		return nil, errors.New("未在 JSON 中识别出有效的 MCP 服务定义（需要包含 command 或 url 字段）")
	}
	scope := firstNonEmpty(asString(payload["scope"]), "global")
	file, err := h.mcpConfigFile(scope, cwd)
	if err != nil {
		return nil, err
	}
	writeErr := mcpEditFile(file, func(data map[string]any) error {
		servers := map[string]any{}
		for key, value := range mcpServersOf(data) {
			servers[key] = value
		}
		for name, cfg := range valid {
			servers[name] = cfg
		}
		data["mcpServers"] = servers
		return nil
	})
	if writeErr != nil {
		return nil, writeErr
	}
	return h.mcpOverview(cwd)
}
