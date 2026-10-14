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
  backend.start(paths.backend, {
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
