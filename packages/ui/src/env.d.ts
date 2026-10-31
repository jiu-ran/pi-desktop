declare module "*.vue" {
  const component: any;
  export default component;
}

declare module "*.css" {}

declare module "markstream-vue" {
  import type { DefineComponent } from "vue";

  export interface MermaidBlockNodeProps {
    maxHeight?: string | null;
    estimatedPreviewHeightPx?: number;
    workerTimeoutMs?: number;
    parseTimeoutMs?: number;
    renderTimeoutMs?: number;
    fullRenderTimeoutMs?: number;
    renderDebounceMs?: number;
    contentStableDelayMs?: number;
    previewPollDelayMs?: number;
    previewPollMaxDelayMs?: number;
    previewPollMaxAttempts?: number;
    showHeader?: boolean;
    showModeToggle?: boolean;
    showCopyButton?: boolean;
    showExportButton?: boolean;
    showFullscreenButton?: boolean;
    showCollapseButton?: boolean;
    showZoomControls?: boolean;
    enableWheelZoom?: boolean;
    isStrict?: boolean;
    enableMermaidInteractions?: boolean;
    showTooltips?: boolean;
    fitPreviewHeight?: boolean;
    onRenderError?: (error: unknown, code: string, container: HTMLElement) => boolean | void;
  }

  export interface MarkdownRenderProps {
    mode?: "docs" | "chat" | "minimal";
    content?: string;
    final?: boolean;
    isDark?: boolean;
    viewportPriority?: boolean;
    codeBlockProps?: Record<string, unknown>;
    mermaidProps?: Partial<MermaidBlockNodeProps>;
  }

  const MarkdownRender: DefineComponent<MarkdownRenderProps>;
  export default MarkdownRender;
  export function enableMermaid(loader?: () => Promise<unknown> | unknown): void;
  export function disableMermaid(): void;
  export function isMermaidEnabled(): boolean;
  export function setMermaidWorker(worker: Worker): void;
  export function clearMermaidWorker(): void;
  export function terminateWorker(): void;
}

export interface WorkspaceEntry {
  path: string;
  relative: string;
  name: string;
  kind: "folder" | "file";
}

/** 跨项目会话摘要（其它项目的对话） */
export interface CrossProjectSessionSummary {
  id: string;
  path: string;
  title: string;
  empty: boolean;
  timestamp: number;
  /** 会话所属项目目录 */
  cwd: string;
  /** 项目目录名 */
  project: string;
}

/** 日志目录概览（设置页展示 / 清理按钮） */
export interface LogSummary {
  dir: string;
  totalBytes: number;
  files: Array<{ name: string; size: number; mtimeMs: number }>;
  /** 当前总量上限（字节） */
  limitBytes?: number;
  /** 单文件上限（字节） */
  fileBytes?: number;
  /** 最多保留多少个文件 */
  keepFiles?: number;
  /** 可选档位（MB） */
  choicesMb?: number[];
}

/** @ 引用对话时，主进程回传的会话上下文条目 */
export interface SessionAttachmentItem {
  /** 会话文件绝对路径 */
  path: string;
  /** 会话名称（没起名时取第一段用户文字） */
  name: string;
  kind: "session";
  size: number;
  inlined: boolean;
  /** 这个会话共有多少条消息 */
  messages: number;
}

export interface WorkspaceFileData {
  path: string;
  relative: string;
  name: string;
  content: string;
  size: number;
  revision?: string;
  /** 图片等二进制文件的预览内容（data URL） */
  preview?: { mimeType: string; dataUrl: string };
  /** 非文本文件：只读，不能保存 */
  binary?: boolean;
}

export interface GitStatusFile {
  code: string;
  index: string;
  worktree: string;
  path: string;
  untracked: boolean;
}

export interface GitCommitNode {
  hash: string;
  shortHash: string;
  graph: string;
  subject: string;
  author: string;
  relativeTime: string;
  refs: string;
}

export interface GitOverview {
  isRepo: boolean;
  root: string;
  branch: string;
  detached: boolean;
  upstream: string;
  ahead: number;
  behind: number;
  hasCommits: boolean;
  canWrite: boolean;
  hasRemote: boolean;
  status: GitStatusFile[];
  commits: GitCommitNode[];
  userName: string;
  userEmail: string;
  worktreeRoot?: string;
  repoKey?: string;
}

export interface GitBranch {
  ref: string;
  name: string;
  remote: boolean;
  current: boolean;
  hash: string;
  subject: string;
  upstream: string;
  tracking: string;
  worktreePath: string;
}

export type GitActionName = "init" | "stage" | "unstage" | "commit" | "fetch" | "pull" | "push" | "switchBranch" | "createBranch" | "deleteBranch";

export interface GitActionPayload {
  paths?: string[];
  all?: boolean;
  message?: string;
  branch?: string;
  localName?: string;
  startPoint?: string;
  force?: boolean;
}

export interface GitActionResult {
  ok: boolean;
  message: string;
  overview: GitOverview;
}

export interface GitInspectResult {
  kind: "commit" | "working" | "staged" | "unstaged";
  target: string;
  title: string;
  subtitle: string;
  meta: string;
  diff: string;
}

export type GitWorktreeMergeStrategy = "squash" | "merge" | "rebase";

export interface GitWorktree {
  path: string;
  branch: string;
  head: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  /** Git 的主工作区（仓库根目录） */
  primary: boolean;
  /** 由 Pi Desktop 创建、可以安全移除的隔离工作区 */
  managed: boolean;
  exists: boolean;
  /** 创建时记录的目标基础分支（合并时默认回到该分支） */
  baseBranch?: string;
  /** 创建时所基于的起点（分支名或提交短哈希） */
  baseRef?: string;
  /** 创建时的起点提交哈希 */
  baseCommit?: string;
  /** 工作区是否有未提交或未跟踪改动 */
  dirty?: boolean;
  /** 相对目标基础分支领先的提交数（待合并提交数） */
  ahead?: number;
  /** 相对目标基础分支落后的提交数 */
  behind?: number;
}

export interface GitWorktreeCreateOptions {
  /** 分支策略：create（新建分支，默认）/ existing（检出已有本地或远程分支） */
  branchMode?: "create" | "existing";
  /** 自定义分支名称（create 模式下为新分支名，如 "feat/login"；existing 检出远程分支时为本地跟踪分支名） */
  branchName?: string;
  /** existing 模式下要检出的已有分支（完整 ref 或分支名） */
  existingBranch?: string;
  /** 起点引用：本地分支、远程分支或提交哈希（省略时为当前 HEAD） */
  startPoint?: string;
  /** 合并回的目标基础分支（省略时取起点对应的本地分支或主工作区当前分支；传空字符串 "" 表示暂不绑定） */
  baseBranch?: string;
  /** 自定义 Worktree 存放的目标目录绝对路径（省略时使用默认托管目录） */
  targetDir?: string;
  /** 创建后要复制迁移到新 Worktree 的源会话文件路径（.jsonl） */
  sourceSessionFile?: string;
}

export interface GitWorktreeCreateResult {
  ok: true;
  message: string;
  worktree: GitWorktree;
  /** 当传入 sourceSessionFile 时，返回复制到新 Worktree 会话目录后的新会话文件路径 */
  sessionFile?: string;
}

export interface GitWorktreeRemoveOptions {
  /** 移除隔离工作区目录后，是否同时删除对应的本地分支 */
  deleteBranch?: boolean;
}

export interface GitWorktreeRemoveResult {
  ok: true;
  message: string;
  branch: string;
  path: string;
  branchDeleted?: boolean;
}

export interface GitWorktreeMergeOptions {
  /** 要合并的隔离工作区路径 */
  worktreePath: string;
  /** 目标本地分支（省略时使用该工作区记录的 baseBranch 或主工作区当前分支） */
  targetBranch?: string;
  /** 合并方式：squash（压缩成一个提交）/ merge（合并提交）/ rebase（变基后快进） */
  strategy?: GitWorktreeMergeStrategy;
  /** 提交说明（用于 squash 或 merge 方式；省略时自动生成） */
  message?: string;
}

export interface GitWorktreeMergeResult {
  ok: boolean;
  conflict?: boolean;
  conflicts?: string[];
  message: string;
  /** 主工作区目录（合并执行位置） */
  primaryPath: string;
  /** 隔离工作区目录 */
  worktreePath: string;
  /** 隔离工作区分支 */
  worktreeBranch: string;
  /** 合并目标分支 */
  targetBranch: string;
  /** 合并方式 */
  strategy: GitWorktreeMergeStrategy;
  /** 合并后主工作区 HEAD 短哈希 */
  commit?: string;
}

export interface GitCloneResult {
  ok: true;
  /** 克隆完成的目录（绝对路径） */
  path: string;
  message: string;
}

export type McpExposureMode = "codemode" | "deferred" | "direct" | "hidden";

export interface McpServerItem {
  name: string;
  scope: "global" | "project";
  sourcePath: string;
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  auth?: { provider: string };
  oauth?: Record<string, any>;
  enabled: boolean;
  exposure: McpExposureMode;
  description?: string;
  timeout?: number;
  state?: string;
  tools?: string[];
  error?: string;
  resources?: boolean;
}

export interface McpOverview {
  agentDir: string;
  globalConfigPath: string;
  projectConfigPath: string;
  autoEnableCodemode: boolean;
  servers: McpServerItem[];
  errors: string[];
}

export interface PiPackageItem {
  source: string;
  scope: "user" | "project";
  kind: "npm" | "git" | "local";
  displayName: string;
  version?: string;
  description?: string;
  installed: boolean;
  installedPath?: string;
  filtered: boolean;
  counts: {
    extensions: number;
    skills: number;
    prompts: number;
    themes: number;
  };
}

export interface PiResourceItem {
  path: string;
  name: string;
  type: "extensions" | "skills" | "prompts" | "themes";
  enabled: boolean;
  scope: "user" | "project";
  origin: "package" | "top-level";
  source: string;
}

export interface PiPackagesOverview {
  agentDir: string;
  globalSettingsPath: string;
  projectSettingsPath: string;
  packages: PiPackageItem[];
  resources: PiResourceItem[];
}

export interface PiSkillItem {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  scope: "user" | "project";
  origin: "package" | "top-level";
  source: string;
  disableModelInvocation: boolean;
}

export interface PiSkillDirectory {
  label: string;
  path: string;
}

export interface PiSkillsOverview {
  agentDir: string;
  globalSkillsDir: string;
  projectSkillsDir: string;
  directories: PiSkillDirectory[];
  skills: PiSkillItem[];
  diagnostics: string[];
}

export interface PiLocation {
  found: boolean;
  version: string;
  /** 本机 pi 可执行文件的解析路径，找不到为空 */
  path: string;
}

export interface AppUpdateCheck {
  current: string;
  latest: string;
  updateAvailable: boolean;
  url: string;
  assetName: string;
  error?: string;
}

export interface PreparedAppUpdate {
  version: string;
  url: string;
  assetName: string;
  filePath: string;
}

export interface PiUpdateCheck {
  current: string;
  latest: string;
  updateAvailable: boolean;
  error?: string;
}

export interface PiUpdateResult {
  ok: boolean;
  from: string;
  to: string;
  log: string;
}

export type TerminalTaskStatus = "running" | "stopping" | "exited" | "failed" | "stopped";

export interface TerminalTaskInfo {
  id: string;
  command: string;
  cwd: string;
  pid?: number;
  shell: string;
  startedAt: number;
  endedAt?: number;
  status: TerminalTaskStatus;
  exitCode?: number | null;
  signal?: string | null;
  /** 交互式会话会保持 stdin 打开，支持逐行发送输入。 */
  interactive?: boolean;
  /** 使用真实伪终端（PTY）承载全屏 TUI 与终端级信号。 */
  pty?: boolean;
  cols?: number;
  rows?: number;
  profileId?: string;
  shellPath?: string;
}

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

export interface TerminalTaskSnapshot extends TerminalTaskInfo {
  output: string;
  truncated: boolean;
}

export type TerminalEvent =
  | { type: "start"; task: TerminalTaskInfo }
  | { type: "data"; id: string; stream: "stdout" | "stderr"; text: string }
  | { type: "status"; task: TerminalTaskInfo }
  | { type: "exit"; id: string; status: TerminalTaskStatus; exitCode?: number | null; signal?: string | null; endedAt: number };

export interface PiDesktopBridge {
  platform: string;
  getPathForFile?: (file: File) => string;
  /** 窗口底色（无边框窗口缩放 / 首帧会露出来） */
  setWindowBackground: (color: string) => Promise<boolean>;
  /** 自绘窗口按钮（Windows / Linux；macOS 用系统红绿灯，不暴露） */
  windowControls: {
    minimize: () => Promise<boolean>;
    toggleMaximize: () => Promise<boolean>;
    close: () => Promise<boolean>;
    state: () => Promise<{ maximized: boolean; fullscreen: boolean }>;
    onChange: (listener: (state: { maximized: boolean; fullscreen: boolean }) => void) => () => void;
  };
  /** customPath 为空时只从 PATH 自动识别；传入则直接校验该路径 */
  locate: (customPath?: string) => Promise<PiLocation>;
  setZoomFactor: (factor: number) => Promise<number>;
  checkPiUpdate: (customPath?: string) => Promise<PiUpdateCheck>;
  checkAppUpdate: (options?: { manual?: boolean }) => Promise<AppUpdateCheck>;
  downloadAppUpdate: () => Promise<PreparedAppUpdate>;
  cancelAppUpdate: () => boolean;
  /** 读取系统剪贴板文本（终端 Ctrl+V 粘贴用，主进程读取避免渲染进程权限差异）。 */
  readClipboard: () => Promise<string>;
  installAppUpdate: (version: string) => Promise<void>;
  openAppUpdate: (url: string) => Promise<boolean>;
  /** scope: self = pi update（默认）；all = pi update --all */
  updatePi: (customPath?: string, scope?: "self" | "all") => Promise<PiUpdateResult>;
  recent: () => Promise<string[]>;
  forget: (cwd: string) => Promise<string[]>;
  chooseDirectory: () => Promise<string | null>;
  chooseFiles: () => Promise<string[]>;
  savePastedImage: (payload: { name?: string; mimeType?: string; data: string }) => Promise<string>;
  chooseFolder: () => Promise<string | null>;
  open: (cwd: string) => Promise<any>;
  snapshot: (cwd: string, sessionFile?: string) => Promise<any>;
  prepareAttachments: (cwd: string, paths: string[], authorizePaths?: string[]) => Promise<any>;
  /** 渲染进程卡顿上报（主进程记到 logs/perf.log） */
  reportLongTask?: (ms: number, label?: string) => void;
  /** 前端日志持久化（logs/renderer.log） */
  logEvent?: (level: "debug" | "info" | "warn" | "error", scope: string, message: string) => void;

  logsInfo?: () => Promise<LogSummary>;
  /** 调整运行日志总量上限（字节），立刻生效 */
  setLogLimit?: (bytes: number) => Promise<LogSummary>;
  logsClear?: () => Promise<LogSummary>;
  logsOpen?: () => Promise<boolean>;
  logsReveal?: () => Promise<boolean>;
  /** 告诉主进程当前项目：日志写在 <项目>/.pi-desktop/logs */

  /** 跨项目会话列表（@ 引用其它项目对话） */
  crossProjectSessions?: (limit?: number) => Promise<CrossProjectSessionSummary[]>;
  /** @ 引用对话：把别的会话压成上下文块 */
  prepareSessionAttachments: (cwd: string, files: string[]) => Promise<{
    items: SessionAttachmentItem[];
    text: string;
    images: any[];
  }>;
  listDirectory: (cwd: string, relative: string) => Promise<WorkspaceEntry[]>;
  readWorkspaceFile: (cwd: string, relative: string) => Promise<WorkspaceFileData>;
  /** 用系统浏览器打开 http(s) / mailto 链接（markdown 里 Ctrl+点击） */
  openExternalUrl?: (url: string) => Promise<boolean>;
  writeWorkspaceFile: (cwd: string, relative: string, content: string, revision?: string) => Promise<WorkspaceFileData>;
  openWorkspacePath: (cwd: string, relative: string) => Promise<string>;
  createWorkspaceEntry: (cwd: string, parent: string, name: string, kind: "file" | "folder") => Promise<WorkspaceEntry>;
  renameWorkspaceEntry: (cwd: string, relative: string, name: string) => Promise<WorkspaceEntry>;
  deleteWorkspaceEntry: (cwd: string, relative: string) => Promise<void>;
  gitOverview: (cwd: string) => Promise<GitOverview>;
  gitBranches: (cwd: string) => Promise<GitBranch[]>;
  gitInspect: (cwd: string, kind: "commit" | "working" | "staged" | "unstaged", target: string) => Promise<GitInspectResult>;
  gitAction: (cwd: string, action: GitActionName, payload?: GitActionPayload) => Promise<GitActionResult>;
  gitWorktrees: (cwd: string) => Promise<GitWorktree[]>;
  gitWorktreeCreate: (cwd: string, name: string, options?: GitWorktreeCreateOptions) => Promise<GitWorktreeCreateResult>;
  gitWorktreeRemove: (cwd: string, target: string, options?: GitWorktreeRemoveOptions) => Promise<GitWorktreeRemoveResult>;
  gitWorktreeMerge: (cwd: string, options: GitWorktreeMergeOptions) => Promise<GitWorktreeMergeResult>;
  gitClone: (url: string, target: string) => Promise<GitCloneResult>;
  completePaths: (cwd: string, query: string) => Promise<WorkspaceEntry[]>;
  restart: (cwd: string, sessionFile?: string) => Promise<any>;
  sessions: (cwd: string) => Promise<any[]>;
  messagePage: (
    cwd: string,
    file: string,
    endIndex?: number,
    limit?: number,
    minTurns?: number,
    minBlocks?: number,
  ) => Promise<{ messages: any[]; startIndex: number; endIndex: number; total: number }>;
  deleteSession: (cwd: string, file: string) => Promise<any[]>;
  /** 项目信任状态（Pi 在 RPC 模式下拿不到回答，默认按不信任处理） */
  projectTrust: (cwd: string) => Promise<{
    cwd: string;
    decision: boolean | null;
    recordedAt: string;
    needsTrust: boolean;
    effective: boolean;
  }>;
  setProjectTrust: (
    cwd: string,
    action: "trust" | "trust-parent" | "distrust",
  ) => Promise<{ cwd: string; decision: boolean | null; recordedAt: string; needsTrust: boolean; effective: boolean }>;
  importSession: (cwd: string, file: string) => Promise<{ path: string; title: string }>;
  exportSessionJsonl: (cwd: string, target?: string) => Promise<{ path: string }>;
  removeProject: (cwd: string, options?: { deleteSessions?: boolean }) => Promise<any>;
  call: (cwd: string, method: string, args?: any[], sessionFile?: string) => Promise<any>;
  respondExtensionUi: (cwd: string, response: Record<string, any>, sessionFile?: string) => Promise<any>;
  reveal: (target: string) => Promise<void>;
  mcpOverview: (cwd?: string) => Promise<McpOverview>;
  mcpProbe: (cwd?: string) => Promise<McpOverview>;
  /** OAuth 登录 / 退出登录：转发给本机 `pi mcp login|logout`，授权在浏览器里完成 */
  mcpLogin: (cwd: string | undefined, name: string) => Promise<{ output: string }>;
  mcpLogout: (cwd: string | undefined, name: string) => Promise<{ output: string }>;
  mcpSaveServer: (
    cwd: string,
    payload: { scope: "global" | "project"; name: string; previousName?: string; config: Record<string, any> },
  ) => Promise<McpOverview>;
  mcpUpdateServer: (
    cwd: string,
    payload: { scope: "global" | "project"; name: string; patch: { enabled?: boolean; exposure?: McpExposureMode } },
  ) => Promise<McpOverview>;
  mcpRemoveServer: (cwd: string, payload: { scope: "global" | "project"; name: string }) => Promise<McpOverview>;
  mcpSetAutoCodemode: (cwd: string, payload: { scope?: "global" | "project"; enabled: boolean }) => Promise<McpOverview>;
  mcpImportJson: (cwd: string, payload: { scope: "global" | "project"; jsonText: string }) => Promise<McpOverview>;
  packagesOverview: (cwd?: string) => Promise<PiPackagesOverview>;
  packagesInstall: (cwd: string, payload: { source: string; local?: boolean }) => Promise<PiPackagesOverview>;
  packagesRemove: (cwd: string, payload: { source: string; local?: boolean }) => Promise<PiPackagesOverview>;
  packagesUpdate: (cwd: string, payload?: { source?: string }) => Promise<PiPackagesOverview>;
  skillsOverview: (cwd?: string) => Promise<PiSkillsOverview>;
  globalAgents: () => Promise<{ path: string; content: string }>;
  saveGlobalAgents: (content: string) => Promise<{ path: string; content: string }>;
  startTerminal: (cwd: string, command: string, options?: TerminalPtyOptions) => Promise<TerminalTaskInfo>;
  /** 启动真实 PTY 终端（全屏 TUI、Ctrl+C 等）；cols/rows 为初始尺寸。 */
  startTerminalPty: (cwd: string, cols?: number, rows?: number, options?: TerminalPtyOptions) => Promise<TerminalTaskInfo>;
  terminalProfiles: () => Promise<TerminalShellProfile[]>;
  chooseTerminalExecutable: () => Promise<string | null>;
  validateTerminalProfile: (options: TerminalPtyOptions) => Promise<TerminalShellProfile>;
  startTerminalShell: (cwd: string) => Promise<TerminalTaskInfo>;
  writeTerminal: (id: string, input: string) => Promise<boolean>;
  writeTerminalPty: (id: string, data: string, binary?: boolean) => Promise<boolean>;
  resizeTerminalPty: (id: string, cols: number, rows: number) => Promise<boolean>;
  /** PTY 聚焦时禁止 Electron 菜单快捷键吞掉 Ctrl+W / Ctrl+R 等终端按键。 */
  setTerminalFocus: (focused: boolean) => Promise<boolean>;
  stopTerminal: (id: string) => Promise<boolean>;
  terminalTasks: () => Promise<TerminalTaskSnapshot[]>;
  onTerminalEvent: (listener: (payload: TerminalEvent) => void) => () => void;
  onEvent: (listener: (payload: { cwd: string; sessionFile?: string; event: any }) => void) => () => void;
}

declare global {
  interface Window {
    piDesktop?: PiDesktopBridge;
    __piDesktop?: any;
  }
}
