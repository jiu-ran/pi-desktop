declare module "*.vue" {
  const component: any;
  export default component;
}

declare module "*.css" {}

declare module "markstream-vue" {
  const MarkdownRender: any;
  export default MarkdownRender;
}

interface PiDesktopBridge {
  platform: string;
  setTitleBar: (colors: { color: string; symbolColor: string }) => Promise<boolean>;
  locate: () => Promise<{ found: boolean; version: string }>;
  recent: () => Promise<string[]>;
  forget: (cwd: string) => Promise<string[]>;
  chooseDirectory: () => Promise<string | null>;
  chooseFiles: () => Promise<string[]>;
  chooseFolder: () => Promise<string | null>;
  open: (cwd: string) => Promise<any>;
  snapshot: (cwd: string) => Promise<any>;
  prepareAttachments: (cwd: string, paths: string[]) => Promise<any>;
  listDirectory: (cwd: string, relative: string) => Promise<any[]>;
  readWorkspaceFile: (cwd: string, relative: string) => Promise<any>;
  writeWorkspaceFile: (cwd: string, relative: string, content: string) => Promise<any>;
  openWorkspacePath: (cwd: string, relative: string) => Promise<string>;
  completePaths: (cwd: string, query: string) => Promise<any[]>;
  restart: (cwd: string) => Promise<any>;
  sessions: (cwd: string) => Promise<any[]>;
  deleteSession: (cwd: string, file: string) => Promise<any[]>;
  removeProject: (cwd: string, options?: { deleteSessions?: boolean }) => Promise<any>;
  call: (cwd: string, method: string, args?: any[]) => Promise<any>;
  respondExtensionUi: (cwd: string, response: Record<string, any>) => Promise<any>;
  reveal: (target: string) => Promise<void>;
  onEvent: (listener: (payload: { cwd: string; event: any }) => void) => () => void;
}

interface Window {
  piDesktop?: PiDesktopBridge;
  __piDesktop?: any;
}
