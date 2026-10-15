import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, onEvent, type MCPStatus } from "../../lib/api";
import { useT } from "../../i18n";
import { CONFIG_UPDATED_EVENT } from "../../App";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Indicator } from "../../components/ui/Indicator";
import { Panel, Row, Rows } from "../../components/ui/Panel";
import { Segmented } from "../../components/ui/Segmented";
import { useNode, useRefresh } from "../../lib/live";

/** The name assistants list the server under. */
const SERVER_NAME = "parallax-wallet-app";

type Client = "claude" | "json";

function snippet(client: Client, url: string, token: string): string {
  if (client === "claude") {
    return `claude mcp add --transport http ${SERVER_NAME} ${url} --header "Authorization: Bearer ${token}"`;
  }
  return JSON.stringify(
    { mcpServers: { [SERVER_NAME]: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
}

/** Shows a token by its ends only: the copy buttons carry the whole. */
const masked = (token: string) => `${token.slice(0, 4)}…${token.slice(-4)}`;

/**
 * McpPanel shows whether the AI assistant server runs and how to connect
 * an assistant to it: its address, its access token, and the setup for
 * Claude Code or any client that reads an mcpServers config.
 */
export default function McpPanel() {
  const t = useT();
  const [st, setSt] = useState<MCPStatus | null>(null);
  const [client, setClient] = useState<Client>("claude");
  const [err, setErr] = useState<string | null>(null);
  const node = useNode();
  const refreshNode = useRefresh();

  useEffect(() => {
    const refresh = () => api.mcpStatus().then(setSt).catch(() => {});
    refresh();
    // Saving the settings starts, stops or moves the server
    window.addEventListener(CONFIG_UPDATED_EVENT, refresh);
    const off = onEvent<MCPStatus>("mcp", setSt);
    return () => {
      window.removeEventListener(CONFIG_UPDATED_EVENT, refresh);
      off();
    };
  }, []);

  if (!st?.enabled) return null;
  if (!st.running) {
    return <Notice tone="critical" title={t("settings.mcp.failed")}>{st.error}</Notice>;
  }

  const resetToken = async () => {
    setErr(null);
    try {
      setSt(await api.mcpResetToken());
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };

  const code = snippet(client, st.url, st.token);
  return (
    <>
      {/* It needs the node, not HTTP-RPC: say so when the node is down */}
      {node && !node.running && (
        <Notice
          tone="warn"
          action={
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                api
                  .startNode()
                  .then(refreshNode)
                  .catch((e: any) => setErr(e?.message || String(e)))
              }
            >
              {t("settings.mcp.startNode")}
            </button>
          }
        >
          {t("settings.mcp.nodeStopped")}
        </Notice>
      )}
      <Rows>
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
      </Rows>
      {err && <Notice tone="critical">{err}</Notice>}

      <Panel className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">{t("settings.mcp.connect")}</span>
          <Segmented
            size="sm"
            value={client}
            onChange={setClient}
            options={[
              { value: "claude", label: "Claude Code" },
              { value: "json", label: t("settings.mcp.jsonConfig") },
            ]}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {client === "claude" ? t("settings.mcp.claude.desc") : t("settings.mcp.json.desc")}
        </p>
        <div className="flex items-start gap-2 rounded-lg bg-segment-well p-3">
          {/* The token is shown by its ends; the copy is whole */}
          <pre className="selectable min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
            {snippet(client, st.url, masked(st.token))}
          </pre>
          <CopyButton value={code} />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("settings.mcp.tools", { n: st.tools?.length ?? 0 })}
        </p>
      </Panel>
    </>
  );
}
