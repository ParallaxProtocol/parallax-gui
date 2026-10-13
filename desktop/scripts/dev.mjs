// Development loop: builds the backend for this machine, starts the Vite
// dev server for the frontend, and runs Electron against it. Frontend
// edits hot-reload; restart this script after backend changes.
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const desktop = path.join(root, "desktop");
const PORT = 5173;
const win = process.platform === "win32";

const run = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: win, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const os = process.platform === "darwin" ? "mac" : win ? "win" : "linux";
const bin = path.join(root, "build", "backend", `${os}-${process.arch}`, win ? "parallax-backend.exe" : "parallax-backend");
run("go", ["build", "-o", bin, "."], { cwd: root });
run("node", ["build.mjs"], { cwd: desktop });

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: path.join(root, "frontend"),
  stdio: "inherit",
  shell: win,
});

const listening = () =>
  new Promise((resolve) => {
    const s = net.connect(PORT, "127.0.0.1", () => {
      s.end();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });
while (!(await listening())) await new Promise((r) => setTimeout(r, 200));

const electron = spawn("npx", ["electron", "."], {
  cwd: desktop,
  stdio: "inherit",
  shell: win,
  env: { ...process.env, PARALLAX_DEV_URL: `http://localhost:${PORT}`, PARALLAX_BACKEND_BIN: bin },
});
electron.on("exit", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
