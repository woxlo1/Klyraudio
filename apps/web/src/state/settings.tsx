import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api/client";
import type { RuntimeSettings, RuntimeSettingsUpdate, SystemInfo } from "../api/types";
import { useI18n } from "../i18n";
import type { Locale } from "../i18n/types";

interface SettingsContextValue {
  settings: RuntimeSettings | null;
  system: SystemInfo | null;
  online: boolean | null;
  loading: boolean;
  loadError: unknown;
  refresh: () => Promise<void>;
  update: (patch: RuntimeSettingsUpdate) => Promise<RuntimeSettings>;
  setLanguage: (language: Locale) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function resolvedTheme(theme: string): "dark" | "light" {
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { setLanguage: setI18nLanguage } = useI18n();
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSettings, nextSystem] = await Promise.all([api.getSettings(), api.systemInfo()]);
      if (!mounted.current) return;
      setSettings(nextSettings);
      setSystem(nextSystem);
      setOnline(true);
      setLoadError(null);
      if (nextSettings.language === "ja" || nextSettings.language === "en") {
        setI18nLanguage(nextSettings.language);
      }
    } catch (error) {
      if (!mounted.current) return;
      setOnline(false);
      setLoadError(error);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [setI18nLanguage]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    let timer = 0;
    const probe = async () => {
      try {
        await api.health();
        if (mounted.current) setOnline(true);
      } catch {
        if (mounted.current) setOnline(false);
      }
    };
    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (document.visibilityState !== "hidden") await probe();
        schedule();
      }, 25000);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!settings) return;
    const apply = () => {
      document.documentElement.dataset.theme = resolvedTheme(settings.theme);
    };
    apply();
    document.documentElement.dataset.reduceMotion = settings.reduce_motion ? "true" : "false";
    if (settings.theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const listener = () => apply();
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [settings]);

  const update = useCallback(async (patch: RuntimeSettingsUpdate) => {
    const next = await api.updateSettings(patch);
    if (mounted.current) {
      setSettings(next);
      setOnline(true);
    }
    return next;
  }, []);

  const setLanguage = useCallback(
    async (language: Locale) => {
      setI18nLanguage(language);
      try {
        const next = await api.updateSettings({ language });
        if (mounted.current) setSettings(next);
      } catch {
        // The interface language still changes for this session when the service is offline.
      }
    },
    [setI18nLanguage],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      system,
      online,
      loading,
      loadError,
      refresh,
      update,
      setLanguage,
    }),
    [settings, system, online, loading, loadError, refresh, update, setLanguage],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside <SettingsProvider>");
  return value;
}
