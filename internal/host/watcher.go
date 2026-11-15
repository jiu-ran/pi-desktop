package host

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

const watchDebounce = 150 * time.Millisecond

type workspaceWatcher struct {
	mu      sync.Mutex
	watcher *fsnotify.Watcher
	roots   map[string]struct{}
	emit    func(map[string]any)
	pending map[string]map[string]bool
	dirs    map[string]map[string]bool
	timer   *time.Timer
	closed  bool
}

func newWorkspaceWatcher(emit func(map[string]any)) *workspaceWatcher {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		logWarn("watch", "无法启动文件监听："+err.Error())
		return &workspaceWatcher{emit: emit, roots: map[string]struct{}{}, pending: map[string]map[string]bool{}, dirs: map[string]map[string]bool{}}
	}
	instance := &workspaceWatcher{
		watcher: w, roots: map[string]struct{}{}, emit: emit,
		pending: map[string]map[string]bool{}, dirs: map[string]map[string]bool{},
	}
	go instance.loop()
	return instance
}

func (w *workspaceWatcher) watch(root string) {
	if w.watcher == nil || root == "" {
		return
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return
	}
	w.mu.Lock()
	if _, exists := w.roots[abs]; exists {
		w.mu.Unlock()
		return
	}
	w.roots[abs] = struct{}{}
	w.mu.Unlock()
	w.addDirs(abs)
}

func (w *workspaceWatcher) addDirs(root string) {
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry == nil {
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		name := entry.Name()
		if path != root && (name == "node_modules" || name == ".git" || name == ".pi" || name == ".pi-desktop" || strings.HasPrefix(name, ".cache")) {
			return filepath.SkipDir
		}
		if w.watcher != nil {
			_ = w.watcher.Add(path)
		}
		return nil
	})
}

func (w *workspaceWatcher) loop() {
	for {
		select {
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			w.handle(event)
		case _, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
		}
	}
}

func (w *workspaceWatcher) handle(event fsnotify.Event) {
	path := event.Name
	if strings.Contains(path, string(os.PathSeparator)+"node_modules"+string(os.PathSeparator)) ||
		strings.Contains(path, string(os.PathSeparator)+".git"+string(os.PathSeparator)) {
		return
	}
	base := filepath.Base(path)
	if base == ".git" || base == ".pi-desktop" || base == "node_modules" {
		return
	}
	w.mu.Lock()
	var root string
	for candidate := range w.roots {
		if path == candidate || within(candidate, path) {
			if len(candidate) > len(root) {
				root = candidate
			}
		}
	}
	if root == "" {
		w.mu.Unlock()
		return
	}
	if event.Has(fsnotify.Create) {
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			w.addDirs(path)
		}
	}
	rel, err := filepath.Rel(root, path)
	if err == nil && rel != "." && !strings.HasPrefix(rel, "..") {
		rel = filepath.ToSlash(rel)
		if w.pending[root] == nil {
			w.pending[root] = map[string]bool{}
		}
		w.pending[root][rel] = true
		dir := filepath.ToSlash(filepath.Dir(rel))
		if w.dirs[root] == nil {
			w.dirs[root] = map[string]bool{}
		}
		for dir != "." && dir != "" && dir != "/" {
			w.dirs[root][dir] = true
			dir = filepath.ToSlash(filepath.Dir(dir))
		}
	}
	if w.timer == nil {
		w.timer = time.AfterFunc(watchDebounce, w.flush)
	}
	w.mu.Unlock()
}

func (w *workspaceWatcher) flush() {
	w.mu.Lock()
	pending, dirs := w.pending, w.dirs
	w.pending = map[string]map[string]bool{}
	w.dirs = map[string]map[string]bool{}
	w.timer = nil
	w.mu.Unlock()
	for root, paths := range pending {
		if len(paths) == 0 || w.closed {
			continue
		}
		relativePaths := make([]string, 0, len(paths))
		for path := range paths {
			relativePaths = append(relativePaths, path)
		}
		directories := []string{}
		for dir := range dirs[root] {
			directories = append(directories, dir)
		}
		if w.emit != nil {
			w.emit(map[string]any{"cwd": root, "relativePaths": relativePaths, "directories": directories})
		}
	}
}

func (w *workspaceWatcher) close() {
	w.mu.Lock()
	w.closed = true
	w.mu.Unlock()
	if w.watcher != nil {
		_ = w.watcher.Close()
	}
}
