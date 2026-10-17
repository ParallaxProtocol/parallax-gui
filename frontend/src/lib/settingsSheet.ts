import { createContext, useContext } from "react";
import type { HardwareKind } from "./api";

export const SETTINGS_SECTIONS = [
  "general",
  "appearance",
  "privacy",
  "storage",
  "accounts",
  "security",
  "node",
  "network",
  "rpc",
  "assistants",
  "permissions",
  "diagnostics",
  "about",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * The pages a section drills into, in place of the section. Finding a
 * phrase's accounts carries the password that opened it and the accounts
 * first read, for as long as the page shows.
 */
export type SettingsPage =
  | { kind: "accounts.add" }
  | { kind: "accounts.import" }
  /** Importing, at following a watch-only account (an offline signer's) */
  | { kind: "accounts.watch" }
  | { kind: "accounts.find"; seedId: string }
  /** Finding more of a hardware wallet's accounts ("" for those of no known wallet), on a device of its kind */
  | { kind: "accounts.findHardware"; device: HardwareKind; wallet: string };

/** pageKey tells pages apart, for their transitions: by what they show, not the secrets they hold. */
export const pageKey = (p: SettingsPage) =>
  p.kind === "accounts.find"
    ? `${p.kind}:${p.seedId}`
    : p.kind === "accounts.findHardware"
      ? `${p.kind}:${p.device}:${p.wallet}`
      : p.kind;

// Whether Settings is open, over the page it was opened from, and the
// section it shows (General each time it opens, unless it was opened at
// another), and the page within it drilled into, if any (not kept: a flow
// left half done starts over)
type Sheet = {
  open: boolean;
  setOpen: (open: boolean) => void;
  section: SettingsSection;
  setSection: (section: SettingsSection) => void;
  page: SettingsPage | null;
  setPage: (page: SettingsPage | null) => void;
  /** openAt opens Settings at a section, or at a page within it. */
  openAt: (section: SettingsSection, page?: SettingsPage) => void;
};
export const SheetContext = createContext<Sheet>({
  open: false,
  setOpen: () => {},
  section: "general",
  setSection: () => {},
  page: null,
  setPage: () => {},
  openAt: () => {},
});

export const useSettingsSheet = () => useContext(SheetContext);
