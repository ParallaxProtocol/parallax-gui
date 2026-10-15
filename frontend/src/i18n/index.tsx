import { useCallback, useEffect, useMemo, useState, ReactNode } from "react";
import { LanguageContext, type Ctx } from "./context";
import { Dict, en, Lang, loadDict } from "./translations";

const STORAGE_KEY = "parallax-lang";

function detectInitial(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (
      saved === "en" ||
      saved === "de" ||
      saved === "fr" ||
      saved === "pt-BR" ||
      saved === "ru" ||
      saved === "zh-SG" ||
      saved === "zh-TW"
    ) {
      return saved;
    }
  } catch {
    /* localStorage unavailable — fall through */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  const lower = nav?.toLowerCase() ?? "";
  if (lower.startsWith("pt")) return "pt-BR";
  if (lower.startsWith("de")) return "de";
  if (lower.startsWith("fr")) return "fr";
  if (lower.startsWith("ru")) return "ru";
  // Traditional Chinese locales (Taiwan, Hong Kong, Macau) map to zh-TW.
  if (
    lower.startsWith("zh-tw") ||
    lower.startsWith("zh-hk") ||
    lower.startsWith("zh-mo") ||
    lower.startsWith("zh-hant")
  ) {
    return "zh-TW";
  }
  // Simplified Chinese locales map to zh-SG.
  if (lower === "zh" || lower.startsWith("zh-cn") || lower.startsWith("zh-sg") || lower.startsWith("zh-hans")) {
    return "zh-SG";
  }
  return "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitial);
  // The active language's dictionary. English shows until it has loaded
  // (a local chunk, so a moment at most); a failed load keeps English.
  const [dict, setDict] = useState<{ lang: Lang; strings: Dict }>({ lang: "en", strings: en });

  useEffect(() => {
    let alive = true;
    loadDict(lang)
      .then((strings) => alive && setDict({ lang, strings }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let str = dict.strings[key] ?? en[key] ?? key;
      if (vars) {
        for (const k of Object.keys(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k]));
        }
      }
      return str;
    },
    [dict],
  );

  const value = useMemo<Ctx>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// The context and its hooks live apart (context.ts), so a change to the
// strings never makes a second context
export { useAgo, useLang, useT } from "./context";

// LANG_NAMES is imported from ./translations directly: a module that
// exports anything but components and hooks can't be Fast Refreshed
export type { Lang };
