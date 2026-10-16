import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { SeedCandidate, SeedPick, SeedScheme } from "../../lib/api";
import { formatLax, shortHex } from "../../lib/format";
import { useNode } from "../../lib/live";
import { STAGGER, useStagger } from "../../lib/motion";
import { useT } from "../../i18n";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { Notice } from "../../components/ui/bits";
import { Segmented } from "../../components/ui/Segmented";
import { useRescanUnread } from "./accountActions";
import { Part } from "./flow";
import { Pill } from "../../components/ui/Pill";

/** How many accounts a scan shows at a time. */
const BATCH = 5;
const SCHEMES: SeedScheme[] = ["standard", "ledgerlive", "legacy"];

export type Found = Record<SeedScheme, SeedCandidate[]>;
/** The word counts a recovery phrase can have. */
export const PHRASE_LENGTHS = [12, 15, 18, 21, 24];

// Picks follow the address: Ledger Live's first account is the standard
// first account, and must read as one choice in both lists
export const pickKey = (c: { address: string }) => c.address;

/** picksOf lists the picked accounts in a stable order (by scheme, then index), each address once. */
export function picksOf(found: Found, picked: Set<string>): SeedPick[] {
  const seen = new Set<string>();
  return SCHEMES.flatMap((scheme) =>
    found[scheme]
      .filter((c) => picked.has(pickKey(c)) && !seen.has(c.address) && seen.add(c.address))
      .map((c) => ({ scheme, index: c.index })),
  );
}

/**
 * AccountPicker lists the accounts a phrase holds under one path scheme at
 * a time, with their balances, to pick from; more load on demand.
 */
export function AccountPicker({
  found,
  picked,
  onToggle,
  onScan,
  error,
  initialScheme = "standard",
}: {
  found: Found;
  picked: Set<string>;
  onToggle: (c: SeedCandidate) => void;
  onScan: (scheme: SeedScheme, from: number) => Promise<void>;
  error: string | null;
  /** The path shown first. */
  initialScheme?: SeedScheme;
}) {
  const t = useT();
  const node = useNode();
  const stagger = useStagger();
  const [scheme, setScheme] = useState<SeedScheme>(initialScheme);
  const [loading, setLoading] = useState(false);
  const list = found[scheme];
  const readable = list.some((c) => c.balanceWei !== "");

  const load = async (s: SeedScheme, from: number) => {
    setLoading(true);
    await onScan(s, from);
    setLoading(false);
  };

  // A scheme's first batch loads when it is first shown
  useEffect(() => {
    if (found[scheme].length === 0) load(scheme, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme]);

  useRescanUnread(found, onScan, BATCH);

  return (
    <>
      <Part className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented<SeedScheme>
            options={[
              { value: "standard", label: t("wallet.import.scheme.standard") },
              { value: "ledgerlive", label: t("wallet.import.scheme.ledgerlive") },
              { value: "legacy", label: t("wallet.import.scheme.legacy") },
            ]}
            value={scheme}
            onChange={setScheme}
          />
          <span className="font-mono text-xs text-muted-foreground">{t(`wallet.import.schemePath.${scheme}`)}</span>
        </div>
        {(node && !node.running) || (list.length > 0 && !readable) ? (
          <Notice tone="info">{t("wallet.import.noBalances")}</Notice>
        ) : null}
      </Part>

      <motion.ul key={scheme} {...stagger} className="flex flex-col divide-y divide-border">
        {list.map((c) => (
          <motion.li key={`${c.scheme}/${c.index}`} variants={STAGGER.item}>
            <Candidate c={c} picked={picked.has(pickKey(c))} onToggle={() => onToggle(c)} />
          </motion.li>
        ))}
        {list.length === 0 && loading && (
          <li className="flex justify-center py-6 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </li>
        )}
      </motion.ul>

      <Part className="items-center py-2.5">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={loading || list.length === 0}
          onClick={() => load(scheme, list.length)}
        >
          {loading && list.length > 0 && <Loader2 className="size-3 animate-spin" />}
          {t("wallet.import.more")}
        </button>
        {error && <Notice tone="critical">{error}</Notice>}
      </Part>
    </>
  );
}

/** Candidate is one account of the phrase: whether it's picked, where it is, what it holds. */
function Candidate({ c, picked, onToggle }: { c: SeedCandidate; picked: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <label
      className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
        c.inWallet ? "opacity-50" : "cursor-pointer hover:bg-hover"
      } ${picked ? "bg-brand-muted/40" : ""}`}
    >
      <input
        type="checkbox"
        className="size-3.5 cursor-pointer accent-[var(--brand-fill)]"
        checked={picked || c.inWallet}
        disabled={c.inWallet}
        onChange={onToggle}
      />
      <AddressAvatar address={c.address} size={28} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm">{shortHex(c.address, 10, 8)}</span>
          {c.used && <Pill tone="brand">{t("wallet.import.used")}</Pill>}
          {c.inWallet && <span className="text-xs text-muted-foreground">{t("wallet.import.inWallet")}</span>}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{c.path}</span>
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
