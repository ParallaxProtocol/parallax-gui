import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import http from "node:http";
import readline from "node:readline";

/** The one stdout line the backend prints once its bridge listens (main.go). */
const HANDSHAKE = "PARALLAX_BACKEND ";

/** How long a quit waits for the node to shut down cleanly before killing it. */
const STOP_TIMEOUT_MS = 60_000;

export type CallResult = { result?: unknown; error?: string };

/**
 * Backend runs parallax-backend (the Go binary at the repository root) as a
 * child process and talks to it over its loopback bridge (bridge.go): calls
 * as HTTP POSTs, events as a server-sent event stream. Emits "event" (name,
 * data) for every backend event and "exit" (code) when the process ends.
 */
export class Backend extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private port = 0;
  private token = "";
  private stderrTail: string[] = [];
  exited = false;
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (e: Error) => void;

  constructor() {
    super();
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  /**
   * Starts the backend. echo passes its log through to this process's
   * stderr, for development: a packaged app's stderr can end up in the
   * system's journal, in the clear, where the app's own log file is sealed
   * (backend/logfile.go). The last lines are kept in memory either way,
   * for an error report.
   */
  start(bin: string, args: string[], env: NodeJS.ProcessEnv, echo: boolean) {
    const proc = spawn(bin, args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.proc = proc;

    readline.createInterface({ input: proc.stdout }).on("line", (line) => {
      if (!line.startsWith(HANDSHAKE) || this.port) return;
      try {
        const hello = JSON.parse(line.slice(HANDSHAKE.length));
        this.port = hello.port;
        this.token = hello.token;
        this.resolveReady();
        this.subscribe();
      } catch (e) {
        this.rejectReady(new Error(`bad handshake: ${line}`));
      }
    });

    // Logs: passed through in development, and the tail kept for an error report
    proc.stderr.on("data", (chunk: Buffer) => {
      if (echo) process.stderr.write(chunk);
      this.stderrTail.push(chunk.toString());
      if (this.stderrTail.length > 40) this.stderrTail.shift();
    });

    proc.on("error", (err) => this.rejectReady(err));
    proc.on("exit", (code) => {
      this.exited = true;
      this.rejectReady(new Error(`backend exited with code ${code} before it was ready`));
      this.emit("exit", code);
    });
  }

  /** The last lines the backend wrote to stderr, for an error dialog. */
  lastOutput(): string {
    return this.stderrTail.join("").split("\n").slice(-25).join("\n");
  }

  async call(method: string, args: unknown[]): Promise<CallResult> {
    await this.ready;
    const res = await fetch(`http://127.0.0.1:${this.port}/call`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ method, args }),
    });
    if (!res.ok) return { error: `backend returned ${res.status}` };
    return (await res.json()) as CallResult;
  }

  /** Follows the event stream, reconnecting if it drops while the backend runs. */
  private subscribe() {
    const req = http.get(
      {
        host: "127.0.0.1",
        port: this.port,
        path: "/events",
        headers: { Authorization: `Bearer ${this.token}` },
      },
      (res) => {
        res.setEncoding("utf8");
        let buf = "";
        res.on("data", (chunk: string) => {
          buf += chunk;
          let end: number;
          while ((end = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, end);
            buf = buf.slice(end + 2);
            let name = "";
            let data = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event: ")) name = line.slice(7);
              else if (line.startsWith("data: ")) data += line.slice(6);
            }
            if (!name) continue;
            try {
              this.emit("event", name, JSON.parse(data));
            } catch {
              /* malformed event: skip it */
            }
          }
        });
        res.on("end", () => this.resubscribe());
      },
    );
    req.on("error", () => this.resubscribe());
  }

  private resubscribe() {
    if (!this.exited) setTimeout(() => this.subscribe(), 500);
  }

  /**
   * Stops the backend: closing its stdin tells it to shut down, which stops
   * the node and flushes the chain database. Killed if it hasn't exited
   * within STOP_TIMEOUT_MS.
   */
  stop(): Promise<void> {
    const proc = this.proc;
    if (!proc || this.exited) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => proc.kill("SIGKILL"), STOP_TIMEOUT_MS);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      proc.stdin.end();
    });
  }
}
