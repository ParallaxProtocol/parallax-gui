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
// make dev PROFILE=<name> runs a separate copy of the app beside the
// default one (backend Profile, desktop main.ts): its own backend binary,
// so a rebuild never replaces the other copy's running one, and the next
// free port for its dev server
const PROFILE = process.env.PROFILE ?? "";
if (PROFILE && !/^[a-z0-9][a-z0-9-]{0,31}$/.test(PROFILE)) {
  console.error(`PROFILE must be lower-case letters, digits and dashes, not "${PROFILE}"`);
  process.exit(1);
}
// Both sides on IPv4 loopback: Vite's default "localhost" may bind only
// ::1, where the wait below (and Electron's URL) would never reach it
const HOST = "127.0.0.1";
const win = process.platform === "win32";

const run = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: win, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const os = process.platform === "darwin" ? "mac" : win ? "win" : "linux";
const exe = `parallax-backend${PROFILE ? `-${PROFILE}` : ""}${win ? ".exe" : ""}`;
const bin = path.join(root, "build", "backend", `${os}-${process.arch}`, exe);
// The Parallax client's commit, from its module's origin, as the release
// build stamps it (Makefile): the node page shows it with the version
const daemonCommit = (() => {
  const daemon = "github.com/ParallaxProtocol/parallax/v2";
  const out = (args) => spawnSync("go", args, { cwd: root, encoding: "utf8", shell: win }).stdout ?? "";
  const mod = out(["list", "-m", daemon]).trim().replace(" ", "@");
  if (!mod) return "";
  try {
    return JSON.parse(out(["mod", "download", "-json", mod])).Origin?.Hash ?? "";
  } catch {
    return "";
  }
})();
run(
  "go",
  [
    "build",
    "-ldflags",
    `-X github.com/ParallaxProtocol/parallax-gui/backend.DaemonCommit=${daemonCommit}`,
    "-o",
    bin,
    ".",
  ],
  {
    cwd: root,
    // As the release build has it on Linux (Makefile): secret calls wipe what they leave in memory
    env: process.platform === "linux" ? { ...process.env, GOEXPERIMENT: "runtimesecret" } : process.env,
  },
);
run("node", ["build.mjs"], { cwd: desktop });

// The first port from 5173 nobody listens on
const free = (port) =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, HOST, () => srv.close(() => resolve(true)));
  });
let PORT = 5173;
while (!(await free(PORT))) PORT++;

const vite = spawn("npx", ["vite", "--host", HOST, "--port", String(PORT), "--strictPort"], {
  cwd: path.join(root, "frontend"),
  stdio: "inherit",
  shell: win,
});

const listening = () =>
  new Promise((resolve) => {
    const s = net.connect(PORT, HOST, () => {
      s.end();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });
while (!(await listening())) await new Promise((r) => setTimeout(r, 200));

// What Electron exits with to be started again: the app restarting itself
// (DEV_RESTART_CODE, desktop/src/main.ts), the dev server kept up meanwhile
const RESTART = 75;

const launch = () => {
  const electron = spawn("npx", ["electron", "."], {
    cwd: desktop,
    stdio: "inherit",
    shell: win,
    // PARALLAX_DEV unlocks the development-only settings (backend/devchain.go)
    env: {
      ...process.env,
      PARALLAX_DEV_URL: `http://${HOST}:${PORT}`,
      PARALLAX_BACKEND_BIN: bin,
      PARALLAX_DEV: "1",
      PARALLAX_PROFILE: PROFILE,
    },
  });
  electron.on("exit", (code) => {
    if (code === RESTART) return launch();
    vite.kill();
    process.exit(code ?? 0);
  });
};
launch();
