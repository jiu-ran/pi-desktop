import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";

export interface TerminalShellProfile {
  id: string;
  label: string;
  file: string;
  args: string[];
  source: "system" | "detected" | "custom";
}

export interface TerminalPtyOptions {
  profileId?: string;
  customPath?: string;
  customArgs?: string[];
}

interface ProfileContext {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  loginShell?: string;
}

/** 终端模拟器与 shell 是不同概念；系统默认项解析系统的命令解释器。 */
export function systemShellCandidate({
  platform = process.platform,
  env = process.env,
  loginShell,
}: ProfileContext = {}): { file: string; args: string[]; label: string } {
  if (platform === "win32") {
    return {
      file: env.ComSpec || env.COMSPEC || path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
      args: [],
      label: "CMD",
    };
  }
  const file = env.SHELL || loginShell || (platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  return { file, args: ["-l"], label: path.posix.basename(file) || "shell" };
}

async function executable(candidate: string, platform: NodeJS.Platform): Promise<string | null> {
  if (!candidate || /[\0\r\n]/.test(candidate)) return null;
  try {
    const resolved = await realpath(candidate);
    if (!(await stat(resolved)).isFile()) return null;
    if (platform === "win32" && !/\.exe$/i.test(resolved)) return null;
    await access(resolved, platform === "win32" ? constants.F_OK : constants.X_OK);
    return resolved;
  } catch {
    return null;
  }
}

async function findExecutable(command: string, context: Required<Pick<ProfileContext, "platform" | "env">>): Promise<string | null> {
  const pathApi = context.platform === "win32" ? path.win32 : path.posix;
  if (pathApi.isAbsolute(command)) return executable(command, context.platform);
  const dirs = (context.env.PATH || context.env.Path || "").split(context.platform === "win32" ? ";" : ":");
  for (const dir of dirs) {
    // 不从当前工作目录加载同名文件；仅使用已配置的 PATH 目录。
    const clean = dir.trim().replace(/^"|"$/g, "");
    if (!pathApi.isAbsolute(clean)) continue;
    const file = await executable(pathApi.join(clean, command), context.platform);
    if (file) return file;
  }
  return null;
}

/** 只检查本机可执行文件，不运行 shell，也不修改系统设置。 */
export async function listTerminalProfiles(context: ProfileContext = {}): Promise<TerminalShellProfile[]> {
  const platform = context.platform || process.platform;
  const env = context.env || process.env;
  let loginShell = context.loginShell;
  if (platform !== "win32" && !loginShell) {
    try { loginShell = userInfo().shell || ""; } catch { /* 使用 SHELL / 平台回退 */ }
  }
  const profiles: TerminalShellProfile[] = [];
  const add = async (id: string, label: string, candidates: string[], args: string[], source: TerminalShellProfile["source"] = "detected") => {
    for (const candidate of candidates) {
      const file = await findExecutable(candidate, { platform, env });
      if (!file) continue;
      profiles.push({ id, label, file, args, source });
      return file;
    }
    return null;
  };
  const system = systemShellCandidate({ platform, env, loginShell });
  const systemFile = await add("system", `系统默认 · ${system.label}`, [system.file], system.args, "system");
  if (platform === "win32") {
    await add("pwsh", "PowerShell 7 (pwsh)", ["pwsh.exe", path.win32.join(env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe")], ["-NoLogo"]);
    await add("powershell", "Windows PowerShell", [env.PI_DESKTOP_POWERSHELL || "powershell.exe", path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")], ["-NoLogo"]);
    const git = await findExecutable("git.exe", { platform, env });
    const roots = [
      ...(git ? [path.win32.resolve(path.win32.dirname(git), "../.."), path.win32.resolve(path.win32.dirname(git), "..")] : []),
      path.win32.join(env.ProgramFiles || "C:\\Program Files", "Git"),
      ...(env.LOCALAPPDATA ? [path.win32.join(env.LOCALAPPDATA, "Programs", "Git")] : []),
      ...(env["ProgramFiles(x86)"] ? [path.win32.join(env["ProgramFiles(x86)"], "Git")] : []),
    ];
    const bashInPath = await findExecutable("bash.exe", { platform, env });
    if (bashInPath && /[\\/]Git[\\/]/i.test(bashInPath)) {
      roots.unshift(path.win32.resolve(path.win32.dirname(bashInPath), "../.."));
    }
    await add("git-bash", "Git Bash", [...new Set(roots)].map((root) => path.win32.join(root, "bin", "bash.exe")), ["--login", "-i"]);
    await add("cmd", "CMD", [env.ComSpec || env.COMSPEC || "cmd.exe"], []);
  } else {
    await add("zsh", "Zsh", ["zsh", "/bin/zsh", "/usr/bin/zsh"], ["-l"]);
    await add("bash", "Bash", ["bash", "/bin/bash", "/usr/bin/bash"], ["-l"]);
    await add("fish", "Fish", ["fish", "/usr/local/bin/fish", "/usr/bin/fish", "/opt/homebrew/bin/fish"], ["-l"]);
    await add("pwsh", "PowerShell (pwsh)", ["pwsh", "/usr/local/bin/pwsh", "/opt/homebrew/bin/pwsh"], ["-NoLogo"]);
    await add("sh", "POSIX sh", ["sh", "/bin/sh"], ["-l"]);
  }
  if (!systemFile) {
    const fallback = profiles.find((profile) => profile.id === (platform === "win32" ? "cmd" : "sh")) || profiles[0];
    if (fallback) profiles.unshift({ ...fallback, id: "system", label: `系统默认 · ${fallback.label}（回退）`, source: "system" });
  }
  return profiles;
}

/** 一次性后台命令也使用用户选择的 shell，不把 Git Bash 命令交给 PowerShell 解释。 */
export function commandForTerminalProfile(profile: TerminalShellProfile, command: string, platform = process.platform): {
  file: string; args: string[]; label: string; windowsVerbatimArguments?: boolean;
} {
  const base = (platform === "win32" ? path.win32 : path.posix).basename(profile.file).toLowerCase();
  if (/^(?:powershell|pwsh)(?:\.exe)?$/.test(base)) {
    const trimmed = command.trimStart();
    const body = /^["']/.test(trimmed) ? `& ${trimmed}` : trimmed;
    return {
      file: profile.file,
      label: profile.label,
      args: [...profile.args, "-NonInteractive", "-Command", `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [Console]::OutputEncoding; ${body}; exit $LASTEXITCODE`],
    };
  }
  if (platform === "win32" && base === "cmd.exe") {
    // /S /C 最外层引号由 cmd 消费，内部的带空格路径保持原样；不能让 Node
    // 把它改写为反斜杠引号。用户命令本身是明确要交给 shell 执行的内容。
    return {
      file: profile.file,
      label: profile.label,
      args: [...profile.args, "/D", "/S", "/C", `"chcp 65001 >nul & ${command}"`],
      windowsVerbatimArguments: true,
    };
  }
  return {
    file: profile.file,
    label: profile.label,
    args: [...profile.args.filter((arg) => arg !== "-i" && arg !== "--interactive"), "-c", command],
  };
}

/** 只允许已发现的配置 ID；自定义 shell 必须为明确存在的绝对可执行路径。 */
export async function resolveTerminalProfile(options: TerminalPtyOptions = {}): Promise<TerminalShellProfile> {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("无效的终端配置");
  const id = options.profileId || "system";
  if (typeof id !== "string" || id.length > 80) throw new Error("无效的终端配置");
  if (id === "custom") {
    const file = typeof options.customPath === "string" ? options.customPath.trim() : "";
    if (!file || file.length > 4000 || !path.isAbsolute(file) || /[\0\r\n]/.test(file)) {
      throw new Error("自定义终端需要填写可执行文件的绝对路径");
    }
    const args = options.customArgs ?? [];
    if (!Array.isArray(args) || args.length > 64 || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))
      || args.reduce((total, arg) => total + arg.length, 0) > 32_000) {
      throw new Error("终端启动参数必须是字符串数组（最多 64 项 / 32000 个字符）");
    }
    const resolved = await executable(file, process.platform);
    if (!resolved) throw new Error("自定义终端文件不存在或不可执行（Windows 请选择 .exe，而不是 .cmd / .bat）");
    if (process.platform === "win32" && /^git-bash\.exe$/i.test(path.basename(resolved))) {
      throw new Error("Git Bash 请选择安装目录下的 bin/bash.exe，而不是会打开外部窗口的 git-bash.exe 启动器");
    }
    return { id, label: path.basename(resolved), file: resolved, args: [...args], source: "custom" };
  }
  const profiles = await listTerminalProfiles();
  const profile = profiles.find((item) => item.id === id);
  if (!profile) throw new Error(`终端「${id}」未安装或路径已失效，请在设置中重新选择`);
  return profile;
}
