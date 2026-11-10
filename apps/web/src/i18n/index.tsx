import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en } from "./en";
import { ja } from "./ja";
import type { Locale, Messages } from "./types";

const TREES: Record<Locale, Messages> = { en, ja };
const STORAGE_KEY = "klyraudio.language";

export type TranslateVars = Record<string, string | number | boolean | null | undefined>;

function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "ja" || stored === "en") return stored;
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
  return "en";
}

function nodeAt(tree: Messages, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, tree);
}

function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

export function translate(locale: Locale, key: string, vars?: TranslateVars): string {
  let value = nodeAt(TREES[locale], key);
  if (value === undefined) value = nodeAt(en, key);
  if (value === undefined) return key;
  if (typeof value === "string") return interpolate(value, vars);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const count = Number(vars?.count ?? 1);
    const forms = value as Record<string, string>;
    const template = count === 1 ? forms.one ?? forms.other : forms.other ?? forms.one;
    return template ? interpolate(template, { ...vars, count }) : key;
  }
  return key;
}

export function translateList(locale: Locale, key: string): string[] {
  const value = nodeAt(TREES[locale], key) ?? nodeAt(en, key);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

export interface I18nValue {
  language: Locale;
  locale: string;
  setLanguage: (language: Locale) => void;
  t: (key: string, vars?: TranslateVars) => string;
  tList: (key: string) => string[];
  formatDate: (iso: string | null | undefined, withTime?: boolean) => string;
  formatRelative: (iso: string | null | undefined) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  initialLanguage?: Locale;
}) {
  const [language, setLanguageState] = useState<Locale>(initialLanguage ?? readStoredLocale());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Ignore storage failures; the language still applies for this session.
    }
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Locale) => {
    setLanguageState(next);
  }, []);

  const t = useCallback(
    (key: string, vars?: TranslateVars) => translate(language, key, vars),
    [language],
  );
  const tList = useCallback((key: string) => translateList(language, key), [language]);
  const locale = language === "ja" ? "ja-JP" : "en-US";

  const formatDate = useCallback(
    (iso: string | null | undefined, withTime = true) => {
      if (!iso) return "—";
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return "—";
      try {
        return new Intl.DateTimeFormat(locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
          ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
        }).format(date);
      } catch {
        return date.toLocaleString();
      }
    },
    [locale],
  );

  const formatRelative = useCallback(
    (iso: string | null | undefined) => {
      if (!iso) return "—";
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return "—";
      const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
      if (seconds < 60) return t("time.justNow");
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return t("time.minutesAgo", { count: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t("time.hoursAgo", { count: hours });
      const days = Math.floor(hours / 24);
      if (days < 7) return t("time.daysAgo", { count: days });
      return formatDate(iso, false);
    },
    [formatDate, t],
  );

  const value = useMemo<I18nValue>(
    () => ({
      language,
      locale,
      setLanguage,
      t,
      tList,
      formatDate,
      formatRelative,
    }),
    [language, locale, setLanguage, t, tList, formatDate, formatRelative],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}

export { TREES };
