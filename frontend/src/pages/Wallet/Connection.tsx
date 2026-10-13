import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { api, openExternal } from "../../lib/api";
import { useNode, useRefresh, useWallet } from "../../lib/live";
import { useNow } from "../../lib/useNow";
import { useAgo, useT } from "../../i18n";
import { Indicator } from "../../components/ui/Indicator";
import { Property, Rows, Section } from "../../components/ui/Panel";
import { CopyButton, Notice } from "../../components/ui/bits";

type StepState = "done" | "current" | "todo";

/**
 * Connection walks the user from a stopped node to a wallet signing
 * against it: node running, local RPC on, the network added to MetaMask,
 * and the wallet live. Each step ticks off as the backend reports it.
 */
export default function Connection() {
  const t = useT();
  const ago = useAgo();
  const now = useNow(5000);
  const node = useNode();
  const wallet = useWallet();
  const refresh = useRefresh();
  const [helperURL, setHelperURL] = useState("");
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.metaMaskHelperURL().then(setHelperURL).catch(() => {});
  }, []);

  const running = !!node?.running;
  const rpc = running && !!node?.rpcEndpoint;
  const live = rpc && wallet.connected;

  const done = [running, rpc, live, live];
  const firstOpen = done.indexOf(false);
  const state = (i: number): StepState => (done[i] ? "done" : i === firstOpen ? "current" : "todo");

  const start = async () => {
    setStarting(true);
    setErr(null);
    try {
      await api.startNode();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setStarting(false);
      refresh();
    }
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[3fr_2fr]">
      <Section
        title={t("wallet.section.connection")}
        aside={
          <span className="flex items-center gap-1.5">
            <Indicator grade={live ? "good" : "off"} ping={live} cause={String(live)} />
            {live ? t("wallet.connected") : t("wallet.notConnected")}
          </span>
        }
      >
        <Rows as="ol">
          <Step state={state(0)} title={t("wallet.step.node")} desc={t("wallet.step.node.desc")}>
            {!running && (
              <button type="button" className="btn btn-primary" onClick={start} disabled={starting}>
                {starting && <Loader2 className="size-3.5 animate-spin" />}
                {starting ? t("node.starting") : t("node.start")}
              </button>
            )}
          </Step>
          <Step state={state(1)} title={t("wallet.step.rpc")} desc={t("wallet.step.rpc.desc")}>
            {running && !rpc && (
              <Link to="/settings" className="btn btn-secondary">
                {t("wallet.step.rpc.cta")}
              </Link>
            )}
          </Step>
          <Step state={state(2)} title={t("wallet.step.add")} desc={t("wallet.step.add.desc")}>
            {rpc && (
              <button
                type="button"
                className={`btn ${live ? "btn-secondary" : "btn-primary"}`}
                disabled={!helperURL}
                onClick={() => helperURL && openExternal(helperURL)}
              >
                {t("wallet.step.add.cta")} <ExternalLink className="size-3.5" />
              </button>
            )}
          </Step>
          <Step
            state={state(3)}
            title={t("wallet.step.live")}
            desc={
              live
                ? t("wallet.step.live.seen", { ago: ago(wallet.lastSeenUnixMilli / 1000, now) })
                : t("wallet.step.live.desc")
            }
          />
        </Rows>
        {err && <Notice tone="critical">{err}</Notice>}
      </Section>

      <Section title={t("wallet.manual")}>
        <Rows as="dl">
          <ManualRow label={t("connect.networkName")} value="Parallax" />
          <ManualRow label={t("connect.rpcUrl")} value={node?.rpcEndpoint || ""} />
          <ManualRow label={t("connect.chainId")} value={node ? String(node.chainId) : ""} />
          <ManualRow label={t("connect.currency")} value="LAX" />
        </Rows>
        <p className="px-1 text-sm text-muted-foreground">
          {t("wallet.manual.desc")} {t("connect.loopbackPrefix")} <span className="font-mono">127.0.0.1</span>{" "}
          {t("connect.loopbackNote")}
        </p>
      </Section>
    </div>
  );
}

function ManualRow({ label, value }: { label: string; value: string }) {
  return (
    <Property label={label} mono={!!value}>
      <span className="truncate">{value || "—"}</span>
      {value && <CopyButton value={value} className="-my-1 -mr-2" />}
    </Property>
  );
}

const STEP_ICON: Record<StepState, ReactNode> = {
  done: (
    <span className="grid size-5 place-items-center rounded-full bg-brand-fill text-brand-foreground">
      <Check className="size-3" strokeWidth={3} />
    </span>
  ),
  current: <span className="size-5 rounded-full border-2 border-brand-mark" />,
  todo: <span className="size-5 rounded-full border border-border-strong" />,
};

/** Step is one row of the checklist: its state, what it is, and the action that completes it. */
function Step({
  state,
  title,
  desc,
  children,
}: {
  state: StepState;
  title: string;
  desc: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2.5">
      <span className="shrink-0">{STEP_ICON[state]}</span>
      <div className="min-w-0 flex-1">
        <div className={state === "todo" ? "text-muted-foreground" : ""}>{title}</div>
        <div className="text-sm text-muted-foreground">{desc}</div>
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </li>
  );
}
