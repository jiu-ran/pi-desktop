export const pi = {
  found: true,
  version: "1.2.0",
  path: "C:\\Users\\jiuran\\AppData\\npm\\pi.cmd",
};

export const workspaces = [
  {
    id: "chat",
    name: "chat",
    path: "C:\\Users\\jiuran\\Desktop\\chat",
    status: "idle",
  },
  {
    id: "pi",
    name: "pi-desktop",
    path: "C:\\Users\\jiuran\\Desktop\\chat\\pi-desktop",
    status: "working",
  },
];

export const sessions = {
  chat: [
    { id: "s1", title: "整理桌面客户端", updated: "刚刚", status: "idle" },
    { id: "s2", title: "看 RPC 协议", updated: "昨天", status: "done" },
  ],
  pi: [{ id: "s3", title: "搭前端骨架", updated: "刚刚", status: "working" }],
};

export const messages = {
  s1: [
    { id: "m1", role: "user", text: "参考开源桌面客户端，把页面补完整。" },
    {
      id: "m2",
      role: "thinking",
      text: "布局参考 Pi Desktop：工作区、会话、对话、变更、终端。数据先留在前端。",
    },
    {
      id: "m3",
      role: "tool",
      name: "read",
      state: "完成",
      text: "大纲.md",
    },
    {
      id: "m4",
      role: "assistant",
      text: "页面只展示状态。模型、密钥和会话文件仍然属于本机 Pi CLI。",
    },
  ],
  s2: [
    { id: "m5", role: "user", text: "pi --mode rpc 是什么" },
    {
      id: "m6",
      role: "assistant",
      text: "它把本机 Pi 跑成一个子进程。界面从 stdin 发命令，从 stdout 收事件。",
    },
  ],
  s3: [],
};

export const changes = [
  { path: "packages/ui/src/App.vue", kind: "修改", additions: 40, deletions: 12 },
  { path: "packages/ui/src/styles.css", kind: "修改", additions: 80, deletions: 20 },
  {
    path: "packages/ui/src/components/Transcript.vue",
    kind: "新增",
    additions: 60,
    deletions: 0,
  },
];

export const terminalLines = [
  "$ pi --mode rpc",
  "等待本机 Pi 的事件。",
  "stdout 只放协议，日志在 stderr。",
];

export const models = ["本机默认模型", "claude-sonnet", "gpt-5"];

export const thinkingLevels = ["off", "low", "medium", "high"];
