import { useEffect, useState } from "react";
import { OctagonAlert, RefreshCw } from "lucide-react";
import { api, CONFIG_UPDATED_EVENT, onEvent, type MCPStatus } from "../../lib/api";
import { useT } from "../../i18n";
import { CopyButton } from "../../components/ui/bits";
import { CardRow } from "../../components/ui/CardRow";
import { Indicator } from "../../components/ui/Indicator";
import { Panel, Row } from "../../components/ui/Panel";
import { Select } from "../../components/ui/Select";

/** The name assistants list the server under. */
const SERVER_NAME = "parallax-wallet-app";

type Setup = {
  label: string;
  /** A command to run, or the config file the snippet goes in. */
  how: { run: true } | { file: string };
  snippet: (url: string, auth: string) => string;
};

const json = (v: unknown) => JSON.stringify(v, null, 2);

/** The common assistants, each with how it adds an HTTP server sending a header. */
const SETUPS = {
  claude: {
    label: "Claude Code",
    how: { run: true },
    snippet: (url, auth) => `claude mcp add --transport http ${SERVER_NAME} ${url} --header "Authorization: ${auth}"`,
  },
  // Claude Desktop's config starts local servers only: mcp-remote bridges
  // to the HTTP one
  claudeDesktop: {
    label: "Claude Desktop",
    how: { file: "claude_desktop_config.json" },
    snippet: (url, auth) =>
      json({
        mcpServers: {
          [SERVER_NAME]: {
            command: "npx",
            args: ["-y", "mcp-remote", url, "--allow-http", "--header", "Authorization:${AUTH_HEADER}"],
            env: { AUTH_HEADER: auth },
          },
        },
      }),
  },
  codex: {
    label: "Codex",
    how: { file: "~/.codex/config.toml" },
    snippet: (url, auth) =>
      `[mcp_servers.${SERVER_NAME}]\nurl = "${url}"\nhttp_headers = { Authorization = "${auth}" }`,
  },
  gemini: {
    label: "Gemini CLI",
    how: { run: true },
    snippet: (url, auth) => `gemini mcp add --transport http ${SERVER_NAME} ${url} --header "Authorization: ${auth}"`,
  },
  cursor: {
    label: "Cursor",
    how: { file: "~/.cursor/mcp.json" },
    snippet: (url, auth) => json({ mcpServers: { [SERVER_NAME]: { url, headers: { Authorization: auth } } } }),
  },
  vscode: {
    label: "VS Code",
    how: { file: ".vscode/mcp.json" },
    snippet: (url, auth) =>
      json({ servers: { [SERVER_NAME]: { type: "http", url, headers: { Authorization: auth } } } }),
  },
  windsurf: {
    label: "Windsurf",
    how: { file: "~/.codeium/windsurf/mcp_config.json" },
    snippet: (url, auth) =>
      json({ mcpServers: { [SERVER_NAME]: { serverUrl: url, headers: { Authorization: auth } } } }),
  },
  zed: {
    label: "Zed",
    how: { file: "~/.config/zed/settings.json" },
    snippet: (url, auth) => json({ context_servers: { [SERVER_NAME]: { url, headers: { Authorization: auth } } } }),
  },
  cline: {
    label: "Cline",
    how: { file: "cline_mcp_settings.json" },
    snippet: (url, auth) =>
      json({ mcpServers: { [SERVER_NAME]: { type: "streamableHttp", url, headers: { Authorization: auth } } } }),
  },
  opencode: {
    label: "opencode",
    how: { file: "opencode.json" },
    snippet: (url, auth) => json({ mcp: { [SERVER_NAME]: { type: "remote", url, headers: { Authorization: auth } } } }),
  },
  lmstudio: {
    label: "LM Studio",
    how: { file: "~/.lmstudio/mcp.json" },
    snippet: (url, auth) => json({ mcpServers: { [SERVER_NAME]: { url, headers: { Authorization: auth } } } }),
  },
  json: {
    label: "",
    how: { file: "" },
    snippet: (url, auth) =>
      json({ mcpServers: { [SERVER_NAME]: { type: "http", url, headers: { Authorization: auth } } } }),
  },
} satisfies Record<string, Setup>;

type Client = keyof typeof SETUPS;

function snippet(client: Client, url: string, token: string): string {
  return SETUPS[client].snippet(url, `Bearer ${token}`);
}

/** Shows a token by its ends only: the copy buttons carry the whole. */
const masked = (token: string) => `${token.slice(0, 4)}…${token.slice(-4)}`;

/**
 * useMcpStatus follows the AI assistant server: whether it's on and
 * running, where, with which token and tools. Saving the settings starts,
 * stops or moves it; it tells of each change itself too.
 */
export function useMcpStatus() {
  const [st, setSt] = useState<MCPStatus | null>(null);
  useEffect(() => {
    const refresh = () =>
      api
        .mcpStatus()
        .then(setSt)
        .catch(() => {});
    refresh();
    window.addEventListener(CONFIG_UPDATED_EVENT, refresh);
    const off = onEvent<MCPStatus>("mcp", setSt);
    return () => {
      window.removeEventListener(CONFIG_UPDATED_EVENT, refresh);
      off();
    };
  }, []);
  return [st, setSt] as const;
}

/**
 * McpServerRows are the server's rows in the Overview's panel, under its
 * switch and port: its address and its access token, or, if it couldn't
 * start, why. Nothing while it's off.
 */
export function McpServerRows({ st, onStatus }: { st: MCPStatus | null; onStatus: (st: MCPStatus) => void }) {
  const t = useT();
  const [err, setErr] = useState<string | null>(null);
  if (!st?.enabled) return null;
  if (!st.running) {
    return <CardRow inPanel tone="critical" icon={OctagonAlert} title={t("settings.mcp.failed")} desc={st.error} />;
  }
  const resetToken = async () => {
    setErr(null);
    try {
      onStatus(await api.mcpResetToken());
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };
  return (
    <>
      <Row title={t("settings.mcp.address")}>
        <span className="flex items-center gap-2">
          <Indicator grade="good" label={t("settings.mcp.running")} />
          <code className="selectable font-mono text-sm">{st.url}</code>
          <CopyButton value={st.url} />
        </span>
      </Row>
      <Row title={t("settings.mcp.token")} desc={t("settings.mcp.token.desc")}>
        <span className="flex items-center gap-1">
          <code className="font-mono text-sm text-muted-foreground">{masked(st.token)}</code>
          <CopyButton value={st.token} />
          <button type="button" onClick={resetToken} className="btn btn-ghost btn-sm">
            <RefreshCw className="size-3.5" />
            {t("settings.mcp.newToken")}
          </button>
        </span>
      </Row>
      {err && <CardRow inPanel tone="critical" icon={OctagonAlert} desc={err} />}
    </>
  );
}

/**
 * McpPanel is how to connect an assistant to the running server: the setup
 * for the common assistants or any client that reads an mcpServers config.
 */
export default function McpPanel({ st }: { st: MCPStatus | null }) {
  const t = useT();
  const [client, setClient] = useState<Client>("claude");
  if (!st?.enabled || !st.running) return null;

  const describe = (c: Client) => {
    const { label, how } = SETUPS[c];
    if (c === "json") return t("settings.mcp.json.desc");
    if ("run" in how) return t("settings.mcp.run.desc", { app: label });
    return t(c === "claudeDesktop" ? "settings.mcp.bridge.desc" : "settings.mcp.file.desc", { file: how.file });
  };

  const code = snippet(client, st.url, st.token);
  return (
    <Panel className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{t("settings.mcp.connect")}</span>
        <Select<Client>
          size="sm"
          value={client}
          onChange={setClient}
          aria-label={t("settings.mcp.connect")}
          options={(Object.keys(SETUPS) as Client[]).map((c) => ({
            value: c,
            label: c === "json" ? t("settings.mcp.jsonConfig") : SETUPS[c].label,
          }))}
        />
      </div>
      <p className="text-sm text-muted-foreground">{describe(client)}</p>
      <div className="flex items-start gap-2 rounded-lg bg-segment-well p-3">
        {/* The token is shown by its ends; the copy is whole */}
        <pre className="selectable min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
          {snippet(client, st.url, masked(st.token))}
        </pre>
        <CopyButton value={code} />
      </div>
      <p className="text-sm text-muted-foreground">{t("settings.mcp.tools", { n: st.tools?.length ?? 0 })}</p>
    </Panel>
  );
}
