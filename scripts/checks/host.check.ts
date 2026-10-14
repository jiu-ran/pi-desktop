import { PiHost } from "../../electron/pi-host.ts";

const host = new PiHost({ emit: () => {} });
const cwd = "C:\\Users\\jiuran\\Desktop\\chat";
try {
  const [a, b] = await Promise.all([host.open(cwd), host.open(cwd)]);
  console.log("processes", host.clients.size, "a.messages", a.messages.length, "b.messages", b.messages.length);
  console.log("same session", a.state.sessionFile === b.state.sessionFile, a.state.sessionFile?.split("\\").at(-1));
  if (host.clients.size !== 1 || a.messages.length === 0) throw new Error("concurrent open broken");
  console.log("OK");
} finally {
  await host.stopAll();
}
