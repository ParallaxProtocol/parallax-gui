import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { api, openExternal } from "../../lib/api";
import { useLive } from "../../lib/live";
import { SPRING } from "../../lib/motion";
import { useNow } from "../../lib/useNow";
import { useAgo, useT } from "../../i18n";
import { Indicator } from "../../components/ui/Indicator";
import { Label, Plate } from "../../components/ui/Plate";
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
  const { node, wallet, refresh } = useLive();
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
    <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
      <Plate className="p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-md border border-border-strong bg-background font-mono text-sm font-semibold">
              MM
            </span>
            <div>
              <div className="font-medium">MetaMask</div>
              <div className="text-xs text-muted-foreground">{t("wallet.connector.desc")}</div>
            </div>
          </div>
          <span
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
              live ? "border-brand/50 text-brand" : "border-border-strong text-muted-foreground"
            }`}
          >
            <Indicator grade={live ? "good" : "off"} ping={live} cause={String(live)} />
            {live ? t("wallet.connected") : t("wallet.notConnected")}
          </span>
        </div>

        <ol className="relative flex flex-col">
          <Step index={1} state={state(0)} title={t("wallet.step.node")} desc={t("wallet.step.node.desc")}>
            {!running && (
              <button type="button" className="btn btn-primary btn-sm" onClick={start} disabled={starting}>
                {starting && <Loader2 className="size-3.5 animate-spin" />}
                {starting ? t("node.starting") : t("node.start")}
              </button>
            )}
          </Step>
          <Step index={2} state={state(1)} title={t("wallet.step.rpc")} desc={t("wallet.step.rpc.desc")}>
            {running && !rpc && (
              <Link to="/settings" className="btn btn-secondary btn-sm">
                {t("wallet.step.rpc.cta")}
              </Link>
            )}
          </Step>
          <Step index={3} state={state(2)} title={t("wallet.step.add")} desc={t("wallet.step.add.desc")}>
            {rpc && (
              <button
                type="button"
                className={`btn btn-sm ${live ? "btn-secondary" : "btn-primary"}`}
                disabled={!helperURL}
                onClick={() => helperURL && openExternal(helperURL)}
              >
                {t("wallet.step.add.cta")} <ExternalLink className="size-3.5" />
              </button>
            )}
          </Step>
          <Step
            index={4}
            state={state(3)}
            title={t("wallet.step.live")}
            desc={
              live
                ? t("wallet.step.live.seen", { ago: ago(wallet.lastSeenUnixMilli / 1000, now) })
                : t("wallet.step.live.desc")
            }
            last
          />
        </ol>
        {err && <Notice tone="critical" className="mt-4">{err}</Notice>}
      </Plate>

      <Plate className="flex flex-col p-6">
        <Label as="h3" className="mb-1">{t("wallet.manual")}</Label>
        <p className="mb-5 text-sm text-muted-foreground">{t("wallet.manual.desc")}</p>
        <dl className="flex flex-col divide-y divide-border rounded-md border border-border bg-background">
          <ManualRow label={t("connect.networkName")} value="Parallax" />
          <ManualRow label={t("connect.rpcUrl")} value={node?.rpcEndpoint || ""} />
          <ManualRow label={t("connect.chainId")} value={node ? String(node.chainId) : ""} />
          <ManualRow label={t("connect.currency")} value="LAX" />
        </dl>
        <p className="mt-auto pt-5 text-xs leading-relaxed text-muted-foreground">
          {t("connect.loopbackPrefix")} <span className="font-mono">127.0.0.1</span>{" "}
          {t("connect.loopbackNote")}
        </p>
      </Plate>
    </div>
  );
}

function ManualRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span className="truncate font-mono text-sm">{value || "—"}</span>
        {value && <CopyButton value={value} compact className="-my-1" />}
      </dd>
    </div>
  );
}

function Step({
  index,
  state,
  title,
  desc,
  last,
  children,
}: {
  index: number;
  state: StepState;
  title: string;
  desc: string;
  last?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      {/* The rail to the next step fills with the gradient once this one is done */}
      {!last && (
        <span className="absolute top-8 bottom-0 left-[15px] w-px bg-border">
          <motion.span
            className="brand-gradient-mark absolute inset-x-0 top-0 origin-top"
            initial={false}
            animate={{ height: state === "done" ? "100%" : "0%" }}
            transition={SPRING}
          />
        </span>
      )}
      <motion.span
        className={`relative grid size-8 shrink-0 place-items-center rounded-full border font-mono text-xs ${
          state === "done"
            ? "brand-gradient border-transparent text-brand-foreground"
            : state === "current"
              ? "border-brand text-brand"
              : "border-border-strong text-muted-foreground"
        }`}
        initial={false}
        animate={{ scale: state === "current" ? 1.06 : 1 }}
        transition={SPRING}
      >
        {state === "done" ? <Check className="size-4" strokeWidth={2.5} /> : index}
      </motion.span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
        <span className={`text-sm font-medium ${state === "todo" ? "text-muted-foreground" : ""}`}>{title}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">{desc}</span>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </li>
  );
}
