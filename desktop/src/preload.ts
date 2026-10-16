import { contextBridge, ipcRenderer } from "electron";

/**
 * The frontend's whole view of the outside world, as window.parallax: calls
 * to the backend, its events, opening links in the default browser, and
 * the native theme. Runs sandboxed; the renderer gets no Node access.
 */

type Listener = (data: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

ipcRenderer.on("backend:event", (_e, name: string, data: unknown) => {
  listeners.get(name)?.forEach((cb) => cb(data));
});

contextBridge.exposeInMainWorld("parallax", {
  /** Calls a backend method (an exported method of App in app.go). */
  async call(method: string, args: unknown[]): Promise<unknown> {
    const res = (await ipcRenderer.invoke("backend:call", method, args)) as { result?: unknown; error?: string };
    if (res.error) throw new Error(res.error);
    return res.result;
  },
  /** Subscribes to a backend event; returns the unsubscribe function. */
  on(name: string, cb: Listener): () => void {
    let set = listeners.get(name);
    if (!set) listeners.set(name, (set = new Set()));
    set.add(cb);
    return () => {
      set!.delete(cb);
    };
  },
  openExternal(url: string): Promise<void> {
    return ipcRenderer.invoke("shell:openExternal", url);
  },
  setTheme(pref: "system" | "light" | "dark") {
    ipcRenderer.send("theme:set", pref);
  },
  /** Whether the app starts at login; `supported` is false in development. */
  loginItem(): Promise<{ supported: boolean; enabled: boolean }> {
    return ipcRenderer.invoke("login:get");
  },
  setLoginItem(on: boolean): Promise<void> {
    return ipcRenderer.invoke("login:set", on);
  },
  /** Saves an account's encrypted keystore file where the user picks; false if cancelled. */
  saveBackup(fileName: string, contents: string): Promise<boolean> {
    return ipcRenderer.invoke("wallet:saveBackup", fileName, contents);
  },
  /** Saves exported contacts where the user picks; false if cancelled. */
  exportContacts(format: "json" | "csv", contents: string): Promise<boolean> {
    return ipcRenderer.invoke("contacts:export", format, contents);
  },
  /** Asks where to save an account's exported activity: a .csv path, or null if cancelled. */
  pickHistoryPath(fileName: string): Promise<string | null> {
    return ipcRenderer.invoke("history:savePath", fileName);
  },
  /** Saves a signing request or signed transaction where the user picks; false if cancelled. */
  saveSigningDoc(fileName: string, contents: string): Promise<boolean> {
    return ipcRenderer.invoke("offline:save", fileName, contents);
  },
  /** Asks for a folder (the node's data, or where to move a store), opened at start; null if cancelled. */
  pickFolder(title: string, start: string): Promise<string | null> {
    return ipcRenderer.invoke("storage:pickFolder", title, start);
  },
  /** Asks for the camera where the OS needs asking (macOS); whether it may be used. */
  cameraAccess(): Promise<boolean> {
    return ipcRenderer.invoke("camera:access");
  },
  /** Keeps the window out of screen captures while on (macOS and Windows). */
  protectContent(on: boolean) {
    ipcRenderer.send("window:protect", on);
  },
  /** Holds off system sleep while on. */
  keepAwake(on: boolean) {
    ipcRenderer.send("power:keepAwake", on);
  },
  platform: process.platform,
});
