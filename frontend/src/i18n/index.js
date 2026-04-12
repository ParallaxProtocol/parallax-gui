import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, } from "react";
import { LANG_NAMES, TRANSLATIONS } from "./translations";
const STORAGE_KEY = "parallax-lang";
function detectInitial() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === "en" || saved === "pt-BR")
            return saved;
    }
    catch {
        /* localStorage unavailable — fall through */
    }
    const nav = typeof navigator !== "undefined" ? navigator.language : "en";
    if (nav && nav.toLowerCase().startsWith("pt"))
        return "pt-BR";
    return "en";
}
const LanguageContext = createContext(null);
export function LanguageProvider({ children }) {
    const [lang, setLangState] = useState(detectInitial);
    const setLang = useCallback((l) => {
        setLangState(l);
        try {
            localStorage.setItem(STORAGE_KEY, l);
        }
        catch {
            /* ignore */
        }
    }, []);
    useEffect(() => {
        document.documentElement.lang = lang;
    }, [lang]);
    const t = useCallback((key, vars) => {
        const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
        let str = dict[key] ?? TRANSLATIONS.en[key] ?? key;
        if (vars) {
            for (const k of Object.keys(vars)) {
                str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k]));
            }
        }
        return str;
    }, [lang]);
    const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
    return (_jsx(LanguageContext.Provider, { value: value, children: children }));
}
export function useLang() {
    const ctx = useContext(LanguageContext);
    if (!ctx)
        throw new Error("useLang must be used inside LanguageProvider");
    return ctx;
}
export function useT() {
    return useLang().t;
}
export { LANG_NAMES };
