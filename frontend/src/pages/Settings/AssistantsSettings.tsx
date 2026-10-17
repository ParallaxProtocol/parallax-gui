import { Ban, FlaskConical } from "lucide-react";
import { Notice } from "../../components/ui/bits";
import { CardRow } from "../../components/ui/CardRow";
import type { GUIConfig, MCPAllow, MCPMode } from "../../lib/api";
import { useT } from "../../i18n";
import { Panel, Row, Rows } from "../../components/ui/Panel";
import Toggle from "../../components/ui/Toggle";
import { Segmented } from "../../components/ui/Segmented";
import { Fold, Group, NumberInput, Reveal, Setting } from "./fields";
import McpPanel, { McpServerRows, useMcpStatus } from "./McpPanel";
import { useNode } from "../../lib/live";
import { NodeOffRow } from "../Wallet/common";

/** The permissions in each group, in the order they're listed. */
const SEE: (keyof MCPAllow)[] = ["nodeStatus", "nodeLogs", "wallet", "contacts"];
/** The public services: on or off, as changing them restarts the server. */
const PUBLIC: ("explorer" | "statusPage")[] = ["explorer", "statusPage"];
const DO: (keyof MCPAllow)[] = ["startNode", "lockApp"];
const ASK: (keyof MCPAllow)[] = [
  "sendTransactions",
  "stopNode",
  "settings",
  "tor",
  "newAccounts",
  "watchOnly",
  "editContacts",
];

/** What no assistant can do, whatever is allowed above: listed so it's plain. */
const NEVER = ["seeds", "keys", "remove", "password", "unlock", "send", "exposure", "offline", "access"];

type PageProps = { cfg: GUIConfig; update: (patch: Partial<GUIConfig>) => void };

/** AssistantsOverview is the AI assistants' Overview: the MCP server and how to connect to it. */
export function AssistantsOverview({ cfg, update }: PageProps) {
  const t = useT();
  const node = useNode();
  const [st, setSt] = useMcpStatus();
  return (
    <Group title={t("settings.group.mcp")} desc={t("settings.mcp.desc")} more={t("settings.mcp.more")}>
      <Rows>
        <Setting title={t("settings.mcp.enable")} desc={t("settings.mcp.enable.desc")}>
          <Toggle
            checked={cfg.mcpEnabled}
            onChange={(v) => update({ mcpEnabled: v })}
            label={t("settings.mcp.enable")}
          />
        </Setting>
        <Reveal show={cfg.mcpEnabled}>
          <Setting title={t("settings.mcp.port")} desc={t("settings.mcp.port.desc")}>
            <NumberInput
              width="w-24"
              min={1}
              value={cfg.mcpPort || 8549}
              onChange={(v) => update({ mcpPort: v || 8549 })}
            />
          </Setting>
        </Reveal>
        {/* Where the server listens and with which token, once it runs */}
        <Reveal show={!!st?.enabled}>
          <McpServerRows st={st} onStatus={setSt} />
        </Reveal>
      </Rows>
      <McpPanel st={st} />
      {/* It needs the node, not HTTP-RPC: said apart, at the page's foot, with the way to start it, while the node is down */}
      {cfg.mcpEnabled && node && !node.running && (
        <Panel>
          <NodeOffRow inPanel desc={t("settings.mcp.nodeStopped")} />
        </Panel>
      )}
    </Group>
  );
}

/**
 * AssistantsPermissions is feature by feature what assistants may see, do,
 * and ask for (each request approved in the app), and what they never can.
 */
export function AssistantsPermissions({ cfg, update }: PageProps) {
  const t = useT();
  const set = (key: keyof MCPAllow, v: MCPMode | boolean) => update({ mcpAllow: { ...cfg.mcpAllow, [key]: v } });
  const mode = (key: keyof MCPAllow): MCPMode => (cfg.mcpAllow?.[key] as MCPMode) || "ask";
  const label = (key: keyof MCPAllow) => t(`settings.mcp.allow.${key}`);
  const desc = (key: keyof MCPAllow) => t(`settings.mcp.allow.${key}.desc`);
  // Allow, Ask or Block: what the app does when an assistant uses it
  const permission = (key: keyof MCPAllow) => (
    <Setting key={key} title={label(key)} desc={desc(key)}>
      <Segmented
        size="sm"
        value={mode(key)}
        onChange={(v) => set(key, v)}
        options={[
          { value: "allow", label: t("settings.mcp.mode.allow") },
          { value: "ask", label: t("settings.mcp.mode.ask") },
          { value: "block", label: t("settings.mcp.mode.block") },
        ]}
      />
    </Setting>
  );
  // Requests are approved one by one: assistants may ask, or not
  const request = (key: keyof MCPAllow) => (
    <Setting key={key} title={label(key)} desc={desc(key)}>
      <Segmented
        size="sm"
        value={mode(key) === "block" ? "block" : "ask"}
        onChange={(v) => set(key, v)}
        options={[
          { value: "ask", label: t("settings.mcp.mode.ask") },
          { value: "block", label: t("settings.mcp.mode.block") },
        ]}
      />
    </Setting>
  );
  const toggle = (key: "explorer" | "statusPage") => (
    <Setting key={key} title={label(key)} desc={desc(key)}>
      <Toggle checked={!!cfg.mcpAllow?.[key]} onChange={(v) => set(key, v)} label={label(key)} />
    </Setting>
  );

  return (
    <>
      {/* At the page's top, above its next part by the page's gap (gap-7) */}
      <Fold show={!cfg.mcpEnabled} gap={28}>
        <Notice
          tone="info"
          action={
            <button type="button" className="btn btn-tinted btn-sm" onClick={() => update({ mcpEnabled: true })}>
              {t("settings.mcp.turnOn")}
            </button>
          }
        >
          {t("settings.mcp.permissionsOff")}
        </Notice>
      </Fold>
      <Group title={t("settings.mcp.see")} desc={t("settings.mcp.see.desc")}>
        <Rows>
          <Row title={t("settings.mcp.allow.chain")} desc={t("settings.mcp.allow.chain.desc")}>
            <span className="text-sm text-muted-foreground">{t("settings.mcp.always")}</span>
          </Row>
          {SEE.map(permission)}
        </Rows>
      </Group>

      <Group title={t("settings.mcp.public")} desc={t("settings.mcp.public.desc")}>
        <Rows>
          {/* On the development chain they're beside the point: said first, as a row of the group */}
          {cfg.devChain && <CardRow inPanel tone="info" icon={FlaskConical} desc={t("settings.mcp.public.dev")} />}
          {PUBLIC.map(toggle)}
        </Rows>
      </Group>

      <Group title={t("settings.mcp.do")} desc={t("settings.mcp.do.desc")}>
        <Rows>{DO.map(permission)}</Rows>
      </Group>

      <Group title={t("settings.mcp.ask")} desc={t("settings.mcp.ask.desc")}>
        <Rows>{ASK.map(request)}</Rows>
      </Group>

      <Group title={t("settings.mcp.never")} desc={t("settings.mcp.never.desc")}>
        <Rows>
          {NEVER.map((k) => (
            <Row key={k} title={t(`settings.mcp.never.${k}`)}>
              <Ban className="size-4 text-muted-foreground" aria-hidden />
            </Row>
          ))}
        </Rows>
      </Group>
    </>
  );
}
