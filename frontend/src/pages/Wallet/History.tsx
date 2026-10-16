import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { sameAddress } from "../../lib/format";
import { useNow } from "../../lib/useNow";
import { useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Notice } from "../../components/ui/bits";
import { PAGE_WIDE } from "../../lib/layout";
import { useSummary } from "./common";
import { ActivitySection, PendingSection, paramsFromView, viewFromParams, type HistoryView } from "./Activity";

/**
 * HistoryPage is the selected account's whole history: what waits in the
 * pool above, everything since its first block below, to filter, search,
 * start from a date and export. The view is kept in the URL, so Back
 * returns to the one before and other places link straight in: a
 * contact's history (?with=), a notification's transaction (?tx=, with
 * ?account= for one of the wallet's other accounts).
 */
export default function HistoryPage() {
  const t = useT();
  const now = useNow(5000);
  const { info, account, select } = useWallet();
  const [params, setParams] = useSearchParams();
  const { view: summary, err, refresh } = useSummary(account?.address);
  const [focus, setFocus] = useState<{ hash: string; at: number } | null>(null);

  // A link for another of the wallet's accounts shows that one
  const wanted = params.get("account");
  const known = !!wanted && !!info?.accounts.some((a) => sameAddress(a.address, wanted));
  const switching = known && !sameAddress(account?.address, wanted);
  useEffect(() => {
    if (switching) select(wanted!).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, switching]);

  // Another account picked here (in the sidebar), the view made for this one goes
  const shown = useRef(account?.address);
  useEffect(() => {
    if (!account || sameAddress(shown.current, account.address)) return;
    shown.current = account.address;
    if (!sameAddress(wanted ?? "", account.address)) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.address]);

  if (!info || !account) {
    return (
      <div className={`p-5 ${PAGE_WIDE}`}>
        <Notice
          tone="info"
          action={
            <Link to="/" className="btn btn-tinted">
              {t("wallet.welcome.cta")}
            </Link>
          }
        >
          {t("wallet.noAccount")}
        </Notice>
      </div>
    );
  }
  if (switching) return null;

  const view = viewFromParams(params);
  const onView = (v: HistoryView, replace = false) => setParams(paramsFromView(v), { replace });

  return (
    <div className={`flex flex-col gap-6 p-5 ${PAGE_WIDE}`}>
      {err && <Notice tone="critical">{err}</Notice>}
      <PendingSection view={summary} refresh={refresh} now={now} focus={focus} />
      <ActivitySection
        address={account.address}
        head={summary?.headBlock ?? 0}
        now={now}
        view={view}
        onView={onView}
        onFoundPending={(hash) => setFocus({ hash, at: Date.now() })}
        // Headed only to set it apart from the Pending section above; the page's title says the rest
        titled={(summary?.pending.length ?? 0) > 0}
      />
    </div>
  );
}
