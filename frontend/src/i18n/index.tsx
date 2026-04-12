import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { Lang, LANG_NAMES, TRANSLATIONS } from "./translations";

const STORAGE_KEY = "parallax-lang";

function detectInitial(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "fr" || saved === "pt-BR") return saved;
  } catch {
    /* localStorage unavailable — fall through */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  const lower = nav?.toLowerCase() ?? "";
  if (lower.startsWith("pt")) return "pt-BR";
  if (lower.startsWith("fr")) return "fr";
  return "en";
}

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitial);

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
      const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
      let str = dict[key] ?? TRANSLATIONS.en[key] ?? key;
      if (vars) {
        for (const k of Object.keys(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k]));
        }
      }
      return str;
    },
    [lang],
  );

  const value = useMemo<Ctx>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLang must be used inside LanguageProvider");
  return ctx;
}

export function useT() {
  return useLang().t;
}

export { LANG_NAMES };
export type { Lang };
