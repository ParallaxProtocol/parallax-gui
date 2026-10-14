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
  platform: process.platform,
  /** Whether the window shows an OS material (vibrancy, Mica) behind transparent surfaces. */
  material: process.argv.includes("--parallax-material"),
});
