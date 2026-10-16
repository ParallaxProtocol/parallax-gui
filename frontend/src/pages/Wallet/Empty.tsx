import { motion } from "motion/react";
import { Download, Eye, Plus, Settings2 } from "lucide-react";
import { useT } from "../../i18n";
import { STAGGER, useStagger } from "../../lib/motion";
import { EASE, Glow } from "../../components/ui/Glow";
import { LinkRow, LinkRows } from "../../components/ui/LinkRow";
import { LogoMark } from "../../components/ui/LogoMark";
import { useSettingsSheet } from "../../components/shell/SettingsSheet";
import { NODE_BAR_GAP, NODE_BAR_ROOM } from "../../components/shell/NodeBar";

/**
 * EmptyWallet is the window while the wallet, unlocked, holds no account:
 * as the greeting's pages, the window to itself, the glow behind, the
 * app's mark and the ways on as rows of glass cards, and Settings in a
 * pill floating at its foot, over the node's bar. Making and importing are Settings' Accounts
 * section's, opened at the flow chosen; once there is an account, the app
 * comes in (App's Shell).
 */
export function EmptyWallet() {
  const t = useT();
  const stagger = useStagger();
  const { openAt, setOpen } = useSettingsSheet();
  return (
    <div className="fixed inset-0 overflow-y-auto bg-background">
      <Glow />
      {/* The window's title bar: draggable, with room for its controls */}
      <div className="drag absolute inset-x-0 top-0 z-10 flex h-13 items-center">
        <span className="traffic-light-gap" />
        <span className="flex-1" />
        <span className="window-controls-gap" />
      </div>

      <div className="relative flex min-h-full flex-col items-center justify-center px-6 pt-16 pb-44">
        <motion.div {...stagger} className="flex w-full max-w-xl flex-col items-center gap-8">
          <motion.div variants={STAGGER.item} className="flex flex-col items-center gap-6 text-center">
            <LogoMark size={72} />
            <div className="flex flex-col items-center gap-3">
              <h1 className="text-4xl font-semibold tracking-tight">{t("wallet.welcome.title")}</h1>
              <p className="max-w-md text-muted-foreground">{t("wallet.welcome.desc")}</p>
            </div>
          </motion.div>
          <motion.div variants={STAGGER.item} className="flex w-full flex-col gap-2">
            <LinkRows>
              <LinkRow
                icon={Plus}
                title={t("wallet.welcome.create")}
                desc={t("wallet.welcome.createDesc")}
                onClick={() => openAt("accounts", { kind: "accounts.add" })}
                autoFocus
              />
              <LinkRow
                icon={Download}
                title={t("wallet.welcome.import")}
                desc={t("wallet.welcome.importDesc")}
                onClick={() => openAt("accounts", { kind: "accounts.import" })}
              />
            </LinkRows>
            <p className="px-4 text-sm text-muted-foreground">{t("wallet.welcome.local")}</p>
          </motion.div>
          <motion.div variants={STAGGER.item} className="w-full">
            <LinkRows>
              <LinkRow
                icon={Eye}
                title={t("offline.watch.title")}
                desc={t("wallet.welcome.watchDesc")}
                onClick={() => openAt("accounts", { kind: "accounts.watch" })}
              />
            </LinkRows>
          </motion.div>
        </motion.div>
      </div>

      {/* Settings, floating over the node's bar as the only way into the rest of the app */}
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        className="glass fixed z-20 flex h-10 items-center gap-2 rounded-full px-4 font-medium transition-colors hover:bg-[var(--glass-hover)]"
        // Over the node bar's left end, lined up with it
        style={{ left: NODE_BAR_GAP, bottom: NODE_BAR_ROOM }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.6, ease: EASE }}
      >
        <Settings2 className="size-4" strokeWidth={1.75} />
        {t("nav.settings")}
      </motion.button>
    </div>
  );
}
