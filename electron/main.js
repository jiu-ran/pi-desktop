import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";

const sessions = new Map();
const DEV_URL = process.env.PI_DESKTOP_URL ?? "http://127.0.0.1:1420";

function cliPath() {
  const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  return path.join(path.dirname(entry), "cli.js");
}

function sessionRoot(cwd) {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
  const resolved = path.resolve(cwd);
  const encoded = `--${[...resolved].map((char) => "\\/:".includes(char) ? "-" : char).join("").replace(/^-/, "")}--`;
  return path.join(agentDir, "sessions", encoded);
}

async function sessionTitle(file, fallback) {
  const text = await readFile(file, "utf8");
  for (const line of text.split(/\r?\n/).slice(0, 40)) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      const message = entry.message ?? entry;
      if (message.role !== "user") continue;
      const content = message.content;
      const value = typeof content === "string"
        ? content
        : content?.find((part) => part.type === "text")?.text;
      if (value) return value.replace(/\s+/g, " ").trim().slice(0, 28);
    } catch {
      // Skip a malformed line and keep looking for the first user message.
    }
  }
  return fallback.slice(0, 8);
}

function recentPath() {
  return path.join(app.getPath("userData"), "recent-workspaces.json");
}

async function recentWorkspaces() {
  try {
    const saved = JSON.parse(await readFile(recentPath(), "utf8"));
    return saved.filter((cwd) => typeof cwd === "string");
  } catch {
    return [];
  }
}

async function rememberWorkspace(cwd) {
  const recent = [cwd, ...(await recentWorkspaces()).filter((item) => item !== cwd)].slice(0, 20);
  await mkdir(path.dirname(recentPath()), { recursive: true });
  await writeFile(recentPath(), JSON.stringify(recent, null, 2));
  return recent;
}

function send(window, channel, payload) {
  if (!window.isDestroyed()) window.webContents.send(channel, payload);
}

async function openWorkspace(window, cwd) {
  const existing = sessions.get(cwd);
  if (existing) {
    return {
      state: existing.state,
      models: existing.models,
      levels: existing.levels,
      messages: await existing.client.getMessages(),
      sessions: await listSessions(cwd),
    };
  }

  const client = new RpcClient({ cliPath: cliPath(), cwd });
  await client.start();
  const state = await client.getState();
  const models = await client.getAvailableModels();
  const levels = await client.getAvailableThinkingLevels();
  const messages = await client.getMessages();
  client.onEvent((event) => send(window, "pi:event", { cwd, event }));
  sessions.set(cwd, { client, state, models, levels });
  return { state, models, levels, messages, sessions: await listSessions(cwd) };
}

async function listSessions(cwd) {
  const dir = sessionRoot(cwd);
  try {
    const names = await readdir(dir);
    const files = names.filter((name) => name.endsWith(".jsonl"));
    return Promise.all(files.map(async (name) => {
      const file = path.join(dir, name);
      const text = await readFile(file, "utf8");
      const header = JSON.parse(text.split(/\r?\n/, 1)[0] || "{}");
      return {
        id: file,
        title: await sessionTitle(file, name),
        path: file,
        updated: header.timestamp ? new Date(header.timestamp).toLocaleString() : "",
        status: "idle",
      };
    }));
  } catch {
    return [];
  }
}

function requireClient(cwd) {
  const session = sessions.get(cwd);
  if (!session) throw new Error("这个工作区还没有启动 Pi");
  return session.client;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#141414",
    webPreferences: {
      preload: path.join(app.getAppPath(), "electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadURL(DEV_URL).catch(() => {
    setTimeout(() => {
      if (!window.isDestroyed()) window.loadURL(DEV_URL);
    }, 500);
  });
  return window;
}

app.whenReady().then(() => {
  const window = createWindow();

  ipcMain.handle("pi:locate", async () => {
    const probe = spawn("pi", ["--version"], { shell: true });
    let output = "";
    probe.stdout.on("data", (chunk) => { output += chunk; });
    probe.stderr.on("data", (chunk) => { output += chunk; });
    const code = await new Promise((resolve) => probe.once("close", resolve));
    return { found: code === 0, version: output.trim() };
  });

  ipcMain.handle("pi:recent", () => recentWorkspaces());
  ipcMain.handle("pi:open", async (_event, cwd) => {
    await rememberWorkspace(cwd);
    return openWorkspace(window, cwd);
  });
  ipcMain.handle("pi:choose-directory", async () => {
    const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("pi:sessions", (_event, cwd) => listSessions(cwd));
  ipcMain.handle("pi:prompt", async (_event, cwd, message, streaming) => {
    const disposition = await requireClient(cwd).prompt(message, undefined, streaming);
    return disposition;
  });
  ipcMain.handle("pi:stop", async (_event, cwd) => {
    const client = requireClient(cwd);
    const queued = await client.clearQueue();
    await client.abort();
    return queued;
  });
  ipcMain.handle("pi:new-session", async (_event, cwd) => {
    await requireClient(cwd).newSession();
    return requireClient(cwd).getState();
  });
  ipcMain.handle("pi:switch-session", async (_event, cwd, sessionPath) => {
    await requireClient(cwd).switchSession(sessionPath);
    return {
      state: await requireClient(cwd).getState(),
      messages: await requireClient(cwd).getMessages(),
    };
  });
  ipcMain.handle("pi:model", async (_event, cwd, provider, modelId) => {
    await requireClient(cwd).setModel(provider, modelId);
    return requireClient(cwd).getAvailableThinkingLevels();
  });
  ipcMain.handle("pi:thinking", (_event, cwd, level) => requireClient(cwd).setThinkingLevel(level));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", async (event) => {
  if (sessions.size === 0) return;
  event.preventDefault();
  const clients = [...sessions.values()];
  sessions.clear();
  await Promise.allSettled(clients.map((session) => session.client.stop()));
  app.exit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
