import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, } from "react";
import { LANG_NAMES, TRANSLATIONS } from "./translations";
const STORAGE_KEY = "parallax-lang";
function detectInitial() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === "en" ||
            saved === "de" ||
            saved === "fr" ||
            saved === "pt-BR" ||
            saved === "ru" ||
            saved === "zh-SG" ||
            saved === "zh-TW") {
            return saved;
        }
    }
    catch {
        /* localStorage unavailable — fall through */
    }
    const nav = typeof navigator !== "undefined" ? navigator.language : "en";
    const lower = nav?.toLowerCase() ?? "";
    if (lower.startsWith("pt"))
        return "pt-BR";
    if (lower.startsWith("de"))
        return "de";
    if (lower.startsWith("fr"))
        return "fr";
    if (lower.startsWith("ru"))
        return "ru";
    // Traditional Chinese locales (Taiwan, Hong Kong, Macau) map to zh-TW.
    if (lower.startsWith("zh-tw") ||
        lower.startsWith("zh-hk") ||
        lower.startsWith("zh-mo") ||
        lower.startsWith("zh-hant")) {
        return "zh-TW";
    }
    // Simplified Chinese locales map to zh-SG.
    if (lower === "zh" ||
        lower.startsWith("zh-cn") ||
        lower.startsWith("zh-sg") ||
        lower.startsWith("zh-hans")) {
        return "zh-SG";
    }
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
