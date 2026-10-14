import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  Menu,
  nativeTheme,
  net,
  powerSaveBlocker,
  protocol,
  shell,
} from "electron";
import { Backend } from "./backend";

/**
 * The Electron shell of Parallax Desktop. It starts the Go backend
 * (parallax-backend, see main.go and bridge.go), shows the React frontend
 * in a sandboxed window, and relays the frontend's calls and the backend's
 * events between the two (preload.ts exposes them as window.parallax).
 */

/** The Vite dev server, when running `npm run dev`; unset in packaged builds. */
const DEV_URL = process.env.PARALLAX_DEV_URL;
const APP_ORIGIN = "app://parallax";
const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";

// What the frontend may load and run. Inline styles stay allowed: Motion
// animates through the style attribute.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};

/** Where the built frontend and the backend binary live, packaged or not. */
function resources() {
  const key = `${isMac ? "mac" : isWindows ? "win" : "linux"}-${process.arch}`;
  const exe = isWindows ? "parallax-backend.exe" : "parallax-backend";
  if (app.isPackaged) {
    return {
      frontend: path.join(process.resourcesPath, "frontend"),
      backend: path.join(process.resourcesPath, "backend", exe),
    };
  }
  const root = path.resolve(__dirname, "..", "..");
  return {
    frontend: path.join(root, "frontend", "dist"),
    backend: process.env.PARALLAX_BACKEND_BIN || path.join(root, "build", "backend", key, exe),
  };
}

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const backend = new Backend();
let mainWindow: BrowserWindow | null = null;
let quitting = false;
/** Runs once the backend has stopped, just before the process exits (restart after an update). */
let afterStop: (() => void) | null = null;

/**
 * Starting the app at login. macOS and Windows keep login items
 * themselves; on Linux it is an XDG autostart entry. It needs a packaged
 * app: in development the executable is Electron itself.
 */
const AUTOSTART_FILE = path.join(app.getPath("appData"), "autostart", "parallax-client.desktop");

/** The file to launch: the AppImage or portable executable the app runs from, else the app itself. */
function launchTarget() {
  return process.env.APPIMAGE || process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function openAtLogin(): boolean {
  if (!isMac && !isWindows) return fs.existsSync(AUTOSTART_FILE);
  return app.getLoginItemSettings(isWindows ? { path: launchTarget() } : undefined).openAtLogin;
}

function setOpenAtLogin(on: boolean) {
  if (isMac || isWindows) {
    app.setLoginItemSettings({ openAtLogin: on, ...(isWindows ? { path: launchTarget() } : {}) });
    return;
  }
  if (!on) {
    fs.rmSync(AUTOSTART_FILE, { force: true });
    return;
  }
  const exec = `"${launchTarget().replace(/(["\\`$])/g, "\\$1")}"`;
  fs.mkdirSync(path.dirname(AUTOSTART_FILE), { recursive: true });
  fs.writeFileSync(
    AUTOSTART_FILE,
    ["[Desktop Entry]", "Type=Application", "Name=Parallax Client", `Exec=${exec}`, "X-GNOME-Autostart-enabled=true", ""].join("\n"),
  );
}

/** Holds the system awake while the frontend asks (syncing, if the user wants it). */
let sleepBlocker: number | null = null;

function keepAwake(on: boolean) {
  if (on && sleepBlocker === null) {
    sleepBlocker = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!on && sleepBlocker !== null) {
    powerSaveBlocker.stop(sleepBlocker);
    sleepBlocker = null;
  }
}

/**
 * The backend's own command-line flags, from the saved config. Metrics
 * collection is decided once, from argv, as the daemon starts
 * (support/metrics), so this is how the Metrics setting reaches it.
 * The path is Go's os.UserConfigDir()/Parallax/gui.json (backend/config.go).
 */
function backendArgs(): string[] {
  try {
    const file = path.join(app.getPath("appData"), "Parallax", "gui.json");
    const cfg = JSON.parse(fs.readFileSync(file, "utf8")) as { metrics?: boolean; metricsExpensive?: boolean };
    const args: string[] = [];
    if (cfg.metrics) args.push("--metrics");
    if (cfg.metrics && cfg.metricsExpensive) args.push("--metrics.expensive");
    return args;
  } catch {
    return []; // no config yet: a fresh install
  }
}

/** Only the app's own pages may use the bridge. */
function trusted(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const url = event.senderFrame?.url ?? "";
  return url.startsWith(`${APP_ORIGIN}/`) || (!!DEV_URL && url.startsWith(DEV_URL));
}

function openExternal(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") shell.openExternal(u.toString());
  } catch {
    /* not a URL: ignore */
  }
}

/**
 * Saves a wallet backup, an account's keystore file, where the user picks.
 * Only an encrypted keystore file is written: the renderer can't use this
 * to put arbitrary content on disk, nor choose the path itself. The file is
 * readable by its owner only.
 */
async function saveBackup(fileName: string, contents: string): Promise<boolean> {
  if (contents.length > 64 * 1024 || !isKeystoreFile(contents)) return false;
  // The keystore's own name (UTC--<time>--<address>), stripped of anything a path could use
  const name = path.basename(fileName).replace(/[^\w.-]/g, "_") || "parallax-keystore.json";
  const opts = {
    title: "Save wallet backup",
    defaultPath: path.join(app.getPath("documents"), name.endsWith(".json") ? name : `${name}.json`),
    filters: [{ name: "Keystore file", extensions: ["json"] }],
  };
  const res = mainWindow ? await dialog.showSaveDialog(mainWindow, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return false;
  await fs.promises.writeFile(res.filePath, contents, { mode: 0o600 });
  // writeFile's mode applies only to a new file: tighten one it replaced too
  await fs.promises.chmod(res.filePath, 0o600).catch(() => {});
  return true;
}

/** Whether s is a Web3 Secret Storage keystore file: an encrypted key, never a plain one. */
function isKeystoreFile(s: string): boolean {
  try {
    const v = JSON.parse(s) as { crypto?: { ciphertext?: unknown; kdf?: unknown }; Crypto?: unknown };
    const c = (v.crypto ?? v.Crypto) as { ciphertext?: unknown; kdf?: unknown } | undefined;
    return typeof c?.ciphertext === "string" && (c.kdf === "scrypt" || c.kdf === "pbkdf2");
  } catch {
    return false;
  }
}

function serveFrontend(dir: string) {
  protocol.handle("app", async (req) => {
    const { pathname } = new URL(req.url);
    const rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    const file = path.join(dir, path.normalize(rel));
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file)) {
      return new Response("not found", { status: 404 });
    }
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers({
      "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Security-Policy": CSP,
    });
    return new Response(res.body, { status: res.status, headers });
  });
}

/**
 * The window has no title bar of its own: the sidebar and the toolbar run
 * up to the top edge and the toolbar is the drag area, as in native apps.
 * macOS keeps its traffic lights, inset to sit centred in the toolbar;
 * Windows and Linux draw their controls over the toolbar's right end, in
 * the toolbar's colours (the frontend's --background), which follow the theme.
 *
 * Where the OS has a window material, the sidebar and status bar show it
 * through: vibrancy on macOS, Mica on Windows 11 (22H2, build 22621, and
 * later). The frontend learns of it from the --parallax-material argument
 * (preload.ts) and leaves those surfaces transparent.
 */
const TOOLBAR_HEIGHT = 44;
const MATERIAL = isMac || (isWindows && Number(os.release().split(".")[2] ?? 0) >= 22621);

function chrome() {
  const dark = nativeTheme.shouldUseDarkColors;
  return {
    background: dark ? "#1b1c1f" : "#f6f6f7",
    overlay: { color: dark ? "#1b1c1f" : "#f6f6f7", symbolColor: dark ? "#e8e8ea" : "#1d1d1f", height: TOOLBAR_HEIGHT },
  };
}

function createWindow() {
  const look = chrome();
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Parallax Desktop",
    backgroundColor: MATERIAL ? "#00000000" : look.background,
    ...(MATERIAL ? (isMac ? { vibrancy: "sidebar" as const } : { backgroundMaterial: "mica" as const }) : {}),
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac ? { trafficLightPosition: { x: 16, y: 15 } } : { titleBarOverlay: look.overlay }),
    icon: isWindows || isMac ? undefined : path.join(__dirname, "..", "resources", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      additionalArguments: MATERIAL ? ["--parallax-material"] : [],
    },
  });
  mainWindow = win;
  win.once("ready-to-show", () => win.show());
  const recolor = () => {
    if (isMac || win.isDestroyed()) return;
    const next = chrome();
    if (!MATERIAL) win.setBackgroundColor(next.background);
    win.setTitleBarOverlay(next.overlay);
  };
  nativeTheme.on("updated", recolor);
  win.on("closed", () => {
    nativeTheme.off("updated", recolor);
    mainWindow = null;
  });

  // Links leave the app for the default browser; the window itself never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    const own = url.startsWith(`${APP_ORIGIN}/`) || (!!DEV_URL && url.startsWith(DEV_URL));
    if (!own) {
      e.preventDefault();
      openExternal(url);
    }
  });
  if (DEV_URL) {
    win.webContents.on("before-input-event", (_e, input) => {
      if (input.type === "keyDown" && input.key === "F12") win.webContents.toggleDevTools();
    });
  }

  win.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
}

/**
 * Restarts onto an installed update, once the backend has stopped: runs the
 * Windows installer (which starts the app when done), or relaunches the
 * AppImage, the portable executable or the app itself.
 */
function restart(installer: string) {
  const relaunchArgs = ["--relaunch"];
  afterStop = () => {
    const detached = { detached: true, stdio: "ignore" as const };
    if (installer && isWindows) {
      spawn(installer, ["/S", "--updated", "--force-run"], detached).unref();
    } else if (process.env.APPIMAGE) {
      spawn(process.env.APPIMAGE, relaunchArgs, detached).unref();
    } else if (process.env.PORTABLE_EXECUTABLE_FILE) {
      spawn(process.env.PORTABLE_EXECUTABLE_FILE, relaunchArgs, detached).unref();
    } else {
      app.relaunch({ args: [...process.argv.slice(1), ...relaunchArgs] });
    }
  };
  app.quit();
}

function wireIpc() {
  ipcMain.handle("backend:call", async (event, method: unknown, args: unknown) => {
    if (!trusted(event) || typeof method !== "string" || !Array.isArray(args)) {
      return { error: "rejected" };
    }
    try {
      return await backend.call(method, args);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle("shell:openExternal", (event, url: unknown) => {
    if (trusted(event) && typeof url === "string") openExternal(url);
  });
  ipcMain.handle("login:get", (event) => {
    if (!trusted(event)) return { supported: false, enabled: false };
    return { supported: app.isPackaged, enabled: app.isPackaged && openAtLogin() };
  });
  ipcMain.handle("login:set", (event, on: unknown) => {
    if (trusted(event) && app.isPackaged && typeof on === "boolean") setOpenAtLogin(on);
  });
  ipcMain.handle("wallet:saveBackup", async (event, fileName: unknown, contents: unknown) => {
    if (!trusted(event) || typeof fileName !== "string" || typeof contents !== "string") return false;
    return saveBackup(fileName, contents);
  });
  ipcMain.on("power:keepAwake", (event, on: unknown) => {
    if (trusted(event) && typeof on === "boolean") keepAwake(on);
  });
  ipcMain.on("theme:set", (event, pref: unknown) => {
    if (trusted(event) && (pref === "system" || pref === "light" || pref === "dark")) {
      nativeTheme.themeSource = pref;
    }
  });

  backend.on("event", (name: string, data: unknown) => {
    if (name === "app:restart") {
      restart((data as { installer?: string })?.installer ?? "");
      return;
    }
    mainWindow?.webContents.send("backend:event", name, data);
  });
  backend.on("exit", (code: number | null) => {
    if (quitting) return;
    dialog.showErrorBox(
      "Parallax Desktop stopped",
      `The Parallax backend exited unexpectedly (code ${code}).\n\n${backend.lastOutput()}`,
    );
    app.exit(1);
  });
}

async function boot() {
  const paths = resources();
  if (!DEV_URL) serveFrontend(paths.frontend);

  Menu.setApplicationMenu(
    isMac
      ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }])
      : null,
  );

  wireIpc();
  backend.start(paths.backend, backendArgs(), {
    ...process.env,
    // Lets the updater replace the portable executable rather than run an installer
    PARALLAX_PORTABLE_EXE: process.env.PORTABLE_EXECUTABLE_FILE ?? "",
  });

  try {
    await backend.ready;
    // Native surfaces (title bar, scrollbars, menus) follow the saved theme
    const cfg = await backend.call("GetConfig", []);
    const theme = (cfg.result as { theme?: string } | undefined)?.theme;
    if (theme === "light" || theme === "dark" || theme === "system") nativeTheme.themeSource = theme;
  } catch (e) {
    dialog.showErrorBox(
      "Parallax Desktop could not start",
      `${e instanceof Error ? e.message : String(e)}\n\n${backend.lastOutput()}`,
    );
    app.exit(1);
    return;
  }
  createWindow();
}

/**
 * One instance at a time: two would fight over the same chain database. A
 * restart after an update may start before the old instance has released
 * the lock, so a relaunched instance waits for it a few seconds.
 */
async function singleInstance(): Promise<boolean> {
  if (app.requestSingleInstanceLock()) return true;
  if (!process.argv.includes("--relaunch")) return false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (app.requestSingleInstanceLock()) return true;
  }
  return false;
}

// Windows shows notifications only for an app with an AppUserModelID: the appId in electron-builder.yml
if (isWindows) app.setAppUserModelId("org.parallaxprotocol.desktop");

singleInstance().then((ok) => {
  if (!ok) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("window-all-closed", () => app.quit());

  // Quitting waits for the backend to stop the node cleanly
  app.on("before-quit", (e) => {
    if (backend.exited && !afterStop) return;
    e.preventDefault();
    if (quitting) return;
    quitting = true;
    for (const w of BrowserWindow.getAllWindows()) w.hide();
    backend.stop().finally(() => {
      afterStop?.();
      app.exit(0);
    });
  });

  app.whenReady().then(boot);
});
