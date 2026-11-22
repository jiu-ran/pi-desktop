package host

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

// RunSmoke 在无头/冒烟模式下加载页面、抓一张截图并退出，用来验证
// MyGo 窗口、前端资源与 WebView2 在本机确实能跑起来。
func RunSmoke(win *mygo.Window) {
	smokeCwd, _ := os.Getwd()
	smokeRepo := ""
	if os.Getenv("PI_DESKTOP_SMOKE_REPO") == "1" {
		if dir, err := os.MkdirTemp("", "pi-desktop-smoke-"); err == nil {
			smokeRepo = dir
			_ = os.WriteFile(filepath.Join(dir, "hello.txt"), []byte("hello\n"), 0o644)
			for _, args := range [][]string{{"init", "-b", "main"}, {"config", "user.name", "Smoke"}, {"config", "user.email", "smoke@example.com"}, {"add", "-A"}, {"commit", "-m", "init"}} {
				cmd := execCommand("git", args...)
				cmd.Dir = dir
				_, _ = cmd.CombinedOutput()
			}
		}
	}
	repoJSON, _ := json.Marshal(smokeRepo)
	cwdJSON, _ := json.Marshal(smokeCwd)
	cwdLiteral := string(cwdJSON)
	go func() {
		time.Sleep(3 * time.Second)
		page := win.Page()
		if page != nil {
			if title, err := page.Eval("document.title"); err == nil {
				log.Printf("smoke: title=%v", title)
			}
			if ready, err := page.Eval("Boolean(window.__piDesktop)"); err == nil {
				log.Printf("smoke: kernel=%v host=%v", ready, evalString(page, "typeof window.piDesktop"))
			}
			hostProbe := `(async () => {
				const h = window.piDesktop;
				if (!h) return "no host";
				const located = await h.locate("");
				const recent = await h.recent();
				const profiles = await h.terminalProfiles();
				const wb = window.__piDesktop?.workbench;
				// 界面恢复上次项目时 activeCwd 已经有了，但进程可能还在启动中；
				// 直接 snapshot 会撞上「这个工作区还没有启动 Pi」，所以先等 open 完成。
				let cwd = wb?.state?.activeCwd || __CWD__;
				await h.open(cwd);
				const snap = await h.snapshot(cwd, "");
				return JSON.stringify({ located, recentCount: recent.length, profiles: profiles.map(p => p.id), cwd, state: snap?.state?.sessionFile ?? null, models: snap?.models?.length ?? null, messages: snap?.messages?.length ?? null, sessions: snap?.sessions?.length ?? null });
			})()`
			if probe, err := page.Eval(strings.ReplaceAll(hostProbe, "__CWD__", cwdLiteral)); err == nil {
				log.Printf("smoke: host=%v", probe)
			} else {
				log.Printf("smoke: host probe failed: %v", err)
			}
			if os.Getenv("PI_DESKTOP_SMOKE_PTY") == "1" {
				script := `(async () => {
					const h = window.piDesktop;
					const cwd = window.__piDesktop?.workbench?.state?.activeCwd || __CWD__;
					const task = await h.startTerminalPty(cwd, 80, 24, { profileId: "cmd" });
					await new Promise((r) => setTimeout(r, 600));
					await h.writeTerminalPty(task.id, "echo hello-mygo\r");
					await new Promise((r) => setTimeout(r, 900));
					const list = await h.terminalTasks();
					const output = list.find((item) => item.id === task.id)?.output || "";
					await h.stopTerminal(task.id);
					const legacy = await h.startTerminal(cwd, "echo legacy-ok", { profileId: "cmd" });
					await new Promise((r) => setTimeout(r, 1000));
					const legacyList = await h.terminalTasks();
					const legacyOut = legacyList.find((item) => item.id === legacy.id)?.output || "";
					const shell = await h.startTerminalShell(cwd);
					await new Promise((r) => setTimeout(r, 800));
					let writeError = "";
					try { await h.writeTerminal(shell.id, "echo shell-ok"); } catch (e) { writeError = String(e?.message || e); }
					await new Promise((r) => setTimeout(r, 1200));
					const shellList = await h.terminalTasks();
					const shellTask = shellList.find((item) => item.id === shell.id);
					const shellOut = shellTask?.output || "";
					await h.stopTerminal(shell.id);
					return JSON.stringify({ pty: output.includes("hello-mygo"), legacy: legacyOut.includes("legacy-ok"), shell: shellOut.includes("shell-ok"), legacyOut: legacyOut.slice(-120), shellStatus: shellTask?.status, shellExit: shellTask?.exitCode, writeError, shellOut: shellOut.slice(-300) });
				})()`
				if result, err := page.Eval(strings.ReplaceAll(script, "__CWD__", cwdLiteral)); err == nil {
					log.Printf("smoke: pty=%v", result)
				} else {
					log.Printf("smoke: pty failed: %v", err)
				}
			}
			if os.Getenv("PI_DESKTOP_SMOKE_BASH") == "1" {
				script := `(async () => {
					const h = window.piDesktop;
					const cwd = window.__piDesktop?.workbench?.state?.activeCwd || __CWD__;
					const created = await h.call(cwd, "newSession", [], "");
					const out = await h.call(cwd, "bash", ["echo smoke-bash-ok", false], "");
					await new Promise((r) => setTimeout(r, 1200));
					const snap = await h.snapshot(cwd, "");
					return JSON.stringify({ created: Boolean(created?.sessionFile), call: out, messages: snap.messages?.length, sessions: snap.sessions?.length });
				})()`
				if result, err := page.Eval(strings.ReplaceAll(script, "__CWD__", cwdLiteral)); err == nil {
					log.Printf("smoke: bash=%v", result)
				} else {
					log.Printf("smoke: bash failed: %v", err)
				}
			}
			if os.Getenv("PI_DESKTOP_SMOKE_PROMPT") == "1" {
				script := `(async () => {
					const h = window.piDesktop;
					const cwd = window.__piDesktop?.workbench?.state?.activeCwd || __CWD__;
					await h.call(cwd, "newSession", [], "");
					let settled = false;
					const wait = new Promise((resolve) => {
						const timer = setTimeout(() => resolve("timeout"), 90000);
						const off = h.onEvent((payload) => {
							if (payload?.event?.type === "agent_settled") { settled = true; clearTimeout(timer); off(); resolve("settled"); }
						});
					});
					const call = await h.call(cwd, "prompt", ["Reply with exactly: OK"], "");
					const result = await wait;
					const snap = await h.snapshot(cwd, "");
					// 快照里的 messages 只在「会话文件还空」时才向 Pi 要，回复落盘后要从文件分页读
					const file = String(snap?.state?.sessionFile || "");
					const page = file ? await h.messagePage(cwd, file, 0, 60, 0, 0) : { messages: [] };
					const messages = (snap.messages || []).length ? snap.messages : (page.messages || []);
					const assistant = messages.filter((m) => m.role === "assistant");
					const last = assistant.length ? assistant[assistant.length - 1] : null;
					const text = Array.isArray(last?.content) ? last.content.filter((p) => p.type === "text").map((p) => p.text).join(" ") : String(last?.content || "");
					return JSON.stringify({ call, result, settled, messages: messages.length, text: text.slice(0, 200) });
				})()`
				if result, err := page.Eval(strings.ReplaceAll(script, "__CWD__", cwdLiteral)); err == nil {
					log.Printf("smoke: prompt=%v", result)
				} else {
					log.Printf("smoke: prompt failed: %v", err)
				}
			}
			if os.Getenv("PI_DESKTOP_SMOKE_UI") == "1" {
				script := `(async () => {
					const wb = window.__piDesktop?.workbench;
					if (!wb) return "no workbench";
					const cwd = __CWD__;
					await wb.open(cwd);
					await new Promise((r) => setTimeout(r, 1500));
					const ws = wb.active.value;
					let files = [];
					try { files = await wb.listDirectory(""); } catch (e) { files = [{ error: String(e?.message || e) }]; }
					const git = await wb.gitOverview().catch((e) => ({ error: String(e?.message || e) }));
					return JSON.stringify({ status: ws?.status, cwd: ws?.cwd, sessions: ws?.sessions?.length, statusText: ws?.error || null, files: files.length, fileFirst: files[0]?.name, git: git?.branch || git?.error, models: ws?.models?.length });
				})()`
				if result, err := page.Eval(strings.ReplaceAll(script, "__CWD__", cwdLiteral)); err == nil {
					log.Printf("smoke: ui=%v", result)
				} else {
					log.Printf("smoke: ui failed: %v", err)
				}
			}
			if os.Getenv("PI_DESKTOP_SMOKE_SETTINGS") == "1" {
				script := `(async () => {
					const h = window.piDesktop;
					const cwd = __CWD__;
					const result = {};
					for (const [name, fn] of Object.entries({
						tools: () => h.toolsOverview(cwd),
						models: () => h.modelDefaults(cwd),
						skills: () => h.skillsOverview(cwd),
						packages: () => h.packagesOverview(cwd),
						mcp: () => h.mcpOverview(cwd),
						trust: () => h.projectTrust(cwd),
						agents: () => h.globalAgents(),
						logs: () => h.logsInfo(),
						network: () => h.networkStatus(),
						appUpdate: () => h.checkAppUpdate({ manual: false }),
					})) {
						try { const value = await fn(); result[name] = Array.isArray(value) ? value.length : Object.keys(value || {}).length; if (name === "appUpdate") result.appUpdateValue = value; }
						catch (e) { result[name] = "ERR: " + String(e?.message || e); }
					}
					return JSON.stringify(result);
				})()`
				if result, err := page.Eval(strings.ReplaceAll(script, "__CWD__", cwdLiteral)); err == nil {
					log.Printf("smoke: settings=%v", result)
				} else {
					log.Printf("smoke: settings failed: %v", err)
				}
			}
			if os.Getenv("PI_DESKTOP_SMOKE_REPO") == "1" && smokeRepo != "" {
				script := `(async () => {
					const wb = window.__piDesktop.workbench;
					const repo = __REPO__;
					await wb.open(repo);
					await new Promise((r) => setTimeout(r, 600));
					const read = await wb.readFile("hello.txt");
					const written = await wb.writeFile("hello.txt", "changed", read.revision);
					const created = await wb.createEntry("", "new.txt", "file");
					const renamed = await wb.renameEntry("new.txt", "renamed.txt");
					const staged = await wb.gitAction("stage", { all: true });
					const committed = await wb.gitAction("commit", { message: "smoke commit" });
					const worktree = await wb.createGitWorktree("smoke-wt", {});
					const removed = await wb.removeGitWorktree(worktree.worktree.path, { deleteBranch: true });
					const files = await wb.listDirectory("");
					return JSON.stringify({ read: read.content, written: written.content, created: created.name, renamed: renamed.name, staged: staged.ok, committed: committed.message, worktree: worktree.worktree?.branch, removed: removed.ok, files: files.map((f) => f.name) });
				})()`
				if result, err := page.Eval(strings.ReplaceAll(strings.ReplaceAll(script, "__CWD__", cwdLiteral), "__REPO__", string(repoJSON))); err == nil {
					log.Printf("smoke: repo=%v", result)
				} else {
					log.Printf("smoke: repo failed: %v", err)
				}
			}
			if png, err := win.CapturePage(); err == nil {
				out := filepath.Join(os.TempDir(), "pi-desktop-mygo-smoke.png")
				if err := os.WriteFile(out, png, 0o644); err == nil {
					fmt.Printf("smoke: screenshot %s (%d bytes)\n", out, len(png))
				}
			} else {
				log.Printf("smoke: capture failed: %v", err)
			}
		}
		win.Close()
		if smokeRepo != "" {
			_ = os.RemoveAll(smokeRepo)
		}
		time.AfterFunc(2*time.Second, func() { mygo.App.Quit() })
	}()
}

func execCommand(name string, args ...string) *exec.Cmd { return exec.Command(name, args...) }

func evalString(page *mygo.Page, code string) string {
	value, err := page.Eval(code)
	if err != nil {
		return "error: " + err.Error()
	}
	return fmt.Sprint(value)
}
