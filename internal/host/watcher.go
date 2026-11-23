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
	// watched 记每个 root 真正加给 fsnotify 的目录，unwatch 时要按它 Remove，
	// 否则句柄会一直留着。
	watched map[string]map[string]bool
	timer   *time.Timer
	closed  bool
}

func newWorkspaceWatcher(emit func(map[string]any)) *workspaceWatcher {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		logWarn("watch", "无法启动文件监听："+err.Error())
		return &workspaceWatcher{emit: emit, roots: map[string]struct{}{}, pending: map[string]map[string]bool{}, dirs: map[string]map[string]bool{}, watched: map[string]map[string]bool{}}
	}
	instance := &workspaceWatcher{
		watcher: w, roots: map[string]struct{}{}, emit: emit,
		pending: map[string]map[string]bool{}, dirs: map[string]map[string]bool{},
		watched: map[string]map[string]bool{},
	}
	go instance.loop()
	return instance
}

func (w *workspaceWatcher) watch(root string) {
	if w.watcher == nil || root == "" {
		return
	}
	// 键必须用真实路径：macOS 的 /var → /private/var、Windows 的 8.3 短名都会让「同一个
	// 目录的两种写法」对上两个键，watch 全部监听、unwatch 一个也删不掉。
	abs := canonicalPath(root)
	w.mu.Lock()
	if _, exists := w.roots[abs]; exists {
		w.mu.Unlock()
		return
	}
	w.roots[abs] = struct{}{}
	w.mu.Unlock()
	w.addDirs(abs, abs)
}

func (w *workspaceWatcher) unwatch(root string) {
	if root == "" {
		return
	}
	abs := canonicalPath(root)
	w.mu.Lock()
	delete(w.roots, abs)
	delete(w.pending, abs)
	delete(w.dirs, abs)
	watched := w.watched[abs]
	delete(w.watched, abs)
	w.mu.Unlock()
	// 以前只删 map，不 Remove：fsnotify 会一直留着目录句柄，项目关得越多句柄越多。
	if w.watcher != nil {
		for dir := range watched {
			_ = w.watcher.Remove(dir)
		}
	}
}

// addDirs 把 walkFrom 及其子目录加进 fsnotify，并登记到所属的 root 下。
// root 与 walkFrom 分开传：新建子目录时 walkFrom 不是 root，以前把它当 root 登记，
// 结果 w.roots 里找不到它，刚加上的监听立刻被当作「已失效」又 Remove 掉。
func (w *workspaceWatcher) addDirs(root, walkFrom string) {
	added := []string{}
	_ = filepath.WalkDir(walkFrom, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry == nil {
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		name := entry.Name()
		if path != walkFrom && (name == "node_modules" || name == ".git" || name == ".pi" || name == ".pi-desktop" || strings.HasPrefix(name, ".cache")) {
			return filepath.SkipDir
		}
		if w.watcher != nil {
			if addErr := w.watcher.Add(path); addErr == nil {
				added = append(added, path)
			}
		}
		return nil
	})
	w.mu.Lock()
	if _, alive := w.roots[root]; alive && len(added) > 0 {
		if w.watched[root] == nil {
			w.watched[root] = map[string]bool{}
		}
		for _, dir := range added {
			w.watched[root][dir] = true
		}
		added = nil
	}
	w.mu.Unlock()
	// Walk 期间这个 root 被 unwatch 了：把刚加进去的目录再撤掉，不留句柄。
	for _, dir := range added {
		if w.watcher != nil {
			_ = w.watcher.Remove(dir)
		}
	}
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
	grow := ""
	if event.Has(fsnotify.Create) {
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			grow = path
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
	// 新目录的内容在锁外补加：WalkDir + fsnotify.Add 在消费 Events 的同一个
	// goroutine 里跑，大目录会长时间占着 m.mu，事件队列堆满后连 Remove 都拿不到锁。
	if grow != "" {
		go w.addDirs(root, grow)
	}
}

func (w *workspaceWatcher) flush() {
	w.mu.Lock()
	closed := w.closed
	pending, dirs := w.pending, w.dirs
	w.pending = map[string]map[string]bool{}
	w.dirs = map[string]map[string]bool{}
	w.timer = nil
	w.mu.Unlock()
	if closed {
		return
	}
	for root, paths := range pending {
		if len(paths) == 0 {
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
	already := w.closed
	w.closed = true
	w.mu.Unlock()
	if !already && w.watcher != nil {
		_ = w.watcher.Close()
	}
}
