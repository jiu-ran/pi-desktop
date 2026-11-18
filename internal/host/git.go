package host

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

const gitMaxOutput = 4 * 1024 * 1024

func userDataDir() string {
	dir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, ".pi-desktop")
	}
	return dir
}

func worktreeRoot() string { return filepath.Join(userDataDir(), "worktrees") }

func runGit(cwd string, args ...string) (string, error) {
	return runGitEnv(cwd, nil, args...)
}

func (h *Host) runGit(cwd string, args ...string) (string, error) {
	var env map[string]string
	if h != nil {
		env = h.childEnv()
	}
	return runGitEnv(cwd, env, args...)
}

func runGitEnv(cwd string, env map[string]string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	cmd.Env = envSlice(env, "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
	hideWindow(cmd)
	prepareProcessGroup(cmd)
	type result struct {
		output []byte
		err    error
	}
	ch := make(chan result, 1)
	go func() {
		out, err := cmd.CombinedOutput()
		ch <- result{out, err}
	}()
	select {
	case res := <-ch:
		if res.err != nil {
			text := strings.TrimSpace(string(res.output))
			if text == "" {
				text = res.err.Error()
			}
			return "", errors.New(text)
		}
		if len(res.output) > gitMaxOutput {
			return string(res.output[:gitMaxOutput]), nil
		}
		return string(res.output), nil
	case <-time.After(120 * time.Second):
		killProcess(cmd)
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return "", errors.New("git 命令超时")
	}
}

func gitProbe(cwd string, args ...string) string {
	out, err := runGit(cwd, args...)
	if err != nil {
		return ""
	}
	return out
}

func gitRepoRoot(cwd string) string {
	top := strings.TrimSpace(gitProbe(cwd, "rev-parse", "--show-toplevel"))
	if top == "" {
		return ""
	}
	if real, err := realPath(top); err == nil {
		return real
	}
	abs, _ := filepath.Abs(top)
	return abs
}

func parseGitStatus(stdout string) []map[string]any {
	files := []map[string]any{}
	entries := strings.Split(stdout, "\x00")
	for index := 0; index < len(entries); index++ {
		line := entries[index]
		if line == "" || len(line) < 3 {
			continue
		}
		indexCode := string(line[0])
		worktreeCode := string(line[1])
		target := line[3:]
		if indexCode == "R" || indexCode == "C" || worktreeCode == "R" || worktreeCode == "C" {
			index++
		}
		if target == "" {
			continue
		}
		code := strings.TrimSpace(indexCode + worktreeCode)
		if code == "" {
			code = "M"
		}
		files = append(files, map[string]any{
			"code": code, "index": indexCode, "worktree": worktreeCode,
			"path": strings.ReplaceAll(target, "\\", "/"), "untracked": indexCode == "?" && worktreeCode == "?",
		})
	}
	return files
}

func gitOperationPaths(root string, payloadPaths []string) ([]string, error) {
	out := []string{}
	for _, raw := range payloadPaths {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if filepath.IsAbs(value) {
			return nil, errors.New("Git 操作只接受仓库内的相对路径")
		}
		resolved := filepath.Join(root, filepath.FromSlash(value))
		rel, err := filepath.Rel(root, resolved)
		if err != nil || rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
			return nil, errors.New("路径必须位于当前项目目录内")
		}
		out = append(out, filepath.ToSlash(rel))
	}
	if len(out) == 0 {
		return nil, errors.New("请先选择要操作的文件")
	}
	return dedupeStrings(out), nil
}

func (h *Host) gitOverview(cwd string) (map[string]any, error) {
	workspace, err := realPath(cwd)
	if err != nil {
		return nil, errors.New("项目目录无效")
	}
	if err := assertRealWorkspacePath(cwd, workspace, false); err != nil {
		return nil, err
	}
	empty := map[string]any{
		"isRepo": false, "root": "", "branch": "", "detached": false, "upstream": "",
		"ahead": 0, "behind": 0, "hasCommits": false, "canWrite": false, "hasRemote": false,
		"status": []any{}, "commits": []any{}, "userName": "", "userEmail": "",
	}
	root := gitRepoRoot(workspace)
	if root == "" {
		if branch := gitBranch(workspace); branch != "" {
			empty["isRepo"] = true
			empty["branch"] = branch
			return empty, nil
		}
		if within(worktreeRoot(), workspace) {
			empty["staleWorktree"] = true
		}
		return empty, nil
	}
	statusOut := gitProbe(root, "status", "--porcelain=v1", "-z", "-uall")
	logOut := gitProbe(root, "log", "--graph", "--no-color", "-n", "60", "--pretty=format:\x1f%H\x1f%h\x1f%s\x1f%an\x1f%cr\x1f%D")
	headOut := strings.TrimSpace(gitProbe(root, "rev-parse", "--verify", "HEAD"))
	symbolic := strings.TrimSpace(gitProbe(root, "symbolic-ref", "-q", "--short", "HEAD"))
	upstream := strings.TrimSpace(gitProbe(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"))
	remoteOut := strings.TrimSpace(gitProbe(root, "remote"))
	userName := strings.TrimSpace(gitProbe(root, "config", "--get", "user.name"))
	userEmail := strings.TrimSpace(gitProbe(root, "config", "--get", "user.email"))

	hasCommits := headOut != ""
	branch := symbolic
	if branch == "" && hasCommits {
		if len(headOut) > 7 {
			branch = headOut[:7]
		} else {
			branch = headOut
		}
	}
	detached := symbolic == "" && hasCommits
	ahead, behind := 0, 0
	if upstream != "" {
		counts := strings.Fields(strings.TrimSpace(gitProbe(root, "rev-list", "--left-right", "--count", "@{upstream}...HEAD")))
		if len(counts) >= 2 {
			behind = int(asFloat(counts[0]))
			ahead = int(asFloat(counts[1]))
		}
	}
	commits := []map[string]any{}
	for _, line := range strings.Split(logOut, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.Split(line, "\x1f")
		if len(parts) < 6 {
			continue
		}
		refs := ""
		if len(parts) > 6 {
			refs = parts[6]
		}
		commits = append(commits, map[string]any{
			"graph": parts[0], "hash": strings.TrimSpace(parts[1]), "shortHash": strings.TrimSpace(parts[2]),
			"subject": strings.TrimSpace(parts[3]), "author": strings.TrimSpace(parts[4]),
			"relativeTime": strings.TrimSpace(parts[5]), "refs": strings.TrimSpace(refs),
		})
	}
	listOut := gitProbe(root, "worktree", "list", "--porcelain")
	firstWorktree := ""
	if parsed := parseWorktreeList(listOut); len(parsed) > 0 {
		firstWorktree = parsed[0].Path
	}
	primaryRoot := root
	if firstWorktree != "" {
		if real, err := realPath(firstWorktree); err == nil {
			primaryRoot = real
		} else {
			primaryRoot = firstWorktree
		}
	}
	repoKey := shortHash(primaryRoot)
	repoName := worktreeSlug(filepath.Base(primaryRoot))
	if repoName == "" {
		repoName = repoKey
	}
	if branch == "" {
		branch = "HEAD"
	}
	return map[string]any{
		"isRepo": true, "root": root, "branch": branch, "detached": detached, "upstream": upstream,
		"ahead": ahead, "behind": behind, "hasCommits": hasCommits, "canWrite": samePath(root, workspace),
		"hasRemote": remoteOut != "", "status": parseGitStatus(statusOut), "commits": commits,
		"userName": userName, "userEmail": userEmail, "worktreeRoot": worktreeRoot(),
		"repoKey": repoKey, "repoName": repoName,
	}, nil
}

func (h *Host) gitBranches(cwd string) ([]map[string]any, error) {
	workspace, _ := filepath.Abs(cwd)
	if err := assertRealWorkspacePath(cwd, workspace, false); err != nil {
		return nil, err
	}
	root := gitRepoRoot(workspace)
	if root == "" {
		return []map[string]any{}, nil
	}
	return listGitBranches(root)
}

func listGitBranches(root string) ([]map[string]any, error) {
	out, err := runGit(root, "for-each-ref", "--sort=-committerdate",
		"--format=%(refname)%00%(HEAD)%00%(objectname:short)%00%(subject)%00%(upstream:short)%00%(upstream:track)%00%(worktreepath)%00%(symref)",
		"refs/heads/", "refs/remotes/")
	if err != nil {
		return nil, err
	}
	branches := []map[string]any{}
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.Split(line, "\x00")
		if len(parts) < 8 {
			continue
		}
		ref := parts[0]
		if ref == "" || !(strings.HasPrefix(ref, "refs/heads/") || strings.HasPrefix(ref, "refs/remotes/")) || parts[7] != "" {
			continue
		}
		name := strings.TrimPrefix(strings.TrimPrefix(ref, "refs/heads/"), "refs/remotes/")
		worktreePath := parts[6]
		if parts[1] == "*" {
			worktreePath = ""
		}
		branches = append(branches, map[string]any{
			"ref": ref, "name": name, "remote": strings.HasPrefix(ref, "refs/remotes/"),
			"current": parts[1] == "*", "hash": parts[2], "subject": parts[3],
			"upstream": parts[4], "tracking": parts[5], "worktreePath": worktreePath,
		})
	}
	return branches, nil
}

func (h *Host) gitAction(cwd, action string, payload map[string]any) (map[string]any, error) {
	lockFile := filepath.Join(cwd, ".git-pi-operation")
	var result map[string]any
	err := withFileWrite(lockFile, func() error {
		value, err := h.performGitAction(cwd, action, payload)
		result = value
		return err
	})
	return result, err
}

func (h *Host) performGitAction(cwd, action string, payload map[string]any) (map[string]any, error) {
	workspace, err := realPath(cwd)
	if err != nil {
		return nil, errors.New("项目目录无效")
	}
	if err := assertRealWorkspacePath(cwd, workspace, false); err != nil {
		return nil, err
	}
	if action == "init" {
		if gitRepoRoot(workspace) != "" {
			return nil, errors.New("当前目录已经是 Git 仓库")
		}
		if _, err := runGit(workspace, "init", "-b", "main"); err != nil {
			if _, err := runGit(workspace, "init"); err != nil {
				return nil, err
			}
		}
		overview, _ := h.gitOverview(cwd)
		return map[string]any{"ok": true, "message": "已初始化 Git 仓库", "overview": overview}, nil
	}
	root := gitRepoRoot(workspace)
	if root == "" {
		return nil, errors.New("当前目录不是 Git 仓库，请先初始化")
	}
	if !samePath(root, workspace) {
		return nil, errors.New("Git 仓库根目录不在当前项目内，暂不支持在此执行写操作")
	}
	overview, _ := h.gitOverview(cwd)
	message := ""
	switch action {
	case "switchBranch", "createBranch", "deleteBranch":
		if h.workspaceBusy(workspace) {
			return nil, errors.New("当前项目有 Agent 任务或命令运行中，请等待结束后再切换、新建或删除分支")
		}
		message, err = changeGitBranch(root, action, payload)
		if err != nil {
			return nil, err
		}
		clearCompletionCache(workspace)
	case "stage":
		all := asBool(payload["all"])
		if all {
			if _, err := runGit(root, "add", "-A"); err != nil {
				return nil, err
			}
			message = "已暂存全部改动"
		} else {
			paths, err := gitOperationPaths(root, strSlice(payload["paths"]))
			if err != nil {
				return nil, err
			}
			args := append([]string{"add", "--"}, paths...)
			if _, err := runGit(root, args...); err != nil {
				return nil, err
			}
			message = fmt.Sprintf("已暂存 %d 个文件", len(paths))
		}
	case "unstage":
		all := asBool(payload["all"])
		if all {
			if _, err := runGit(root, "reset", "--quiet"); err != nil {
				if _, retryErr := runGit(root, "rm", "--cached", "-r", "--quiet", "."); retryErr != nil {
					return nil, err
				}
			}
			message = "已取消全部暂存"
		} else {
			paths, err := gitOperationPaths(root, strSlice(payload["paths"]))
			if err != nil {
				return nil, err
			}
			args := append([]string{"restore", "--staged", "--"}, paths...)
			if _, err := runGit(root, args...); err != nil {
				rmArgs := append([]string{"rm", "--cached", "-r", "--quiet", "--"}, paths...)
				if _, retryErr := runGit(root, rmArgs...); retryErr != nil {
					return nil, err
				}
			}
			message = fmt.Sprintf("已取消暂存 %d 个文件", len(paths))
		}
	case "commit":
		text := strings.TrimSpace(asString(payload["message"]))
		if text == "" {
			return nil, errors.New("提交信息不能为空")
		}
		if len([]rune(text)) > 5000 {
			return nil, errors.New("提交信息过长（上限 5000 字）")
		}
		staged := strings.TrimSpace(gitProbe(root, "diff", "--cached", "--name-only")) != ""
		if !staged {
			return nil, errors.New("没有已暂存的改动，请先暂存要提交的文件")
		}
		if _, err := runGit(root, "commit", "-m", text); err != nil {
			return nil, err
		}
		short := strings.TrimSpace(gitProbe(root, "rev-parse", "--short", "HEAD"))
		if short != "" {
			message = "已提交 " + short
		} else {
			message = "已提交"
		}
	case "fetch":
		if asString(overview["upstream"]) == "" && strings.TrimSpace(gitProbe(root, "remote")) == "" {
			return nil, errors.New("没有配置远程仓库，无法获取更新")
		}
		if _, err := h.runGit(root, "fetch", "--all", "--prune"); err != nil {
			return nil, err
		}
		message = "已获取远程更新"
	case "pull":
		if asString(overview["upstream"]) == "" {
			return nil, errors.New("当前分支没有上游分支，请先推送一次以建立跟踪关系")
		}
		if _, err := h.runGit(root, "pull", "--no-edit"); err != nil {
			return nil, err
		}
		message = "已拉取远程更新"
	case "push":
		if asBool(overview["detached"]) {
			return nil, errors.New("当前处于游离 HEAD 状态，无法推送")
		}
		remotes := strings.Fields(strings.TrimSpace(gitProbe(root, "remote")))
		if len(remotes) == 0 {
			return nil, errors.New("没有配置远程仓库，无法推送")
		}
		if asString(overview["upstream"]) != "" {
			if _, err := h.runGit(root, "push"); err != nil {
				return nil, err
			}
		} else {
			remote := "origin"
			found := false
			for _, item := range remotes {
				if item == "origin" {
					found = true
					break
				}
			}
			if !found {
				remote = remotes[0]
			}
			if _, err := h.runGit(root, "push", "-u", remote, asString(overview["branch"])); err != nil {
				return nil, err
			}
		}
		message = "已推送到远程"
	default:
		return nil, fmt.Errorf("不支持的 Git 操作：%s", action)
	}
	updated, _ := h.gitOverview(cwd)
	return map[string]any{"ok": true, "message": message, "overview": updated}, nil
}

func (h *Host) workspaceBusy(cwd string) bool {
	key := h.resolvePoolKey(cwd)
	pool := h.requirePool(key)
	if pool == nil {
		return false
	}
	pool.mu.Lock()
	defer pool.mu.Unlock()
	for _, slot := range pool.workers {
		if slot.busy() {
			return true
		}
	}
	return false
}

func validateBranchName(root, value string) (string, error) {
	if value == "" || value != strings.TrimSpace(value) || len([]rune(value)) > 240 || strings.HasPrefix(value, "-") || value == "HEAD" {
		return "", errors.New("无效的分支名称（上限 240 字，不能包含空白或以 - 开头）")
	}
	for _, r := range value {
		if r <= 0x20 || r == 0x7f {
			return "", errors.New("无效的分支名称（不能包含空白或以 - 开头）")
		}
	}
	if _, err := runGit(root, "check-ref-format", "refs/heads/"+value); err != nil {
		return "", errors.New("无效的分支名称，不能包含 ..、~、^、:、?、*、[ 或反斜杠等字符")
	}
	return value, nil
}

func changeGitBranch(root, action string, payload map[string]any) (string, error) {
	branches, err := listGitBranches(root)
	if err != nil {
		return "", err
	}
	find := func(refOrName string) map[string]any {
		for _, item := range branches {
			if asString(item["ref"]) == refOrName {
				return item
			}
			if !asBool(item["remote"]) && asString(item["name"]) == refOrName {
				return item
			}
		}
		return nil
	}
	switch action {
	case "deleteBranch":
		ref := strings.TrimSpace(asString(payload["branch"]))
		targetRef := ref
		if !strings.HasPrefix(ref, "refs/") {
			targetRef = "refs/heads/" + ref
		}
		branch := find(targetRef)
		if branch == nil {
			branch = find(ref)
		}
		if branch == nil {
			return "", errors.New("目标分支已不存在，请刷新分支列表")
		}
		if asBool(branch["remote"]) {
			return "", errors.New("不能直接删除远程跟踪分支，请仅删除本地分支")
		}
		if asBool(branch["current"]) {
			return "", errors.New("不能删除当前所在的分支，请先切换到其他分支")
		}
		if asString(branch["worktreePath"]) != "" {
			return "", fmt.Errorf("此分支正在工作区中使用（%s），请先在「工作区」页签移除该工作区", asString(branch["worktreePath"]))
		}
		name, err := validateBranchName(root, asString(branch["name"]))
		if err != nil {
			return "", err
		}
		flag := "-d"
		if asBool(payload["force"]) {
			flag = "-D"
		}
		if _, err := runGit(root, "branch", flag, "--", name); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "not fully merged") {
				return "", fmt.Errorf("分支「%s」包含尚未合并的提交。若确认丢弃这些提交，请勾选「强制删除」后重试。", name)
			}
			return "", err
		}
		return "已删除本地分支 " + name, nil
	case "switchBranch":
		ref := asString(payload["branch"])
		branch := find(ref)
		if branch == nil {
			return "", errors.New("目标分支已不存在，请刷新分支列表")
		}
		if asBool(branch["current"]) {
			return "已在分支 " + asString(branch["name"]), nil
		}
		if asString(branch["worktreePath"]) != "" {
			return "", fmt.Errorf("此分支已在另一工作区使用：%s", asString(branch["worktreePath"]))
		}
		if !asBool(branch["remote"]) {
			if _, err := validateBranchName(root, asString(branch["name"])); err != nil {
				return "", err
			}
		}
		if strings.TrimSpace(gitProbe(root, "status", "--porcelain=v1", "-uall")) != "" {
			return "", errors.New("当前工作区有未提交或未跟踪改动，请先提交或自行暂存到 stash，再切换分支；不会自动丢弃改动")
		}
		if asBool(branch["remote"]) {
			name, err := validateBranchName(root, asString(payload["localName"]))
			if err != nil {
				return "", err
			}
			for _, item := range branches {
				if asString(item["ref"]) == "refs/heads/"+name {
					return "", errors.New("同名本地分支已存在，请切换本地分支或换一个名称")
				}
			}
			if _, err := runGit(root, "switch", "-c", name, "--track", asString(branch["ref"])); err != nil {
				return "", err
			}
			return fmt.Sprintf("已创建跟踪 %s 的本地分支 %s 并切换", asString(branch["name"]), name), nil
		}
		if _, err := runGit(root, "switch", "--no-guess", "--", asString(branch["name"])); err != nil {
			return "", err
		}
		return "已切换到分支 " + asString(branch["name"]), nil
	default:
		name, err := validateBranchName(root, asString(payload["branch"]))
		if err != nil {
			return "", err
		}
		for _, item := range branches {
			if asString(item["ref"]) == "refs/heads/"+name {
				return "", errors.New("同名本地分支已存在")
			}
		}
		if _, err := runGit(root, "rev-parse", "--verify", "HEAD"); err != nil {
			return "", err
		}
		start := firstNonEmpty(asString(payload["startPoint"]), "HEAD")
		if start != "HEAD" {
			found := false
			for _, item := range branches {
				if asString(item["ref"]) == start || asString(item["name"]) == start {
					found = true
					break
				}
			}
			if !found {
				return "", errors.New("请选择有效的起点分支")
			}
			if strings.TrimSpace(gitProbe(root, "status", "--porcelain=v1", "-uall")) != "" {
				return "", errors.New("从其他分支新建前请先处理未提交改动")
			}
		}
		if _, err := runGit(root, "switch", "-c", name, start); err != nil {
			return "", err
		}
		return "已新建并切换到分支 " + name, nil
	}
}

func (h *Host) gitInspect(cwd, kind, target string) (map[string]any, error) {
	root, _ := filepath.Abs(cwd)
	if err := assertRealWorkspacePath(cwd, root, false); err != nil {
		return nil, err
	}
	if kind == "commit" {
		valid := len(target) >= 4 && len(target) <= 40
		if valid {
			for _, r := range target {
				if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
					valid = false
					break
				}
			}
		}
		if !valid {
			return nil, errors.New("无效的提交哈希")
		}
		metaOut, err := runGit(root, "show", "--no-patch", "--pretty=format:%H%n%an <%ae>%n%ci (%cr)%n%s%n%b", target)
		if err != nil {
			return nil, err
		}
		diffOut, err := runGit(root, "show", "--format=", "--patch", "--unified=3", target)
		if err != nil {
			return nil, err
		}
		lines := strings.Split(metaOut, "\n")
		line := func(index int) string {
			if index < len(lines) {
				return lines[index]
			}
			return ""
		}
		fullHash := firstNonEmpty(line(0), target)
		author := line(1)
		date := line(2)
		subject := firstNonEmpty(line(3), target)
		return map[string]any{
			"kind": "commit", "target": fullHash, "title": subject,
			"subtitle": fullHash[:minInt(7, len(fullHash))] + " · " + author, "meta": date, "diff": diffOut,
		}, nil
	}
	safeRoot, safeTarget, err := workspacePath(root, target)
	if err != nil {
		return nil, err
	}
	if err := assertRealWorkspacePath(root, safeTarget, true); err != nil {
		return nil, err
	}
	rel, _ := filepath.Rel(safeRoot, safeTarget)
	rel = filepath.ToSlash(rel)
	area := []string{"HEAD"}
	if kind == "staged" {
		area = []string{"--cached"}
	} else if kind == "unstaged" {
		area = []string{}
	}
	args := append([]string{"diff"}, area...)
	args = append(args, "--unified=3", "--", rel)
	diff := ""
	if out, err := runGit(safeRoot, args...); err == nil {
		diff = out
	}
	if strings.TrimSpace(diff) == "" && kind != "staged" {
		untracked := strings.TrimSpace(gitProbe(safeRoot, "ls-files", "--others", "--exclude-standard", "--", rel))
		if untracked != "" {
			if data, err := os.ReadFile(safeTarget); err == nil {
				content := string(data)
				if content != "" {
					added := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
					for i := range added {
						added[i] = "+" + added[i]
					}
					diff = "--- /dev/null\n+++ b/" + rel + "\n@@ -0,0 +1 @@\n" + strings.Join(added, "\n")
				}
			}
		}
	}
	meta := "工作区未提交变更"
	if kind == "staged" {
		meta = "暂存区变更"
	} else if kind == "unstaged" {
		meta = "未暂存变更"
	}
	return map[string]any{
		"kind": kind, "target": rel, "title": filepath.Base(rel), "subtitle": rel, "meta": meta, "diff": diff,
	}, nil
}

func (h *Host) gitClone(url, target string) (map[string]any, error) {
	source := strings.TrimSpace(url)
	if source == "" {
		return nil, errors.New("仓库地址不能为空")
	}
	if strings.HasPrefix(source, "-") {
		return nil, errors.New("仓库地址不能以 - 开头")
	}
	if strings.ContainsAny(source, "\x00\r\n") {
		return nil, errors.New("仓库地址包含非法字符")
	}
	raw := strings.TrimSpace(target)
	if raw == "" {
		return nil, errors.New("请选择克隆到的位置")
	}
	if !filepath.IsAbs(raw) {
		return nil, errors.New("位置必须是绝对路径")
	}
	dest, _ := filepath.Abs(raw)
	parent := filepath.Dir(dest)
	parentInfo, err := os.Stat(parent)
	if err != nil || !parentInfo.IsDir() {
		return nil, errors.New("位置不存在或不是目录")
	}
	if info, err := os.Stat(dest); err == nil {
		if !info.IsDir() {
			return nil, errors.New("目标位置已存在同名文件")
		}
		if entries := readDirNames(dest); len(entries) > 0 {
			return nil, errors.New("目标目录已存在且不为空，请换一个位置")
		}
	}
	if _, err := h.runGit(parent, "clone", "--", source, dest); err != nil {
		return nil, err
	}
	canonical, err := realPath(dest)
	if err != nil {
		canonical = dest
	}
	// 克隆目标由用户在选择器里确认；先授权，打开项目时才能直接进入 Agent 选择。
	_, _ = h.authorizeWorkspace(canonical)
	return map[string]any{"ok": true, "path": canonical, "message": "已克隆 " + source}, nil
}

func parseWorktreeList(stdout string) []struct {
	Path     string
	Branch   string
	Head     string
	Detached bool
	Bare     bool
	Locked   bool
	Prunable bool
} {
	type item = struct {
		Path     string
		Branch   string
		Head     string
		Detached bool
		Bare     bool
		Locked   bool
		Prunable bool
	}
	items := []item{}
	var current *item
	flush := func() {
		if current != nil {
			items = append(items, *current)
		}
		current = nil
	}
	for _, line := range strings.Split(stdout, "\n") {
		switch {
		case strings.HasPrefix(line, "worktree "):
			flush()
			p := strings.TrimSpace(strings.TrimPrefix(line, "worktree "))
			p = firstNonEmpty(p, "")
			if abs, err := filepath.Abs(p); err == nil {
				p = abs
			}
			current = &item{Path: p}
		case current == nil:
			continue
		case strings.HasPrefix(line, "HEAD "):
			current.Head = strings.TrimSpace(strings.TrimPrefix(line, "HEAD "))
		case strings.HasPrefix(line, "branch refs/heads/"):
			current.Branch = strings.TrimSpace(strings.TrimPrefix(line, "branch refs/heads/"))
		case line == "detached":
			current.Detached = true
		case line == "bare":
			current.Bare = true
		case strings.HasPrefix(line, "locked"):
			current.Locked = true
		case strings.HasPrefix(line, "prunable"):
			current.Prunable = true
		}
	}
	flush()
	return items
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

var _ = sort.Strings
