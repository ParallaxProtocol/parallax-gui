import { useEffect, useState } from "react";
import { api, NodeStatus, openExternal } from "../lib/api";
import { useWalletStatus } from "../lib/useWalletStatus";
import SectionHeading from "../components/SectionHeading";
import { PageStagger, StaggerItem } from "../components/PageStagger";
import { useT } from "../i18n";

export default function Connect() {
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [helperURL, setHelperURL] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const wallet = useWalletStatus();
  const t = useT();

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const s = await api.nodeStatus();
        if (alive) setStatus(s);
      } catch {
        /* swallow */
      }
    };
    refresh();
    const id = setInterval(refresh, 4000);
    api.metaMaskHelperURL().then((u) => alive && setHelperURL(u)).catch(() => {});
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const copyEndpoint = async () => {
    if (!status?.rpcEndpoint) return;
    await navigator.clipboard.writeText(status.rpcEndpoint);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const enabled = !!status?.running && !!status?.rpcEndpoint;

  return (
    <PageStagger className="space-y-12 max-w-3xl mx-auto">
      <StaggerItem>
        <SectionHeading
          eyebrow={t("connect.eyebrow")}
          title={t("connect.title")}
          subtitle={t("connect.subtitle")}
        />
      </StaggerItem>

      {enabled && wallet.connected && (
        <StaggerItem>
          <div className="card border-success/40 bg-success/10">
            <div className="flex items-start gap-4">
              <span className="live-dot-success mt-2" />
              <div>
                <div className="eyebrow text-success mb-1">{t("connect.connected")}</div>
                <p className="text-sm text-fg leading-relaxed">
                  {t("connect.connected.desc")}
                </p>
              </div>
            </div>
          </div>
        </StaggerItem>
      )}

      {!enabled && (
        <StaggerItem>
          <div className="card border-gold/40 bg-gold-muted text-fg">
            <div className="eyebrow mb-2">{t("connect.notAvailable")}</div>
            <p className="text-sm text-fg/80 leading-relaxed">
              {status?.running
                ? t("connect.rpcDisabled")
                : t("connect.nodeStopped")}
            </p>
          </div>
        </StaggerItem>
      )}

      {enabled && (
        <StaggerItem>
          <section className="card-featured">
            <div className="eyebrow mb-3">{t("connect.oneClick")}</div>
            <h2 className="display-sm mb-3">{t("connect.addTitle")}</h2>
            <p className="text-muted leading-relaxed mb-6 max-w-lg">
              {t("connect.addDesc")}
            </p>
            <button
              className="btn-primary"
              disabled={!helperURL}
              onClick={() => helperURL && openExternal(helperURL)}
            >
              {t("connect.addCta")}
            </button>
            <p className="text-xs text-muted mt-5 leading-relaxed">
              {t("connect.noMetaMask")}
            </p>
          </section>
        </StaggerItem>
      )}

      {enabled && (
        <StaggerItem>
          <section className="card">
            <div className="eyebrow mb-6">{t("connect.manualSetup")}</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
              <Field label={t("connect.rpcUrl")}>
                <div className="flex items-center gap-3">
                  <code className="font-mono text-sm text-fg">
                    {status!.rpcEndpoint}
                  </code>
                  <button onClick={copyEndpoint} className="link-arrow">
                    {copied ? t("common.copied") : t("common.copy")}
                  </button>
                </div>
              </Field>
              <Field label={t("connect.chainId")}>
                <code className="font-mono text-sm text-fg">{status!.chainId}</code>
              </Field>
              <Field label={t("connect.currency")}>
                <code className="font-mono text-sm text-fg">LAX</code>
              </Field>
              <Field label={t("connect.networkName")}>
                <code className="font-mono text-sm text-fg">Parallax</code>
              </Field>
            </div>

            <p className="text-xs text-muted mt-7 leading-relaxed">
              {t("connect.loopbackPrefix")}{" "}
              <span className="font-mono">127.0.0.1</span> {t("connect.loopbackNote")}
            </p>
          </section>
        </StaggerItem>
      )}
    </PageStagger>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      <div>{children}</div>
    </div>
  );
}
