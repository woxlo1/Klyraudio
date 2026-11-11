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
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { uid } from "../lib/format";
import { useI18n } from "../i18n";

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastInput {
  message: string;
  title?: string;
  tone?: ToastTone;
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: string;
  tone: ToastTone;
}

interface ToastContextValue {
  notify: (input: ToastInput | string, tone?: ToastTone) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_ICON = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const { t } = useI18n();

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback((input: ToastInput | string, tone: ToastTone = "info") => {
    const resolved: ToastInput = typeof input === "string" ? { message: input, tone } : input;
    const id = uid("toast");
    setItems((current) => [
      ...current.slice(-4),
      { ...resolved, id, tone: resolved.tone ?? "info" },
    ]);
    return id;
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-label={t("a11y.toast")}>
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const Icon = TONE_ICON[item.tone];
  // The provider re-renders whenever notifications change; keep the timer
  // independent of those renders so unrelated toasts do not reset it.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });
  useEffect(() => {
    const duration = item.durationMs ?? (item.tone === "error" ? 9000 : 5000);
    const timer = window.setTimeout(() => dismissRef.current(), duration);
    return () => window.clearTimeout(timer);
  }, [item.durationMs, item.tone]);
  return (
    <div className={`toast toast--${item.tone}`} role="status">
      <Icon size={18} aria-hidden="true" className="toast__icon" />
      <div className="toast__body">
        {item.title ? <strong className="toast__title">{item.title}</strong> : null}
        <span>{item.message}</span>
      </div>
      <button
        type="button"
        className="icon-button icon-button--small"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside <ToastProvider>");
  return value;
}
