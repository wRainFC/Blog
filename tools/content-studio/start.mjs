import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const astroBin = fileURLToPath(
  new URL("../../node_modules/astro/bin/astro.mjs", import.meta.url),
);

// Windows environments can expose both `Path` and `PATH`. Node's child
// process environment is case-sensitive until it reaches the Windows API,
// where the duplicate keys make CreateProcess fail. Normalize that one key
// before launching Astro.
const childEnv = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.toLowerCase() === "path") {
    if (childEnv.PATH === undefined) childEnv.PATH = value;
    continue;
  }
  childEnv[key] = value;
}
childEnv.CONTENT_STUDIO = "1";
childEnv.CONTENT_STUDIO_TOKEN = randomBytes(32).toString("hex");
// Astro treats agent-run commands as background requests. The Studio is a
// foreground process by design so Ctrl-C cleanly stops both the UI server and
// its launcher.
childEnv.ASTRO_DEV_BACKGROUND = "1";

const child = spawn(
  process.execPath,
  [astroBin, "dev", "--host", "127.0.0.1", "--open", "/studio"],
  {
    cwd: root,
    env: childEnv,
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
