import { createContext, useContext, useMemo } from "react";
import type { Lang } from "./translations";

// The language context, apart from the provider (index.tsx) and from the
// strings: a module imported only for its types isn't one this depends on
// when the app runs, so editing a translation hot-reloads the provider
// without making a second context, which the components still holding the
// first would no longer find.

export type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export const LanguageContext = createContext<Ctx | null>(null);

export function useLang() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLang must be used inside LanguageProvider");
  return ctx;
}

export function useT() {
  return useLang().t;
}

/**
 * useAgo returns a formatter for how long ago a unix time (seconds) was,
 * in the interface language: "3 minutes ago", "vor 3 Minuten".
 */
export function useAgo() {
  const { lang } = useLang();
  return useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
    return (unixSeconds: number, now = Date.now()) => {
      const s = Math.round(unixSeconds - now / 1000);
      const a = Math.abs(s);
      if (a < 60) return rtf.format(s, "second");
      if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
      if (a < 86_400) return rtf.format(Math.round(s / 3600), "hour");
      return rtf.format(Math.round(s / 86_400), "day");
    };
  }, [lang]);
}
