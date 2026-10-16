import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ChevronDown, Loader2 } from "lucide-react";
import { SeedCandidate, SeedScheme } from "../../../lib/api";
import { formatLax, shortHex } from "../../../lib/format";
import { useNode } from "../../../lib/live";
import { STAGGER, useStagger } from "../../../lib/motion";
import { useT } from "../../../i18n";
import { Notice } from "../../../components/ui/bits";
import { Panel, Row, Rows } from "../../../components/ui/Panel";
import { Pill } from "../../../components/ui/Pill";
import { Segmented } from "../../../components/ui/Segmented";
import { AddressAvatar } from "../../../components/ui/AddressAvatar";
import { GroupedAddress } from "../../../components/ui/AccountParts";
import { useRescanUnread } from "../../Wallet/accountActions";
import { type Found, pickKey } from "../../Wallet/PhraseImport";
import { Group } from "../fields";

/** How many accounts a scan shows at a time. */
export const BATCH = 5;
const SCHEMES: SeedScheme[] = ["standard", "ledgerlive", "legacy"];

/**
 * PhrasePicker lists the accounts a recovery phrase holds to pick from, as
 * two Settings groups: the path to look along, as a setting, then the
 * accounts found there with what each holds (those used picked by the
 * scans, those in the wallet ticked off), more loading on demand. A path's
 * first batch loads when it is first shown, and scans read while the node
 * couldn't are read again once it can. onScan reports its own errors.
 */
export function PhrasePicker({
  found,
  picked,
  onToggle,
  onScan,
  error,
  aside,
  pathDesc,
  initialScheme = "standard",
}: {
  found: Found;
  picked: Set<string>;
  onToggle: (c: SeedCandidate) => void;
  onScan: (scheme: SeedScheme, from: number) => Promise<void>;
  error?: string | null;
  /** What acts on the picks, across from the accounts' title. */
  aside?: ReactNode;
  /** What the paths are, where they aren't a phrase's. */
  pathDesc?: string;
  /** The path shown first. */
  initialScheme?: SeedScheme;
}) {
  const t = useT();
  const node = useNode();
  const stagger = useStagger();
  const [scheme, setScheme] = useState<SeedScheme>(initialScheme);
  const [loading, setLoading] = useState(false);
  const load = async (s: SeedScheme, from: number) => {
    setLoading(true);
    await onScan(s, from);
    setLoading(false);
  };
  useRescanUnread(found, onScan, BATCH);

  useEffect(() => {
    if (found[scheme].length === 0) load(scheme, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme]);

  const list = found[scheme];
  const unread = (node && !node.running) || list.some((c) => c.balanceWei === "");

  return (
    <>
      <Group title={t("wallet.find.pathGroup")} desc={pathDesc ?? t("wallet.find.pathDesc")}>
        <Rows>
          <Row
            title={t("wallet.find.path")}
            desc={<span className="font-mono">{t(`wallet.import.schemePath.${scheme}`)}</span>}
          >
            <Segmented<SeedScheme>
              options={SCHEMES.map((s) => ({ value: s, label: t(`wallet.import.scheme.${s}`) }))}
              value={scheme}
              onChange={setScheme}
            />
          </Row>
        </Rows>
      </Group>

      <Group title={t("wallet.find.accountsGroup")} desc={t("wallet.find.accountsDesc")} aside={aside}>
        {unread && <Notice tone="info">{t("wallet.import.noBalances")}</Notice>}
        <Panel className="overflow-hidden">
          <motion.ul key={scheme} {...stagger} className="divide-y divide-border">
            {list.map((c) => (
              <motion.li key={`${c.scheme}/${c.index}`} variants={STAGGER.item}>
                <FoundRow c={c} picked={picked.has(pickKey(c))} onToggle={() => onToggle(c)} />
              </motion.li>
            ))}
            {list.length === 0 && loading && (
              <li className="flex h-16 items-center justify-center text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </li>
            )}
          </motion.ul>
          {list.length > 0 && (
            <button
              type="button"
              disabled={loading}
              onClick={() => load(scheme, list.length)}
              className="flex h-12 w-full items-center justify-center gap-1.5 border-t border-border text-sm font-medium text-brand transition-colors enabled:hover:bg-hover disabled:opacity-60"
            >
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronDown className="size-3.5" />}
              {t("wallet.import.more")}
            </button>
          )}
        </Panel>
        {error && <Notice tone="critical">{error}</Notice>}
      </Group>
    </>
  );
}

/**
 * FoundRow is one account the phrase holds, as the Accounts list draws
 * one: picked or not, its whole address grouped as a card number is
 * (shortened where the row has no room), where under the phrase it is,
 * and what it holds.
 */
function FoundRow({ c, picked, onToggle }: { c: SeedCandidate; picked: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <label
      className={`flex items-center gap-3.5 px-4 py-3 transition-colors ${
        c.inWallet ? "" : "cursor-pointer hover:bg-hover"
      } ${picked ? "bg-brand-muted/40" : ""}`}
    >
      <input
        type="checkbox"
        className="size-4 shrink-0 cursor-pointer accent-[var(--brand-fill)] disabled:cursor-default"
        checked={picked || c.inWallet}
        disabled={c.inWallet}
        onChange={onToggle}
      />
      <AddressAvatar address={c.address} size={36} className={c.inWallet ? "opacity-50" : ""} />
      <span className={`@container flex min-w-0 flex-1 flex-col gap-0.5 ${c.inWallet ? "opacity-60" : ""}`}>
        <span className="hidden truncate @md:block">
          <GroupedAddress address={c.address} />
        </span>
        <span className="font-mono @md:hidden">{shortHex(c.address, 10, 8)}</span>
        <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <span className="truncate font-mono">{c.path}</span>
          {c.used && <Pill tone="brand">{t("wallet.import.used")}</Pill>}
          {c.inWallet && <Pill>{t("wallet.import.inWallet")}</Pill>}
        </span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        {c.balanceWei !== "" ? (
          <>
            {formatLax(c.balanceWei, 6)} <span className="text-muted-foreground">LAX</span>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </span>
    </label>
  );
}
