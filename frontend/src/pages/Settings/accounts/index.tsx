import { ScrollText, Usb } from "lucide-react";
import type { SettingsPage } from "../../../components/shell/SettingsSheet";
import { useWallet } from "../../../lib/wallet";
import { useT } from "../../../i18n";
import { AddAccounts, ImportAccounts } from "./Add";
import { FindAccounts } from "./Find";
import { FindHardwareAccounts } from "./Hardware";
import { DEVICE_NAME } from "../../../components/hardware/Device";
import { DrillIn } from "./flow";

/**
 * AccountPage is a page the Accounts section drills into: adding accounts,
 * importing them, or finding more of a recovery phrase's or a hardware
 * wallet's. Leaving it, or finishing, comes
 * back to the list, where the account added is the one selected.
 */
export function AccountPage({ page, onLeave }: { page: SettingsPage; onLeave: () => void }) {
  const t = useT();
  const wallet = useWallet();
  const parent = t("settings.section.accounts");

  if (page.kind === "accounts.find") {
    // A phrase removed meanwhile (by another tool) has nothing to find
    const seed = wallet.info?.seeds.find((s) => s.id === page.seedId);
    if (!seed) return null;
    return (
      <DrillIn
        title={t("wallet.find.cta")}
        subtitle={
          <span className="flex items-center gap-1.5">
            <ScrollText className="size-4" />
            {seed.name}
          </span>
        }
        parent={parent}
        onLeave={onLeave}
      >
        <FindAccounts seed={seed} onLeave={onLeave} onDone={onLeave} />
      </DrillIn>
    );
  }
  if (page.kind === "accounts.findHardware") {
    // A hardware wallet whose last account went meanwhile has nothing to find
    const hw = page.wallet ? wallet.info?.hardwareWallets.find((w) => w.id === page.wallet) : null;
    if (page.wallet && !hw) return null;
    return (
      <DrillIn
        title={t("wallet.find.cta")}
        subtitle={
          <span className="flex items-center gap-1.5">
            <Usb className="size-4" />
            {hw?.name ?? DEVICE_NAME[page.device]}
          </span>
        }
        parent={parent}
        onLeave={onLeave}
      >
        <FindHardwareAccounts kind={page.device} wallet={hw ?? null} onLeave={onLeave} onDone={onLeave} />
      </DrillIn>
    );
  }
  if (page.kind === "accounts.import" || page.kind === "accounts.watch") {
    return (
      <DrillIn title={t("wallet.accounts.importTitle")} parent={parent} onLeave={onLeave}>
        <ImportAccounts
          initial={page.kind === "accounts.watch" ? "watch" : undefined}
          onLeave={onLeave}
          onDone={onLeave}
        />
      </DrillIn>
    );
  }
  return (
    <DrillIn title={t("wallet.accounts.createTitle")} parent={parent} onLeave={onLeave}>
      <AddAccounts onLeave={onLeave} onDone={onLeave} />
    </DrillIn>
  );
}
