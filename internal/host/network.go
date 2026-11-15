package host

import (
	"os"
	"os/exec"
	"regexp"
	"strings"
)

var proxyEnvKeys = []string{
	"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
	"http_proxy", "https_proxy", "all_proxy", "no_proxy",
}

var proxyURLRe = regexp.MustCompile(`^[a-z][a-z0-9+.-]*://`)

func normalizeProxyURL(value string) string {
	text := strings.TrimSpace(value)
	if text == "" {
		return ""
	}
	if !proxyURLRe.MatchString(text) {
		text = "http://" + text
	}
	lower := strings.ToLower(text)
	for _, scheme := range []string{"http://", "https://", "socks://", "socks4://", "socks5://"} {
		if strings.HasPrefix(lower, scheme) {
			rest := text[len(scheme):]
			// 去掉 path/query，只保留 host。
			if idx := strings.IndexAny(rest, "/?#"); idx >= 0 {
				rest = rest[:idx]
			}
			if rest == "" {
				return ""
			}
			return lower[:len(scheme)] + rest
		}
	}
	return ""
}

func envProxyOf(env map[string]string) string {
	for _, key := range []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"} {
		if value := normalizeProxyURL(env[key]); value != "" {
			return value
		}
	}
	return ""
}

func systemProxyOnWindows() string {
	if !isWindows() {
		return ""
	}
	cmd := exec.Command("reg", "query", `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`, "/v", "ProxyServer")
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	text := string(out)
	idx := strings.Index(text, "REG_SZ")
	if idx < 0 {
		return ""
	}
	server := strings.TrimSpace(text[idx+len("REG_SZ"):])
	if server == "" {
		return ""
	}
	// ProxyServer 可能是 `http=host:port;https=host:port`，取 https 优先。
	chosen := server
	if strings.Contains(server, "=") {
		chosen = ""
		for _, part := range strings.Split(server, ";") {
			kv := strings.SplitN(part, "=", 2)
			if len(kv) != 2 {
				continue
			}
			if strings.EqualFold(kv[0], "https") {
				chosen = kv[1]
				break
			}
			if chosen == "" && strings.EqualFold(kv[0], "http") {
				chosen = kv[1]
			}
		}
	}
	return normalizeProxyURL(chosen)
}

func (h *Host) systemProxy() string {
	if value := envProxyOf(envMap()); value != "" {
		return value
	}
	return systemProxyOnWindows()
}

func envMap() map[string]string {
	out := map[string]string{}
	for _, item := range os.Environ() {
		if idx := strings.Index(item, "="); idx > 0 {
			out[item[:idx]] = item[idx+1:]
		}
	}
	return out
}

func (h *Host) planProxy() (mode, proxy, source string) {
	h.mu.Lock()
	mode = h.networkMode
	custom := normalizeProxyURL(h.networkCustom)
	h.mu.Unlock()
	system := h.systemProxy()
	switch mode {
	case "direct":
		return "direct", "", "none"
	case "custom":
		if custom != "" {
			return "custom", custom, "custom"
		}
		return "custom", "", "none"
	case "system":
		if system != "" {
			return "system", system, "system"
		}
		return "system", "", "none"
	default:
		if fromEnv := envProxyOf(envMap()); fromEnv != "" {
			return "auto", fromEnv, "env"
		}
		if system != "" {
			return "auto", system, "system"
		}
		return "auto", "", "none"
	}
}

func (h *Host) childEnv() map[string]string {
	env := envMap()
	_, proxy, _ := h.planProxy()
	for _, key := range proxyEnvKeys {
		delete(env, key)
	}
	if proxy == "" {
		env["NO_PROXY"] = "*"
		return env
	}
	env["HTTP_PROXY"] = proxy
	env["HTTPS_PROXY"] = proxy
	env["http_proxy"] = proxy
	env["https_proxy"] = proxy
	return env
}

func (h *Host) networkApply(mode, custom string) map[string]any {
	if mode != "system" && mode != "direct" && mode != "custom" {
		mode = "auto"
	}
	h.mu.Lock()
	h.networkMode = mode
	h.networkCustom = custom
	h.mu.Unlock()
	return h.networkStatus()
}

func (h *Host) networkStatus() map[string]any {
	mode, proxy, source := h.planProxy()
	h.mu.Lock()
	custom := h.networkCustom
	h.mu.Unlock()
	return map[string]any{
		"mode": mode, "custom": custom, "proxy": proxy, "source": source, "systemProxy": h.systemProxy(),
	}
}
