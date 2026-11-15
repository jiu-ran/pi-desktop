package host

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

func (h *Host) gitWorktrees(cwd string) ([]map[string]any, error) {
	workspace, _ := filepath.Abs(cwd)
	if err := assertRealWorkspacePath(cwd, workspace, false); err != nil {
		return nil, err
	}
	root := gitRepoRoot(workspace)
	if root == "" {
		return []map[string]any{}, nil
	}
	out := gitProbe(root, "worktree", "list", "--porcelain")
	parsed := parseWorktreeList(out)
	if len(parsed) == 0 {
		return []map[string]any{}, nil
	}
	primaryRoot := parsed[0].Path
	if real, err := realPath(primaryRoot); err == nil {
		primaryRoot = real
	}
	primaryBranch := parsed[0].Branch
	if primaryBranch == "" {
		primaryBranch = strings.TrimSpace(gitProbe(primaryRoot, "symbolic-ref", "--quiet", "--short", "HEAD"))
	}
	managedRoot := worktreeRoot()
	if real, err := realPath(managedRoot); err == nil {
		managedRoot = real
	}
	configOut := gitProbe(primaryRoot, "config", "--get-regexp", `^branch\..*\.pi(base|managed)`)
	branchMeta := map[string]map[string]string{}
	re := regexp.MustCompile(`(?i)^branch\.(.+)\.(pibasebranch|pibaseref|pibasecommit|pimanaged)\s+(.*)$`)
	for _, line := range strings.Split(configOut, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		match := re.FindStringSubmatch(line)
		if len(match) < 4 {
			continue
		}
		branch := match[1]
		if branchMeta[branch] == nil {
			branchMeta[branch] = map[string]string{}
		}
		branchMeta[branch][strings.ToLower(match[2])] = strings.TrimSpace(match[3])
	}
	result := []map[string]any{}
	for _, item := range parsed {
		canonical := item.Path
		if real, err := realPath(item.Path); err == nil {
			canonical = real
		}
		primary := samePath(canonical, primaryRoot)
		meta := branchMeta[item.Branch]
		managed := !primary && (within(managedRoot, canonical) || strings.EqualFold(meta["pimanaged"], "true"))
		exists := dirExists(canonical)
		entry := map[string]any{
			"path": canonical, "branch": item.Branch, "head": item.Head, "detached": item.Detached,
			"bare": item.Bare, "locked": item.Locked, "prunable": item.Prunable,
			"primary": primary, "managed": managed, "exists": exists,
		}
		baseBranch := ""
		if !primary {
			baseBranch = firstNonEmpty(meta["pibasebranch"], primaryBranch)
			if baseBranch != "" {
				entry["baseBranch"] = baseBranch
			}
			if baseRef := firstNonEmpty(meta["pibaseref"], baseBranch); baseRef != "" {
				entry["baseRef"] = baseRef
			}
			if meta["pibasecommit"] != "" {
				entry["baseCommit"] = meta["pibasecommit"]
			}
		}
		if !primary && exists {
			dirty := strings.TrimSpace(gitProbe(canonical, "status", "--porcelain=v1", "-uall")) != ""
			entry["dirty"] = dirty
			ahead, behind := 0, 0
			if baseBranch != "" && item.Head != "" {
				if strings.TrimSpace(gitProbe(primaryRoot, "show-ref", "--verify", "refs/heads/"+baseBranch)) != "" {
					counts := strings.Fields(strings.TrimSpace(gitProbe(primaryRoot, "rev-list", "--left-right", "--count", "refs/heads/"+baseBranch+"..."+item.Head)))
					if len(counts) >= 2 {
						behind = int(asFloat(counts[0]))
						ahead = int(asFloat(counts[1]))
					}
				}
			}
			entry["ahead"] = ahead
			entry["behind"] = behind
		}
		result = append(result, entry)
	}
	return result, nil
}

func (h *Host) gitWorktreeCreate(cwd, name string, options map[string]any) (map[string]any, error) {
	workspace, err := realPath(cwd)
	if err != nil {
		return nil, errors.New("项目目录无效")
	}
	if err := assertRealWorkspacePath(cwd, workspace, false); err != nil {
		return nil, err
	}
	root := gitRepoRoot(workspace)
	if root == "" {
		return nil, errors.New("当前目录不是 Git 仓库，请先初始化")
	}
	if !samePath(root, workspace) {
		return nil, errors.New("请在仓库根目录创建隔离工作区")
	}
	head := strings.TrimSpace(gitProbe(root, "rev-parse", "--verify", "HEAD"))
	if head == "" {
		return nil, errors.New("仓库还没有提交，无法创建隔离工作区")
	}
	parsedWorktrees := parseWorktreeList(gitProbe(root, "worktree", "list", "--porcelain"))
	primaryRoot := root
	if len(parsedWorktrees) > 0 {
		primaryRoot = parsedWorktrees[0].Path
		if real, err := realPath(primaryRoot); err == nil {
			primaryRoot = real
		}
	}
	branches, _ := listGitBranches(primaryRoot)
	primaryBranch := strings.TrimSpace(gitProbe(primaryRoot, "symbolic-ref", "--quiet", "--short", "HEAD"))
	currentBranch := strings.TrimSpace(gitProbe(root, "symbolic-ref", "--quiet", "--short", "HEAD"))
	defaultBaseBranch := currentBranch
	if defaultBaseBranch == "" || strings.HasPrefix(defaultBaseBranch, "pi/") {
		defaultBaseBranch = primaryBranch
	}
	if defaultBaseBranch == "" {
		for _, branch := range branches {
			if !asBool(branch["remote"]) {
				defaultBaseBranch = asString(branch["name"])
				break
			}
		}
	}
	if defaultBaseBranch == "" {
		defaultBaseBranch = "main"
	}
	branchMode := "create"
	if asString(options["branchMode"]) == "existing" {
		branchMode = "existing"
	}
	customBranch := strings.TrimPrefix(strings.TrimSpace(asString(options["branchName"])), "refs/heads/")
	validate := func(candidate string) (string, error) {
		if candidate == "" || len([]rune(candidate)) > 240 || strings.HasPrefix(candidate, "-") || candidate == "HEAD" {
			return "", errors.New("无效的分支名称（不能包含空白或以 - 开头）")
		}
		for _, r := range candidate {
			if r <= 0x20 || r == 0x7f {
				return "", errors.New("无效的分支名称（不能包含空白或以 - 开头）")
			}
		}
		if strings.TrimSpace(gitProbe(primaryRoot, "check-ref-format", "--branch", candidate)) == "" {
			if _, err := runGit(primaryRoot, "check-ref-format", "--branch", candidate); err != nil {
				return "", errors.New("无效的 Git 分支名称，请换一个名称")
			}
		}
		return candidate, nil
	}
	baseCommit := head
	baseRef := firstNonEmpty(currentBranch, head[:minInt(7, len(head))])
	baseBranch := defaultBaseBranch
	branch := ""
	checkoutExistingLocal := false
	trackRemoteRef := ""
	if branchMode == "existing" {
		rawExisting := strings.TrimSpace(asString(options["existingBranch"]))
		if rawExisting == "" {
			return nil, errors.New("请选择要检出的已有分支")
		}
		var match map[string]any
		for _, item := range branches {
			if asString(item["ref"]) == rawExisting || asString(item["name"]) == rawExisting {
				match = item
				break
			}
		}
		if match == nil {
			return nil, fmt.Errorf("找不到要检出的分支：%s", rawExisting)
		}
		if !asBool(match["remote"]) {
			for _, worktree := range parsedWorktrees {
				if worktree.Branch == asString(match["name"]) {
					return nil, fmt.Errorf("分支 %s 已在工作区使用（%s），不能在多个工作树重复检出", asString(match["name"]), worktree.Path)
				}
			}
			if asBool(match["current"]) || asString(match["worktreePath"]) != "" {
				return nil, fmt.Errorf("分支 %s 已在工作区使用（%s），不能在多个工作树重复检出", asString(match["name"]), firstNonEmpty(asString(match["worktreePath"]), root))
			}
			var err error
			branch, err = validate(asString(match["name"]))
			if err != nil {
				return nil, err
			}
			checkoutExistingLocal = true
			baseCommit = firstNonEmpty(strings.TrimSpace(gitProbe(primaryRoot, "rev-parse", "--verify", asString(match["ref"]))), head)
			baseRef = asString(match["name"])
		} else {
			name := asString(match["name"])
			if idx := strings.Index(name, "/"); idx >= 0 {
				name = name[idx+1:]
			}
			localName, err := validate(firstNonEmpty(customBranch, name))
			if err != nil {
				return nil, err
			}
			for _, worktree := range parsedWorktrees {
				if worktree.Branch == localName {
					return nil, fmt.Errorf("本地分支 %s 已在工作区使用（%s），请指定其他本地跟踪分支名", localName, worktree.Path)
				}
			}
			branch = localName
			if strings.TrimSpace(gitProbe(primaryRoot, "show-ref", "--verify", "refs/heads/"+localName)) != "" {
				checkoutExistingLocal = true
			} else {
				trackRemoteRef = asString(match["ref"])
			}
			baseCommit = firstNonEmpty(strings.TrimSpace(gitProbe(primaryRoot, "rev-parse", "--verify", asString(match["ref"]))), head)
			baseRef = asString(match["name"])
		}
	} else {
		rawStart := strings.TrimSpace(asString(options["startPoint"]))
		if rawStart != "" && rawStart != "HEAD" {
			if strings.HasPrefix(rawStart, "-") || strings.ContainsAny(rawStart, " \t\r\n") || strings.Contains(rawStart, "@{") || strings.Contains(rawStart, "..") {
				return nil, errors.New("无效的起点分支或提交")
			}
			resolved := strings.TrimSpace(gitProbe(primaryRoot, "rev-parse", "--verify", "--end-of-options", rawStart+"^{commit}"))
			if resolved == "" {
				return nil, fmt.Errorf("找不到指定的起点分支或提交：%s", rawStart)
			}
			baseCommit = resolved
			for _, item := range branches {
				if !asBool(item["remote"]) && (asString(item["ref"]) == rawStart || asString(item["name"]) == rawStart) {
					baseRef = asString(item["name"])
					baseBranch = asString(item["name"])
					break
				}
			}
		}
	}
	if raw, ok := options["baseBranch"]; ok {
		rawBase := strings.TrimPrefix(strings.TrimSpace(asString(raw)), "refs/heads/")
		if rawBase == "" {
			baseBranch = ""
		} else {
			found := false
			for _, item := range branches {
				if !asBool(item["remote"]) && asString(item["name"]) == rawBase {
					found = true
					break
				}
			}
			if !found {
				return nil, fmt.Errorf("目标基础分支不存在：%s", rawBase)
			}
			baseBranch = rawBase
		}
	}
	if baseBranch != "" && baseBranch == branch {
		baseBranch = ""
	}
	rawSeed := firstNonEmpty(name, customBranch, branch)
	slug := worktreeSlug(strings.TrimPrefix(strings.TrimPrefix(rawSeed, "pi/"), "pi-"))
	if slug == "" {
		slug = worktreeSlug(rawSeed)
	}
	if slug == "" {
		return nil, errors.New("任务名或分支名不能为空")
	}
	repoSeed := worktreeSlug(filepath.Base(primaryRoot))
	if repoSeed == "" {
		repoSeed = shortHash(primaryRoot)
	}
	_ = os.MkdirAll(worktreeRoot(), 0o755)
	managedRoot := worktreeRoot()
	if real, err := realPath(managedRoot); err == nil {
		managedRoot = real
	}
	target := ""
	rawTarget := strings.TrimSpace(asString(options["targetDir"]))
	if rawTarget != "" {
		if !filepath.IsAbs(rawTarget) {
			return nil, errors.New("隔离工作区目录必须是绝对路径")
		}
		target, _ = filepath.Abs(rawTarget)
		if samePath(target, primaryRoot) || samePath(target, root) || within(target, primaryRoot) || within(filepath.Join(primaryRoot, ".git"), target) {
			return nil, errors.New("隔离工作区目录不能是当前仓库根目录、其上级目录或 .git 内部")
		}
		if info, err := os.Stat(target); err == nil {
			if !info.IsDir() {
				return nil, errors.New("目标路径已存在且不是文件夹")
			}
			if len(readDirNames(target)) > 0 {
				return nil, errors.New("目标文件夹非空，请选择空文件夹或修改目标目录名称")
			}
		}
		if branchMode == "create" {
			if customBranch != "" {
				var err error
				branch, err = validate(customBranch)
				if err != nil {
					return nil, err
				}
				if strings.TrimSpace(gitProbe(primaryRoot, "show-ref", "--verify", "refs/heads/"+branch)) != "" {
					return nil, fmt.Errorf("本地分支 %s 已存在，请换一个分支名或改选「检出已有分支」", branch)
				}
			} else {
				for index := 1; index <= 100; index++ {
					candidate := "pi/" + slug
					if index > 1 {
						candidate = fmt.Sprintf("pi/%s-%d", slug, index)
					}
					if strings.TrimSpace(gitProbe(primaryRoot, "show-ref", "--verify", "refs/heads/"+candidate)) == "" {
						branch = candidate
						break
					}
				}
				if branch == "" {
					return nil, errors.New("同名隔离工作区分支过多，请换一个任务名")
				}
				if _, err := validate(branch); err != nil {
					return nil, err
				}
			}
		}
	} else {
		baseDir := filepath.Join(managedRoot, repoSeed+"-"+slug)
		if branchMode == "create" && customBranch != "" {
			var err error
			branch, err = validate(customBranch)
			if err != nil {
				return nil, err
			}
			if strings.TrimSpace(gitProbe(primaryRoot, "show-ref", "--verify", "refs/heads/"+branch)) != "" {
				return nil, fmt.Errorf("本地分支 %s 已存在，请换一个分支名或改选「检出已有分支」", branch)
			}
			for index := 1; index <= 100; index++ {
				candidate := baseDir
				if index > 1 {
					candidate = fmt.Sprintf("%s-%d", baseDir, index)
				}
				if !dirExists(candidate) {
					target = candidate
					break
				}
			}
			if target == "" {
				return nil, errors.New("同名隔离工作区目录过多，请换一个名称或自定义目录")
			}
		} else if branchMode == "existing" {
			for index := 1; index <= 100; index++ {
				candidate := baseDir
				if index > 1 {
					candidate = fmt.Sprintf("%s-%d", baseDir, index)
				}
				if !dirExists(candidate) {
					target = candidate
					break
				}
			}
			if target == "" {
				return nil, errors.New("同名隔离工作区目录过多，请自定义存放目录")
			}
		} else {
			for index := 1; index <= 100; index++ {
				candidateBranch := "pi/" + slug
				candidateDir := baseDir
				if index > 1 {
					candidateBranch = fmt.Sprintf("pi/%s-%d", slug, index)
					candidateDir = fmt.Sprintf("%s-%d", baseDir, index)
				}
				if strings.TrimSpace(gitProbe(primaryRoot, "show-ref", "--verify", "refs/heads/"+candidateBranch)) == "" && !dirExists(candidateDir) {
					branch = candidateBranch
					target = candidateDir
					break
				}
			}
			if target == "" {
				return nil, errors.New("同名隔离工作区过多，请换一个任务名")
			}
			if _, err := validate(branch); err != nil {
				return nil, err
			}
		}
	}
	if baseBranch != "" && baseBranch == branch {
		baseBranch = ""
	}
	_ = os.MkdirAll(filepath.Dir(target), 0o755)
	if branchMode == "existing" {
		if checkoutExistingLocal {
			if _, err := runGit(primaryRoot, "worktree", "add", target, branch); err != nil {
				return nil, err
			}
		} else {
			if _, err := runGit(primaryRoot, "worktree", "add", "--track", "-b", branch, target, trackRemoteRef); err != nil {
				return nil, err
			}
		}
	} else {
		if _, err := runGit(primaryRoot, "worktree", "add", "-b", branch, target, baseCommit); err != nil {
			return nil, err
		}
	}
	_ = gitProbe(primaryRoot, "config", "branch."+branch+".piManaged", "true")
	if baseBranch != "" {
		_ = gitProbe(primaryRoot, "config", "branch."+branch+".piBaseBranch", baseBranch)
	}
	if baseRef != "" {
		_ = gitProbe(primaryRoot, "config", "branch."+branch+".piBaseRef", baseRef)
	}
	if baseCommit != "" {
		_ = gitProbe(primaryRoot, "config", "branch."+branch+".piBaseCommit", baseCommit)
	}
	canonicalTarget := target
	if real, err := realPath(target); err == nil {
		canonicalTarget = real
	}
	h.mu.Lock()
	h.authorized[normPathKey(canonicalTarget)] = canonicalTarget
	h.mu.Unlock()
	clonedSession := ""
	if source := strings.TrimSpace(asString(options["sourceSessionFile"])); source != "" {
		verified, err := assertReadableSessionFile(cwd, source)
		if err != nil {
			return nil, err
		}
		clonedSession, err = cloneSessionToWorkspace(verified, canonicalTarget)
		if err != nil {
			return nil, err
		}
	}
	list, _ := h.gitWorktrees(cwd)
	var worktree map[string]any
	for _, item := range list {
		if samePath(asString(item["path"]), canonicalTarget) {
			worktree = item
			break
		}
	}
	if worktree == nil {
		worktree = map[string]any{
			"path": canonicalTarget, "branch": branch, "head": baseCommit, "detached": false, "bare": false,
			"locked": false, "prunable": false, "primary": false, "managed": true, "exists": true,
			"baseBranch": baseBranch, "baseRef": baseRef, "baseCommit": baseCommit, "dirty": false, "ahead": 0, "behind": 0,
		}
	}
	message := fmt.Sprintf("已基于 %s 创建隔离工作区（%s）", baseRef, branch)
	if branchMode == "existing" {
		message = fmt.Sprintf("已检出分支 %s 创建隔离工作区", branch)
	}
	result := map[string]any{"ok": true, "message": message, "worktree": worktree}
	if clonedSession != "" {
		result["sessionFile"] = clonedSession
	}
	return result, nil
}

func (h *Host) gitWorktreeRemove(cwd, target string, options map[string]any) (map[string]any, error) {
	workspace, err := realPath(cwd)
	if err != nil {
		return nil, errors.New("项目目录无效")
	}
	if err := assertRealWorkspacePath(cwd, workspace, false); err != nil {
		return nil, err
	}
	root := gitRepoRoot(workspace)
	if root == "" {
		return nil, errors.New("当前目录不是 Git 仓库")
	}
	if !samePath(root, workspace) {
		return nil, errors.New("请在仓库根目录移除隔离工作区")
	}
	all, _ := h.gitWorktrees(cwd)
	var primary, entry map[string]any
	for _, item := range all {
		if asBool(item["primary"]) {
			primary = item
		}
		if samePath(asString(item["path"]), target) {
			entry = item
		}
	}
	primaryRoot := root
	if primary != nil {
		primaryRoot = asString(primary["path"])
	}
	if entry == nil {
		return nil, errors.New("该目录不是当前仓库的 worktree")
	}
	if asBool(entry["primary"]) {
		return nil, errors.New("不能移除仓库的主工作区")
	}
	if samePath(asString(entry["path"]), workspace) {
		return nil, errors.New("不能移除当前正在使用的工作区")
	}
	entryPath := asString(entry["path"])
	if pool := h.requirePool(entryPath); pool != nil {
		if h.workspaceBusy(entryPath) {
			return nil, errors.New("该隔离工作区仍有 Agent 任务或命令正在运行，请等待结束后再移除")
		}
		h.discardWorkspace(entryPath)
	}
	_ = gitProbe(primaryRoot, "worktree", "unlock", entryPath)
	attempts := 1
	if dirExists(entryPath) {
		attempts = 6
	}
	for attempt := 0; attempt < attempts; attempt++ {
		if _, err := runGit(primaryRoot, "worktree", "remove", "--force", "--force", entryPath); err == nil {
			break
		}
		if attempt+1 < attempts {
			time.Sleep(250 * time.Millisecond)
		}
	}
	if dirExists(entryPath) {
		removed := false
		for attempt := 0; attempt < 6; attempt++ {
			if err := os.RemoveAll(entryPath); err == nil {
				removed = true
				break
			}
			time.Sleep(250 * time.Millisecond)
		}
		if !removed {
			return nil, errors.New("工作区文件仍被占用，请关闭占用该目录的程序后重试")
		}
	}
	_ = gitProbe(primaryRoot, "worktree", "prune", "--expire", "now")
	remaining, _ := h.gitWorktrees(cwd)
	for _, item := range remaining {
		if samePath(asString(item["path"]), entryPath) {
			return nil, fmt.Errorf("未能移除工作树 %s，Git 仍保留该工作树记录，请检查是否有外部程序占用", entryPath)
		}
	}
	branch := asString(entry["branch"])
	deleteBranch := asBool(options["deleteBranch"])
	branchDeleted := false
	if branch != "" {
		if deleteBranch {
			if out := gitProbe(primaryRoot, "branch", "-D", branch); strings.TrimSpace(out) != "" {
				branchDeleted = true
			}
		} else {
			for _, key := range []string{"piManaged", "piBaseBranch", "piBaseRef", "piBaseCommit"} {
				_ = gitProbe(primaryRoot, "config", "--unset-all", "branch."+branch+"."+key)
			}
		}
	}
	typeLabel := "外部工作区"
	if asBool(entry["managed"]) {
		typeLabel = "隔离工作区"
	}
	label := firstNonEmpty(branch, asString(entry["head"])[:minInt(7, len(asString(entry["head"])))], "detached")
	message := fmt.Sprintf("已移除%s（%s）", typeLabel, label)
	if branchDeleted {
		message = fmt.Sprintf("已移除%s并删除分支 %s", typeLabel, branch)
	}
	return map[string]any{"ok": true, "message": message, "branch": branch, "path": entryPath, "branchDeleted": branchDeleted}, nil
}

func (h *Host) gitWorktreeMerge(cwd string, options map[string]any) (map[string]any, error) {
	workspace, err := realPath(cwd)
	if err != nil {
		return nil, errors.New("项目目录无效")
	}
	if err := assertRealWorkspacePath(cwd, workspace, false); err != nil {
		return nil, err
	}
	root := gitRepoRoot(workspace)
	if root == "" {
		return nil, errors.New("当前目录不是 Git 仓库")
	}
	all, _ := h.gitWorktrees(workspace)
	var primary, entry map[string]any
	for _, item := range all {
		if asBool(item["primary"]) {
			primary = item
		}
		if samePath(asString(item["path"]), asString(options["worktreePath"])) {
			entry = item
		}
	}
	if primary == nil || !asBool(primary["exists"]) {
		return nil, errors.New("找不到仓库的主工作区")
	}
	primaryRoot := asString(primary["path"])
	if _, err := realPath(primaryRoot); err != nil {
		primaryRoot = root
	}
	h.mu.Lock()
	h.authorized[normPathKey(primaryRoot)] = primaryRoot
	h.mu.Unlock()
	if entry == nil {
		return nil, errors.New("该目录不是当前仓库的 worktree")
	}
	if asBool(entry["primary"]) {
		return nil, errors.New("不能将主工作区合并到自身")
	}
	if !asBool(entry["exists"]) {
		return nil, errors.New("隔离工作区目录不存在")
	}
	entryBranch := asString(entry["branch"])
	if entryBranch == "" {
		return nil, errors.New("隔离工作区处于游离 HEAD 状态，请先在工作区内创建分支后再合并")
	}
	targetBranch := firstNonEmpty(asString(options["targetBranch"]), asString(entry["baseBranch"]), asString(primary["branch"]))
	targetBranch = strings.TrimPrefix(targetBranch, "refs/heads/")
	if targetBranch == "" {
		return nil, errors.New("请指定要合并到的目标基础分支")
	}
	if targetBranch == entryBranch {
		return nil, errors.New("目标基础分支不能与隔离工作区分支相同")
	}
	targetRef := "refs/heads/" + targetBranch
	if strings.TrimSpace(gitProbe(primaryRoot, "show-ref", "--verify", targetRef)) == "" {
		return nil, fmt.Errorf("目标基础分支不存在：%s", targetBranch)
	}
	strategy := asString(options["strategy"])
	if strategy != "merge" && strategy != "rebase" {
		strategy = "squash"
	}
	if h.workspaceBusy(primaryRoot) || h.workspaceBusy(asString(entry["path"])) {
		return nil, errors.New("相关工作区仍有 Agent 任务或命令正在运行，请等待任务结束后再合并")
	}
	if strings.TrimSpace(gitProbe(asString(entry["path"]), "status", "--porcelain=v1", "-uall")) != "" {
		return nil, fmt.Errorf("隔离工作区（%s）仍有未提交或未跟踪的改动，请先在隔离工作区提交后再合并", entryBranch)
	}
	if strings.TrimSpace(gitProbe(primaryRoot, "status", "--porcelain=v1", "-uall")) != "" {
		return nil, fmt.Errorf("主工作区（%s）有未提交或未跟踪的改动，请先在主工作区处理后再合并", firstNonEmpty(asString(primary["branch"]), primaryRoot))
	}
	counts := strings.Fields(strings.TrimSpace(gitProbe(primaryRoot, "rev-list", "--left-right", "--count", targetRef+"...refs/heads/"+entryBranch)))
	ahead := 0
	if len(counts) >= 2 {
		ahead = int(asFloat(counts[1]))
	}
	if ahead <= 0 {
		return nil, fmt.Errorf("分支 %s 没有领先于 %s 的新提交，无需合并", entryBranch, targetBranch)
	}
	currentBranch := strings.TrimSpace(gitProbe(primaryRoot, "symbolic-ref", "--quiet", "--short", "HEAD"))
	if currentBranch != targetBranch {
		for _, item := range all {
			if !asBool(item["primary"]) && asString(item["branch"]) == targetBranch {
				return nil, fmt.Errorf("目标分支 %s 当前已在另一工作区检出：%s", targetBranch, asString(item["path"]))
			}
		}
		if _, err := runGit(primaryRoot, "switch", "--no-guess", "--", targetBranch); err != nil {
			return nil, err
		}
	}
	message := strings.TrimSpace(asString(options["message"]))
	if len([]rune(message)) > 5000 {
		return nil, errors.New("合并提交说明过长（上限 5000 字）")
	}
	if message == "" {
		if ahead == 1 {
			message = firstNonEmpty(strings.TrimSpace(gitProbe(primaryRoot, "log", "-1", "--format=%s", "refs/heads/"+entryBranch)), "合并 "+entryBranch+" 到 "+targetBranch)
		} else {
			subjects := strings.TrimSpace(gitProbe(primaryRoot, "log", "--reverse", "--format=- %s", targetRef+"..refs/heads/"+entryBranch))
			message = "合并 " + entryBranch + " 到 " + targetBranch
			if subjects != "" {
				message += "\n\n" + subjects
			}
		}
	}
	collectConflicts := func(dir string) []string {
		out := strings.TrimSpace(gitProbe(dir, "diff", "--name-only", "--diff-filter=U"))
		if out != "" {
			return dedupeStrings(strings.Split(out, "\n"))
		}
		status := parseGitStatus(gitProbe(dir, "status", "--porcelain=v1", "-z"))
		files := []string{}
		for _, file := range status {
			index := asString(file["index"])
			worktree := asString(file["worktree"])
			if index == "U" || worktree == "U" || (index == "A" && worktree == "A") || (index == "D" && worktree == "D") {
				files = append(files, asString(file["path"]))
			}
		}
		return files
	}
	failure := func(conflicts []string, action string) map[string]any {
		return map[string]any{
			"ok": false, "conflict": true, "conflicts": conflicts,
			"message":     fmt.Sprintf("合并 %s 到 %s 时发生冲突（共 %d 个文件），已自动中止合并并恢复主工作区", entryBranch, targetBranch, len(conflicts)),
			"primaryPath": primaryRoot, "worktreePath": asString(entry["path"]),
			"worktreeBranch": entryBranch, "targetBranch": targetBranch, "strategy": strategy,
		}
	}
	switch strategy {
	case "squash":
		if _, err := runGit(primaryRoot, "merge", "--squash", "refs/heads/"+entryBranch); err != nil {
			conflicts := collectConflicts(primaryRoot)
			_ = gitProbe(primaryRoot, "reset", "--hard", "HEAD")
			_ = gitProbe(primaryRoot, "clean", "-fd")
			if len(conflicts) > 0 {
				return failure(conflicts, "squash"), nil
			}
			return nil, err
		}
		if strings.TrimSpace(gitProbe(primaryRoot, "status", "--porcelain=v1")) == "" {
			_ = gitProbe(primaryRoot, "reset", "--hard", "HEAD")
			return nil, fmt.Errorf("分支 %s 的改动内容已包含在 %s 中，无需生成新提交", entryBranch, targetBranch)
		}
		if _, err := runGit(primaryRoot, "commit", "-m", message); err != nil {
			return nil, err
		}
	case "merge":
		if _, err := runGit(primaryRoot, "merge", "--no-ff", "-m", message, "refs/heads/"+entryBranch); err != nil {
			conflicts := collectConflicts(primaryRoot)
			_ = gitProbe(primaryRoot, "merge", "--abort")
			_ = gitProbe(primaryRoot, "reset", "--hard", "HEAD")
			if len(conflicts) > 0 {
				return failure(conflicts, "merge"), nil
			}
			return nil, err
		}
	default:
		if _, err := runGit(asString(entry["path"]), "rebase", targetRef); err != nil {
			conflicts := collectConflicts(asString(entry["path"]))
			_ = gitProbe(asString(entry["path"]), "rebase", "--abort")
			_ = gitProbe(asString(entry["path"]), "reset", "--hard", "HEAD")
			if len(conflicts) > 0 {
				result := failure(conflicts, "rebase")
				result["message"] = fmt.Sprintf("将 %s 变基到 %s 时发生冲突（共 %d 个文件），已中止变基并恢复工作区干净", entryBranch, targetBranch, len(conflicts))
				return result, nil
			}
			return nil, err
		}
		if _, err := runGit(primaryRoot, "merge", "--ff-only", "refs/heads/"+entryBranch); err != nil {
			return nil, err
		}
	}
	clearCompletionCache(primaryRoot)
	commit := strings.TrimSpace(gitProbe(primaryRoot, "rev-parse", "--short", "HEAD"))
	label := map[string]string{"squash": "压缩合并", "merge": "合并提交", "rebase": "变基快进"}[strategy]
	message = fmt.Sprintf("已通过%s将 %s 合入 %s", label, entryBranch, targetBranch)
	if commit != "" {
		message += "（" + commit + "）"
	}
	return map[string]any{
		"ok": true, "message": message, "primaryPath": primaryRoot, "worktreePath": asString(entry["path"]),
		"worktreeBranch": entryBranch, "targetBranch": targetBranch, "strategy": strategy, "commit": commit,
	}, nil
}
