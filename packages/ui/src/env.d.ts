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

export interface WorkspaceFileData {
  path: string;
  relative: string;
  name: string;
  content: string;
  size: number;
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
}

export type GitActionName = "init" | "stage" | "unstage" | "commit" | "fetch" | "pull" | "push";

export interface GitActionPayload {
  paths?: string[];
  all?: boolean;
  message?: string;
}

export interface GitActionResult {
  ok: boolean;
  message: string;
  overview: GitOverview;
}

export interface GitInspectResult {
  kind: "commit" | "working";
  target: string;
  title: string;
  subtitle: string;
  meta: string;
  diff: string;
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
  scope: "user" | "project" | "temporary";
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
  scope: "user" | "project" | "temporary";
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

export interface PiUpdateRecord {
  from: string;
  to: string;
  at: number;
  log: string;
}

export interface PiDesktopBridge {
  platform: string;
  getPathForFile?: (file: File) => string;
  setTitleBar: (colors: { color: string; symbolColor: string }) => Promise<boolean>;
  /** customPath 为空时只从 PATH 自动识别；传入则直接校验该路径 */
  locate: (customPath?: string) => Promise<PiLocation>;
  setZoomFactor: (factor: number) => Promise<number>;
  checkPiUpdate: (customPath?: string) => Promise<PiUpdateCheck>;
  checkAppUpdate: () => Promise<AppUpdateCheck>;
  downloadAppUpdate: () => Promise<PreparedAppUpdate>;
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
  listDirectory: (cwd: string, relative: string) => Promise<WorkspaceEntry[]>;
  readWorkspaceFile: (cwd: string, relative: string) => Promise<WorkspaceFileData>;
  writeWorkspaceFile: (cwd: string, relative: string, content: string) => Promise<WorkspaceFileData>;
  openWorkspacePath: (cwd: string, relative: string) => Promise<string>;
  createWorkspaceEntry: (cwd: string, parent: string, name: string, kind: "file" | "folder") => Promise<WorkspaceEntry>;
  renameWorkspaceEntry: (cwd: string, relative: string, name: string) => Promise<WorkspaceEntry>;
  deleteWorkspaceEntry: (cwd: string, relative: string) => Promise<void>;
  gitOverview: (cwd: string) => Promise<GitOverview>;
  gitInspect: (cwd: string, kind: "commit" | "working", target: string) => Promise<GitInspectResult>;
  gitAction: (cwd: string, action: GitActionName, payload?: GitActionPayload) => Promise<GitActionResult>;
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
  removeProject: (cwd: string, options?: { deleteSessions?: boolean }) => Promise<any>;
  call: (cwd: string, method: string, args?: any[], sessionFile?: string) => Promise<any>;
  respondExtensionUi: (cwd: string, response: Record<string, any>, sessionFile?: string) => Promise<any>;
  reveal: (target: string) => Promise<void>;
  mcpOverview: (cwd?: string) => Promise<McpOverview>;
  mcpProbe: (cwd?: string) => Promise<McpOverview>;
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
  onEvent: (listener: (payload: { cwd: string; sessionFile?: string; event: any }) => void) => () => void;
}

declare global {
  interface Window {
    piDesktop?: PiDesktopBridge;
    __piDesktop?: any;
  }
}
