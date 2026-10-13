import { fileURLToPath } from "node:url";
import path from "node:path";
import { RpcClient } from "@earendil-works/pi-coding-agent";

const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const cliPath = path.join(path.dirname(entry), "cli.js");
const cwd = process.argv[2] ?? process.cwd();
const client = new RpcClient({ cliPath, cwd });

try {
  await client.start();
  const state = await client.getState();
  const models = await client.getAvailableModels();
  console.log(JSON.stringify({
    ok: true,
    cliPath,
    cwd,
    model: state.model ? `${state.model.provider}/${state.model.id}` : null,
    sessionFile: state.sessionFile ?? null,
    models: models.length,
  }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, cliPath, message: error.message, stderr: client.getStderr() }));
  process.exitCode = 1;
} finally {
  await client.stop();
}
